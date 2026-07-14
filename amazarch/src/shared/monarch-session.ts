// Pure helpers for extracting the Monarch web app's session from localStorage.
// The web app persists redux state under "persist:root"; the auth token lives at
// JSON.parse(JSON.parse(localStorage["persist:root"]).user).token and the device
// id under "monarchDeviceUUID" (see SPEC.md §R3).

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
