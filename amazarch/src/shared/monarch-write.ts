// Monarch write operations. Starts with the safest write — appending Amazon
// item details to a transaction's notes (additive, never clobbers). Uses the
// same cookie/CSRF transport proven for reads (SPEC.md §R3). Merchant rename,
// category, and splits build on this later.
import { type MonarchAuth, gqlRequest } from "./monarch-gql";
import type { AmazonOrderLite } from "./messages";

const MARKER = "[Amazarch]";

/** The note line we add for a matched order. */
export function buildNoteLine(order: AmazonOrderLite): string {
  const items = order.itemTitles.slice(0, 5).join(", ");
  const parts = [`${MARKER} ${items || "Amazon order"}`];
  if (order.orderId) {
    parts.push(`#${order.orderId}`);
    parts.push(`https://www.amazon.com/gp/css/order-details?orderID=${order.orderId}`);
  }
  return parts.join(" · ");
}

/** Append our line to existing notes; never overwrite. Skip if already present. */
export function mergeNotes(
  existing: string | null | undefined,
  order: AmazonOrderLite,
  line: string,
): { notes: string; changed: boolean } {
  const cur = existing ?? "";
  if (order.orderId && cur.includes(order.orderId)) return { notes: cur, changed: false };
  if (cur.includes(line)) return { notes: cur, changed: false };
  return { notes: cur ? `${cur}\n${line}` : line, changed: true };
}

const MUTATION = `mutation Web_TransactionDrawerUpdateTransaction($input: UpdateTransactionMutationInput!) {
  updateTransaction(input: $input) {
    transaction { id notes }
    errors { message }
  }
}`;

export interface WriteResult {
  ok: boolean;
  note: string;
}

export async function setTransactionNotes(
  auth: MonarchAuth,
  id: string,
  notes: string,
): Promise<WriteResult> {
  const res = await gqlRequest(auth, {
    operationName: "Web_TransactionDrawerUpdateTransaction",
    query: MUTATION,
    variables: { input: { id, notes } },
  });
  if (!res.ok) return { ok: false, note: res.note };
  const payloadError = firstPayloadError(res.data);
  if (payloadError) return { ok: false, note: `Monarch rejected the update: ${payloadError}` };
  return { ok: true, note: "notes updated" };
}

function firstPayloadError(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const upd = (data as Record<string, unknown>)["updateTransaction"];
  if (typeof upd !== "object" || upd === null) return null;
  const errors = (upd as Record<string, unknown>)["errors"];
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const msg = (errors[0] as Record<string, unknown>)?.["message"];
  return typeof msg === "string" ? msg : "unknown error";
}
