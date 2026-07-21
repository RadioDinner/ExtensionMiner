// Import an Amazon "Request My Data" ZIP into the per-account order store — the
// bulk-history backfill (SPEC.md D7). The imported orders merge (union by order
// id) into the chosen account's bucket, so a later live sync of that account
// adds to them rather than dropping them, and the matcher runs against the full
// history on the next sync. Reuses the pure ZIP + CSV parsers; this thin runtime
// wrapper does the File → bytes → store I/O.
import { readZipEntries } from "./zip";
import { parseRetailOrderHistory } from "./amazon-export";
import { recordAccountOrders } from "./order-store";
import type { AmazonOrderLite } from "./messages";

const ORDER_HISTORY_RE = /Retail\.OrderHistory.*\.csv$/i;

export interface ImportResult {
  orders: number; // distinct orders imported
  files: number; // Retail.OrderHistory CSVs found in the ZIP
  account: string; // bucket they were merged into
}

/** Parse a ZIP's Retail.OrderHistory CSV(s) and merge the orders into an account
 *  bucket. Throws with a user-facing message on a bad/empty archive. */
export async function importOrderHistoryZip(file: File, accountLabel: string): Promise<ImportResult> {
  const label = accountLabel.trim() || "Imported (Amazon export)";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = await readZipEntries(bytes);
  const csvs = entries.filter((e) => ORDER_HISTORY_RE.test(e.name));
  if (csvs.length === 0) {
    throw new Error(
      "No Retail.OrderHistory CSV found in that ZIP. Make sure you exported the “Your Orders” category from Amazon Privacy Central.",
    );
  }

  const seen = new Set<string>();
  const orders: AmazonOrderLite[] = [];
  const decoder = new TextDecoder();
  for (const csv of csvs) {
    for (const o of parseRetailOrderHistory(decoder.decode(csv.bytes))) {
      if (o.orderId) {
        if (seen.has(o.orderId)) continue;
        seen.add(o.orderId);
      }
      orders.push(o);
    }
  }
  if (orders.length === 0) {
    // We found the file(s) but parsed nothing — most likely the export's columns
    // changed (e.g. the order-total column was renamed, so every order was
    // dropped). Say so, rather than implying the export was empty.
    throw new Error(
      "Found the order-history file(s) but couldn't read any orders — Amazon's export format may have changed. Please use “Copy diagnostics” and report it.",
    );
  }

  await recordAccountOrders(label, orders);
  return { orders: orders.length, files: csvs.length, account: label };
}
