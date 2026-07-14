// Amazarch background (Chrome: MV3 service worker; Firefox: event page).
// M0 scope: receive the Monarch session from the content script, hold it in
// session storage (never persisted to disk), and answer popup status queries.
import browser from "webextension-polyfill";
import type { Message, MonarchSessionInfo, StatusResponse } from "../shared/messages";
import { tokenPreview } from "../shared/messages";

const SESSION_KEY = "monarchSession";

// storage.session is memory-backed and cleared when the browser closes —
// the right place for an auth token (never storage.local).
async function saveSession(session: MonarchSessionInfo): Promise<void> {
  await browser.storage.session.set({ [SESSION_KEY]: session });
}

async function loadSession(): Promise<MonarchSessionInfo | null> {
  const found = await browser.storage.session.get(SESSION_KEY);
  return (found[SESSION_KEY] as MonarchSessionInfo | undefined) ?? null;
}

browser.runtime.onMessage.addListener(async (raw: unknown): Promise<StatusResponse | undefined> => {
  const message = raw as Message;
  if (message.type === "monarch-session-detected") {
    await saveSession(message.session);
    return undefined;
  }
  if (message.type === "get-status") {
    const session = await loadSession();
    return {
      monarch: session
        ? {
            deviceUuid: session.deviceUuid,
            origin: session.origin,
            capturedAt: session.capturedAt,
            tokenPreview: tokenPreview(session.token),
          }
        : null,
    };
  }
  return undefined;
});
