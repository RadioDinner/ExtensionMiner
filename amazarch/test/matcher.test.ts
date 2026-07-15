import { describe, expect, it } from "vitest";
import { dayDiff, matchOrdersToCharges, summarize } from "../src/shared/matcher";
import type { AmazonTxn } from "../src/shared/monarch-read";
import type { AmazonOrderLite } from "../src/shared/messages";

function charge(id: string, date: string, cents: number): AmazonTxn {
  return { id, date, amountCents: cents, merchantName: "AMZN Mktp US", notes: "" };
}
function order(orderId: string, date: string, cents: number): AmazonOrderLite {
  return { orderId, date, totalCents: cents, itemTitles: ["thing"] };
}

describe("dayDiff", () => {
  it("computes calendar-day differences", () => {
    expect(dayDiff("2026-07-06", "2026-07-07")).toBe(1);
    expect(dayDiff("2026-07-06", "2026-07-06")).toBe(0);
    expect(dayDiff("2026-07-10", "2026-07-06")).toBe(-4);
    expect(dayDiff("bad", "2026-07-06")).toBeNull();
  });
});

describe("matchOrdersToCharges", () => {
  it("auto-matches the $47.47 charge (7-7) to the order (7-6) within the window", () => {
    const results = matchOrdersToCharges(
      [charge("c1", "2026-07-07", -4747)],
      [order("111-2222222-3333333", "2026-07-06", 4747)],
    );
    expect(results[0]!.status).toBe("auto");
    expect(results[0]!.order?.orderId).toBe("111-2222222-3333333");
    expect(results[0]!.dayDiff).toBe(1);
  });

  it("flags ambiguous same-amount orders as review", () => {
    const results = matchOrdersToCharges(
      [charge("c1", "2026-07-07", -2000)],
      [order("o1", "2026-07-06", 2000), order("o2", "2026-07-05", 2000)],
    );
    expect(results[0]!.status).toBe("review");
    expect(results[0]!.candidateCount).toBe(2);
    expect(results[0]!.order?.orderId).toBe("o1"); // closest date wins as the shown candidate
  });

  it("does not match outside the date window", () => {
    const results = matchOrdersToCharges(
      [charge("c1", "2026-08-01", -4747)],
      [order("o1", "2026-07-06", 4747)], // 26 days later — beyond the 10-day window
    );
    expect(results[0]!.status).toBe("unmatched");
  });

  it("does not match a different amount", () => {
    const results = matchOrdersToCharges(
      [charge("c1", "2026-07-07", -4700)],
      [order("o1", "2026-07-06", 4747)],
    );
    expect(results[0]!.status).toBe("unmatched");
  });

  it("classifies money-in as a refund (handled later)", () => {
    const results = matchOrdersToCharges([charge("c1", "2026-07-07", 4747)], []);
    expect(results[0]!.status).toBe("refund");
  });

  it("summarizes statuses", () => {
    const results = matchOrdersToCharges(
      [charge("a", "2026-07-07", -4747), charge("b", "2026-07-07", 500), charge("c", "2026-07-07", -9999)],
      [order("o1", "2026-07-06", 4747)],
    );
    expect(summarize(results)).toEqual({ auto: 1, review: 0, unmatched: 1, refund: 1 });
  });
});
