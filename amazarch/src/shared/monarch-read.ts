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

const READ_QUERY = `query Web_GetTransactionsList($offset: Int, $limit: Int, $filters: TransactionFilterInput) {
  allTransactions(filters: $filters) {
    totalCount
    results(offset: $offset, limit: $limit) {
      id
      date
      amount
      notes
      merchant { name }
    }
  }
}`;

function buildDoc(offset: number, limit: number, search: string | null) {
  return {
    operationName: "Web_GetTransactionsList",
    query: READ_QUERY,
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
): Promise<AmazonReadResult> {
  const maxRows = opts.maxRows ?? 500;
  const pageSize = opts.pageSize ?? 100;
  const unfilteredScanCap = opts.unfilteredScanCap ?? 1000;

  let useSearch = true;
  const rows: AmazonTxn[] = [];
  let totalCount: number | null = null;
  let totalScanned = 0;
  let offset = 0;
  let capped = false;

  while (rows.length < maxRows) {
    let res = await gqlRequest(auth, buildDoc(offset, pageSize, useSearch ? "amazon" : null));
    if (!res.ok && useSearch) {
      // Monarch may not accept filters.search — fall back to an unfiltered scan.
      useSearch = false;
      offset = 0;
      totalScanned = 0;
      rows.length = 0;
      res = await gqlRequest(auth, buildDoc(offset, pageSize, null));
    }
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
    if (page.pageLen < pageSize) break; // last page
    if (!useSearch && totalScanned >= unfilteredScanCap) { capped = true; break; }
    offset += pageSize;
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
