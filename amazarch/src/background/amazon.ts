// Amazon reachability probe (first Amazon milestone). The background fetches
// the order-history page using the user's amazon.com session cookies (silent
// background fetch, SPEC.md D5) — content scripts can't do this cross-origin in
// Chrome, the background can. Diagnostic-first: report whether we reached a
// signed-in orders page, a login wall, or something unrecognized, so we learn
// what Amazon actually serves before building the order parser.
import type { AmazonStatus } from "../shared/messages";
import { countOrderCards, detectAmazonPage, pageTitle } from "../shared/amazon-parse";

const ORDERS_URL = "https://www.amazon.com/gp/css/order-history";

export async function checkAmazon(): Promise<AmazonStatus> {
  try {
    const res = await fetch(ORDERS_URL, {
      credentials: "include",
      headers: {
        // Look like a normal top-level navigation, not an XHR, so Amazon serves
        // the real order-history HTML rather than a fragment/challenge.
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const html = await res.text();
    const kind = detectAmazonPage(html, res.url);
    if (kind === "login") {
      return { ranAt: Date.now(), ok: true, signedIn: false, orderCardCount: 0, note: "not signed in to Amazon — open amazon.com and sign in" };
    }
    if (kind === "orders") {
      const n = countOrderCards(html);
      return { ranAt: Date.now(), ok: true, signedIn: true, orderCardCount: n, note: `signed in — order-history page reached (${n} order cards visible)` };
    }
    return {
      ranAt: Date.now(),
      ok: false,
      signedIn: false,
      orderCardCount: 0,
      note: `unrecognized Amazon page: "${pageTitle(html)}" (HTTP ${res.status}, ${html.length} bytes)`,
    };
  } catch (e) {
    return {
      ranAt: Date.now(),
      ok: false,
      signedIn: false,
      orderCardCount: 0,
      note: `Amazon fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
