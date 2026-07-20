import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: { local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined } },
  },
}));

import {
  EMPTY_LICENSE,
  evaluateEntitlement,
  parseLicense,
  parseLicenseResponse,
  type LicenseState,
} from "../src/shared/licensing";

const DAY = 86400000;
const NOW = 1_700_000_000_000;
const state = (over: Partial<LicenseState>): LicenseState => ({ ...EMPTY_LICENSE, ...over });

describe("evaluateEntitlement", () => {
  it("no license, no trial → not allowed", () => {
    const e = evaluateEntitlement(EMPTY_LICENSE, NOW);
    expect(e).toMatchObject({ allowed: false, status: "none" });
  });

  it("active trial is allowed with days left", () => {
    const e = evaluateEntitlement(state({ trialEndsAt: NOW + 3 * DAY }), NOW);
    expect(e).toMatchObject({ allowed: true, status: "trial", daysLeft: 3 });
  });

  it("expired trial is not allowed", () => {
    const e = evaluateEntitlement(state({ trialEndsAt: NOW - DAY }), NOW);
    expect(e).toMatchObject({ allowed: false, status: "trial-expired" });
  });

  it("a lifetime license (no expiry) is allowed forever", () => {
    const e = evaluateEntitlement(state({ active: true, plan: "lifetime", expiresAt: null }), NOW);
    expect(e).toMatchObject({ allowed: true, status: "active", plan: "lifetime", daysLeft: null });
  });

  it("an in-date subscription is allowed with days left", () => {
    const e = evaluateEntitlement(state({ active: true, plan: "yearly", expiresAt: NOW + 10 * DAY }), NOW);
    expect(e).toMatchObject({ allowed: true, status: "active", daysLeft: 10 });
  });

  it("a lapsed subscription is allowed during the offline grace window, then denied", () => {
    const lapsed = state({ active: true, plan: "monthly", expiresAt: NOW - DAY, lastValidatedAt: NOW - 2 * DAY });
    expect(evaluateEntitlement(lapsed, NOW, 5).allowed).toBe(true); // within 5-day grace of last check
    expect(evaluateEntitlement(lapsed, NOW, 1)).toMatchObject({ allowed: false, status: "expired" }); // grace too short
  });

  it("a paid license takes precedence over an also-present trial", () => {
    const both = state({ active: true, plan: "lifetime", trialEndsAt: NOW - DAY });
    expect(evaluateEntitlement(both, NOW)).toMatchObject({ allowed: true, status: "active" });
  });
});

describe("parseLicenseResponse", () => {
  it("reads the canonical shape", () => {
    expect(parseLicenseResponse({ valid: true, plan: "yearly", expiresAt: NOW })).toEqual({
      valid: true, plan: "yearly", expiresAt: NOW, error: null,
    });
  });

  it("tolerates aliases (activated/status, expires_at, seconds vs ms)", () => {
    expect(parseLicenseResponse({ status: "active", expires_at: 1700000000 })).toMatchObject({
      valid: true, expiresAt: 1700000000000,
    });
    expect(parseLicenseResponse({ activated: true })).toMatchObject({ valid: true, expiresAt: null });
  });

  it("parses ISO date strings", () => {
    expect(parseLicenseResponse({ valid: true, expiry: "2026-01-01T00:00:00Z" }).expiresAt).toBe(
      Date.parse("2026-01-01T00:00:00Z"),
    );
  });

  it("marks invalid responses with an error", () => {
    expect(parseLicenseResponse({ valid: false, error: "revoked" })).toMatchObject({ valid: false, error: "revoked" });
    expect(parseLicenseResponse({})).toMatchObject({ valid: false, error: "License not valid" });
    expect(parseLicenseResponse("garbage")).toMatchObject({ valid: false });
  });

  it("only accepts known plan names", () => {
    expect(parseLicenseResponse({ valid: true, plan: "enterprise" }).plan).toBeNull();
  });
});

describe("parseLicense", () => {
  it("round-trips a valid state and rejects junk fields", () => {
    const s = state({ key: "K", plan: "monthly", active: true, expiresAt: NOW, trialEndsAt: NOW, lastValidatedAt: NOW });
    expect(parseLicense(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(parseLicense(null)).toEqual(EMPTY_LICENSE);
    expect(parseLicense({ plan: "bogus", active: "yes" })).toEqual(EMPTY_LICENSE);
  });
});
