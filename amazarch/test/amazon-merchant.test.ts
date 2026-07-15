import { describe, expect, it } from "vitest";
import { isAmazonMerchant } from "../src/shared/amazon-merchant";
import { collectAmazon } from "../src/shared/monarch-read";

describe("isAmazonMerchant", () => {
  it("matches real-world Amazon bank-feed names", () => {
    for (const name of [
      "Amazon",
      "Amazon.com",
      "AMZN Mktp US*1A2B3C",
      "AMZN Mktp US",
      "Amazon Prime",
      "Amazon.com*Z99XY4",
      "AMAZON MKTPL",
      "Prime Video",
    ]) {
      expect(isAmazonMerchant(name), name).toBe(true);
    }
  });

  it("excludes Whole Foods / Fresh (out of v1 scope) and non-Amazon", () => {
    for (const name of ["Whole Foods Market", "Amazon Fresh", "AMZN Fresh", "Target", "Walmart", "", null, undefined]) {
      expect(isAmazonMerchant(name), String(name)).toBe(false);
    }
  });
});

describe("collectAmazon", () => {
  const payload = {
    allTransactions: {
      totalCount: 812,
      results: [
        { id: "1", date: "2026-07-10", amount: -24.99, notes: "existing", merchant: { name: "AMZN Mktp US*1A2B3C" } },
        { id: "2", date: "2026-07-09", amount: -5.75, merchant: { name: "Starbucks" } },
        { id: "3", date: "2026-07-08", amount: -119.0, merchant: { name: "Amazon.com" } },
        { id: "4", date: "2026-07-07", amount: -60.0, merchant: { name: "Whole Foods Market" } }, // excluded
        { id: "5", date: "2026-07-06", amount: -1.0, merchant: { name: null } },
      ],
    },
  };

  it("extracts Amazon rows with integer-cent amounts and reports totals", () => {
    const out = collectAmazon(payload);
    expect(out.pageLen).toBe(5);
    expect(out.totalCount).toBe(812);
    expect(out.rows).toEqual([
      { id: "1", date: "2026-07-10", amountCents: -2499, merchantName: "AMZN Mktp US*1A2B3C", notes: "existing" },
      { id: "3", date: "2026-07-08", amountCents: -11900, merchantName: "Amazon.com", notes: "" },
    ]);
  });

  it("is tolerant of malformed/empty payloads", () => {
    expect(collectAmazon(null)).toEqual({ rows: [], pageLen: 0, totalCount: null });
    expect(collectAmazon({ allTransactions: {} })).toEqual({ rows: [], pageLen: 0, totalCount: null });
    expect(collectAmazon({ allTransactions: { results: "nope" } })).toEqual({
      rows: [],
      pageLen: 0,
      totalCount: null,
    });
  });
});
