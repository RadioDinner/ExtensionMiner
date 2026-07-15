import { describe, expect, it } from "vitest";
import { buildNoteLine, mergeNotes } from "../src/shared/monarch-write";
import type { AmazonOrderLite } from "../src/shared/messages";

const order: AmazonOrderLite = {
  orderId: "114-1234567-7654321",
  date: "2026-07-06",
  totalCents: 4747,
  itemTitles: ["USB-C Cable", "AA Batteries"],
};

describe("buildNoteLine", () => {
  it("includes items, order number, and a link, tagged with the marker", () => {
    const line = buildNoteLine(order);
    expect(line).toContain("[Amazarch]");
    expect(line).toContain("USB-C Cable, AA Batteries");
    expect(line).toContain("#114-1234567-7654321");
    expect(line).toContain("orderID=114-1234567-7654321");
  });
});

describe("mergeNotes", () => {
  const line = buildNoteLine(order);

  it("appends to existing notes without clobbering them", () => {
    const r = mergeNotes("my own note", order, line);
    expect(r.changed).toBe(true);
    expect(r.notes).toBe(`my own note\n${line}`);
  });

  it("writes the line when there are no existing notes", () => {
    const r = mergeNotes("", order, line);
    expect(r.changed).toBe(true);
    expect(r.notes).toBe(line);
  });

  it("is idempotent — skips if the order is already noted", () => {
    const r = mergeNotes(`something ${order.orderId} already`, order, line);
    expect(r.changed).toBe(false);
  });
});
