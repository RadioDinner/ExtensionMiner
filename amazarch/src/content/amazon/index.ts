// Amazon content script — runs on the user's amazon.com order-history page and
// scrapes the RENDERED DOM (after Siege client-side decryption), where dates,
// totals, and item names are real visible text. Sends parsed orders to the
// background. See SPEC.md §R1 (client-side-encryption correction).
import browser from "webextension-polyfill";
import {
  bestTotalCents,
  looksDecrypted,
  orderIdFromSlotId,
  parseOrderDate,
  parseOrderId,
} from "../../shared/amazon-dom-parse";
import type { AmazonOrderLite } from "../../shared/messages";

const LOG = "[Amazarch/amazon]";
const MAX_WAIT = 25; // seconds to wait for decryption/render

console.info(`${LOG} active on ${location.href}`);

function detectLogin(): boolean {
  return /\/ap\/signin/i.test(location.href) || !!document.getElementById("ap_email");
}

function scrapeOrders(): AmazonOrderLite[] {
  const cards = document.querySelectorAll<HTMLElement>(".js-order-card, .order-card");
  const orders: AmazonOrderLite[] = [];
  cards.forEach((card) => {
    const text = card.textContent ?? "";
    const orderId =
      orderIdFromSlotId(card.getAttribute("data-csa-c-slot-id")) ?? parseOrderId(text) ?? "";
    const date = parseOrderDate(text);
    const totalCents = bestTotalCents(text);
    if (date === null || totalCents === null) return; // not decrypted / not an order
    const items = Array.from(
      card.querySelectorAll<HTMLAnchorElement>('a[href*="/dp/"], a[href*="/gp/product/"]'),
    )
      .map((a) => (a.textContent ?? "").trim())
      .filter((t) => t.length > 2);
    orders.push({ orderId, date, totalCents, itemTitles: [...new Set(items)].slice(0, 10) });
  });
  return orders;
}

function report(orders: AmazonOrderLite[], signedIn: boolean): void {
  void browser.runtime
    .sendMessage({ type: "amazon-orders", orders, signedIn })
    .catch((e) => console.warn(`${LOG} could not reach background:`, e));
  showPill(signedIn ? `Amazarch: read ${orders.length} Amazon orders` : "Amazarch: please sign in to Amazon");
}

// Poll until the cards decrypt (their text gains real amounts/dates), then scrape.
let tries = 0;
const timer = setInterval(() => {
  tries += 1;
  if (detectLogin()) {
    clearInterval(timer);
    report([], false);
    return;
  }
  const anyCard = document.querySelector(".js-order-card, .order-card");
  const decrypted = anyCard ? looksDecrypted(anyCard.textContent ?? "") : false;
  if (decrypted || tries >= MAX_WAIT) {
    clearInterval(timer);
    report(scrapeOrders(), true);
  }
}, 1000);

let pillShown = false;
function showPill(msg: string): void {
  if (pillShown || !document.body) return;
  pillShown = true;
  const pill = document.createElement("div");
  pill.textContent = msg;
  pill.setAttribute(
    "style",
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:8px 14px;border-radius:999px;background:#111827;color:#f9fafb;font:12px/1.4 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)",
  );
  document.body.appendChild(pill);
  setTimeout(() => pill.remove(), 6000);
}
