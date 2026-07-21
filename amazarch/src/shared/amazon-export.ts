// Parse Amazon's Privacy Central "Request My Data" export (the Your Orders
// category → Retail.OrderHistory CSV) into the same AmazonOrderLite shape the
// live scraper produces. This is the ToS-clean BULK backfill path (SPEC.md §R1,
// D7): it beats the official Monarch extension's ~3-month limit — the headline
// differentiator. Pure + tested; the ZIP reader (zip.ts) feeds CSV text here.
//
// The export is one row PER ITEM, so rows are grouped by Order ID: the order
// total is the sum of each item row's "Total Owed" (the amount owed incl.
// allocated tax/shipping), item titles are collected, cancelled rows are
// dropped. A wrong total simply fails to match a charge (lands unmatched/review)
// — it can never cause a bad auto-write, so summing is the safe default.
import { parseCsv } from "./csv";
import { parseAmountToCents } from "./money";
import type { AmazonOrderLite } from "./messages";

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Index of the first header matching any of the given names (punctuation- and
 *  case-insensitive), or -1. */
function headerIndex(headers: string[], ...names: string[]): number {
  const wanted = names.map(norm);
  return headers.findIndex((h) => wanted.includes(norm(h)));
}

/** Normalize an export date ("2024-01-15T08:30:00Z", "2024-01-15", …) to
 *  YYYY-MM-DD, or null. */
export function normalizeExportDate(s: string): string | null {
  const t = s.trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const parsed = Date.parse(t);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

interface Group {
  orderId: string;
  date: string;
  totalCents: number;
  titles: string[];
  returnHint: boolean;
}

/** Parse one Retail.OrderHistory CSV into per-order records. Returns [] if the
 *  text isn't a recognizable order-history CSV (missing Order ID / Order Date). */
export function parseRetailOrderHistory(csvText: string): AmazonOrderLite[] {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];
  const h = rows[0]!;
  const idI = headerIndex(h, "Order ID", "OrderID");
  const dateI = headerIndex(h, "Order Date", "OrderDate");
  const totalI = headerIndex(h, "Total Owed", "Item Total", "Total");
  const nameI = headerIndex(h, "Product Name", "Title");
  const statusI = headerIndex(h, "Order Status", "Order Status Code");
  if (idI < 0 || dateI < 0) return [];

  const groups = new Map<string, Group>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const orderId = (row[idI] ?? "").trim();
    if (!orderId) continue;
    const date = normalizeExportDate(row[dateI] ?? "");
    if (!date) continue;
    const status = statusI >= 0 ? (row[statusI] ?? "").toLowerCase() : "";
    if (status.includes("cancel")) continue; // never charged
    const cents = totalI >= 0 ? parseAmountToCents(row[totalI] ?? "") ?? 0 : 0;
    const title = nameI >= 0 ? (row[nameI] ?? "").trim() : "";
    const returnHint = /return|refund/.test(status);

    const g = groups.get(orderId);
    if (!g) {
      groups.set(orderId, { orderId, date, totalCents: cents, titles: title ? [title] : [], returnHint });
    } else {
      g.totalCents += cents;
      if (title && !g.titles.includes(title)) g.titles.push(title);
      if (returnHint) g.returnHint = true;
      if (date < g.date) g.date = date; // earliest row date for the order
    }
  }

  return [...groups.values()]
    .filter((g) => g.totalCents > 0)
    .map((g) => ({
      orderId: g.orderId,
      date: g.date,
      totalCents: g.totalCents,
      itemTitles: g.titles.slice(0, 10),
      returnHint: g.returnHint,
    }));
}

/** Parse + merge several CSV parts (a multi-part export), deduped by order id. */
export function parseExportCsvs(texts: string[]): AmazonOrderLite[] {
  const byId = new Map<string, AmazonOrderLite>();
  for (const text of texts) {
    for (const o of parseRetailOrderHistory(text)) {
      if (!byId.has(o.orderId)) byId.set(o.orderId, o);
    }
  }
  return [...byId.values()];
}
