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
import { matchOrdersToCharges } from "../../shared/matcher";
import {
  buildMerchantName,
  buildNoteLine,
  mergeNotes,
  setTransactionName,
  setTransactionNotes,
} from "../../shared/monarch-write";
import type { ApplyResult } from "./overlay";
import type {
  AmazonCheck,
  AmazonOrderLite,
  AuthMethod,
  Message,
  MonarchSessionInfo,
} from "../../shared/messages";
import type { MonarchAuth } from "../../shared/monarch-gql";
import { renderPanel, setPanelStatus } from "./overlay";

// Live status line with a running timer, updated in place during a sync.
let statusTimer: ReturnType<typeof setInterval> | undefined;
let statusStart = 0;
let statusLabel = "";
function statusTick(): void {
  const secs = Math.floor((Date.now() - statusStart) / 1000);
  setPanelStatus(`${statusLabel}  ·  ${secs}s`);
}
function statusBegin(label: string): void {
  statusLabel = label;
  statusStart = Date.now();
  statusTick();
  if (statusTimer) clearInterval(statusTimer);
  statusTimer = setInterval(statusTick, 1000);
}
function statusSet(label: string): void {
  statusLabel = label;
  statusTick();
}
function statusStop(): void {
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = undefined;
  }
}

// Live progress pushed from the background while it reads the Amazon tab.
browser.runtime.onMessage.addListener((raw: unknown): undefined => {
  const m = raw as { type?: string; label?: string };
  if (m?.type === "amazon-progress" && typeof m.label === "string") statusSet(m.label);
  return undefined;
});

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

  // Click-to-apply actions (append note / rename merchant) — additive, undoable.
  const onApply = async (chargeId: string, chargeNotes: string, order: AmazonOrderLite): Promise<ApplyResult> => {
    const merged = mergeNotes(chargeNotes, order, buildNoteLine(order));
    if (!merged.changed) return { ok: true, note: "already noted" };
    const res = await setTransactionNotes(auth, chargeId, merged.notes);
    if (!res.ok) return { ok: false, note: res.note };
    return { ok: true, note: "note added", undo: () => setTransactionNotes(auth, chargeId, chargeNotes) };
  };
  const onRename = async (chargeId: string, currentName: string, order: AmazonOrderLite): Promise<ApplyResult> => {
    const target = buildMerchantName(order);
    if (currentName === target) return { ok: true, note: "already named" };
    const res = await setTransactionName(auth, chargeId, target);
    if (!res.ok) return { ok: false, note: res.note };
    return { ok: true, note: "renamed", undo: () => setTransactionName(auth, chargeId, currentName) };
  };

  // Heavy work (read charges + open the Amazon tab + match) runs ONLY on demand,
  // so opening Monarch stays fast and the Amazon tab isn't opened every visit.
  const doSync = async (): Promise<void> => {
    try {
      statusBegin("Sync queued…");
      statusSet("Reading your Monarch transactions…");
      const read = await readAmazonTransactions(auth, {}, (loaded) =>
        statusSet(`Reading Monarch transactions — ${loaded} Amazon charges so far…`),
      );
      console.info(`${LOG} transaction read: ok=${read.ok} — ${read.note}`);
      if (!read.ok) {
        statusStop();
        renderPanel({
          txns: [], totalCount: null, capped: false,
          synced: true, status: `Monarch read failed — ${read.note}`,
          onSync: doSync, onApply, onRename,
        });
        return;
      }
      let matches: ReturnType<typeof matchOrdersToCharges> = [];
      let check: AmazonCheck | null = null;
      try {
        statusSet("Opening Amazon…"); // background pushes per-page progress from here
        check = (await browser.runtime.sendMessage({ type: "fetch-amazon" })) as AmazonCheck;
        console.info(`${LOG} amazon: ${check.status.note}`);
        statusSet(`Matching ${check.orders.length} orders to ${read.rows.length} charges…`);
        matches = matchOrdersToCharges(read.rows, check.orders);
      } catch (e) {
        console.warn(`${LOG} amazon fetch failed:`, e);
      }
      statusStop();
      let done: string;
      if (check?.status.signedIn === false) {
        done = "Amazon needs sign-in — open amazon.com, sign in, then Sync again.";
      } else if (check && check.orders.length === 0) {
        done = `Done — ${read.rows.length} charges, but 0 Amazon orders. ${check.status.note}`;
      } else {
        done = `Done — ${read.rows.length} Amazon charges, ${check?.orders.length ?? 0} orders read.`;
      }
      renderPanel({
        txns: read.rows, totalCount: read.totalCount, capped: read.capped,
        orders: check?.orders, amazonNote: check?.status.note, matches,
        synced: true, status: done, onSync: doSync, onApply, onRename,
        diagnostic: check?.diagnostic, sample: check?.sample, report: check?.report,
      });
    } catch (e) {
      statusStop();
      console.error(`${LOG} sync error:`, e);
      renderPanel({
        txns: [], totalCount: null, capped: false,
        synced: true, status: `Sync error — ${e instanceof Error ? e.message : String(e)}`,
        onSync: doSync, onApply, onRename,
      });
    }
  };

  // On connect: show a light panel with a "Sync now" button — no heavy work yet.
  renderPanel({
    txns: [], totalCount: null, capped: false,
    synced: false, onSync: doSync, onApply, onRename,
    syncNote: 'Click "Sync now" to read your Amazon orders and match them to your Monarch charges.',
  });

  const message: Message = { type: "monarch-connected", session, probe, read: null };
  void browser.runtime
    .sendMessage(message)
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
