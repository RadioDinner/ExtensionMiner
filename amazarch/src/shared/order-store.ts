// Persistent per-account Amazon order cache (multi-account, D11). Amazon keeps
// only ONE active session at a time (SPEC.md §R1), so we cannot fetch two
// accounts at once. Instead each sync scrapes whichever account is active,
// MERGES those orders into that account's bucket here, and the matcher runs
// against the UNION of every account's cached orders. Switching accounts on
// amazon.com and syncing again fills the other bucket. Kept in
// browser.storage.local (financial data stays on-device, never a server —
// COMMERCIALIZATION.md). Pure merge/union helpers are unit-tested; thin storage
// wrappers wrap them.
import browser from "webextension-polyfill";
import type { AmazonAccountSummary, AmazonOrderLite } from "./messages";

export interface AccountOrders {
  orders: AmazonOrderLite[];
  lastSync: number; // epoch ms of the last successful scrape into this bucket
}
export interface OrderStore {
  accounts: Record<string, AccountOrders>;
}

const KEY = "amazarchOrderStore";

/** Bucket label used when the account name can't be read from the page. */
export const DEFAULT_ACCOUNT = "Amazon account";

export function emptyStore(): OrderStore {
  return { accounts: {} };
}

/** Amazon order ids are globally unique; fall back to a date|total|item key when
 *  an id wasn't parsed. Shared with the background so cache keys never drift. */
export function orderKey(o: AmazonOrderLite): string {
  return o.orderId || `${o.date}|${o.totalCents}|${o.itemTitles[0] ?? ""}`;
}

/** Pure: coerce whatever is in storage into a valid store. */
export function parseOrderStore(raw: unknown): OrderStore {
  if (typeof raw !== "object" || raw === null) return emptyStore();
  const accountsRaw = (raw as Record<string, unknown>)["accounts"];
  if (typeof accountsRaw !== "object" || accountsRaw === null) return emptyStore();
  const accounts: Record<string, AccountOrders> = {};
  for (const [label, v] of Object.entries(accountsRaw as Record<string, unknown>)) {
    if (typeof v !== "object" || v === null) continue;
    const o = v as Record<string, unknown>;
    const orders = Array.isArray(o["orders"]) ? (o["orders"] as AmazonOrderLite[]) : [];
    const lastSync = typeof o["lastSync"] === "number" ? o["lastSync"] : 0;
    accounts[label] = { orders, lastSync };
  }
  return { accounts };
}

/** Pure: merge freshly-scraped orders for one account into the store. Orders are
 *  historical facts, so we UNION by order key (a shallow re-sync never drops the
 *  deep-synced older orders) and keep a return hint once seen. Each merged order
 *  is tagged with the account. */
export function mergeAccountOrders(
  store: OrderStore,
  label: string,
  fresh: AmazonOrderLite[],
  now: number,
): OrderStore {
  const byKey = new Map<string, AmazonOrderLite>();
  for (const o of store.accounts[label]?.orders ?? []) byKey.set(orderKey(o), o);
  for (const o of fresh) {
    const k = orderKey(o);
    const existing = byKey.get(k);
    byKey.set(k, {
      ...(existing ?? {}),
      ...o,
      account: label,
      returnHint: Boolean(existing?.returnHint) || Boolean(o.returnHint),
    });
  }
  return {
    accounts: { ...store.accounts, [label]: { orders: [...byKey.values()], lastSync: now } },
  };
}

/** Pure: drop an account's bucket entirely. */
export function forgetAccount(store: OrderStore, label: string): OrderStore {
  const accounts = { ...store.accounts };
  delete accounts[label];
  return { accounts };
}

/** Pure: every account's orders, deduped by key (return hint wins). This is what
 *  the matcher runs against. */
export function unionOrders(store: OrderStore): AmazonOrderLite[] {
  const byKey = new Map<string, AmazonOrderLite>();
  for (const acc of Object.values(store.accounts)) {
    for (const o of acc.orders) {
      const k = orderKey(o);
      const existing = byKey.get(k);
      if (!existing) byKey.set(k, o);
      else byKey.set(k, { ...existing, ...o, returnHint: Boolean(existing.returnHint) || Boolean(o.returnHint) });
    }
  }
  return [...byKey.values()];
}

/** Pure: one summary row per account, active first then most-recently-synced. */
export function summarizeAccounts(store: OrderStore, activeLabel: string | null): AmazonAccountSummary[] {
  return Object.entries(store.accounts)
    .map(([label, a]) => ({ label, count: a.orders.length, lastSync: a.lastSync, active: label === activeLabel }))
    .sort((a, b) => Number(b.active) - Number(a.active) || b.lastSync - a.lastSync);
}

// --- storage wrappers --------------------------------------------------------

export async function loadOrderStore(): Promise<OrderStore> {
  try {
    const got = await browser.storage.local.get(KEY);
    return parseOrderStore((got as Record<string, unknown>)?.[KEY]);
  } catch {
    return emptyStore();
  }
}

export async function saveOrderStore(store: OrderStore): Promise<void> {
  await browser.storage.local.set({ [KEY]: store });
}

/** Merge a scrape into the store and persist; returns the updated store. */
export async function recordAccountOrders(label: string, fresh: AmazonOrderLite[]): Promise<OrderStore> {
  const merged = mergeAccountOrders(await loadOrderStore(), label, fresh, Date.now());
  await saveOrderStore(merged);
  return merged;
}

/** Forget an account and persist; returns the updated store. */
export async function removeAccount(label: string): Promise<OrderStore> {
  const next = forgetAccount(await loadOrderStore(), label);
  await saveOrderStore(next);
  return next;
}
