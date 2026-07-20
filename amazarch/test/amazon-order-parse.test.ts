import { describe, expect, it } from "vitest";
import {
  hasReturnHint,
  parseAmazonOrders,
  parseOrderDate,
  parseOrderId,
  parseOrderTotal,
} from "../src/shared/amazon-order-parse";

// Two order cards resembling Amazon's order-history markup (obfuscated classes,
// stable visible labels + /dp/ item links).
const ORDERS_HTML = `
<div class="a-box-group xyz123">
  <div class="a-row"><span>Order placed</span><span>July 6, 2026</span></div>
  <div class="a-column"><span>Total</span><span>$47.47</span></div>
  <div class="yohtmlc-order-id"><span>Order # 114-1234567-7654321</span></div>
  <a class="a-link-normal" href="/dp/B0ABCDEFG/ref=x">USB-C Cable 6ft &amp; Adapter</a>
  <a class="a-link-normal" href="/gp/product/B0HIJKLMN/">AA Batteries 24-pack</a>
</div>
<div class="a-box-group xyz123">
  <div class="a-row"><span>Order placed</span><span>June 28, 2026</span></div>
  <div class="a-column"><span>Total</span><span>$1,204.99</span></div>
  <div class="yohtmlc-order-id"><span>Order # 112-7654321-1234567</span></div>
  <a class="a-link-normal" href="/dp/B0LAPTOP12/">Laptop Stand</a>
</div>`;

describe("parseAmazonOrders", () => {
  it("parses each order's date, total (cents), id, and items", () => {
    const orders = parseAmazonOrders(ORDERS_HTML);
    expect(orders).toHaveLength(2);
    expect(orders[0]).toEqual({
      orderId: "114-1234567-7654321",
      date: "2026-07-06",
      totalCents: 4747,
      itemTitles: ["USB-C Cable 6ft & Adapter", "AA Batteries 24-pack"],
      returnHint: false,
    });
    expect(orders[1]).toEqual({
      orderId: "112-7654321-1234567",
      date: "2026-06-28",
      totalCents: 120499,
      itemTitles: ["Laptop Stand"],
      returnHint: false,
    });
  });

  it("returns nothing for a page with no orders", () => {
    expect(parseAmazonOrders("<html><body>nothing here</body></html>")).toEqual([]);
  });
});

describe("hasReturnHint", () => {
  it("flags COMPLETED return/refund wording", () => {
    expect(hasReturnHint("Delivered June 5 Refund issued")).toBe(true);
    expect(hasReturnHint("Return complete")).toBe(true);
    expect(hasReturnHint("Your refund has been issued")).toBe(true);
    expect(hasReturnHint("Item returned on July 2")).toBe(true);
    expect(hasReturnHint("Items returned")).toBe(true);
    expect(hasReturnHint("Refunded")).toBe(true);
    expect(hasReturnHint("Track your refund")).toBe(true);
    expect(hasReturnHint("Return received — refund processing")).toBe(true);
  });
  it("does NOT flag the return-offer wording on every delivered order", () => {
    expect(hasReturnHint("Return or replace items")).toBe(false);
    expect(hasReturnHint("Return eligible through Aug 5, 2026")).toBe(false);
    expect(hasReturnHint("Return window closed on Aug 5, 2026")).toBe(false);
    expect(hasReturnHint("Eligible for Return, Refund or Replacement")).toBe(false);
    expect(hasReturnHint("Delivered June 5 Buy it again")).toBe(false);
    expect(hasReturnHint("")).toBe(false);
  });
  it("flags a full order card containing a completed-return line", () => {
    expect(
      hasReturnHint("Order placed July 6, 2026 Total $47.47 Return complete Return or replace items"),
    ).toBe(true);
  });
});

describe("field parsers", () => {
  it("parses month-name dates to ISO", () => {
    expect(parseOrderDate("Order placed December 1, 2025")).toBe("2025-12-01");
    expect(parseOrderDate("Order placed Jan 9, 2026")).toBe("2026-01-09");
    expect(parseOrderDate("no date")).toBeNull();
  });
  it("parses totals with commas to integer cents", () => {
    expect(parseOrderTotal("Total $1,204.99")).toBe(120499);
    expect(parseOrderTotal("Grand Total: $12.00")).toBe(1200);
    expect(parseOrderTotal("no total")).toBeNull();
  });
  it("parses the 3-7-7 order id", () => {
    expect(parseOrderId("Order # 114-1234567-7654321")).toBe("114-1234567-7654321");
    expect(parseOrderId("no id")).toBeNull();
  });
});
