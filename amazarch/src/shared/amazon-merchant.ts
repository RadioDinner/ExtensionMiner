// Detect Amazon-originated transactions by their (messy) bank-feed merchant
// names. v1 scope (SPEC.md D3): amazon.com orders + Amazon Marketplace; NOT
// Whole Foods / Fresh (deliberately excluded so they don't get matched yet).

const AMAZON_RE =
  /\b(amazon(\.com)?|amzn(\s*mktp)?|amznmktp|amazon\s*mktp|amazon\s*prime|amazon\s*digital|prime\s*video)\b/i;

// Guard against sibling brands we do NOT want to treat as Amazon orders in v1.
const EXCLUDE_RE = /\b(whole\s*foods|amazon\s*fresh|amzn\s*fresh)\b/i;

export function isAmazonMerchant(name: string | null | undefined): boolean {
  if (!name) return false;
  if (EXCLUDE_RE.test(name)) return false;
  return AMAZON_RE.test(name);
}
