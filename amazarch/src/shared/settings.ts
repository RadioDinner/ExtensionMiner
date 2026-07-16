// User settings, persisted in browser.storage.local and edited in the popup.
// Auto match: when enabled, Sync automatically applies the selected actions
// (add note / rename merchant) to EXACT ("auto") matches — "review" matches
// always stay manual.
import browser from "webextension-polyfill";

export interface AmazarchSettings {
  autoMatch: boolean; // master toggle
  autoNote: boolean; // sub-toggle: automatically add the order note
  autoRename: boolean; // sub-toggle: automatically rename the merchant
}

export const DEFAULT_SETTINGS: AmazarchSettings = {
  autoMatch: false,
  autoNote: true,
  autoRename: false, // renaming is the more invasive write — opt in explicitly
};

const KEY = "amazarchSettings";

/** Pure: coerce whatever is in storage into a valid settings object. */
export function parseSettings(raw: unknown): AmazarchSettings {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    autoMatch: typeof obj["autoMatch"] === "boolean" ? obj["autoMatch"] : DEFAULT_SETTINGS.autoMatch,
    autoNote: typeof obj["autoNote"] === "boolean" ? obj["autoNote"] : DEFAULT_SETTINGS.autoNote,
    autoRename: typeof obj["autoRename"] === "boolean" ? obj["autoRename"] : DEFAULT_SETTINGS.autoRename,
  };
}

export async function loadSettings(): Promise<AmazarchSettings> {
  try {
    const got = await browser.storage.local.get(KEY);
    return parseSettings((got as Record<string, unknown>)?.[KEY]);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(s: AmazarchSettings): Promise<void> {
  await browser.storage.local.set({ [KEY]: s });
}
