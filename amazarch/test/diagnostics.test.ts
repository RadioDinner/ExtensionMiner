import { describe, expect, it } from "vitest";
import { buildDiagnosticReport, type DiagnosticInputs } from "../src/shared/diagnostics";

const base: DiagnosticInputs = {
  version: "0.10.0",
  browser: "firefox",
  now: Date.parse("2026-07-21T00:00:00Z"),
  hostAccess: { monarch: true, amazon: false },
  monarch: { connected: true, authMethod: "cookie", host: "app.monarch.com", probeNote: "HTTP 200 me ok" },
  amazonSignedIn: null,
  counts: { amazonCharges: 42, monarchTotal: 17000, orders: 130, accounts: 2 },
  license: { configured: false, status: "trial", gateReason: "unconfigured" },
  lastError: null,
};

describe("buildDiagnosticReport", () => {
  it("includes versions, access, counts, and a no-financial-data header", () => {
    const r = buildDiagnosticReport(base);
    expect(r).toContain("no financial data");
    expect(r).toContain("version:          0.10.0");
    expect(r).toContain("browser:          firefox");
    expect(r).toContain("monarch access:   yes");
    expect(r).toContain("amazon access:    no");
    expect(r).toContain("cached orders:    130");
    expect(r).toContain("accounts:         2");
    expect(r).toContain("write gate:       unconfigured");
  });

  it("renders unknown for a null amazon sign-in and — for missing counts", () => {
    const r = buildDiagnosticReport({ ...base, amazonSignedIn: null, counts: {} });
    expect(r).toContain("signed in:        unknown");
    expect(r).toContain("cached orders:    —");
  });

  it("redacts token-shaped substrings from a last error", () => {
    const r = buildDiagnosticReport({ ...base, lastError: "401 with token abcdef1234567890ABCDEFghij at end" });
    expect(r).toContain("Last error");
    expect(r).toContain("«redacted»");
    expect(r).not.toContain("abcdef1234567890ABCDEFghij");
  });

  it("does not emit account names or amounts — only the fields we pass", () => {
    const r = buildDiagnosticReport(base);
    // Sanity: nothing resembling a dollar amount or a person's name leaks in.
    expect(r).not.toMatch(/\$\d/);
  });
});
