// Amazon order retrieval via a background tab. Amazon encrypts order details
// client-side (Siege CSD — SPEC.md §R1), so we open the order-history page in a
// background tab, let the amazon content script scrape the decrypted DOM, and
// PAGINATE through the history (startIndex) to load more than the first page.
import browser from "webextension-polyfill";
import type { AmazonCheck, AmazonOrderLite, AmazonStatus } from "../shared/messages";
import { filterLabel, pageAllOlderThan, planLookback, yearFilterMismatch } from "../shared/lookback";
import { effectiveLookbackMonths, loadDeepSync, recordDeepSync } from "../shared/deep-sync";
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
  diag?: Diag;
}

// Pending tab scrapes, keyed by tabId → resolver called when its content script reports.
const pending = new Map<number, (r: Report) => void>();

/** Called by the message router when an amazon content script reports orders. */
export function resolveAmazonReport(
  tabId: number | undefined,
  orders: AmazonOrderLite[],
  signedIn: boolean,
  diag?: Diag,
): void {
  if (tabId === undefined) return;
  const resolve = pending.get(tabId);
  if (resolve) resolve({ orders, signedIn, diag });
}

function waitForReport(tabId: number): Promise<Report> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(tabId);
      resolve({ orders: [], signedIn: true }); // timed out — treat as end of pages
    }, TAB_TIMEOUT_MS);
    pending.set(tabId, (r) => {
      clearTimeout(timer);
      pending.delete(tabId);
      resolve(r);
    });
  });
}

function orderKey(o: AmazonOrderLite): string {
  return o.orderId || `${o.date}|${o.totalCents}|${o.itemTitles[0] ?? ""}`;
}

export async function fetchAmazonViaTab(
  onProgress?: (label: string) => void,
): Promise<AmazonCheck> {
  // How far back: the configured lookback on the initial sync, Amazon's fast
  // default (3 months) once a deep fetch has succeeded (see deep-sync.ts).
  const months = effectiveLookbackMonths(await loadSettings(), await loadDeepSync());
  const plan = planLookback(todayIso(), months);

  let tabId: number | undefined;
  const all = new Map<string, AmazonOrderLite>();
  let signedIn = true;
  let pagesRead = 0;
  let lastDiag: Diag | undefined;
  const filterWarnings: string[] = [];

  try {
    onProgress?.("Opening Amazon in a background tab…");
    const tab = await browser.tabs.create({ url: pageUrl(0, plan.filters[0] ?? null), active: false });
    tabId = tab.id;
    if (tabId === undefined) return errCheck("could not open an Amazon tab");

    let firstNav = true;
    outer: for (const filter of plan.filters) {
      const seenThisFilter: AmazonOrderLite[] = [];
      for (let page = 0; page < MAX_PAGES_PER_FILTER; page++) {
        if (!firstNav) await browser.tabs.update(tabId, { url: pageUrl(page * PAGE_SIZE, filter) });
        firstNav = false;
        onProgress?.(
          `Reading ${filterLabel(filter)} — page ${page + 1} (${all.size} so far, waiting for decryption…)`,
        );
        const r = await waitForReport(tabId);
        signedIn = r.signedIn;
        if (r.diag) lastDiag = r.diag;
        if (!r.signedIn) break outer;
        pagesRead += 1;
        seenThisFilter.push(...r.orders);
        let added = 0;
        for (const o of r.orders) {
          const key = orderKey(o);
          const existing = all.get(key);
          if (!existing) {
            all.set(key, o);
            added += 1;
          } else if (o.returnHint && !existing.returnHint) {
            // Same order seen again with a return/refund hint — keep the hint.
            existing.returnHint = true;
          }
        }
        // Stop when a page brings nothing new (last page, or startIndex ignored)
        // or is entirely older than the lookback window (pages are newest-first).
        if (r.orders.length === 0 || added === 0) break;
        if (pageAllOlderThan(r.orders, plan.cutoffIso)) break;
      }
      if (yearFilterMismatch(filter, seenThisFilter)) filterWarnings.push(filterLabel(filter));
    }
  } catch (e) {
    return errCheck(`Amazon tab error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (tabId !== undefined) await browser.tabs.remove(tabId).catch(() => {});
  }

  const orders = [...all.values()];
  let note: string;
  if (!signedIn) {
    note = "not signed in to Amazon — open amazon.com and sign in, then re-sync";
  } else if (orders.length > 0) {
    note =
      `${orders.length} orders read from ${pagesRead} page${pagesRead === 1 ? "" : "s"} ` +
      `(${months}-month lookback)` +
      (filterWarnings.length > 0
        ? ` — ⚠ Amazon may have ignored the time filter for: ${filterWarnings.join(", ")}`
        : "");
  } else {
    // Diagnostic so we can see WHY nothing was read (throttled decryption vs. no cards vs. wrong page).
    note = lastDiag
      ? `0 orders — saw ${lastDiag.cardCount} cards, decrypted=${lastDiag.decrypted}, waited ${lastDiag.waited}s (${lastDiag.url})`
      : "0 orders — the Amazon tab never reported (timed out)";
  }

  // A completed deep pass (signed in, found orders, cleanly applied filters)
  // makes later syncs fast. A filter warning means coverage is unproven — do
  // NOT record, so the next sync tries deep again and keeps the warning visible.
  if (signedIn && orders.length > 0 && months > 3 && filterWarnings.length === 0) {
    await recordDeepSync(months);
  }

  const status: AmazonStatus = {
    ranAt: Date.now(),
    ok: signedIn,
    signedIn,
    orderCardCount: orders.length,
    note,
  };
  return { status, orders };
}

function errCheck(note: string): AmazonCheck {
  return {
    status: { ranAt: Date.now(), ok: false, signedIn: false, orderCardCount: 0, note },
    orders: [],
  };
}
