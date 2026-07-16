// Planning for how far back the Amazon order fetch looks. Amazon's order
// history page defaults to "past three months"; older orders are only
// reachable through per-period time filters (timeFilter=year-YYYY). A lookback
// longer than 3 months is fetched as a series of year filters, newest first,
// with a cutoff date to stop paginating once a page is entirely older. Pure.

export interface LookbackPlan {
  filters: (string | null)[]; // null = Amazon's default page (past 3 months)
  cutoffIso: string; // orders older than this end a filter's pagination early
}

/** ISO date minus N months, day-of-month clamped (2026-03-31 − 1mo → 2026-02-28). */
export function minusMonthsIso(iso: string, months: number): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  let year = Number(m[1]);
  let month = Number(m[2]) - 1 - months; // 0-based
  const day = Number(m[3]);
  year += Math.floor(month / 12);
  month = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const d = Math.min(day, lastDay);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function planLookback(todayIso: string, months: number): LookbackPlan {
  const cutoffIso = minusMonthsIso(todayIso, months);
  if (months <= 3) return { filters: [null], cutoffIso };
  const thisYear = Number(todayIso.slice(0, 4));
  const cutoffYear = Number(cutoffIso.slice(0, 4));
  const filters: (string | null)[] = [];
  for (let y = thisYear; y >= cutoffYear; y--) filters.push(`year-${y}`);
  return { filters, cutoffIso };
}

/** True when every order on the page is older than the cutoff (ISO compare). */
export function pageAllOlderThan(orders: { date: string }[], cutoffIso: string): boolean {
  return orders.length > 0 && orders.every((o) => o.date < cutoffIso);
}

/** For a year filter: Amazon returned orders but NONE from that year — the
 *  filter probably didn't apply and we silently got the default page. */
export function yearFilterMismatch(filter: string | null, orders: { date: string }[]): boolean {
  if (!filter) return false;
  const m = filter.match(/^year-(\d{4})$/);
  if (!m) return false;
  return orders.length > 0 && !orders.some((o) => o.date.startsWith(`${m[1]}-`));
}

/** Human label for a filter, for progress messages. */
export function filterLabel(filter: string | null): string {
  if (!filter) return "recent orders";
  const m = filter.match(/^year-(\d{4})$/);
  return m ? `${m[1]} orders` : filter;
}
