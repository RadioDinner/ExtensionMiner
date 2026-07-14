import { describe, expect, it } from "vitest";
import { formatCents, parseAmountToCents, sumCents } from "../src/shared/money";

describe("parseAmountToCents", () => {
  it("parses plain and formatted dollar amounts", () => {
    expect(parseAmountToCents("$1,234.56")).toBe(123456);
    expect(parseAmountToCents("12.30")).toBe(1230);
    expect(parseAmountToCents("12.3")).toBe(1230);
    expect(parseAmountToCents("12")).toBe(1200);
  });

  it("parses negatives (refunds)", () => {
    expect(parseAmountToCents("-$12.00")).toBe(-1200);
    expect(parseAmountToCents("-0.01")).toBe(-1);
  });

  it("rejects garbage", () => {
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("12.345")).toBeNull();
    expect(parseAmountToCents("$1.2.3")).toBeNull();
  });
});

describe("formatCents", () => {
  it("round-trips with parse", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-1200)).toBe("-$12.00");
    expect(formatCents(5)).toBe("$0.05");
  });
});

describe("sumCents", () => {
  it("sums integers and rejects floats (split validation)", () => {
    expect(sumCents([100, 250, -50])).toBe(300);
    expect(() => sumCents([100, 0.5])).toThrow();
  });
});
