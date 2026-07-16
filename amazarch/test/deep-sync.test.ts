import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: { local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined } },
  },
}));

import { effectiveLookbackMonths, parseDeepSync } from "../src/shared/deep-sync";
import { DEFAULT_SETTINGS } from "../src/shared/settings";

const s = (lookbackMonths: number) => ({ ...DEFAULT_SETTINGS, lookbackMonths });

describe("parseDeepSync", () => {
  it("accepts a valid record and rejects garbage", () => {
    expect(parseDeepSync({ months: 12, at: 1000 })).toEqual({ months: 12, at: 1000 });
    expect(parseDeepSync(null)).toBeNull();
    expect(parseDeepSync({})).toBeNull();
    expect(parseDeepSync({ months: "12", at: 1000 })).toBeNull();
    expect(parseDeepSync("done")).toBeNull();
  });
});

describe("effectiveLookbackMonths", () => {
  it("a 3-month (or less) setting never goes deep", () => {
    expect(effectiveLookbackMonths(s(3), null)).toBe(3);
    expect(effectiveLookbackMonths(s(3), { months: 36, at: 1 })).toBe(3);
  });

  it("goes deep until a deep fetch of at least the configured depth succeeded", () => {
    expect(effectiveLookbackMonths(s(12), null)).toBe(12);
    expect(effectiveLookbackMonths(s(12), { months: 6, at: 1 })).toBe(12); // not deep enough yet
    expect(effectiveLookbackMonths(s(12), { months: 12, at: 1 })).toBe(3); // done → fast
    expect(effectiveLookbackMonths(s(12), { months: 24, at: 1 })).toBe(3); // deeper than needed → fast
  });

  it("raising the setting re-triggers a deep fetch", () => {
    expect(effectiveLookbackMonths(s(36), { months: 12, at: 1 })).toBe(36);
  });
});
