// Tracks the one-time DEEP order fetch. The "initial sync history" setting
// applies to the FIRST sync: once a deep fetch covering at least the configured
// months has succeeded, later syncs drop back to Amazon's fast default (past
// 3 months). Raising the setting (or clearing this record from the popup)
// makes the next sync deep again.
import browser from "webextension-polyfill";
import type { AmazarchSettings } from "./settings";

export interface DeepSyncRecord {
  months: number; // lookback the completed deep fetch covered
  at: number; // epoch ms
}

const KEY = "amazarchDeepSync";

/** Pure: coerce whatever is in storage into a record (or null). */
export function parseDeepSync(raw: unknown): DeepSyncRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o["months"] !== "number" || typeof o["at"] !== "number") return null;
  return { months: o["months"], at: o["at"] };
}

/** Pure: how many months THIS fetch should cover. */
export function effectiveLookbackMonths(s: AmazarchSettings, done: DeepSyncRecord | null): number {
  if (s.lookbackMonths <= 3) return s.lookbackMonths;
  return done && done.months >= s.lookbackMonths ? 3 : s.lookbackMonths;
}

export async function loadDeepSync(): Promise<DeepSyncRecord | null> {
  try {
    const got = await browser.storage.local.get(KEY);
    return parseDeepSync((got as Record<string, unknown>)?.[KEY]);
  } catch {
    return null;
  }
}

export async function recordDeepSync(months: number): Promise<void> {
  await browser.storage.local.set({ [KEY]: { months, at: Date.now() } satisfies DeepSyncRecord });
}

export async function clearDeepSync(): Promise<void> {
  await browser.storage.local.remove(KEY);
}
