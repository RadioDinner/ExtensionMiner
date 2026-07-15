// Amazon order retrieval via a background tab. Amazon encrypts order details
// client-side (Siege CSD — SPEC.md §R1), so we open the order-history page in a
// background tab, let the amazon content script scrape the decrypted DOM, and
// PAGINATE through the history (startIndex) to load more than the first page.
import browser from "webextension-polyfill";
import type { AmazonCheck, AmazonOrderLite, AmazonStatus } from "../shared/messages";

const TAB_TIMEOUT_MS = 30000;
const PAGE_SIZE = 10;
const MAX_PAGES = 10; // up to ~100 recent orders; full backfill is a later feature (D7)

function pageUrl(startIndex: number): string {
  return `https://www.amazon.com/gp/css/order-history?startIndex=${startIndex}`;
}

// Pending tab scrapes, keyed by tabId → resolver called when its content script reports.
const pending = new Map<number, (r: { orders: AmazonOrderLite[]; signedIn: boolean }) => void>();

/** Called by the message router when an amazon content script reports orders. */
export function resolveAmazonReport(
  tabId: number | undefined,
  orders: AmazonOrderLite[],
  signedIn: boolean,
): void {
  if (tabId === undefined) return;
  const resolve = pending.get(tabId);
  if (resolve) resolve({ orders, signedIn });
}

function waitForReport(tabId: number): Promise<{ orders: AmazonOrderLite[]; signedIn: boolean }> {
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
  let tabId: number | undefined;
  const all = new Map<string, AmazonOrderLite>();
  let signedIn = true;
  let pagesRead = 0;

  try {
    onProgress?.("Opening Amazon in a background tab…");
    const tab = await browser.tabs.create({ url: pageUrl(0), active: false });
    tabId = tab.id;
    if (tabId === undefined) return errCheck("could not open an Amazon tab");

    for (let page = 0; page < MAX_PAGES; page++) {
      if (page > 0) await browser.tabs.update(tabId, { url: pageUrl(page * PAGE_SIZE) });
      onProgress?.(`Reading Amazon orders — page ${page + 1} (${all.size} so far, waiting for decryption…)`);
      const r = await waitForReport(tabId);
      signedIn = r.signedIn;
      if (!r.signedIn) break;
      pagesRead += 1;
      let added = 0;
      for (const o of r.orders) {
        const key = orderKey(o);
        if (!all.has(key)) {
          all.set(key, o);
          added += 1;
        }
      }
      // Stop when a page brings nothing new (last page, or startIndex ignored).
      if (r.orders.length === 0 || added === 0) break;
    }
  } catch (e) {
    return errCheck(`Amazon tab error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (tabId !== undefined) await browser.tabs.remove(tabId).catch(() => {});
  }

  const orders = [...all.values()];
  const status: AmazonStatus = {
    ranAt: Date.now(),
    ok: signedIn,
    signedIn,
    orderCardCount: orders.length,
    note: signedIn
      ? `${orders.length} orders read from ${pagesRead} page${pagesRead === 1 ? "" : "s"} of your Amazon history`
      : "not signed in to Amazon — open amazon.com and sign in, then re-sync",
  };
  return { status, orders };
}

function errCheck(note: string): AmazonCheck {
  return {
    status: { ranAt: Date.now(), ok: false, signedIn: false, orderCardCount: 0, note },
    orders: [],
  };
}
