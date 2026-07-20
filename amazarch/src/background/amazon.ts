// Amazon order retrieval via a background tab. Amazon encrypts order details
// client-side (Siege CSD — SPEC.md §R1), so we open the order-history page in a
// background tab, let the amazon content script scrape the decrypted DOM, and
// PAGINATE through the history (startIndex) to load more than the first page.
//
// Multi-account (D11): Amazon keeps only ONE active session at a time, so each
// sync scrapes whichever account is signed in, merges those orders into that
// account's bucket in the persistent order store, and returns the UNION of all
// accounts' cached orders to the matcher. Switching accounts on amazon.com and
// syncing again fills the other bucket. Deep-sync is tracked per account.
import browser from "webextension-polyfill";
import type { AmazonCheck, AmazonOrderLite, AmazonStatus } from "../shared/messages";
import { filterLabel, pageAllOlderThan, planLookback, yearFilterMismatch } from "../shared/lookback";
import { effectiveLookbackMonths, loadDeepSyncMap, recordDeepSync, recordForAccount } from "../shared/deep-sync";
import {
  DEFAULT_ACCOUNT,
  loadOrderStore,
  orderKey,
  recordAccountOrders,
  summarizeAccounts,
  unionOrders,
} from "../shared/order-store";
import { loadSettings } from "../shared/settings";

const TAB_TIMEOUT_MS = 50000; // must exceed the content script's decryption wait
const PAGE_SIZE = 10;
const MAX_PAGES_PER_FILTER = 20; // up to ~200 orders per time filter

// Amazon defaults the order page to "past three months"; older orders need a
// time filter. The React page reads timeFilter=, the legacy route read
// orderFilter= — send both, extras are ignored.
function pageUrl(startIndex: number, filter: string | null): string {
  const f = filter ? `&timeFilter=${filter}&orderFilter=${filter}` : "";
  return `https://www.amazon.com/gp/css/order-history?startIndex=${startIndex}${f}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Diag {
  cardCount: number;
  decrypted: boolean;
  url: string;
  waited: number;
}
interface Report {
  orders: AmazonOrderLite[];
  signedIn: boolean;
  account: string | null;
  diag?: Diag;
}

// Pending tab scrapes, keyed by tabId → resolver called when its content script reports.
const pending = new Map<number, (r: Report) => void>();

/** Called by the message router when an amazon content script reports orders. */
export function resolveAmazonReport(
  tabId: number | undefined,
  orders: AmazonOrderLite[],
  signedIn: boolean,
  account: string | null,
  diag?: Diag,
): void {
  if (tabId === undefined) return;
  const resolve = pending.get(tabId);
  if (resolve) resolve({ orders, signedIn, account, diag });
}

function waitForReport(tabId: number): Promise<Report> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(tabId);
      resolve({ orders: [], signedIn: true, account: null }); // timed out — treat as end of pages
    }, TAB_TIMEOUT_MS);
    pending.set(tabId, (r) => {
      clearTimeout(timer);
      pending.delete(tabId);
      resolve(r);
    });
  });
}

export async function fetchAmazonViaTab(
  onProgress?: (label: string) => void,
): Promise<AmazonCheck> {
  const settings = await loadSettings();
  const deepMap = await loadDeepSyncMap();

  let tabId: number | undefined;
  const scraped = new Map<string, AmazonOrderLite>(); // orders scraped THIS run (active account)
  let signedIn = true;
  let pagesRead = 0;
  let lastDiag: Diag | undefined;
  let activeAccount: string | null = null;
  let months = settings.lookbackMonths;
  const filterWarnings: string[] = [];

  // Add a page of orders to the run's set; keep a return hint once seen.
  const add = (orders: AmazonOrderLite[]): number => {
    let added = 0;
    for (const o of orders) {
      const key = orderKey(o);
      const existing = scraped.get(key);
      if (!existing) {
        scraped.set(key, o);
        added += 1;
      } else if (o.returnHint && !existing.returnHint) {
        existing.returnHint = true;
      }
    }
    return added;
  };

  // Page through one time filter (startIndex pagination) until a page adds
  // nothing new or is entirely older than the lookback cutoff (pages are
  // newest-first). Returns the orders seen under this filter (for mismatch
  // detection). startPage lets the caller skip page 0 when it was already read.
  const pageFilter = async (
    filter: string | null,
    cutoffIso: string | undefined,
    startPage: number,
  ): Promise<AmazonOrderLite[]> => {
    const seen: AmazonOrderLite[] = [];
    for (let page = startPage; page < MAX_PAGES_PER_FILTER; page++) {
      await browser.tabs.update(tabId!, { url: pageUrl(page * PAGE_SIZE, filter) });
      onProgress?.(`Reading ${filterLabel(filter)} — page ${page + 1} (${scraped.size} so far, waiting for decryption…)`);
      const r = await waitForReport(tabId!);
      signedIn = r.signedIn;
      if (r.diag) lastDiag = r.diag;
      if (r.account) activeAccount = r.account;
      if (!r.signedIn) break;
      pagesRead += 1;
      seen.push(...r.orders);
      const added = add(r.orders);
      if (r.orders.length === 0 || added === 0) break;
      if (cutoffIso && pageAllOlderThan(r.orders, cutoffIso)) break;
    }
    return seen;
  };

  try {
    onProgress?.("Opening Amazon in a background tab…");
    // Always load the default page first: it carries the signed-in account name
    // and the most recent orders, and lets us pick the depth for THIS account.
    const tab = await browser.tabs.create({ url: pageUrl(0, null), active: false });
    tabId = tab.id;
    if (tabId === undefined) return errCheck("could not open an Amazon tab");

    onProgress?.("Reading recent Amazon orders (waiting for decryption…)");
    const first = await waitForReport(tabId);
    signedIn = first.signedIn;
    if (first.diag) lastDiag = first.diag;
    if (first.account) activeAccount = first.account;

    if (signedIn) {
      pagesRead += 1;
      add(first.orders);

      // Depth for THIS account: deep only until an account's own deep fetch of
      // at least the configured months has succeeded.
      const label = activeAccount ?? DEFAULT_ACCOUNT;
      months = effectiveLookbackMonths(settings, recordForAccount(deepMap, label));
      const plan = planLookback(todayIso(), months);

      // Finish paging the default (recent) window beyond page 0.
      await pageFilter(null, plan.cutoffIso, 1);

      // Deep sync: walk each year filter (page 0). The default page already
      // captured the newest orders; dedupe merges the overlap.
      if (months > 3) {
        for (const filter of plan.filters) {
          if (filter === null) continue; // the default window is already done
          const seenThisFilter = await pageFilter(filter, plan.cutoffIso, 0);
          if (yearFilterMismatch(filter, seenThisFilter)) filterWarnings.push(filterLabel(filter));
        }
      }
    }
  } catch (e) {
    return errCheck(`Amazon tab error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (tabId !== undefined) await browser.tabs.remove(tabId).catch(() => {});
  }

  const label = activeAccount ?? DEFAULT_ACCOUNT;

  // Persist this account's scrape (merged into its bucket), then match against
  // the UNION of every account. A completed deep pass (signed in, orders found,
  // filters applied cleanly) makes THIS account's later syncs fast; a filter
  // warning means coverage is unproven, so we don't record it.
  let store = await loadOrderStore();
  if (signedIn && scraped.size > 0) {
    store = await recordAccountOrders(label, [...scraped.values()]);
    if (months > 3 && filterWarnings.length === 0) await recordDeepSync(months, label);
  }
  const orders = unionOrders(store);
  const accounts = summarizeAccounts(store, signedIn ? label : null);

  let note: string;
  if (!signedIn) {
    note =
      orders.length > 0
        ? `Not signed in to Amazon — showing ${orders.length} cached orders. Sign in and re-sync to refresh.`
        : "Not signed in to Amazon — open amazon.com and sign in, then re-sync";
  } else if (scraped.size > 0) {
    const others = accounts.filter((a) => !a.active).length;
    note =
      `${scraped.size} orders read for ${label} from ${pagesRead} page${pagesRead === 1 ? "" : "s"} ` +
      `(${months}-month lookback)` +
      (others > 0 ? ` · ${orders.length} across ${accounts.length} accounts` : "") +
      (filterWarnings.length > 0
        ? ` — ⚠ Amazon may have ignored the time filter for: ${filterWarnings.join(", ")}`
        : "");
  } else {
    // Diagnostic so we can see WHY nothing was read (throttled decryption vs. no cards vs. wrong page).
    note = lastDiag
      ? `0 orders — saw ${lastDiag.cardCount} cards, decrypted=${lastDiag.decrypted}, waited ${lastDiag.waited}s (${lastDiag.url})`
      : "0 orders — the Amazon tab never reported (timed out)";
  }

  const status: AmazonStatus = {
    ranAt: Date.now(),
    ok: signedIn,
    signedIn,
    orderCardCount: orders.length,
    note,
  };
  return { status, orders, accounts, activeAccount: signedIn ? label : null };
}

function errCheck(note: string): AmazonCheck {
  return {
    status: { ranAt: Date.now(), ok: false, signedIn: false, orderCardCount: 0, note },
    orders: [],
    accounts: [],
    activeAccount: null,
  };
}
