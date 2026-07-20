// Tracks the one-time DEEP order fetch, PER AMAZON ACCOUNT (multi-account, D11).
// The "initial sync history" setting applies to the FIRST sync of each account:
// once a deep fetch covering at least the configured months has succeeded for an
// account, that account's later syncs drop back to Amazon's fast default (past
// 3 months). Each account gets its own deep first sync (your spouse's account is
// not marked "done" just because yours was). Raising the setting (or clearing the
// record from the popup) makes the next sync deep again.
import browser from "webextension-polyfill";
import type { AmazarchSettings } from "./settings";
import { DEFAULT_ACCOUNT } from "./order-store";

export interface DeepSyncRecord {
  months: number; // lookback the completed deep fetch covered
  at: number; // epoch ms
}

/** account label → its deep-sync record. */
export type DeepSyncMap = Record<string, DeepSyncRecord>;

const KEY = "amazarchDeepSync";

/** Pure: coerce a single record (or null). */
export function parseDeepSync(raw: unknown): DeepSyncRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o["months"] !== "number" || typeof o["at"] !== "number") return null;
  return { months: o["months"], at: o["at"] };
}

/** Pure: coerce the stored value into a per-account map. Migrates a legacy single
 *  record (pre-multi-account) into the default account's slot. */
export function parseDeepSyncMap(raw: unknown): DeepSyncMap {
  if (typeof raw !== "object" || raw === null) return {};
  // Legacy shape was a bare { months, at } — migrate it under the default account.
  const legacy = parseDeepSync(raw);
  if (legacy) return { [DEFAULT_ACCOUNT]: legacy };
  const out: DeepSyncMap = {};
  for (const [label, v] of Object.entries(raw as Record<string, unknown>)) {
    const rec = parseDeepSync(v);
    if (rec) out[label] = rec;
  }
  return out;
}

/** Pure: an account's deep-sync record from the map (or null). */
export function recordForAccount(map: DeepSyncMap, account: string): DeepSyncRecord | null {
  return map[account] ?? null;
}

/** Pure: how many months THIS fetch should cover, given the account's record. */
export function effectiveLookbackMonths(s: AmazarchSettings, done: DeepSyncRecord | null): number {
  if (s.lookbackMonths <= 3) return s.lookbackMonths;
  return done && done.months >= s.lookbackMonths ? 3 : s.lookbackMonths;
}

export async function loadDeepSyncMap(): Promise<DeepSyncMap> {
  try {
    const got = await browser.storage.local.get(KEY);
    return parseDeepSyncMap((got as Record<string, unknown>)?.[KEY]);
  } catch {
    return {};
  }
}

/** The deepest record across accounts — for popup display (which has no active
 *  account context). */
export async function loadDeepSync(): Promise<DeepSyncRecord | null> {
  const recs = Object.values(await loadDeepSyncMap());
  if (recs.length === 0) return null;
  return recs.reduce((a, b) => (b.months > a.months ? b : a));
}

export async function recordDeepSync(months: number, account: string): Promise<void> {
  const map = await loadDeepSyncMap();
  map[account] = { months, at: Date.now() };
  await browser.storage.local.set({ [KEY]: map });
}

/** Clear every account's deep record (popup "fetch deep again"). */
export async function clearDeepSync(): Promise<void> {
  await browser.storage.local.remove(KEY);
}
