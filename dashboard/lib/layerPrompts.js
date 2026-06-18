// Layer 2 / Layer 3 ("deep dive study") prompt builders.
//
// These layers are skill-driven: the dashboard generates a ready-to-paste
// research brief for ONE extension, the user runs it in a Claude session with the
// deep-research skill, exports the PDF, and uploads it back. Each brief ends with
// a strict, machine-readable JSON block between sentinels so the upload handler
// can pull structured competitors / opportunities / financials out of the
// exported report.
//
// Keep the sentinels in sync with lib/layerReport.js (the parser).

export const LAYER_JSON_START = "===EXTENSIONMINER-JSON===";
export const LAYER_JSON_END = "===END-EXTENSIONMINER-JSON===";

function storeUrl(ext) {
  if (!ext) return "";
  if (ext.listing_url) return ext.listing_url;
  return ext.ext_id ? `https://chromewebstore.google.com/detail/${ext.ext_id}` : "";
}

function line(label, value) {
  return value == null || value === "" ? null : `- ${label}: ${value}`;
}

function factsBlock(ext) {
  const e = ext || {};
  return [
    line("Name", e.name),
    line("Developer", e.developer),
    line("Category", e.store_category),
    line(
      "Store rating",
      e.rating != null
        ? `${Number(e.rating).toFixed(1)}★ (${e.rating_count != null ? Number(e.rating_count).toLocaleString() : "?"} ratings)`
        : null
    ),
    line("Installs", e.install_count != null ? Number(e.install_count).toLocaleString() : null),
    line("Chrome Web Store listing", storeUrl(e)),
  ]
    .filter(Boolean)
    .join("\n");
}

// Wrap a JSON schema body in the sentinel block + the output instructions shared
// by both layers.
function outputSpec(jsonBody) {
  return `OUTPUT FORMAT (important):
First, write the full narrative research report (headings, prose, tables — whatever reads best).
Then, as the VERY LAST thing in your response, output the structured data below — a single JSON object between the exact sentinel lines, with NOTHING after the closing sentinel. This block is parsed by software, so keep it valid JSON.

${LAYER_JSON_START}
${jsonBody}
${LAYER_JSON_END}`;
}

function buildLayer2Prompt(ext) {
  const name = (ext && (ext.name || ext.ext_id)) || "this Chrome extension";
  const jsonBody = `{
  "summary": "2-4 sentence executive summary of the opportunity.",
  "recommendation": "build | maybe | avoid",
  "target_strengths": ["what ${name} genuinely does well"],
  "target_weaknesses": ["recurring, fixable weaknesses of ${name}"],
  "competitors": [
    {
      "name": "competitor product/extension name",
      "url": "homepage or store listing (never invent one)",
      "pricing": "e.g. free, freemium, $5/mo",
      "users": "install/user scale if known, else \\"\\"",
      "positioning": "how it positions itself in the market",
      "strengths": "what it does well / where it beats ${name}",
      "weaknesses": "where it falls short — the opening to exploit"
    }
  ],
  "opportunities": [
    {
      "title": "short name for the opening",
      "detail": "concrete description of the gap and how a new entrant wins it",
      "evidence": "the reviews / market signals that support it",
      "effort": "low | medium | high"
    }
  ],
  "sources": ["every URL you actually consulted"]
}`;

  return `Use Claude's deep-research skill to produce a comprehensive competitive study of the Chrome extension "${name}", aimed at a founder deciding whether to build and ship a competitor against it.

TARGET EXTENSION
${factsBlock(ext)}

DO THIS, THOROUGHLY:
1. Map the FULL competitive landscape. Find every real alternative — competing Chrome extensions, but also web apps, desktop tools, and built-in/browser features that solve the same job. Don't stop at the obvious ones.
2. For EACH competitor, dig into: pricing/business model, rough user scale, market positioning, concrete strengths, and concrete weaknesses (the openings). Read their reviews/communities where you can.
3. Assess the TARGET itself: what it genuinely does well, and its recurring, fixable weaknesses. Ground this in its actual reviews and reputation.
4. Synthesize the OPPORTUNITIES for a new entrant: where the unmet demand is, the differentiation angle, the "I'd pay if…" signals, and what it would take to win. Give each opportunity concrete evidence and a rough build effort.
5. Finish with an honest build / maybe / avoid verdict.

Be specific and skeptical. Only cite pages you actually consulted; never invent competitors, prices, or URLs.

${outputSpec(jsonBody)}`;
}

function buildLayer3Prompt(ext) {
  const name = (ext && (ext.name || ext.ext_id)) || "this Chrome extension";
  const jsonBody = `{
  "summary": "2-4 sentence executive summary of the financial picture and the money opportunity.",
  "recommendation": "build | maybe | avoid",
  "financials": {
    "revenue_model": "how ${name} makes money today (free, paid, freemium, ads, B2B, data, etc.)",
    "pricing": "its price points / tiers, if any",
    "estimated_revenue": "rough revenue scale and how you derived it",
    "competitor_attacks": ["concrete ways competitors are attacking ${name} commercially"],
    "free_alternatives": ["free or freemium tools launched to capture this market — who, and how aggressive"],
    "pricing_opportunity": "where the pricing/packaging gap is for a new entrant",
    "moat_risks": ["what could make this market hard to monetize or defend"]
  },
  "competitors": [
    {
      "name": "competitor product/extension name",
      "url": "homepage or store listing (never invent one)",
      "pricing": "its pricing / business model",
      "users": "install/user scale if known, else \\"\\"",
      "positioning": "commercial positioning (premium, free land-grab, B2B, etc.)",
      "strengths": "commercial strengths",
      "weaknesses": "commercial weaknesses — the monetization opening"
    }
  ],
  "opportunities": [
    {
      "title": "short name for the money opportunity",
      "detail": "how a new entrant captures revenue here",
      "evidence": "the market/pricing signals that support it",
      "effort": "low | medium | high"
    }
  ],
  "sources": ["every URL you actually consulted"]
}`;

  return `Use Claude's deep-research skill to produce a FINANCIAL competitive study of the Chrome extension "${name}", aimed at a founder deciding whether a competitor can make money here.

TARGET EXTENSION
${factsBlock(ext)}

DO THIS, THOROUGHLY:
1. Work out how "${name}" makes money today: its revenue model, pricing/tiers, paywalls, ads, B2B/enterprise, data, or whether it's a loss-leader. Estimate the revenue scale and show your reasoning.
2. Study how COMPETITORS are attacking it commercially: who's undercutting on price, who launched a FREE or freemium alternative to capture the market, who bundles it for free, who's going upmarket. Be concrete.
3. Find the PRICING / packaging opportunity for a new entrant — where the market is over- or under-priced, what people would pay for, and the "I'd pay if…" signals.
4. Flag the monetization RISKS and moats (platform dependence, commoditization, a free incumbent, etc.).
5. Finish with an honest build / maybe / avoid verdict on the money opportunity.

Be specific and skeptical. Only cite pages you actually consulted; never invent prices, revenue, or URLs.

${outputSpec(jsonBody)}`;
}

// Build the deep-research brief for one extension at the given layer (2 or 3).
export function buildStudyPrompt(ext, layer) {
  return Number(layer) === 3 ? buildLayer3Prompt(ext) : buildLayer2Prompt(ext);
}
