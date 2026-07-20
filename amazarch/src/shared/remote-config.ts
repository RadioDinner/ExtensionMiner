// Remote config / kill switch (Phase 1 commercialization). A paid extension that
// writes through Monarch's UNOFFICIAL GraphQL API needs a way to stop writing
// the moment Monarch changes that API — otherwise paying customers get corrupted
// writes until a store update ships. This polls a small static JSON and lets the
// owner flip writes into read-only "safe mode", require a minimum version, or
// show a banner — turning "the product is broken" into "read-only, fix coming".
// Fetched JSON is DATA, not code (MV3-legal). Fail-SAFE: an unreachable or
// malformed config never blocks writes (only an explicit writesEnabled:false,
// successfully fetched, pauses them). Pure logic is unit-tested.
import browser from "webextension-polyfill";
import { REMOTE_CONFIG_TTL_MS, REMOTE_CONFIG_URL } from "./config";

export interface RemoteConfig {
  writesEnabled: boolean; // false = read-only safe mode
  minVersion: string | null; // semver floor; below → update required
  message: string | null; // banner shown in the panel/popup
  fetchedAt: number; // ms; 0 = defaults, never fetched
}

export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
  writesEnabled: true,
  minVersion: null,
  message: null,
  fetchedAt: 0,
};

/** Pure: coerce a fetched/stored value into a RemoteConfig. writesEnabled is
 *  fail-safe — only an explicit boolean false disables writes. */
export function parseRemoteConfig(raw: unknown, fetchedAt: number): RemoteConfig {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    writesEnabled: o["writesEnabled"] === false ? false : true,
    minVersion: typeof o["minVersion"] === "string" ? o["minVersion"] : null,
    message: typeof o["message"] === "string" && o["message"].trim() ? o["message"] : null,
    fetchedAt,
  };
}

/** Pure: compare dotted numeric versions. -1 if a<b, 0 if equal, 1 if a>b.
 *  Non-numeric/extra segments are treated leniently (missing = 0). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export interface RemoteConfigEval {
  writesEnabled: boolean;
  updateRequired: boolean;
  message: string | null;
}

/** Pure: resolve the config against the running version. */
export function evaluateRemoteConfig(c: RemoteConfig, version: string): RemoteConfigEval {
  return {
    writesEnabled: c.writesEnabled !== false,
    updateRequired: c.minVersion ? compareVersions(version, c.minVersion) < 0 : false,
    message: c.message,
  };
}

// --- Storage + I/O -----------------------------------------------------------

const KEY = "amazarchRemoteConfig";

export async function loadRemoteConfig(): Promise<RemoteConfig> {
  try {
    const got = await browser.storage.local.get(KEY);
    const stored = (got as Record<string, unknown>)?.[KEY];
    if (stored && typeof stored === "object") {
      const o = stored as Record<string, unknown>;
      return parseRemoteConfig(o, typeof o["fetchedAt"] === "number" ? o["fetchedAt"] : 0);
    }
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULT_REMOTE_CONFIG };
}

/** Fetch + cache when stale (TTL). Returns the freshest config we can trust;
 *  any failure falls back to the cached/default config (never blocks). */
export async function refreshRemoteConfig(now: number = Date.now()): Promise<RemoteConfig> {
  if (!REMOTE_CONFIG_URL) return { ...DEFAULT_REMOTE_CONFIG };
  const cached = await loadRemoteConfig();
  if (cached.fetchedAt && now - cached.fetchedAt < REMOTE_CONFIG_TTL_MS) return cached;
  try {
    const res = await fetch(REMOTE_CONFIG_URL, { cache: "no-store" });
    if (!res.ok) return cached;
    const data: unknown = await res.json().catch(() => ({}));
    const fresh = parseRemoteConfig(data, now);
    await browser.storage.local.set({ [KEY]: fresh });
    return fresh;
  } catch {
    return cached;
  }
}
