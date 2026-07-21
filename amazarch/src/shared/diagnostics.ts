// Scrubbed diagnostics bundle (Phase 1 stranger-proofing). Supporting paying
// users of a scraper without a diagnostic is guesswork — but a finance tool must
// never leak financial data into a support ticket. buildDiagnosticReport is a
// PURE formatter over STRUCTURED, non-PII inputs: versions, connection/permission
// state, and COUNTS only — never order item names, merchant names, amounts,
// account names, tokens, or license keys. The caller assembles inputs from
// counts (not labels), so nothing sensitive can reach this function. Tested.

export interface DiagnosticInputs {
  version: string;
  browser: string; // "chrome" | "firefox"
  now: number; // epoch ms
  hostAccess: { monarch: boolean; amazon: boolean };
  monarch: { connected: boolean; authMethod?: string; host?: string; probeNote?: string };
  amazonSignedIn: boolean | null;
  counts: {
    amazonCharges?: number | null; // Amazon-looking Monarch transactions
    monarchTotal?: number | null; // total transactions in Monarch
    orders?: number; // cached Amazon orders (union)
    accounts?: number; // number of Amazon accounts (COUNT, not names)
  };
  license: { configured: boolean; status?: string; gateReason?: string };
  lastError?: string | null; // a technical error string (no financial data)
}

function yn(v: boolean | null | undefined): string {
  return v === true ? "yes" : v === false ? "no" : "unknown";
}
function num(v: number | null | undefined): string {
  return typeof v === "number" ? String(v) : "—";
}

/** Build a copy-pasteable, financial-data-free diagnostic bundle. */
export function buildDiagnosticReport(d: DiagnosticInputs): string {
  const iso = new Date(d.now).toISOString();
  const lines = [
    "Amazarch diagnostics (no financial data — safe to share with support)",
    "=".repeat(64),
    `generated:        ${iso}`,
    `version:          ${d.version}`,
    `browser:          ${d.browser}`,
    "",
    "-- Access --------------------------------------------------------",
    `monarch access:   ${yn(d.hostAccess.monarch)}`,
    `amazon access:    ${yn(d.hostAccess.amazon)}`,
    "",
    "-- Monarch -------------------------------------------------------",
    `connected:        ${yn(d.monarch.connected)}`,
    `auth method:      ${d.monarch.authMethod ?? "—"}`,
    `host:             ${d.monarch.host ?? "—"}`,
    `probe:            ${d.monarch.probeNote ?? "—"}`,
    "",
    "-- Amazon --------------------------------------------------------",
    `signed in:        ${yn(d.amazonSignedIn)}`,
    `accounts:         ${num(d.counts.accounts)}`,
    `cached orders:    ${num(d.counts.orders)}`,
    "",
    "-- Matching ------------------------------------------------------",
    `amazon charges:   ${num(d.counts.amazonCharges)}`,
    `monarch txns:     ${num(d.counts.monarchTotal)}`,
    "",
    "-- License -------------------------------------------------------",
    `configured:       ${yn(d.license.configured)}`,
    `status:           ${d.license.status ?? "—"}`,
    `write gate:       ${d.license.gateReason ?? "—"}`,
  ];
  if (d.lastError) {
    lines.push("", "-- Last error ----------------------------------------------------", scrub(d.lastError));
  }
  return lines.join("\n");
}

// Defence-in-depth: strip anything that looks like a bearer token or long key
// from a free-text error string before it lands in the report.
function scrub(s: string): string {
  return s.replace(/\b[A-Za-z0-9_-]{24,}\b/g, "«redacted»").slice(0, 500);
}
