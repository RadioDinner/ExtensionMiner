// Amazon order-history fetch + parse (silent background fetch, SPEC.md D5).
// The background fetches the order-history page with the user's amazon.com
// session cookies (content scripts can't do this cross-origin in Chrome), then
// parses it into structured orders. Diagnostic-first: report what we reached.
import type { AmazonCheck, AmazonStatus } from "../shared/messages";
import { countOrderCards, detectAmazonPage, diagnoseOrderHtml, pageTitle } from "../shared/amazon-parse";
import { parseAmazonOrders } from "../shared/amazon-order-parse";

const ORDERS_URL = "https://www.amazon.com/gp/css/order-history";

export async function checkAmazon(): Promise<AmazonCheck> {
  try {
    const res = await fetch(ORDERS_URL, {
      credentials: "include",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const html = await res.text();
    const kind = detectAmazonPage(html, res.url);

    if (kind === "login") {
      return { status: notSignedIn(), orders: [] };
    }
    if (kind === "orders") {
      const cards = countOrderCards(html);
      const orders = parseAmazonOrders(html);
      const status: AmazonStatus = {
        ranAt: Date.now(),
        ok: true,
        signedIn: true,
        orderCardCount: cards,
        note:
          orders.length > 0
            ? `${orders.length} orders parsed (${cards} cards on page 1)`
            : `0 orders parsed from ${cards} cards — see the [Amazarch] console diagnostic on the Monarch tab`,
      };
      // When cards are present but nothing parsed, return a redacted diagnostic
      // (counts only) so the content script can log it on the Monarch tab.
      const diagnostic = orders.length === 0 && cards > 0 ? diagnoseOrderHtml(html) : undefined;
      return { status, orders, diagnostic };
    }
    return {
      status: {
        ranAt: Date.now(),
        ok: false,
        signedIn: false,
        orderCardCount: 0,
        note: `unrecognized Amazon page: "${pageTitle(html)}" (HTTP ${res.status}, ${html.length} bytes)`,
      },
      orders: [],
    };
  } catch (e) {
    return {
      status: {
        ranAt: Date.now(),
        ok: false,
        signedIn: false,
        orderCardCount: 0,
        note: `Amazon fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      },
      orders: [],
    };
  }
}

function notSignedIn(): AmazonStatus {
  return {
    ranAt: Date.now(),
    ok: true,
    signedIn: false,
    orderCardCount: 0,
    note: "not signed in to Amazon — open amazon.com and sign in, then reload Monarch",
  };
}
