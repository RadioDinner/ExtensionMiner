import { describe, expect, it } from "vitest";
import { dayDiff, matchOrdersToCharges, summarize } from "../src/shared/matcher";
import type { AmazonTxn } from "../src/shared/monarch-read";
import type { AmazonOrderLite } from "../src/shared/messages";

function charge(id: string, date: string, cents: number): AmazonTxn {
  return { id, date, amountCents: cents, merchantName: "AMZN Mktp US", name: "AMZN Mktp US", notes: "" };
}
function order(orderId: string, date: string, cents: number, returnHint = false): AmazonOrderLite {
  return { orderId, date, totalCents: cents, itemTitles: ["thing"], returnHint };
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

  it("money-in with no matching order stays an unmatched refund", () => {
    const results = matchOrdersToCharges([charge("c1", "2026-07-07", 4747)], []);
    expect(results[0]!.status).toBe("refund");
    expect(results[0]!.kind).toBe("refund");
    expect(results[0]!.order).toBeNull();
  });

  it("labels money-out results as charges", () => {
    const results = matchOrdersToCharges(
      [charge("c1", "2026-07-07", -4747)],
      [order("o1", "2026-07-06", 4747)],
    );
    expect(results[0]!.kind).toBe("charge");
    expect(results[0]!.refundMatch).toBeNull();
  });

  it("summarizes statuses", () => {
    const results = matchOrdersToCharges(
      [charge("a", "2026-07-07", -4747), charge("b", "2026-07-07", 500), charge("c", "2026-07-07", -9999)],
      [order("o1", "2026-07-06", 4747)],
    );
    expect(summarize(results)).toEqual({ auto: 1, review: 0, unmatched: 1, refund: 1 });
  });
});

describe("refund matching (money-in credits)", () => {
  it("auto-matches a unique full-amount refund within the refund window", () => {
    const results = matchOrdersToCharges(
      [charge("r1", "2026-07-20", 4747)],
      [order("o1", "2026-05-06", 4747)], // 75 days earlier — inside the 120-day window
    );
    const r = results[0]!;
    expect(r.status).toBe("auto");
    expect(r.kind).toBe("refund");
    expect(r.refundMatch).toBe("full");
    expect(r.order?.orderId).toBe("o1");
    expect(r.dayDiff).toBe(75);
  });

  it("does not match an order placed AFTER the credit posted", () => {
    const results = matchOrdersToCharges(
      [charge("r1", "2026-07-07", 4747)],
      [order("o1", "2026-07-10", 4747)],
    );
    expect(results[0]!.status).toBe("refund");
    expect(results[0]!.order).toBeNull();
  });

  it("does not match beyond the refund window", () => {
    const results = matchOrdersToCharges(
      [charge("r1", "2026-07-07", 4747)],
      [order("o1", "2026-01-01", 4747)], // 187 days — beyond 120
    );
    expect(results[0]!.status).toBe("refund");
  });

  it("queues ambiguous same-amount refunds for review, closest order first", () => {
    const results = matchOrdersToCharges(
      [charge("r1", "2026-07-20", 2000)],
      [order("o1", "2026-07-01", 2000), order("o2", "2026-06-01", 2000)],
    );
    const r = results[0]!;
    expect(r.status).toBe("review");
    expect(r.candidateCount).toBe(2);
    expect(r.order?.orderId).toBe("o1");
  });

  it("a return hint singles out one of several same-amount orders → auto", () => {
    const results = matchOrdersToCharges(
      [charge("r1", "2026-07-20", 2000)],
      // o1 is CLOSER in date, but o2 is the one showing "Return complete"
      [order("o1", "2026-07-01", 2000), order("o2", "2026-06-01", 2000, true)],
    );
    const r = results[0]!;
    expect(r.status).toBe("auto");
    expect(r.order?.orderId).toBe("o2");
    expect(r.candidateCount).toBe(2);
  });

  it("two hinted same-amount orders stay ambiguous (review)", () => {
    const results = matchOrdersToCharges(
      [charge("r1", "2026-07-20", 2000)],
      [order("o1", "2026-07-01", 2000, true), order("o2", "2026-06-01", 2000, true)],
    );
    expect(results[0]!.status).toBe("review");
  });

  it("matches a partial refund ONLY against a return-hinted larger order, as review", () => {
    const hinted = matchOrdersToCharges(
      [charge("r1", "2026-07-20", 1000)],
      [order("o1", "2026-07-01", 5000, true)],
    );
    expect(hinted[0]!.status).toBe("review");
    expect(hinted[0]!.refundMatch).toBe("partial");
    expect(hinted[0]!.order?.orderId).toBe("o1");

    const unhinted = matchOrdersToCharges(
      [charge("r1", "2026-07-20", 1000)],
      [order("o1", "2026-07-01", 5000)],
    );
    expect(unhinted[0]!.status).toBe("refund"); // no hint → no partial evidence
    expect(unhinted[0]!.order).toBeNull();
  });

  it("prefers a full-amount match over a partial candidate", () => {
    const results = matchOrdersToCharges(
      [charge("r1", "2026-07-20", 2000)],
      [order("big", "2026-07-01", 5000, true), order("exact", "2026-06-15", 2000)],
    );
    const r = results[0]!;
    expect(r.refundMatch).toBe("full");
    expect(r.order?.orderId).toBe("exact");
    expect(r.status).toBe("auto");
  });

  it("respects a custom refundWindowDays", () => {
    const results = matchOrdersToCharges(
      [charge("r1", "2026-07-20", 4747)],
      [order("o1", "2026-05-06", 4747)], // 75 days
      { refundWindowDays: 30 },
    );
    expect(results[0]!.status).toBe("refund");
  });

  it("matched refunds count as auto/review in the summary; only unmatched count as refund", () => {
    const results = matchOrdersToCharges(
      [charge("r1", "2026-07-20", 4747), charge("r2", "2026-07-20", 123)],
      [order("o1", "2026-07-01", 4747)],
    );
    expect(summarize(results)).toEqual({ auto: 1, review: 0, unmatched: 0, refund: 1 });
  });
});
