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

// --- Merchant rename ---------------------------------------------------------

// Shorten a long Amazon item title into a merchant suffix, e.g.
// "Nordic Naturals Omega-3 Fish Oil, 690mg, 120 Soft Gels" -> "Nordic Naturals Omega-3 Fish Oil".
// (A crisper paraphrase like "Omega 3 supplement" needs the AI summarizer, D14.)
export function shortItemSummary(titles: string[], maxLen = 42): string {
  let s = titles[0] ?? "";
  s = s.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " "); // drop (…) and […]
  s = s.replace(/\bpack of \d+\b/gi, " ").replace(/\b\d+[-\s]?pack\b/gi, " ");
  // drop quantity/size tokens: "120 Soft Gels", "690mg", "12 fl oz", "3 ct", …
  s = s.replace(
    /\b\d[\d.,]*\s?(count|ct|pack|pk|pieces?|pcs?|soft ?gels?|capsules?|caplets?|tablets?|servings?|fl ?oz|oz|ml|l|mg|g|kg|lbs?|inch(?:es)?|in|ft|cm|mm|pack)\b/gi,
    " ",
  );
  s = s.replace(/[,|]+/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/\s\S*$/, "").trim(); // cut at a word boundary
  const extra = titles.length > 1 ? ` +${titles.length - 1}` : "";
  return (s || "order") + extra;
}

export function buildMerchantName(order: AmazonOrderLite, base = "Amazon"): string {
  return `${base} — ${shortItemSummary(order.itemTitles)}`;
}

// --- Writes ------------------------------------------------------------------

const MUTATION = `mutation Web_TransactionDrawerUpdateTransaction($input: UpdateTransactionMutationInput!) {
  updateTransaction(input: $input) {
    transaction { id name notes }
    errors { message }
  }
}`;

export interface WriteResult {
  ok: boolean;
  note: string;
}

async function updateTransaction(
  auth: MonarchAuth,
  input: Record<string, unknown>,
): Promise<WriteResult> {
  const res = await gqlRequest(auth, {
    operationName: "Web_TransactionDrawerUpdateTransaction",
    query: MUTATION,
    variables: { input },
  });
  if (!res.ok) return { ok: false, note: res.note };
  const payloadError = firstPayloadError(res.data);
  if (payloadError) return { ok: false, note: `Monarch rejected the update: ${payloadError}` };
  return { ok: true, note: "updated" };
}

export function setTransactionNotes(auth: MonarchAuth, id: string, notes: string): Promise<WriteResult> {
  return updateTransaction(auth, { id, notes });
}

export function setTransactionName(auth: MonarchAuth, id: string, name: string): Promise<WriteResult> {
  return updateTransaction(auth, { id, name });
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
