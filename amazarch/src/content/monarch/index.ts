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
  buildRefundMerchantName,
  buildRefundNoteLine,
  mergeNotes,
  setTransactionName,
  setTransactionNotes,
  type WriteResult,
} from "../../shared/monarch-write";
import type { MatchResult } from "../../shared/matcher";
import { loadSettings } from "../../shared/settings";
import { planAutoApply, runAutoApply, summarizeAutoApply } from "../../shared/auto-apply";
import type { ApplyResult } from "./overlay";
import { armUndo } from "./overlay";
import type {
  AmazonCheck,
  AuthMethod,
  Message,
  MonarchSessionInfo,
} from "../../shared/messages";
import type { MonarchAuth } from "../../shared/monarch-gql";
import { renderPanel, setPanelStatus, setPanelTimer } from "./overlay";

// Keep the background event page alive while a Monarch tab is open. Firefox
// suspends idle event pages, and once suspended a one-off runtime message can
// fail with "Receiving end does not exist"; an open port both wakes it and
// keeps it alive, so on-demand sync (clicked minutes after load) always has a
// live receiver. Reconnect if the connection ever drops.
function connectKeepAlive(): void {
  try {
    const port = browser.runtime.connect({ name: "amazarch-keepalive" });
    port.onDisconnect.addListener(() => setTimeout(connectKeepAlive, 1000));
  } catch {
    setTimeout(connectKeepAlive, 2000);
  }
}
connectKeepAlive();

// A port alone doesn't reliably hold a Firefox event page open, so also poke the
// background every 15s (under Firefox's ~30s idle timeout). This keeps it warm
// the whole time Monarch is open, so on-demand Sync — clicked minutes later —
// always reaches a live receiver.
setInterval(() => {
  browser.runtime.sendMessage({ type: "get-status" }).catch(() => {});
}, 15000);

// Send a message to the background, retrying to cover the case where Firefox has
// idle-suspended the event page (first send wakes it, a retry then connects).
async function sendToBackground<T>(msg: unknown): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      return (await browser.runtime.sendMessage(msg)) as T;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw lastErr;
}

// A pure vanity timer: once a sync starts it ticks every second until the sync
// ends, independent of which phase/status is showing — a simple sign of life.
let syncStartedAt: number | null = null;
let vanityTimer: ReturnType<typeof setInterval> | undefined;
function statusBegin(label: string): void {
  syncStartedAt = Date.now();
  setPanelTimer("0s");
  setPanelStatus(label);
  if (!vanityTimer) {
    vanityTimer = setInterval(() => {
      if (syncStartedAt === null) return;
      setPanelTimer(`${Math.floor((Date.now() - syncStartedAt) / 1000)}s`);
    }, 1000);
  }
}
function statusSet(label: string): void {
  setPanelStatus(label);
}
function statusStop(): void {
  syncStartedAt = null;
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
  // Each write is verified from the mutation response (see monarch-write.ts) and
  // the result is reported honestly in the status line: Monarch's own UI does
  // NOT refetch after our write, so a successful change is invisible until the
  // page is refreshed — say so instead of letting it read as "did nothing".
  const reportWrite = (what: string, res: WriteResult): void => {
    if (res.verified === true) {
      setPanelStatus(`${what} confirmed by Monarch ✓ — refresh the page to see it.`);
    } else if (res.verified === false) {
      const reads = res.readBack === null ? "a different value" : `“${res.readBack.slice(0, 40)}”`;
      setPanelStatus(`⚠ ${what}: Monarch accepted the write but reports ${reads} — refresh and check.`);
    } else {
      setPanelStatus(`${what} accepted (couldn't confirm from the response) — refresh the page to check.`);
    }
  };
  // Both actions take the full match so refund credits get refund wording
  // ("[Amazarch] Refund — …", "Amazon refund — …") through the same verified,
  // undoable write path as charges.
  const onApply = async (m: MatchResult): Promise<ApplyResult> => {
    const order = m.order;
    if (!order) return { ok: false, note: "no matched order" };
    const chargeId = m.charge.id;
    const chargeNotes = m.charge.notes;
    const line = m.kind === "refund" ? buildRefundNoteLine(order, m.refundMatch) : buildNoteLine(order);
    const merged = mergeNotes(chargeNotes, order, line);
    if (!merged.changed) return { ok: true, note: "already noted" };
    const res = await setTransactionNotes(auth, chargeId, merged.notes);
    if (!res.ok) return { ok: false, note: res.note };
    reportWrite("Note write", res);
    return {
      ok: true,
      note: res.verified === false ? "note not applied" : res.verified === null ? "note added (unconfirmed)" : "note added",
      verified: res.verified,
      undo: async () => {
        const u = await setTransactionNotes(auth, chargeId, chargeNotes);
        if (u.ok) reportWrite("Note undo", u);
        return u;
      },
    };
  };
  const onRename = async (m: MatchResult): Promise<ApplyResult> => {
    const order = m.order;
    if (!order) return { ok: false, note: "no matched order" };
    const chargeId = m.charge.id;
    const currentName = m.charge.name;
    const target = m.kind === "refund" ? buildRefundMerchantName(order) : buildMerchantName(order);
    if (currentName === target) return { ok: true, note: "already named" };
    const res = await setTransactionName(auth, chargeId, target);
    if (!res.ok) return { ok: false, note: res.note };
    reportWrite("Rename", res);
    return {
      ok: true,
      note: res.verified === false ? "rename not applied" : res.verified === null ? "renamed (unconfirmed)" : "renamed",
      verified: res.verified,
      undo: async () => {
        const u = await setTransactionName(auth, chargeId, currentName);
        if (u.ok) reportWrite("Rename undo", u);
        return u;
      },
    };
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
      let amazonError: string | null = null;
      try {
        statusSet("Opening Amazon…"); // background pushes per-page progress from here
        check = await sendToBackground<AmazonCheck>({ type: "fetch-amazon" });
        console.info(`${LOG} amazon: ${check?.status?.note}`);
        statusSet(`Matching ${check.orders.length} orders to ${read.rows.length} charges…`);
        matches = matchOrdersToCharges(read.rows, check.orders);
      } catch (e) {
        amazonError = e instanceof Error ? e.message : String(e);
        console.warn(`${LOG} amazon fetch failed:`, e);
      }
      statusStop();
      let done: string;
      if (amazonError) {
        done = `Amazon fetch error — ${amazonError}`;
      } else if (!check) {
        done = "Amazon fetch returned nothing (no response from background).";
      } else if (check.status.signedIn === false) {
        done = "Amazon needs sign-in — open amazon.com, sign in, then Sync again.";
      } else if (check.orders.length === 0) {
        done = `Done — ${read.rows.length} charges, but 0 Amazon orders. ${check.status.note}`;
      } else {
        done = `Done — ${read.rows.length} Amazon charges, ${check.orders.length} orders read.`;
      }
      const view = {
        txns: read.rows, totalCount: read.totalCount, capped: read.capped,
        orders: check?.orders, amazonNote: check?.status.note, matches,
        synced: true, status: done, onSync: doSync, onApply, onRename,
        diagnostic: check?.diagnostic, sample: check?.sample, report: check?.report,
      };
      renderPanel(view);

      // Auto match (popup settings): apply the enabled actions to EXACT ("auto")
      // matches, politely paced, through the SAME onApply/onRename paths as the
      // buttons — then re-render so every auto-applied action shows its armed
      // Undo. "review" matches always stay manual.
      const settings = await loadSettings();
      const plan = planAutoApply(matches, settings);
      if (plan.length > 0) {
        console.info(`${LOG} auto-match: ${plan.length} actions queued`);
        const summary = await runAutoApply(
          plan,
          async (a) => {
            const m = a.match;
            const r = a.kind === "note" ? await onApply(m) : await onRename(m);
            armUndo(`${m.charge.id}:${a.kind}`, r);
            return r;
          },
          {
            onProgress: (n, total, a) => statusSet(`Auto-match: ${a.kind} ${n}/${total}…`),
            pause: () => new Promise((r) => setTimeout(r, 300)),
          },
        );
        console.info(`${LOG} auto-match done: ${JSON.stringify(summary)}`);
        renderPanel({ ...view, status: summarizeAutoApply(summary) });
      }
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

  // Health check on load: is the background reachable at all? This runs before
  // any Sync click, so it isolates "background dead/unreachable" from anything
  // sync-specific — shown right in the status line, no DevTools needed.
  void browser.runtime.sendMessage({ type: "get-status" }).then(
    () => setPanelStatus("Background connected ✓ — ready to Sync"),
    (e) => setPanelStatus(`⚠ Background NOT reachable: ${e instanceof Error ? e.message : String(e)}`),
  );

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
