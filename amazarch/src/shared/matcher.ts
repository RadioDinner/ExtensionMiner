// The matcher — pairs Amazon orders to Monarch Amazon charges by amount + a date
// window (SPEC.md §3). Amazon charges the card when an item ships and the bank
// records the settlement date, so the charge lands on/after the order date; we
// match on exact amount within a window rather than exact date. Pure + tested.
//
// Refunds (SPEC.md §3 rule 4, D3): a money-IN row is a refund credit. It is
// matched back to the order it refunds: a credit equal to an order's total
// within the refund window is a FULL refund (auto when unique, or when the
// card's return/refund hint singles out one of several same-amount orders);
// a credit smaller than a return-hinted order's total is a PARTIAL refund
// candidate (always review — never auto). No candidate → status "refund"
// (an unmatched refund, listed rather than silently dropped).
import type { AmazonTxn } from "./monarch-read";
import type { AmazonOrderLite } from "./messages";

export type MatchStatus = "auto" | "review" | "unmatched" | "refund";
export type MatchKind = "charge" | "refund";
export type RefundMatch = "full" | "partial";

export interface MatchResult {
  charge: AmazonTxn;
  order: AmazonOrderLite | null;
  candidateCount: number;
  status: MatchStatus;
  dayDiff: number | null; // charge/credit date minus order date, in days
  kind: MatchKind; // money-out = charge, money-in = refund credit
  refundMatch: RefundMatch | null; // set only on matched refunds
}

export interface MatchOptions {
  windowDays?: number; // how many days AFTER the order a charge may land
  backDays?: number; // small tolerance for a charge dated before the order
  refundWindowDays?: number; // how many days after the order a refund may land
}

export interface MatchSummary {
  auto: number;
  review: number;
  unmatched: number;
  refund: number; // refund credits with NO matching order (matched ones count as auto/review)
}

/** Days between two YYYY-MM-DD dates (b - a), timezone-independent. */
export function dayDiff(aIso: string, bIso: string): number | null {
  const a = toDayNum(aIso);
  const b = toDayNum(bIso);
  if (a === null || b === null) return null;
  return b - a;
}

function toDayNum(iso: string): number | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000;
}

export function matchOrdersToCharges(
  charges: AmazonTxn[],
  orders: AmazonOrderLite[],
  opts: MatchOptions = {},
): MatchResult[] {
  const windowDays = opts.windowDays ?? 10;
  const backDays = opts.backDays ?? 2;
  // Amazon's return window is ~30 days (extended to ~3 months over the
  // holidays) and the credit posts days after the return — 120 covers it.
  const refundWindowDays = opts.refundWindowDays ?? 120;

  return charges.map((charge) => {
    if (charge.amountCents > 0) {
      return matchRefund(charge, orders, refundWindowDays);
    }
    const target = Math.abs(charge.amountCents);
    if (target === 0) {
      return unmatched(charge, "charge");
    }

    const candidates = orders
      .map((o) => ({ o, dd: dayDiff(o.date, charge.date) }))
      .filter((c): c is { o: AmazonOrderLite; dd: number } => c.dd !== null)
      .filter((c) => c.o.totalCents === target && c.dd >= -backDays && c.dd <= windowDays)
      .sort((a, b) => Math.abs(a.dd) - Math.abs(b.dd)); // closest date first

    if (candidates.length === 0) {
      return unmatched(charge, "charge");
    }
    const best = candidates[0]!;
    return {
      charge,
      order: best.o,
      candidateCount: candidates.length,
      status: candidates.length === 1 ? ("auto" as const) : ("review" as const),
      dayDiff: best.dd,
      kind: "charge" as const,
      refundMatch: null,
    };
  });
}

/** Match a refund credit (money-in) back to the order it refunds. */
function matchRefund(
  credit: AmazonTxn,
  orders: AmazonOrderLite[],
  refundWindowDays: number,
): MatchResult {
  const target = credit.amountCents; // positive cents
  // A refund always posts on/after its order's date — no back tolerance.
  const inWindow = orders
    .map((o) => ({ o, dd: dayDiff(o.date, credit.date) }))
    .filter((c): c is { o: AmazonOrderLite; dd: number } => c.dd !== null)
    .filter((c) => c.dd >= 0 && c.dd <= refundWindowDays);

  // Full refund: credit equals an order's total. Unique → auto; several
  // same-amount orders where the return hint singles out exactly one → auto
  // (the hint IS the disambiguation); otherwise review, hinted-first.
  const full = inWindow
    .filter((c) => c.o.totalCents === target)
    .sort((a, b) => hintRank(b.o) - hintRank(a.o) || a.dd - b.dd);
  if (full.length > 0) {
    const hinted = full.filter((c) => c.o.returnHint === true);
    const best = (hinted.length === 1 ? hinted[0] : full[0])!;
    return {
      charge: credit,
      order: best.o,
      candidateCount: full.length,
      status: full.length === 1 || hinted.length === 1 ? "auto" : "review",
      dayDiff: best.dd,
      kind: "refund",
      refundMatch: "full",
    };
  }

  // Partial refund: a smaller credit against a return-hinted order. Without a
  // hint an order-total can't evidence a partial amount, so the hint is
  // REQUIRED here — and partials are never auto (SPEC §3 rule 4).
  const partial = inWindow
    .filter((c) => c.o.returnHint === true && c.o.totalCents > target)
    .sort((a, b) => a.dd - b.dd);
  if (partial.length > 0) {
    const best = partial[0]!;
    return {
      charge: credit,
      order: best.o,
      candidateCount: partial.length,
      status: "review",
      dayDiff: best.dd,
      kind: "refund",
      refundMatch: "partial",
    };
  }

  return unmatched(credit, "refund");
}

function hintRank(o: AmazonOrderLite): number {
  return o.returnHint === true ? 1 : 0;
}

function unmatched(charge: AmazonTxn, kind: MatchKind): MatchResult {
  return {
    charge,
    order: null,
    candidateCount: 0,
    status: kind === "refund" ? "refund" : "unmatched",
    dayDiff: null,
    kind,
    refundMatch: null,
  };
}

export function summarize(results: MatchResult[]): MatchSummary {
  const s: MatchSummary = { auto: 0, review: 0, unmatched: 0, refund: 0 };
  for (const r of results) s[r.status] += 1;
  return s;
}
