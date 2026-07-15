// Read the user's Amazon-looking transactions from Monarch — the read half of
// the matcher (M1). Reuses the M0 cookie transport. Prefers a server-side text
// filter so it fetches only Amazon rows (not all ~17k), and falls back to
// scanning recent pages client-side if Monarch rejects the filter shape.
import { type MonarchAuth, gqlRequest } from "./monarch-gql";
import { isAmazonMerchant } from "./amazon-merchant";

export interface AmazonTxn {
  id: string;
  date: string; // YYYY-MM-DD
  amountCents: number; // integer cents; negative = money out
  merchantName: string;
  name: string; // current transaction display name (for rename undo)
  notes: string; // current Monarch notes (for never-clobber + undo)
}

export interface AmazonReadResult {
  ranAt: number;
  ok: boolean;
  rows: AmazonTxn[];
  amazonCount: number; // rows.length
  totalScanned: number; // raw transactions examined
  totalCount: number | null; // Monarch's reported grand total, if available
  filtered: boolean; // true if the server-side search filter was used
  capped: boolean; // true if we stopped early (unfiltered scan cap or maxRows)
  note: string;
}

// `name` is included only when withName is true; if Monarch's schema rejects it
// we retry without it (self-heal) so the whole read never breaks over one field.
function readQuery(withName: boolean): string {
  return `query Web_GetTransactionsList($offset: Int, $limit: Int, $filters: TransactionFilterInput) {
  allTransactions(filters: $filters) {
    totalCount
    results(offset: $offset, limit: $limit) {
      id
      date
      amount
      ${withName ? "name" : ""}
      notes
      merchant { name }
    }
  }
}`;
}

function buildDoc(offset: number, limit: number, search: string | null, withName: boolean) {
  return {
    operationName: "Web_GetTransactionsList",
    query: readQuery(withName),
    variables: { offset, limit, filters: search ? { search } : {} },
  };
}

interface Options {
  maxRows?: number; // cap on Amazon rows collected
  pageSize?: number;
  unfilteredScanCap?: number; // when falling back, don't scan the entire ledger
}

export async function readAmazonTransactions(
  auth: MonarchAuth,
  opts: Options = {},
  onProgress?: (loaded: number) => void,
): Promise<AmazonReadResult> {
  const maxRows = opts.maxRows ?? 500;
  const pageSize = opts.pageSize ?? 100;
  const unfilteredScanCap = opts.unfilteredScanCap ?? 1000;

  // Detect a query shape Monarch accepts: try search+name first, then drop name
  // (schema may not expose it), then drop the search filter, then both.
  const combos = [
    { search: true, name: true },
    { search: true, name: false },
    { search: false, name: true },
    { search: false, name: false },
  ];
  let useSearch = true;
  let withName = true;
  let firstRes = null;
  let lastNote = "no attempt made";
  for (const c of combos) {
    const res = await gqlRequest(auth, buildDoc(0, pageSize, c.search ? "amazon" : null, c.name));
    lastNote = res.note;
    if (res.ok) {
      useSearch = c.search;
      withName = c.name;
      firstRes = res;
      break;
    }
  }
  if (!firstRes) {
    return {
      ranAt: Date.now(), ok: false, rows: [], amazonCount: 0,
      totalScanned: 0, totalCount: null, filtered: false, capped: false, note: lastNote,
    };
  }

  const rows: AmazonTxn[] = [];
  let totalCount: number | null = null;
  let totalScanned = 0;
  let offset = 0;
  let capped = false;
  let res: typeof firstRes | null = firstRes;

  while (rows.length < maxRows) {
    if (res === null) res = await gqlRequest(auth, buildDoc(offset, pageSize, useSearch ? "amazon" : null, withName));
    if (!res.ok) {
      return {
        ranAt: Date.now(), ok: false, rows, amazonCount: rows.length,
        totalScanned, totalCount, filtered: useSearch, capped, note: res.note,
      };
    }
    const page = collectAmazon(res.data);
    if (totalCount === null) totalCount = page.totalCount;
    totalScanned += page.pageLen;
    for (const row of page.rows) {
      if (rows.length >= maxRows) { capped = true; break; }
      rows.push(row);
    }
    onProgress?.(rows.length);
    if (page.pageLen < pageSize) break; // last page
    if (!useSearch && totalScanned >= unfilteredScanCap) { capped = true; break; }
    offset += pageSize;
    res = null; // force a fresh fetch for the next page
  }

  return {
    ranAt: Date.now(), ok: true, rows, amazonCount: rows.length, totalScanned, totalCount,
    filtered: useSearch, capped,
    note:
      `${rows.length} Amazon txns` +
      (useSearch ? " (server-filtered)" : ` (scanned ${totalScanned} recent`) +
      (!useSearch ? (capped ? ", capped)" : ")") : "") +
      (totalCount !== null ? `, ${totalCount} total in Monarch` : ""),
  };
}

/** Pure: extract Amazon rows from an allTransactions payload. */
export function collectAmazon(data: unknown): {
  rows: AmazonTxn[];
  pageLen: number;
  totalCount: number | null;
} {
  const all = pick(data, "allTransactions");
  const results = pick(all, "results");
  const raw = Array.isArray(results) ? results : [];
  const totalCount = numOrNull(pick(all, "totalCount"));
  const rows: AmazonTxn[] = [];
  for (const r of raw) {
    const name = strOrNull(pick(pick(r, "merchant"), "name"));
    if (!isAmazonMerchant(name)) continue;
    rows.push({
      id: strOrNull(pick(r, "id")) ?? "",
      date: strOrNull(pick(r, "date")) ?? "",
      amountCents: toCents(pick(r, "amount")),
      merchantName: name ?? "",
      name: strOrNull(pick(r, "name")) ?? name ?? "",
      notes: strOrNull(pick(r, "notes")) ?? "",
    });
  }
  return { rows, pageLen: raw.length, totalCount };
}

function pick(obj: unknown, key: string): unknown {
  if (typeof obj !== "object" || obj === null) return null;
  return (obj as Record<string, unknown>)[key] ?? null;
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function toCents(v: unknown): number {
  return typeof v === "number" ? Math.round(v * 100) : 0;
}
