// Read Monarch transactions and count the Amazon-looking ones — the first
// read-side proof (M1). Reuses the M0 cookie transport. The query shape follows
// the community-documented Web_GetTransactionsList; if Monarch's schema differs,
// gqlRequest surfaces the exact graphql error so we can correct it.
import { type MonarchAuth, gqlRequest } from "./monarch-gql";
import { isAmazonMerchant } from "./amazon-merchant";

export interface AmazonReadResult {
  ranAt: number;
  ok: boolean;
  amazonCount: number; // Amazon-looking transactions in the scanned page
  totalScanned: number; // transactions returned in this page
  totalCount: number | null; // Monarch's reported total, if available
  note: string;
}

const READ_DOC = {
  operationName: "Web_GetTransactionsList",
  query: `query Web_GetTransactionsList($offset: Int, $limit: Int, $filters: TransactionFilterInput) {
  allTransactions(offset: $offset, limit: $limit, filters: $filters) {
    totalCount
    results {
      id
      date
      amount
      merchant { name }
    }
  }
}`,
  variables: { offset: 0, limit: 100, filters: {} },
};

interface TxnRow {
  merchant?: { name?: string | null } | null;
}

/** Pure: count Amazon-looking rows in an allTransactions payload. */
export function countAmazon(data: unknown): {
  amazonCount: number;
  totalScanned: number;
  totalCount: number | null;
} {
  const all = pick(data, "allTransactions");
  const results = pick(all, "results");
  const rows: TxnRow[] = Array.isArray(results) ? (results as TxnRow[]) : [];
  const totalCountRaw = pick(all, "totalCount");
  const totalCount = typeof totalCountRaw === "number" ? totalCountRaw : null;
  let amazonCount = 0;
  for (const row of rows) {
    if (isAmazonMerchant(row?.merchant?.name)) amazonCount += 1;
  }
  return { amazonCount, totalScanned: rows.length, totalCount };
}

export async function readAmazonTransactions(auth: MonarchAuth): Promise<AmazonReadResult> {
  const res = await gqlRequest(auth, READ_DOC);
  if (!res.ok) {
    return {
      ranAt: Date.now(),
      ok: false,
      amazonCount: 0,
      totalScanned: 0,
      totalCount: null,
      note: res.note,
    };
  }
  const { amazonCount, totalScanned, totalCount } = countAmazon(res.data);
  return {
    ranAt: Date.now(),
    ok: true,
    amazonCount,
    totalScanned,
    totalCount,
    note: `scanned ${totalScanned} txns${totalCount !== null ? ` of ${totalCount}` : ""}, ${amazonCount} look like Amazon`,
  };
}

function pick(obj: unknown, key: string): unknown {
  if (typeof obj !== "object" || obj === null) return null;
  return (obj as Record<string, unknown>)[key] ?? null;
}
