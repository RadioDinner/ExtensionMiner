// Pure helpers for extracting the Monarch web app's session from web storage.
// Historically the app persisted redux state under localStorage "persist:root"
// with the auth token at JSON.parse(JSON.parse(ls["persist:root"]).user).token
// (SPEC.md §R3). Since Monarch's Jan-2026 domain migration + OAuth flow, the
// token moved, so we hunt by VALUE SHAPE across the persisted slices instead of
// trusting one field name, and we expose a redacted fingerprint for diagnosis.

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
  const unquoted = raw.replace(/^"|"$/g, "");
  return unquoted.length > 0 ? unquoted : null;
}

// ---------------------------------------------------------------------------
// Shape-based token hunt
// ---------------------------------------------------------------------------

export type StringClass =
  | "jwt"
  | "hex40"
  | "hex"
  | "alnum"
  | "uuid"
  | "email"
  | "url"
  | "other";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT_RE = /^[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}$/;
const HEX40_RE = /^[a-f0-9]{40}$/i;
const HEX_RE = /^[a-f0-9]{16,}$/i;
const ALNUM_RE = /^[A-Za-z0-9._-]{20,}$/;

export function classifyString(s: string): StringClass {
  if (UUID_RE.test(s)) return "uuid";
  if (JWT_RE.test(s)) return "jwt";
  if (s.includes("@")) return "email";
  if (/^https?:\/\//i.test(s)) return "url";
  if (HEX40_RE.test(s)) return "hex40";
  if (HEX_RE.test(s)) return "hex";
  if (ALNUM_RE.test(s)) return "alnum";
  return "other";
}

// Only these top-level storage keys are searched, so unrelated widgets that
// happen to store their own "*userToken" (e.g. the Gist/Intercom chat widget)
// can never be mistaken for the Monarch session.
const TOKEN_FIELDS = ["token", "authToken", "accessToken"];
function isSearchableContainer(key: string): boolean {
  return key.startsWith("persist:") || TOKEN_FIELDS.includes(key);
}

// Leaf names that look tokenish but are known NOT to be the API bearer token.
const DENY_LEAF_RE = /(uuid|device|oauthstate|^state$|anon|csrf|_persist|refresh)/i;
// Leaf names that strongly indicate the API bearer token.
const PREFER_LEAF_RE = /(^|\.)(token|authToken|accessToken|apiToken|sessionToken)$/i;

interface StringLeaf {
  path: string;
  value: string;
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// Walk a (possibly double-JSON-encoded) value, collecting string leaves.
// redux-persist stores each slice as a JSON string, so string values that
// parse to objects are recursed into rather than treated as leaves.
function walkStrings(value: unknown, path: string, out: StringLeaf[], budget: { n: number }): void {
  if (budget.n <= 0) return;
  budget.n -= 1;
  if (typeof value === "string") {
    const parsed = tryParse(value);
    if (parsed !== undefined && typeof parsed === "object" && parsed !== null) {
      walkStrings(parsed, path, out, budget);
    } else {
      out.push({ path, value });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, out, budget));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      walkStrings(v, path ? `${path}.${k}` : k, out, budget);
    }
  }
}

function collectLeaves(entries: Record<string, string>): StringLeaf[] {
  const out: StringLeaf[] = [];
  const budget = { n: 5000 };
  for (const [key, raw] of Object.entries(entries)) {
    if (!isSearchableContainer(key)) continue;
    const parsed = tryParse(raw);
    if (parsed !== undefined && typeof parsed === "object" && parsed !== null) {
      walkStrings(parsed, key, out, budget);
    } else {
      // Bare token key whose value is the raw token string.
      out.push({ path: key, value: raw.replace(/^"|"$/g, "") });
    }
  }
  return out;
}

function leafName(path: string): string {
  const afterDot = path.split(".").pop() ?? path;
  return afterDot.split("[")[0] ?? afterDot;
}

function scoreCandidate(leaf: StringLeaf, cls: StringClass): number | null {
  if (cls === "uuid" || cls === "email" || cls === "url" || cls === "other") return null;
  if (DENY_LEAF_RE.test(leafName(leaf.path))) return null;
  const classScore = { jwt: 400, hex40: 300, hex: 200, alnum: 100 }[cls];
  const nameBonus = PREFER_LEAF_RE.test(leaf.path) ? 1000 : 0;
  return nameBonus + classScore + Math.min(leaf.value.length, 200);
}

export interface TokenHunt {
  token: string | null;
  /** Full storage path the token was found at, e.g. "persist:root.user.token" — null if none. */
  strategy: string | null;
}

/** Search a storage snapshot (key -> raw value) for the Monarch API bearer token. */
export function huntMonarchToken(entries: Record<string, string>): TokenHunt {
  // Fast path: the historically-correct exact location.
  const known = extractMonarchToken(entries["persist:root"] ?? null);
  if (known && known.length >= 16) return { token: known, strategy: "persist:root.user.token" };

  let best: { leaf: StringLeaf; score: number } | null = null;
  for (const leaf of collectLeaves(entries)) {
    const score = scoreCandidate(leaf, classifyString(leaf.value));
    if (score === null) continue;
    if (!best || score > best.score) best = { leaf, score };
  }
  return best ? { token: best.leaf.value, strategy: best.leaf.path } : { token: null, strategy: null };
}

// ---------------------------------------------------------------------------
// Redacted diagnostics
// ---------------------------------------------------------------------------

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export interface StorageDiagnostics {
  keys: string[];
  persistShapes: Record<string, string[]>;
  /** Deep field fingerprint of persist:root + persist:auth: path -> "class/len". No values. */
  fingerprint: Record<string, string>;
}

/**
 * Describe a storage snapshot for a bug report: key NAMES, slice shapes, and a
 * per-field fingerprint (character class + length) for the auth-bearing slices.
 * Never emits a single stored value — safe to console.log and paste.
 */
export function describeStorageForDiagnostics(entries: Record<string, string>): StorageDiagnostics {
  const keys = Object.keys(entries).sort();
  const persistShapes: Record<string, string[]> = {};
  for (const key of keys) {
    if (!key.startsWith("persist:")) continue;
    const parsed = safeParse(entries[key] ?? "");
    if (typeof parsed === "object" && parsed !== null) {
      persistShapes[key] = Object.keys(parsed as Record<string, unknown>).sort();
    }
  }

  const fingerprint: Record<string, string> = {};
  const budget = { n: 5000 };
  for (const key of ["persist:root", "persist:auth"]) {
    const raw = entries[key];
    if (!raw) continue;
    const parsed = tryParse(raw);
    if (parsed === undefined || typeof parsed !== "object" || parsed === null) continue;
    const leaves: StringLeaf[] = [];
    walkStrings(parsed, key, leaves, budget);
    for (const leaf of leaves) {
      if (leaf.value.length < 6) continue;
      fingerprint[leaf.path] = `${classifyString(leaf.value)}/${leaf.value.length}`;
    }
  }
  return { keys, persistShapes, fingerprint };
}
