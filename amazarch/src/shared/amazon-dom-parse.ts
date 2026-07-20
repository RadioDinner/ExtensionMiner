// Pure helpers for parsing an Amazon order card's RENDERED text (after Siege
// client-side decryption). The order number comes from the card's
// data-csa-c-slot-id attribute; date/total/items come from the decrypted,
// visible text. See SPEC.md §R1 (client-side-encryption correction).
import { parseAmountToCents } from "./money";
import { hasReturnHint, parseOrderDate, parseOrderId, parseOrderTotal } from "./amazon-order-parse";

export { hasReturnHint, parseOrderDate, parseOrderId, parseOrderTotal };

/** Extract the 3-7-7 order id from data-csa-c-slot-id (or any string). */
export function orderIdFromSlotId(slotId: string | null | undefined): string | null {
  if (!slotId) return null;
  const m = slotId.match(/(\d{3}-\d{7}-\d{7})/);
  return m ? (m[1] ?? null) : null;
}

/** First "$x.xx" amount in a string → integer cents. */
export function firstDollarCents(text: string): number | null {
  const m = text.match(/\$\s?([\d,]+\.\d{2})/);
  return m && m[1] ? parseAmountToCents(`$${m[1]}`) : null;
}

/** Best-effort order total from rendered card text: prefer the amount next to a
 * "Total" label, else the first dollar amount in the card. */
export function bestTotalCents(text: string): number | null {
  return parseOrderTotal(text) ?? firstDollarCents(text);
}

/** True once a card's text looks decrypted (has a real dollar amount + a date). */
export function looksDecrypted(text: string): boolean {
  return firstDollarCents(text) !== null && parseOrderDate(text) !== null;
}
