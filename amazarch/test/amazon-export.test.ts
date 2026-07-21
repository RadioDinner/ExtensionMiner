import { describe, expect, it } from "vitest";
import {
  normalizeExportDate,
  parseExportCsvs,
  parseRetailOrderHistory,
} from "../src/shared/amazon-export";

// A miniature Retail.OrderHistory CSV: one order with two item rows, one
// single-item order, and a cancelled row that must be dropped.
const CSV = [
  '"Order ID","Order Date","Total Owed","Product Name","Order Status"',
  '"111-2222222-3333333","2024-03-02T10:00:00Z","19.99","USB-C Cable","Closed"',
  '"111-2222222-3333333","2024-03-02T10:00:00Z","27.48","Dog Food, 20lb","Closed"',
  '"112-0000000-0000001","2024-05-10","5.00","Sticker","Closed"',
  '"113-9999999-9999999","2024-06-01","99.99","Cancelled Thing","Cancelled"',
].join("\n");

describe("parseRetailOrderHistory", () => {
  it("groups item rows by order id and sums Total Owed", () => {
    const orders = parseRetailOrderHistory(CSV);
    const byId = Object.fromEntries(orders.map((o) => [o.orderId, o]));
    expect(byId["111-2222222-3333333"]).toEqual({
      orderId: "111-2222222-3333333",
      date: "2024-03-02",
      totalCents: 4747, // 19.99 + 27.48
      itemTitles: ["USB-C Cable", "Dog Food, 20lb"],
      returnHint: false,
    });
    expect(byId["112-0000000-0000001"]).toMatchObject({ totalCents: 500, itemTitles: ["Sticker"] });
  });

  it("drops cancelled orders", () => {
    expect(parseRetailOrderHistory(CSV).some((o) => o.orderId === "113-9999999-9999999")).toBe(false);
  });

  it("flags a returned/refunded order via Order Status", () => {
    const csv = [
      '"Order ID","Order Date","Total Owed","Product Name","Order Status"',
      '"200-0000000-0000000","2024-02-02","10.00","Widget","Returned"',
    ].join("\n");
    expect(parseRetailOrderHistory(csv)[0]!.returnHint).toBe(true);
  });

  it("is tolerant of header punctuation/case and alternate total columns", () => {
    const csv = [
      "order id,order date,item total,title",
      "300-0000000-0000000,2024-01-01,12.00,Thing",
    ].join("\n");
    expect(parseRetailOrderHistory(csv)[0]).toMatchObject({ orderId: "300-0000000-0000000", totalCents: 1200 });
  });

  it("returns [] for a CSV that isn't order history", () => {
    expect(parseRetailOrderHistory("a,b\n1,2")).toEqual([]);
    expect(parseRetailOrderHistory("")).toEqual([]);
  });

  it("drops orders that sum to zero (e.g. fully gift-carded / no owed amount)", () => {
    const csv = [
      '"Order ID","Order Date","Total Owed","Product Name"',
      '"400-0000000-0000000","2024-01-01","0.00","Freebie"',
    ].join("\n");
    expect(parseRetailOrderHistory(csv)).toEqual([]);
  });
});

describe("parseExportCsvs", () => {
  it("merges multi-part exports, deduping by order id", () => {
    const part1 = '"Order ID","Order Date","Total Owed","Product Name"\n"A-1","2024-01-01","10.00","One"';
    const part2 = '"Order ID","Order Date","Total Owed","Product Name"\n"A-1","2024-01-01","10.00","One"\n"B-2","2024-02-01","20.00","Two"';
    const orders = parseExportCsvs([part1, part2]);
    expect(orders.map((o) => o.orderId).sort()).toEqual(["A-1", "B-2"]);
  });
});

describe("normalizeExportDate", () => {
  it("normalizes ISO timestamps and plain dates to YYYY-MM-DD", () => {
    expect(normalizeExportDate("2024-03-02T10:00:00Z")).toBe("2024-03-02");
    expect(normalizeExportDate("2024-03-02")).toBe("2024-03-02");
    expect(normalizeExportDate("March 2, 2024")).toBe("2024-03-02");
    expect(normalizeExportDate("not a date")).toBeNull();
  });
});
