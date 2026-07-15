// Amazon order retrieval via a background tab. Because Amazon encrypts order
// details client-side (Siege CSD — see SPEC.md §R1), we can't read them from a
// raw fetch; instead we open the order-history page in a background tab and let
// the amazon content script scrape the decrypted, rendered DOM, then close it.
import browser from "webextension-polyfill";
import type { AmazonCheck, AmazonOrderLite, AmazonStatus } from "../shared/messages";

const ORDERS_URL = "https://www.amazon.com/gp/css/order-history";
const TAB_TIMEOUT_MS = 30000;

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

export async function fetchAmazonViaTab(): Promise<AmazonCheck> {
  let tabId: number | undefined;
  try {
    const tab = await browser.tabs.create({ url: ORDERS_URL, active: false });
    tabId = tab.id;
    if (tabId === undefined) return errCheck("could not open an Amazon tab");

    const result = await new Promise<{ orders: AmazonOrderLite[]; signedIn: boolean }>((resolve) => {
      const id = tabId as number;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ orders: [], signedIn: true }); // timed out; treat as no orders read
      }, TAB_TIMEOUT_MS);
      pending.set(id, (r) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(r);
      });
    });

    const status: AmazonStatus = {
      ranAt: Date.now(),
      ok: result.signedIn,
      signedIn: result.signedIn,
      orderCardCount: result.orders.length,
      note: result.signedIn
        ? `${result.orders.length} orders read from your Amazon order history`
        : "not signed in to Amazon — open amazon.com and sign in, then re-sync",
    };
    return { status, orders: result.orders };
  } catch (e) {
    return errCheck(`Amazon tab error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (tabId !== undefined) await browser.tabs.remove(tabId).catch(() => {});
  }
}

function errCheck(note: string): AmazonCheck {
  return {
    status: { ranAt: Date.now(), ok: false, signedIn: false, orderCardCount: 0, note },
    orders: [],
  };
}
