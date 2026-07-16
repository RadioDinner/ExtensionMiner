import { describe, expect, it } from "vitest";
import {
  filterLabel,
  minusMonthsIso,
  pageAllOlderThan,
  planLookback,
  yearFilterMismatch,
} from "../src/shared/lookback";

describe("minusMonthsIso", () => {
  it("subtracts months across year boundaries", () => {
    expect(minusMonthsIso("2026-07-16", 3)).toBe("2026-04-16");
    expect(minusMonthsIso("2026-01-15", 3)).toBe("2025-10-15");
    expect(minusMonthsIso("2026-07-16", 12)).toBe("2025-07-16");
    expect(minusMonthsIso("2026-07-16", 36)).toBe("2023-07-16");
  });

  it("clamps the day when the target month is shorter", () => {
    expect(minusMonthsIso("2026-03-31", 1)).toBe("2026-02-28");
    expect(minusMonthsIso("2024-03-31", 1)).toBe("2024-02-29"); // leap year
    expect(minusMonthsIso("2026-07-31", 1)).toBe("2026-06-30");
  });
});

describe("planLookback", () => {
  it("3 months or less uses Amazon's default page (no filter)", () => {
    expect(planLookback("2026-07-16", 3)).toEqual({ filters: [null], cutoffIso: "2026-04-16" });
    expect(planLookback("2026-07-16", 1)).toEqual({ filters: [null], cutoffIso: "2026-06-16" });
  });

  it("6 months in July stays within the current year", () => {
    expect(planLookback("2026-07-16", 6)).toEqual({ filters: ["year-2026"], cutoffIso: "2026-01-16" });
  });

  it("6 months in February spans into the previous year", () => {
    expect(planLookback("2026-02-10", 6)).toEqual({
      filters: ["year-2026", "year-2025"],
      cutoffIso: "2025-08-10",
    });
  });

  it("longer lookbacks add one year filter per calendar year, newest first", () => {
    expect(planLookback("2026-07-16", 12).filters).toEqual(["year-2026", "year-2025"]);
    expect(planLookback("2026-07-16", 36).filters).toEqual([
      "year-2026",
      "year-2025",
      "year-2024",
      "year-2023",
    ]);
  });
});

describe("pageAllOlderThan", () => {
  it("is true only when every order predates the cutoff", () => {
    expect(pageAllOlderThan([{ date: "2026-01-01" }, { date: "2025-12-01" }], "2026-04-16")).toBe(true);
    expect(pageAllOlderThan([{ date: "2026-05-01" }, { date: "2025-12-01" }], "2026-04-16")).toBe(false);
  });

  it("an empty page is not 'older' (it is 'no data')", () => {
    expect(pageAllOlderThan([], "2026-04-16")).toBe(false);
  });
});

describe("yearFilterMismatch", () => {
  it("flags a year filter that returned only other years' orders", () => {
    expect(yearFilterMismatch("year-2025", [{ date: "2026-06-01" }, { date: "2026-05-01" }])).toBe(true);
  });

  it("passes when at least one order is from the filtered year", () => {
    expect(yearFilterMismatch("year-2025", [{ date: "2026-01-02" }, { date: "2025-11-11" }])).toBe(false);
  });

  it("never flags the default page or an empty result", () => {
    expect(yearFilterMismatch(null, [{ date: "2026-06-01" }])).toBe(false);
    expect(yearFilterMismatch("year-2023", [])).toBe(false);
  });
});

describe("filterLabel", () => {
  it("labels filters for progress messages", () => {
    expect(filterLabel(null)).toBe("recent orders");
    expect(filterLabel("year-2025")).toBe("2025 orders");
  });
});
