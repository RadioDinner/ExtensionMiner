// Pure helpers for extracting the Monarch web app's session from web storage.
// Historically the app persisted redux state under localStorage "persist:root"
// with the auth token at JSON.parse(JSON.parse(ls["persist:root"]).user).token
// and the device id under "monarchDeviceUUID" (SPEC.md §R3). Monarch migrated
// domains in Jan 2026 and may move storage again, so the hunt tries several
// strategies and reports which one hit.

export function extractMonarchToken(persistRootRaw: string | null): string | null {
  if (!persistRootRaw) return null;
  try {
    const root: unknown = JSON.parse(persistRootRaw);
    if (typeof root !== "object" || root === null) return null;
    const userRaw = (root as Record<string, unknown>)["user"];
    if (typeof userRaw !== "string") return null;
    const user: unknown = JSON.parse(userRaw);
    if (typeof user !== "object" || user === null) return null;
    const token = (user as Record<string, unknown>)["token"];
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export function extractDeviceUuid(raw: string | null): string | null {
  if (!raw) return null;
  // Stored either as a bare string or a JSON-quoted string depending on writer.
  const unquoted = raw.replace(/^"|"$/g, "");
  return unquoted.length > 0 ? unquoted : null;
}

export interface TokenHunt {
  token: string | null;
  /** Which strategy found it, e.g. "persist:root.user.token" — null if none hit. */
  strategy: string | null;
}

const TOKEN_FIELDS = ["token", "authToken", "accessToken"];

function tokenFromObject(obj: unknown): string | null {
  if (typeof obj !== "object" || obj === null) return null;
  for (const field of TOKEN_FIELDS) {
    const v = (obj as Record<string, unknown>)[field];
    if (typeof v === "string" && v.length >= 16) return v;
  }
  return null;
}

/**
 * Multi-strategy token hunt over a storage snapshot (key -> raw value).
 * Order: the known-good persist:root path, then any other persist:* key
 * (redux-persist slices are double-encoded), then bare token-ish keys.
 */
export function huntMonarchToken(entries: Record<string, string>): TokenHunt {
  const known = extractMonarchToken(entries["persist:root"] ?? null);
  if (known && known.length >= 16) return { token: known, strategy: "persist:root.user.token" };

  for (const [key, raw] of Object.entries(entries)) {
    if (!key.startsWith("persist:")) continue;
    try {
      const root: unknown = JSON.parse(raw);
      if (typeof root !== "object" || root === null) continue;
      // Slice values are JSON-encoded strings; also tolerate plain objects.
      for (const [sliceName, sliceRaw] of Object.entries(root as Record<string, unknown>)) {
        const slice = typeof sliceRaw === "string" ? safeParse(sliceRaw) : sliceRaw;
        const token = tokenFromObject(slice);
        if (token) return { token, strategy: `${key}.${sliceName}` };
      }
      const direct = tokenFromObject(root);
      if (direct) return { token: direct, strategy: key };
    } catch {
      // not JSON — skip
    }
  }

  for (const field of TOKEN_FIELDS) {
    const raw = entries[field];
    if (typeof raw !== "string" || raw.length === 0) continue;
    const unquoted = raw.replace(/^"|"$/g, "");
    if (unquoted.length >= 16) return { token: unquoted, strategy: `localStorage.${field}` };
    const parsed = safeParse(raw);
    const token = tokenFromObject(parsed);
    if (token) return { token, strategy: `localStorage.${field}.*` };
  }

  return { token: null, strategy: null };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Redacted description of a storage snapshot for diagnostics: key NAMES and
 * shapes only — never values. Safe to console.log and paste into a bug report.
 */
export function describeStorageForDiagnostics(entries: Record<string, string>): {
  keys: string[];
  persistShapes: Record<string, string[]>;
} {
  const keys = Object.keys(entries).sort();
  const persistShapes: Record<string, string[]> = {};
  for (const key of keys) {
    if (!key.startsWith("persist:")) continue;
    const parsed = safeParse(entries[key] ?? "");
    if (typeof parsed === "object" && parsed !== null) {
      persistShapes[key] = Object.keys(parsed as Record<string, unknown>).sort();
    }
  }
  return { keys, persistShapes };
}
