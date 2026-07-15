// Pure detectors for Amazon order-history HTML. Diagnostic-first: we classify
// the page (orders / login / unknown) and count order cards, so the first
// Amazon milestone proves reachability + sign-in before we build the full
// order/charge parser (SPEC.md §R1). No personal data is extracted here yet.

export type AmazonPageKind = "orders" | "login" | "unknown";

const LOGIN_URL_RE = /\/ap\/signin|\/ap\/mfa|\/ax\/claim/i;
const LOGIN_HTML_RE = /(id=["']ap_email|name=["']email["'][^>]*type=["']email|Amazon Sign-?In|auth-error-message-box)/i;
// Order-history layouts, old and new (AZAD tracks these; SPEC.md §R1).
const ORDERS_HTML_RE = /(order-card|js-order-card|yohtmlc-order|a-box-group[^>]*order|Order\s+placed|your-orders\/order-details)/i;

export function detectAmazonPage(html: string, finalUrl: string): AmazonPageKind {
  if (LOGIN_URL_RE.test(finalUrl) || LOGIN_HTML_RE.test(html)) return "login";
  if (ORDERS_HTML_RE.test(html)) return "orders";
  return "unknown";
}

export function countOrderCards(html: string): number {
  const byCard = html.match(/\bjs-order-card\b/gi);
  if (byCard) return byCard.length;
  const byClass = html.match(/class=["'][^"']*\border-card\b[^"']*["']/gi);
  if (byClass) return byClass.length;
  const byPlaced = html.match(/Order\s+placed/gi);
  return byPlaced ? byPlaced.length : 0;
}

export function pageTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m && m[1] ? m[1].trim().slice(0, 100) : "";
}

/**
 * Redacted structural diagnostic for order-history HTML: counts of the patterns
 * the parser keys on. NO stored values — safe to log and paste into a report.
 * Tells us why parsing found nothing (wrong format vs. a JS-only shell page).
 */
export function diagnoseOrderHtml(html: string): Record<string, number | string> {
  const count = (re: RegExp) => (html.match(re) || []).length;
  return {
    htmlLength: html.length,
    title: pageTitle(html),
    jsOrderCard: count(/\bjs-order-card\b/gi),
    orderCardClass: count(/class=["'][^"']*\border-card\b/gi),
    orderPlaced: count(/order placed/gi),
    totalLabel: count(/\btotal\b/gi),
    grandTotal: count(/grand total/gi),
    dollarAmounts: count(/\$\s?\d[\d,]*\.\d{2}/g),
    monthDates: count(/[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}/g),
    isoDates: count(/\d{4}-\d{2}-\d{2}/g),
    orderNumbers: count(/\b\d{3}-\d{7}-\d{7}\b/g),
    dpLinks: count(/href="[^"]*\/(?:gp\/product|dp)\//gi),
    scriptJson: count(/<script[^>]*type=["']application\/json/gi),
    keyOrderDate: count(/"(order[_]?date|orderPlacedDate|purchaseDate)"/gi),
    keyTotal: count(/"(grandTotal|orderTotal|totalAmount|grand_total|order_total)"/gi),
    dataState: count(/data-a-state/gi),
    orderedOn: count(/ordered on/gi),
    looksJsShell: /enable JavaScript|noscript|window\.__INITIAL/i.test(html) ? 1 : 0,
    looksCaptcha: /captcha|are you a human|automated access/i.test(html) ? 1 : 0,
  };
}

/**
 * Redacted schema of the largest embedded JSON blob (from <script type=
 * "application/json"> or data-a-state). Reports nested KEY NAMES and value
 * TYPES only ("string"/"number"/array/object) — never a value. This reveals
 * where the order data (date, total, order id, items) lives so we can parse the
 * JSON instead of the pre-hydration HTML.
 */
export function extractOrderJsonSchema(html: string): string {
  const blobs: string[] = [];
  const scriptRe = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) if (m[1]) blobs.push(m[1]);
  const stateRe = /data-a-state=["'](\{[^"']*\})["']/gi;
  while ((m = stateRe.exec(html)) !== null) if (m[1]) blobs.push(m[1].replace(/&quot;/g, '"'));

  let best: unknown = null;
  let bestLen = 0;
  for (const b of blobs) {
    try {
      const parsed = JSON.parse(b.trim());
      if (b.length > bestLen) {
        best = parsed;
        bestLen = b.length;
      }
    } catch {
      // not valid JSON — skip
    }
  }
  if (best === null) return `(no parseable JSON blob found; ${blobs.length} candidates)`;
  return `(schema of largest JSON blob, ${bestLen} bytes)\n` + JSON.stringify(schemaOf(best, 0), null, 1).slice(0, 6000);
}

function schemaOf(value: unknown, depth: number): unknown {
  if (depth > 7) return "…";
  if (Array.isArray(value)) return value.length ? [schemaOf(value[0], depth + 1)] : [];
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).slice(0, 40)) {
      out[k] = schemaOf((value as Record<string, unknown>)[k], depth + 1);
    }
    return out;
  }
  return typeof value;
}

/**
 * A privacy-safe structural skeleton of the first order card: every digit is
 * masked to '#' (removes amounts, dates, order numbers, ids) and every text
 * node longer than 15 chars is blanked (removes item names / addresses),
 * leaving tag names, attribute names, class names, and short labels intact so
 * the real data structure can be seen without exposing any values.
 */
export function redactedCardSample(html: string, span = 2800): string {
  const i = html.search(/js-order-card|\border-card\b/i);
  if (i < 0) return "";
  const start = Math.max(0, i - 250);
  let slice = html.slice(start, start + span);
  slice = slice.replace(/[0-9]/g, "#"); // mask all numeric values
  slice = slice.replace(/>([^<]{16,})</g, ">[text]<"); // blank long text nodes
  slice = slice.replace(/\s+/g, " ").trim();
  return slice;
}
