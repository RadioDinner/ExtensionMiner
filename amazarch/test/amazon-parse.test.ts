import { describe, expect, it } from "vitest";
import { countOrderCards, detectAmazonPage, pageTitle } from "../src/shared/amazon-parse";

const LOGIN_HTML = `<!doctype html><html><head><title>Amazon Sign-In</title></head>
<body><form name="signIn"><input id="ap_email" name="email" type="email"></form></body></html>`;

const ORDERS_HTML = `<!doctype html><html><head><title>Your Orders</title></head><body>
<div class="order-card js-order-card"><span>Order placed</span> July 6, 2026 ... $47.47</div>
<div class="order-card js-order-card"><span>Order placed</span> July 2, 2026 ... $12.30</div>
</body></html>`;

const UNKNOWN_HTML = `<!doctype html><html><head><title>Amazon.com</title></head><body>Something else</body></html>`;

describe("detectAmazonPage", () => {
  it("detects the sign-in wall by URL or HTML", () => {
    expect(detectAmazonPage(LOGIN_HTML, "https://www.amazon.com/gp/css/order-history")).toBe("login");
    expect(detectAmazonPage("<html></html>", "https://www.amazon.com/ap/signin?x=1")).toBe("login");
  });

  it("detects the order-history page", () => {
    expect(detectAmazonPage(ORDERS_HTML, "https://www.amazon.com/gp/css/order-history")).toBe("orders");
  });

  it("returns unknown for unrecognized pages", () => {
    expect(detectAmazonPage(UNKNOWN_HTML, "https://www.amazon.com/foo")).toBe("unknown");
  });
});

describe("countOrderCards", () => {
  it("counts order cards", () => {
    expect(countOrderCards(ORDERS_HTML)).toBe(2);
  });
  it("returns 0 when none present", () => {
    expect(countOrderCards(UNKNOWN_HTML)).toBe(0);
  });
});

describe("pageTitle", () => {
  it("extracts the <title>", () => {
    expect(pageTitle(ORDERS_HTML)).toBe("Your Orders");
    expect(pageTitle("<html></html>")).toBe("");
  });
});

import { redactedCardSample } from "../src/shared/amazon-parse";

describe("redactedCardSample", () => {
  const html = `<div class="order-card js-order-card" data-order-id="114-1234567-7654321">
    <span>Ordered on</span><span>2026-07-06</span><span>Total</span><span>$47.47</span>
    <a href="/dp/B0ABCDEFG">A Very Long Product Title That Should Be Masked Away</a></div>`;

  it("masks digits and long text but keeps structure/labels", () => {
    const s = redactedCardSample(html);
    expect(s).toContain("js-order-card");
    expect(s).toContain("Total");
    expect(s).toContain("Ordered on");
    expect(s).toContain("[text]"); // long product title blanked
    expect(s).not.toContain("47.47");
    expect(s).not.toContain("1234567");
    expect(s).not.toContain("A Very Long Product Title");
  });

  it("returns empty string when no order card is present", () => {
    expect(redactedCardSample("<html><body>none</body></html>")).toBe("");
  });
});
