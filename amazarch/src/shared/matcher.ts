// The matcher — pairs Amazon orders to Monarch Amazon charges by amount + a date
// window (SPEC.md §3). Amazon charges the card when an item ships and the bank
// records the settlement date, so the charge lands on/after the order date; we
// match on exact amount within a window rather than exact date. Pure + tested.
import type { AmazonTxn } from "./monarch-read";
import type { AmazonOrderLite } from "./messages";

export type MatchStatus = "auto" | "review" | "unmatched" | "refund";

export interface MatchResult {
  charge: AmazonTxn;
  order: AmazonOrderLite | null;
  candidateCount: number;
  status: MatchStatus;
  dayDiff: number | null; // charge date minus order date, in days
}

export interface MatchOptions {
  windowDays?: number; // how many days AFTER the order a charge may land
  backDays?: number; // small tolerance for a charge dated before the order
}

export interface MatchSummary {
  auto: number;
  review: number;
  unmatched: number;
  refund: number;
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

  return charges.map((charge) => {
    // Money-in on an Amazon transaction is a refund; order history has no
    // refunds, so flag it for the (future) refund matcher rather than mismatch it.
    if (charge.amountCents > 0) {
      return { charge, order: null, candidateCount: 0, status: "refund", dayDiff: null };
    }
    const target = Math.abs(charge.amountCents);
    if (target === 0) {
      return { charge, order: null, candidateCount: 0, status: "unmatched", dayDiff: null };
    }

    const candidates = orders
      .map((o) => ({ o, dd: dayDiff(o.date, charge.date) }))
      .filter((c): c is { o: AmazonOrderLite; dd: number } => c.dd !== null)
      .filter((c) => c.o.totalCents === target && c.dd >= -backDays && c.dd <= windowDays)
      .sort((a, b) => Math.abs(a.dd) - Math.abs(b.dd)); // closest date first

    if (candidates.length === 0) {
      return { charge, order: null, candidateCount: 0, status: "unmatched", dayDiff: null };
    }
    const best = candidates[0]!;
    return {
      charge,
      order: best.o,
      candidateCount: candidates.length,
      status: candidates.length === 1 ? "auto" : "review",
      dayDiff: best.dd,
    };
  });
}

export function summarize(results: MatchResult[]): MatchSummary {
  const s: MatchSummary = { auto: 0, review: 0, unmatched: 0, refund: 0 };
  for (const r of results) s[r.status] += 1;
  return s;
}
