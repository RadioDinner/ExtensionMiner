// Monarch content script (runs on app.monarchmoney.com / app.monarch.com).
// M0 scope: token bridge — detect the user's Monarch session and report it to
// the background — plus a small "connected" pill to prove overlay injection.
// Everything here logs under the [Amazarch] prefix; open DevTools on the
// Monarch tab to see it. Diagnostics log key NAMES only, never values.
import browser from "webextension-polyfill";
import {
  describeStorageForDiagnostics,
  extractDeviceUuid,
  huntMonarchToken,
} from "../../shared/monarch-session";
import type { Message } from "../../shared/messages";

const LOG = "[Amazarch]";
const MAX_ATTEMPTS = 30;

console.info(`${LOG} content script active on ${location.origin} (${document.readyState})`);

// Heartbeat so the popup can distinguish "content script never ran" (usually a
// host-permission problem) from "ran but found no token".
const heartbeat: Message = {
  type: "content-script-loaded",
  origin: location.origin,
  loadedAt: Date.now(),
};
void browser.runtime.sendMessage(heartbeat).catch((e) => {
  console.warn(`${LOG} could not reach background:`, e);
});

function snapshotStorage(store: Storage): Record<string, string> {
  const entries: Record<string, string> = {};
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key !== null) entries[key] = store.getItem(key) ?? "";
  }
  return entries;
}

function tryDetect(): boolean {
  const local = snapshotStorage(localStorage);
  let hunt = huntMonarchToken(local);
  let where = "localStorage";
  if (!hunt.token) {
    hunt = huntMonarchToken(snapshotStorage(sessionStorage));
    where = "sessionStorage";
  }
  if (!hunt.token || !hunt.strategy) return false;

  console.info(`${LOG} Monarch session found via ${where}:${hunt.strategy}`);
  const message: Message = {
    type: "monarch-session-detected",
    session: {
      token: hunt.token,
      deviceUuid: extractDeviceUuid(localStorage.getItem("monarchDeviceUUID")),
      origin: location.origin,
      capturedAt: Date.now(),
      strategy: `${where}:${hunt.strategy}`,
    },
  };
  void browser.runtime
    .sendMessage(message)
    .then(() => showConnectedPill())
    .catch((e) => console.warn(`${LOG} failed to deliver session to background:`, e));
  return true;
}

function logDiagnostics(): void {
  const local = describeStorageForDiagnostics(snapshotStorage(localStorage));
  const session = describeStorageForDiagnostics(snapshotStorage(sessionStorage));
  const cookieNames = document.cookie
    .split(";")
    .map((c) => c.split("=")[0]?.trim())
    .filter(Boolean);
  // Key NAMES and object shapes only — no values, no tokens.
  console.warn(
    `${LOG} no Monarch token found after ${MAX_ATTEMPTS}s. ` +
      `Paste this diagnostic object into the bug report:`,
    JSON.stringify(
      {
        origin: location.origin,
        localStorageKeys: local.keys,
        localStoragePersistShapes: local.persistShapes,
        sessionStorageKeys: session.keys,
        cookieNames,
      },
      null,
      2,
    ),
  );
}

let pillShown = false;
function showConnectedPill(): void {
  if (pillShown || !document.body) return;
  pillShown = true;
  const pill = document.createElement("div");
  pill.textContent = "Amazarch connected";
  pill.setAttribute(
    "style",
    [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483647",
      "padding:6px 12px",
      "border-radius:999px",
      "background:#1f2937",
      "color:#f9fafb",
      "font:12px/1.4 system-ui,sans-serif",
      "box-shadow:0 2px 8px rgba(0,0,0,.25)",
      "opacity:0",
      "transition:opacity .3s",
      "pointer-events:none",
    ].join(";"),
  );
  document.body.appendChild(pill);
  requestAnimationFrame(() => (pill.style.opacity = "1"));
  setTimeout(() => {
    pill.style.opacity = "0";
    setTimeout(() => pill.remove(), 400);
  }, 4000);
}

// The token appears after the app hydrates; retry instead of assuming it
// exists at document_idle.
if (!tryDetect()) {
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (tryDetect()) {
      clearInterval(timer);
    } else if (attempts >= MAX_ATTEMPTS) {
      clearInterval(timer);
      logDiagnostics();
    }
  }, 1000);
}
