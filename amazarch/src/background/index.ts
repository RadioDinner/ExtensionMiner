// Amazarch background (Chrome: MV3 service worker; Firefox: event page).
// M0 scope: the content script establishes + verifies the Monarch API session;
// the background just holds the result in session storage (never on disk) and
// answers popup status queries.
import browser from "webextension-polyfill";
import type { Message, MonarchSessionInfo, ProbeResult, StatusResponse } from "../shared/messages";
import { tokenPreview } from "../shared/messages";

const SESSION_KEY = "monarchSession";
const PROBE_KEY = "monarchProbe";
const CS_ORIGINS_KEY = "contentScriptOrigins";

// storage.session is memory-backed and cleared when the browser closes —
// the right place for session material (never storage.local).
async function set(key: string, value: unknown): Promise<void> {
  await browser.storage.session.set({ [key]: value });
}
async function get<T>(key: string): Promise<T | null> {
  const found = await browser.storage.session.get(key);
  return (found[key] as T | undefined) ?? null;
}

async function recordContentScript(origin: string): Promise<void> {
  const origins = new Set((await get<string[]>(CS_ORIGINS_KEY)) ?? []);
  origins.add(origin);
  await set(CS_ORIGINS_KEY, [...origins]);
}

browser.runtime.onMessage.addListener(async (raw: unknown): Promise<StatusResponse | undefined> => {
  const message = raw as Message;

  if (message.type === "content-script-loaded") {
    await recordContentScript(message.origin);
    return undefined;
  }

  if (message.type === "monarch-connected") {
    await set(SESSION_KEY, message.session);
    await set(PROBE_KEY, message.probe);
    console.info(
      `[Amazarch] ${message.probe.ok ? "connected" : "connection failed"} ` +
        `(${message.session.authMethod}) — ${message.probe.note}`,
    );
    return undefined;
  }

  if (message.type === "get-status") {
    const session = await get<MonarchSessionInfo>(SESSION_KEY);
    return {
      monarch: session
        ? {
            authMethod: session.authMethod,
            deviceUuid: session.deviceUuid,
            origin: session.origin,
            capturedAt: session.capturedAt,
            strategy: session.strategy,
            tokenPreview: tokenPreview(session.token),
          }
        : null,
      probe: await get<ProbeResult>(PROBE_KEY),
      contentScriptOrigins: (await get<string[]>(CS_ORIGINS_KEY)) ?? [],
    };
  }

  return undefined;
});
