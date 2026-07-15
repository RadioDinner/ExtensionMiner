// Monarch content script (runs on app.monarchmoney.com / app.monarch.com).
// M0 scope: establish an authenticated Monarch API session and prove it with a
// live `me` query, then report the outcome to the background. Runs the probe
// here (not in the background) so requests originate from the Monarch page —
// correct Origin/Referer for CSRF, and the session cookie rides along.
// All logs use the [Amazarch] prefix; diagnostics never emit stored values.
import browser from "webextension-polyfill";
import {
  describeStorageForDiagnostics,
  extractDeviceUuid,
  huntMonarchToken,
} from "../../shared/monarch-session";
import { probeMonarchApi, readCookie } from "../../shared/monarch-probe";
import { readAmazonTransactions } from "../../shared/monarch-read";
import type { AuthMethod, Message, MonarchSessionInfo } from "../../shared/messages";
import type { MonarchAuth } from "../../shared/monarch-gql";

const LOG = "[Amazarch]";
const MAX_ATTEMPTS = 20;

console.info(`${LOG} content script active on ${location.origin} (${document.readyState})`);

// Heartbeat so the popup can distinguish "content script never ran" (usually a
// host-permission problem) from "ran but couldn't connect".
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

let connected = false;

async function tryConnect(): Promise<boolean> {
  if (connected) return true;
  const deviceUuid =
    extractDeviceUuid(localStorage.getItem("monarchDeviceUUID")) ??
    readCookie(document.cookie, "monarchDeviceUUID");
  const csrftoken = readCookie(document.cookie, "csrftoken");
  const hunt = huntMonarchToken(snapshotStorage(localStorage));

  // Cookie auth is the primary path; a found bearer token is a fallback attempt.
  if (!csrftoken && !hunt.token) return false; // nothing to try yet — app not hydrated

  const auth: MonarchAuth = { origin: location.origin, csrftoken, deviceUuid, token: hunt.token };
  const probe = await probeMonarchApi(auth);

  if (!probe.ok) {
    // Keep the last failure visible in the popup, but keep retrying while the
    // page finishes loading; only give up (and dump diagnostics) after the loop.
    reportFailure(probe.note, hunt, deviceUuid);
    return false;
  }

  connected = true;
  const authMethod: AuthMethod = probe.note.includes("(bearer)") ? "bearer" : "cookie";
  const session: MonarchSessionInfo = {
    authMethod,
    token: authMethod === "bearer" ? hunt.token : null,
    deviceUuid,
    origin: location.origin,
    capturedAt: Date.now(),
    strategy: authMethod === "bearer" ? `bearer:${hunt.strategy}` : "cookie+csrftoken",
  };
  console.info(`${LOG} connected to Monarch API via ${authMethod}`);

  // First read-side proof: how many Amazon-looking transactions are in Monarch?
  const read = await readAmazonTransactions(auth);
  console.info(`${LOG} transaction read: ok=${read.ok} — ${read.note}`);

  const message: Message = { type: "monarch-connected", session, probe, read };
  void browser.runtime
    .sendMessage(message)
    .then(() => showConnectedPill())
    .catch((e) => console.warn(`${LOG} failed to report connection:`, e));
  return true;
}

let lastFailureNote = "";
function reportFailure(note: string, hunt: ReturnType<typeof huntMonarchToken>, dev: string | null): void {
  if (note === lastFailureNote) return;
  lastFailureNote = note;
  const session: MonarchSessionInfo = {
    authMethod: "none",
    token: null,
    deviceUuid: dev,
    origin: location.origin,
    capturedAt: Date.now(),
    strategy: hunt.strategy ? `token@${hunt.strategy}` : "no-token",
  };
  const message: Message = {
    type: "monarch-connected",
    session,
    probe: { ranAt: Date.now(), status: 0, ok: false, note },
    read: null,
  };
  void browser.runtime.sendMessage(message).catch(() => {});
}

function logDiagnostics(): void {
  const local = describeStorageForDiagnostics(snapshotStorage(localStorage));
  const session = describeStorageForDiagnostics(snapshotStorage(sessionStorage));
  const cookieNames = document.cookie
    .split(";")
    .map((c) => c.split("=")[0]?.trim())
    .filter(Boolean);
  // Key NAMES, object shapes, and per-field class/length only — no values.
  console.warn(
    `${LOG} could not establish a Monarch API session after ${MAX_ATTEMPTS}s. ` +
      `Paste this diagnostic object into the bug report:`,
    JSON.stringify(
      {
        origin: location.origin,
        lastError: lastFailureNote,
        localStorageKeys: local.keys,
        localStoragePersistShapes: local.persistShapes,
        authFieldFingerprint: local.fingerprint,
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

// The session/cookies appear after the app hydrates; retry, then dump a
// redacted diagnostic if we still couldn't connect.
void (async () => {
  if (await tryConnect()) return;
  let attempts = 0;
  const timer = setInterval(async () => {
    attempts += 1;
    if (await tryConnect()) {
      clearInterval(timer);
    } else if (attempts >= MAX_ATTEMPTS) {
      clearInterval(timer);
      logDiagnostics();
    }
  }, 1000);
})();
