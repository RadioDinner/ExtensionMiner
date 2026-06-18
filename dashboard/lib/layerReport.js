// Parse a deep-research report (uploaded as a PDF, or pasted) into a narrative +
// the structured JSON block the prompt asked for. Robust to the messiness of PDF
// text extraction: tolerant sentinel matching, code-fence stripping, and a
// brace-scan fallback if JSON.parse trips. Never throws — on failure it returns
// the full text as the narrative with a parse_warning so the user still gets the
// report.
//
// Keep the sentinels in sync with lib/layerPrompts.js.

import { LAYER_JSON_START, LAYER_JSON_END } from "./layerPrompts";

function asStringArray(v) {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? x : x == null ? "" : String(x)))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

function str(v) {
  if (v == null) return "";
  return typeof v === "string" ? v : String(v);
}

function normCompetitor(c) {
  if (typeof c === "string") return { name: c.trim() };
  if (!c || typeof c !== "object") return null;
  const out = {
    name: str(c.name).trim(),
    url: str(c.url).trim(),
    pricing: str(c.pricing).trim(),
    users: str(c.users).trim(),
    positioning: str(c.positioning).trim(),
    strengths: str(c.strengths).trim(),
    weaknesses: str(c.weaknesses).trim(),
  };
  return out.name ? out : null;
}

function normOpportunity(o) {
  if (typeof o === "string") return { title: o.trim(), detail: "", evidence: "", effort: "" };
  if (!o || typeof o !== "object") return null;
  const out = {
    title: str(o.title).trim(),
    detail: str(o.detail).trim(),
    evidence: str(o.evidence).trim(),
    effort: str(o.effort).trim(),
  };
  return out.title || out.detail ? out : null;
}

// Pull the JSON object text out of the (possibly fenced) sentinel block.
function jsonFromBlock(block) {
  let s = block.trim();
  // Strip a ```json … ``` (or plain ```) fence if the model wrapped it.
  s = s.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(s);
  } catch {
    // Fallback: take everything from the first { to the last } and retry.
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a !== -1 && b > a) {
      try {
        return JSON.parse(s.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Locate the sentinel block tolerantly (PDF extraction can mangle spacing).
function splitOnSentinels(text) {
  const start = text.indexOf(LAYER_JSON_START);
  if (start === -1) return { narrative: text.trim(), block: null };
  const afterStart = start + LAYER_JSON_START.length;
  const end = text.indexOf(LAYER_JSON_END, afterStart);
  const block = text.slice(afterStart, end === -1 ? undefined : end);
  // Narrative = everything before the start sentinel (drop the machine block).
  const narrative = text.slice(0, start).trim();
  return { narrative, block };
}

// Parse a raw report string into the page-ready, DB-ready shape.
export function parseStudyReport(rawText) {
  const text = str(rawText).replace(/\r\n/g, "\n");
  const { narrative, block } = splitOnSentinels(text);

  let data = null;
  let parse_warning = null;
  if (block != null) {
    data = jsonFromBlock(block);
    if (!data) {
      parse_warning =
        "Found the data block but couldn't parse it as JSON — stored the narrative only.";
    }
  } else {
    parse_warning =
      "No structured data block found in the upload — stored the narrative only. " +
      "Re-run with the generated prompt so the report ends with the JSON block.";
  }

  data = data && typeof data === "object" ? data : {};

  const competitors = Array.isArray(data.competitors)
    ? data.competitors.map(normCompetitor).filter(Boolean)
    : [];
  const opportunities = Array.isArray(data.opportunities)
    ? data.opportunities.map(normOpportunity).filter(Boolean)
    : [];
  const financials =
    data.financials && typeof data.financials === "object" ? data.financials : {};

  return {
    report_md: narrative || text.trim(),
    summary: str(data.summary).trim(),
    recommendation: str(data.recommendation).trim().toLowerCase(),
    target_strengths: asStringArray(data.target_strengths),
    target_weaknesses: asStringArray(data.target_weaknesses),
    competitors,
    opportunities,
    financials,
    sources: asStringArray(data.sources),
    details: data,
    parse_warning,
  };
}
