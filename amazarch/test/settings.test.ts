import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: { storage: { local: { get: async () => ({}), set: async () => undefined } } },
}));

import { DEFAULT_SETTINGS, parseSettings } from "../src/shared/settings";

describe("parseSettings", () => {
  it("returns defaults for missing/garbage storage", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("nope")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps stored booleans and fills the rest with defaults", () => {
    expect(parseSettings({ autoMatch: true })).toEqual({ ...DEFAULT_SETTINGS, autoMatch: true });
    expect(parseSettings({ autoMatch: true, autoRename: true })).toEqual({
      autoMatch: true,
      autoNote: DEFAULT_SETTINGS.autoNote,
      autoRename: true,
    });
  });

  it("ignores non-boolean values", () => {
    expect(parseSettings({ autoMatch: "yes", autoNote: 1, autoRename: {} })).toEqual(DEFAULT_SETTINGS);
  });

  it("defaults are conservative: auto match OFF, rename OFF, note ON", () => {
    expect(DEFAULT_SETTINGS).toEqual({ autoMatch: false, autoNote: true, autoRename: false });
  });
});
