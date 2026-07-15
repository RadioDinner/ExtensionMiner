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
