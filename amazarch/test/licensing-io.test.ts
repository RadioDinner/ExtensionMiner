import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stateful in-memory storage.local so validateKey/ensureTrialStarted round-trip.
const { store } = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));
vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: store[k] }),
        set: async (o: Record<string, unknown>) => {
          Object.assign(store, o);
        },
        remove: async (k: string) => {
          delete store[k];
        },
      },
    },
  },
}));

import { LICENSE_CONFIG } from "../src/shared/config";
import {
  EMPTY_LICENSE,
  ensureTrialStarted,
  loadLicense,
  validateKey,
  type LicenseState,
} from "../src/shared/licensing";

const KEY = "amazarchLicense";
const DAY = 86400000;
const NOW = 1_700_000_000_000;

function seed(over: Partial<LicenseState>): void {
  store[KEY] = { ...EMPTY_LICENSE, ...over };
}
function fetchOnce(impl: () => unknown): void {
  vi.stubGlobal("fetch", vi.fn(async () => impl() as Response));
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  LICENSE_CONFIG.validateUrl = "https://example.test/validate";
});
afterEach(() => {
  LICENSE_CONFIG.validateUrl = "";
  vi.unstubAllGlobals();
});

describe("ensureTrialStarted", () => {
  it("does NOT start the trial while licensing is unconfigured", async () => {
    LICENSE_CONFIG.validateUrl = "";
    const s = await ensureTrialStarted(NOW);
    expect(s.trialEndsAt).toBeNull();
  });

  it("starts a 14-day trial once configured, and is immutable afterwards", async () => {
    const first = await ensureTrialStarted(NOW);
    expect(first.trialEndsAt).toBe(NOW + LICENSE_CONFIG.trialDays * DAY);
    const again = await ensureTrialStarted(NOW + 5 * DAY); // must not restart
    expect(again.trialEndsAt).toBe(first.trialEndsAt);
  });

  it("does not start a trial when a license key is already present", async () => {
    seed({ key: "K-123" });
    expect((await ensureTrialStarted(NOW)).trialEndsAt).toBeNull();
  });
});

describe("validateKey — authoritative responses", () => {
  it("activates on a well-formed valid response", async () => {
    fetchOnce(() => ({ status: 200, json: async () => ({ valid: true, plan: "yearly", expiresAt: NOW + 30 * DAY }) }));
    const s = await validateKey("K-1", NOW);
    expect(s).toMatchObject({ active: true, plan: "yearly", expiresAt: NOW + 30 * DAY, lastValidatedAt: NOW, lastError: null });
  });

  it("honors an explicit valid:false (revoked), even though it deactivates", async () => {
    seed({ key: "K-1", active: true, plan: "monthly", lastValidatedAt: NOW - DAY });
    fetchOnce(() => ({ status: 200, json: async () => ({ valid: false, error: "revoked" }) }));
    const s = await validateKey("K-1", NOW);
    expect(s).toMatchObject({ active: false, lastError: "revoked" });
  });
});

describe("validateKey — fails OPEN (never revokes a paying user on a hiccup)", () => {
  const seedActive = (): void =>
    seed({ key: "K-1", active: true, plan: "monthly", expiresAt: NOW + 10 * DAY, lastValidatedAt: NOW - DAY });

  it("preserves the entitlement on a 5xx", async () => {
    seedActive();
    fetchOnce(() => ({ status: 503, json: async () => ({ valid: false }) }));
    const s = await validateKey("K-1", NOW);
    expect(s.active).toBe(true);
    expect(s.expiresAt).toBe(NOW + 10 * DAY);
    expect(s.lastError).toMatch(/503/);
  });

  it("preserves the entitlement on a non-JSON body", async () => {
    seedActive();
    fetchOnce(() => ({ status: 200, json: async () => { throw new Error("Unexpected token <"); } }));
    expect((await validateKey("K-1", NOW)).active).toBe(true);
  });

  it("preserves the entitlement on a 2xx body with no validity verdict", async () => {
    seedActive();
    fetchOnce(() => ({ status: 200, json: async () => ({ message: "hello" }) }));
    expect((await validateKey("K-1", NOW)).active).toBe(true);
  });

  it("preserves the entitlement on a network error", async () => {
    seedActive();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const s = await validateKey("K-1", NOW);
    expect(s.active).toBe(true);
    expect(s.lastError).toMatch(/network down/);
  });

  it("records a 'not configured' note without a network call when unconfigured", async () => {
    LICENSE_CONFIG.validateUrl = "";
    seedActive();
    const s = await validateKey("K-1", NOW);
    expect(s.active).toBe(true); // untouched
    expect(s.lastError).toMatch(/not configured/);
  });
});

describe("loadLicense round-trips what validateKey saved", () => {
  it("persists across a reload", async () => {
    fetchOnce(() => ({ status: 200, json: async () => ({ valid: true, plan: "lifetime" }) }));
    await validateKey("K-9", NOW);
    const reloaded = await loadLicense();
    expect(reloaded).toMatchObject({ key: "K-9", active: true, plan: "lifetime" });
  });
});
