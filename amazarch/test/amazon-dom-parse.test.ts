import { describe, expect, it } from "vitest";
import {
  bestTotalCents,
  firstDollarCents,
  looksDecrypted,
  orderIdFromSlotId,
} from "../src/shared/amazon-dom-parse";

describe("orderIdFromSlotId", () => {
  it("extracts the 3-7-7 id from the slot attribute", () => {
    expect(orderIdFromSlotId("amzn1.yourorders.order-card.114-1234567-7654321")).toBe(
      "114-1234567-7654321",
    );
  });
  it("returns null when absent", () => {
    expect(orderIdFromSlotId("amzn1.yourorders.order-card.")).toBeNull();
    expect(orderIdFromSlotId(null)).toBeNull();
    expect(orderIdFromSlotId(undefined)).toBeNull();
  });
});

describe("firstDollarCents / bestTotalCents", () => {
  it("reads the first dollar amount", () => {
    expect(firstDollarCents("Order placed July 6, 2026 Total $47.47 items")).toBe(4747);
    expect(firstDollarCents("no money here")).toBeNull();
  });
  it("prefers the amount next to a Total label", () => {
    // item price $9.99 appears first, but the order Total is $47.47
    expect(bestTotalCents("Item $9.99 ... Total: $47.47")).toBe(4747);
  });
  it("falls back to first dollar amount without a Total label", () => {
    expect(bestTotalCents("$12.00 only")).toBe(1200);
  });
});

describe("looksDecrypted", () => {
  it("is true once a card's text has a real amount + date", () => {
    expect(looksDecrypted("Order placed July 6, 2026 Total $47.47")).toBe(true);
  });
  it("is false for ciphertext / pre-render text", () => {
    expect(looksDecrypted("YifV88fQ== encrypted blob no plaintext")).toBe(false);
    expect(looksDecrypted("")).toBe(false);
  });
});
