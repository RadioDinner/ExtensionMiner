// Monarch write operations. Starts with the safest write — appending Amazon
// item details to a transaction's notes (additive, never clobbers). Uses the
// same cookie/CSRF transport proven for reads (SPEC.md §R3). Merchant rename,
// category, and splits build on this later.
import { type MonarchAuth, gqlRequest } from "./monarch-gql";
import type { AmazonOrderLite } from "./messages";
import type { RefundMatch } from "./matcher";

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

/** The note line for a refund credit matched back to its order. */
export function buildRefundNoteLine(order: AmazonOrderLite, refundMatch: RefundMatch | null): string {
  const items = order.itemTitles.slice(0, 5).join(", ");
  const what = refundMatch === "partial" ? "Partial refund" : "Refund";
  const parts = [`${MARKER} ${what} — ${items || "Amazon order"}`];
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

/** Merchant name for a refund credit, e.g. "Amazon refund — USB-C cable +1". */
export function buildRefundMerchantName(order: AmazonOrderLite): string {
  return buildMerchantName(order, "Amazon refund");
}

// --- Writes ------------------------------------------------------------------

// Two return selections. The RICH one reads back `notes` and `merchant { name }`
// so the mutation response itself proves whether the write took effect —
// merchant.name is readable on Transaction (the read query selects it). Bare
// `name` must NEVER appear in the selection: it isn't readable and makes the
// server throw AFTER applying the write (`name` stays valid as an INPUT field).
// If Monarch ever rejects the rich selection, we self-heal: retry the write
// (idempotent — it sets absolute values) with the MINIMAL selection and report
// verified=null instead of failing the whole write over a read-back field.
export function mutationDoc(rich: boolean): string {
  const fields = rich ? "id notes merchant { name }" : "id";
  return `mutation Web_TransactionDrawerUpdateTransaction($input: UpdateTransactionMutationInput!) {
  updateTransaction(input: $input) {
    transaction { ${fields} }
    errors { message }
  }
}`;
}

export interface WriteResult {
  ok: boolean;
  note: string;
  /** true = response proves the write took effect; false = response shows the
   *  field UNCHANGED after an accepted write; null = accepted, not confirmable. */
  verified: boolean | null;
  /** The post-write value Monarch reported for the checked field, if any. */
  readBack: string | null;
}

/** Pure: pull the post-write notes + merchant name out of a mutation response.
 *  hasTransaction distinguishes "no transaction object at all" from a selected
 *  field whose post-write VALUE is null (e.g. cleared notes) — GraphQL always
 *  includes selected fields in the response map, possibly with value null. */
export function readBackFromMutation(data: unknown): {
  hasTransaction: boolean;
  notes: string | null;
  merchantName: string | null;
} {
  const txn = pick(pick(data, "updateTransaction"), "transaction");
  return {
    hasTransaction: typeof txn === "object" && txn !== null,
    notes: strOrNull(pick(txn, "notes")),
    merchantName: strOrNull(pick(pick(txn, "merchant"), "name")),
  };
}

async function updateTransaction(
  auth: MonarchAuth,
  input: Record<string, unknown>,
  field: "notes" | "merchantName",
  expected: string,
): Promise<WriteResult> {
  const doc = (rich: boolean) => ({
    operationName: "Web_TransactionDrawerUpdateTransaction",
    query: mutationDoc(rich),
    variables: { input },
  });
  let res = await gqlRequest(auth, doc(true));
  let verifiable = true;
  if (!res.ok && res.errors.length > 0) {
    // Only a GraphQL-level rejection warrants the minimal-selection fallback.
    // Transport failures (network error, 429, 5xx) return as plain failures so
    // the button offers a retry — no immediate second POST, no false
    // "selection rejected" diagnosis.
    res = await gqlRequest(auth, doc(false));
    verifiable = false;
  }
  if (!res.ok) return { ok: false, note: res.note, verified: null, readBack: null };
  const payloadError = firstPayloadError(res.data);
  if (payloadError) {
    return { ok: false, note: `Monarch rejected the update: ${payloadError}`, verified: null, readBack: null };
  }
  if (!verifiable) {
    return { ok: true, note: "updated (read-back selection rejected — unconfirmed)", verified: null, readBack: null };
  }
  const rb = readBackFromMutation(res.data);
  if (!rb.hasTransaction) {
    return { ok: true, note: "updated (no transaction in response)", verified: null, readBack: null };
  }
  // The rich selection succeeded, so a null field is a REAL post-write value
  // (e.g. notes cleared to empty) — compare it as "" rather than "unknown".
  // Whitespace-insensitive: don't cry wolf if Monarch trims/collapses spaces.
  const readBack = rb[field];
  const verified = norm(readBack ?? "") === norm(expected);
  return {
    ok: true,
    verified,
    readBack,
    note: verified ? "updated — confirmed by Monarch" : "updated, but Monarch reports a different value",
  };
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function setTransactionNotes(auth: MonarchAuth, id: string, notes: string): Promise<WriteResult> {
  return updateTransaction(auth, { id, notes }, "notes", notes);
}

export function setTransactionName(auth: MonarchAuth, id: string, name: string): Promise<WriteResult> {
  return updateTransaction(auth, { id, name }, "merchantName", name);
}

function pick(obj: unknown, key: string): unknown {
  if (typeof obj !== "object" || obj === null) return null;
  return (obj as Record<string, unknown>)[key] ?? null;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
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
