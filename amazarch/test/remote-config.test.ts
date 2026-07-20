import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: { local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined } },
  },
}));

import {
  compareVersions,
  DEFAULT_REMOTE_CONFIG,
  evaluateRemoteConfig,
  parseRemoteConfig,
} from "../src/shared/remote-config";

describe("parseRemoteConfig (fail-safe)", () => {
  it("defaults writes ON — only an explicit false disables", () => {
    expect(parseRemoteConfig({}, 1).writesEnabled).toBe(true);
    expect(parseRemoteConfig({ writesEnabled: "no" }, 1).writesEnabled).toBe(true); // not a real false
    expect(parseRemoteConfig({ writesEnabled: false }, 1).writesEnabled).toBe(false);
    expect(parseRemoteConfig(null, 1)).toMatchObject({ writesEnabled: true, minVersion: null, message: null });
  });

  it("reads minVersion + message", () => {
    expect(parseRemoteConfig({ minVersion: "1.2.0", message: "update please" }, 5)).toEqual({
      writesEnabled: true, minVersion: "1.2.0", message: "update please", fetchedAt: 5,
    });
    expect(parseRemoteConfig({ message: "   " }, 5).message).toBeNull(); // blank → null
  });
});

describe("compareVersions", () => {
  it("orders dotted numeric versions", () => {
    expect(compareVersions("0.9.0", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "0.9.0")).toBe(1);
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("1.2", "1.2.0")).toBe(0); // missing segment = 0
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1); // numeric, not lexical
  });
});

describe("evaluateRemoteConfig", () => {
  it("passes writes + no update by default", () => {
    expect(evaluateRemoteConfig(DEFAULT_REMOTE_CONFIG, "0.9.0")).toEqual({
      writesEnabled: true, updateRequired: false, message: null,
    });
  });

  it("kill switch pauses writes", () => {
    const c = parseRemoteConfig({ writesEnabled: false, message: "paused for a fix" }, 1);
    expect(evaluateRemoteConfig(c, "0.9.0")).toMatchObject({ writesEnabled: false, message: "paused for a fix" });
  });

  it("requires an update when below the version floor", () => {
    const c = parseRemoteConfig({ minVersion: "1.0.0" }, 1);
    expect(evaluateRemoteConfig(c, "0.9.0").updateRequired).toBe(true);
    expect(evaluateRemoteConfig(c, "1.0.0").updateRequired).toBe(false);
    expect(evaluateRemoteConfig(c, "1.1.0").updateRequired).toBe(false);
  });
});
