// Amazarch background (Chrome: MV3 service worker; Firefox: event page).
// M0 scope: receive the Monarch session from the content script, hold it in
// session storage (never persisted to disk), and answer popup status queries.
import browser from "webextension-polyfill";
import type { Message, MonarchSessionInfo, StatusResponse } from "../shared/messages";
import { tokenPreview } from "../shared/messages";

const SESSION_KEY = "monarchSession";
const CS_ORIGINS_KEY = "contentScriptOrigins";

// storage.session is memory-backed and cleared when the browser closes —
// the right place for an auth token (never storage.local).
async function saveSession(session: MonarchSessionInfo): Promise<void> {
  await browser.storage.session.set({ [SESSION_KEY]: session });
}

async function loadSession(): Promise<MonarchSessionInfo | null> {
  const found = await browser.storage.session.get(SESSION_KEY);
  return (found[SESSION_KEY] as MonarchSessionInfo | undefined) ?? null;
}

async function recordContentScript(origin: string): Promise<void> {
  const found = await browser.storage.session.get(CS_ORIGINS_KEY);
  const origins = new Set((found[CS_ORIGINS_KEY] as string[] | undefined) ?? []);
  origins.add(origin);
  await browser.storage.session.set({ [CS_ORIGINS_KEY]: [...origins] });
}

async function loadContentScriptOrigins(): Promise<string[]> {
  const found = await browser.storage.session.get(CS_ORIGINS_KEY);
  return (found[CS_ORIGINS_KEY] as string[] | undefined) ?? [];
}

browser.runtime.onMessage.addListener(async (raw: unknown): Promise<StatusResponse | undefined> => {
  const message = raw as Message;
  if (message.type === "content-script-loaded") {
    console.info("[Amazarch] content script reported in from", message.origin);
    await recordContentScript(message.origin);
    return undefined;
  }
  if (message.type === "monarch-session-detected") {
    console.info(
      "[Amazarch] Monarch session received from",
      message.session.origin,
      "via",
      message.session.strategy,
    );
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
            strategy: session.strategy,
            tokenPreview: tokenPreview(session.token),
          }
        : null,
      contentScriptOrigins: await loadContentScriptOrigins(),
    };
  }
  return undefined;
});
