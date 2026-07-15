import { describe, expect, it } from "vitest";
import { isAmazonMerchant } from "../src/shared/amazon-merchant";
import { countAmazon } from "../src/shared/monarch-read";

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

describe("countAmazon", () => {
  const payload = {
    allTransactions: {
      totalCount: 812,
      results: [
        { id: "1", merchant: { name: "AMZN Mktp US*1A2B3C" } },
        { id: "2", merchant: { name: "Starbucks" } },
        { id: "3", merchant: { name: "Amazon.com" } },
        { id: "4", merchant: { name: "Whole Foods Market" } }, // excluded
        { id: "5", merchant: { name: null } },
      ],
    },
  };

  it("counts Amazon rows and reports totals", () => {
    expect(countAmazon(payload)).toEqual({ amazonCount: 2, totalScanned: 5, totalCount: 812 });
  });

  it("is tolerant of malformed/empty payloads", () => {
    expect(countAmazon(null)).toEqual({ amazonCount: 0, totalScanned: 0, totalCount: null });
    expect(countAmazon({ allTransactions: {} })).toEqual({
      amazonCount: 0,
      totalScanned: 0,
      totalCount: null,
    });
    expect(countAmazon({ allTransactions: { results: "nope" } })).toEqual({
      amazonCount: 0,
      totalScanned: 0,
      totalCount: null,
    });
  });
});
