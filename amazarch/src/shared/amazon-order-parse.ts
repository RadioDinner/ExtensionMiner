// Parse Amazon order-history HTML into structured orders. Deliberately keyed on
// human-visible labels ("Order placed", "Total", the 3-7-7 order-number format)
// and product-link href patterns rather than CSS classes — Amazon obfuscates
// class/attribute names but the visible text is stable (SPEC.md §R1). Pure and
// fixture-tested; the background runs it on the fetched HTML.
import { parseAmountToCents } from "./money";

export interface AmazonOrder {
  orderId: string;
  date: string; // ISO YYYY-MM-DD (the "Order placed" date)
  totalCents: number; // positive cents
  itemTitles: string[];
  returnHint: boolean; // completed return/refund wording seen on the card
}

export function parseAmazonOrders(html: string): AmazonOrder[] {
  const orders: AmazonOrder[] = [];
  for (const block of splitOrderBlocks(html)) {
    const date = parseOrderDate(block);
    const totalCents = parseOrderTotal(block);
    if (date === null || totalCents === null) continue;
    orders.push({
      orderId: parseOrderId(block) ?? "",
      date,
      totalCents,
      itemTitles: parseItemTitles(block),
      returnHint: hasReturnHint(block),
    });
  }
  return orders;
}

// Each order card contains exactly one "Order placed" label; slice the HTML
// into per-order blocks on those boundaries.
function splitOrderBlocks(html: string): string[] {
  const idxs: number[] = [];
  const re = /Order placed/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) idxs.push(m.index);
  return idxs.map((start, i) => html.slice(start, idxs[i + 1] ?? html.length));
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** The first "Month D, YYYY" date in the block — the Order-placed date. */
export function parseOrderDate(block: string): string | null {
  const m = block.match(/([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS[(m[1] ?? "").toLowerCase()];
  if (!month) return null;
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (!day || !year) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The order total: the first "$" amount following a "Total" label. */
export function parseOrderTotal(block: string): number | null {
  const m = block.match(/Total[\s\S]{0,80}?\$\s?([\d,]+\.\d{2})/i);
  if (!m || !m[1]) return null;
  return parseAmountToCents(`$${m[1]}`);
}

/** Amazon order numbers look like 114-1234567-1234567. */
export function parseOrderId(block: string): string | null {
  const m = block.match(/\b(\d{3}-\d{7}-\d{7})\b/);
  return m ? (m[1] ?? null) : null;
}

// COMPLETED return/refund wording only. Nearly every delivered order card
// carries "Return or replace items" / "Return eligible through …" button text,
// so a bare /return|refund/ would flag everything — match the completed-state
// phrases Amazon renders once a return or refund actually happened.
const RETURN_HINT_RE =
  /refund (issued|complete|completed|processed)|refunded|your refund|track (your )?refund|return (complete|completed|received|successful)|items? returned/i;

/** True when a card's text shows a COMPLETED return/refund (refund-match signal). */
export function hasReturnHint(text: string): boolean {
  return RETURN_HINT_RE.test(text);
}

/** Product titles from item links (/dp/ or /gp/product/), deduped. */
export function parseItemTitles(block: string): string[] {
  const titles: string[] = [];
  const re = /<a[^>]+href="[^"]*\/(?:gp\/product|dp)\/[^"]*"[^>]*>([^<]{3,})<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const t = decodeEntities((m[1] ?? "").trim());
    if (t) titles.push(t);
  }
  return [...new Set(titles)].slice(0, 10);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}
