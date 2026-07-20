import browser from "webextension-polyfill";
import type { Message, StatusResponse } from "../shared/messages";
import { loadSettings, saveSettings, type AmazarchSettings } from "../shared/settings";
import { clearDeepSync, loadDeepSync } from "../shared/deep-sync";
import { loadOrderStore, summarizeAccounts } from "../shared/order-store";

const MONARCH_ORIGINS = ["https://app.monarchmoney.com/*", "https://app.monarch.com/*"];

function setText(id: string, text: string, ok?: boolean): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("ok", ok === true);
  el.classList.toggle("warn", ok === false);
}

async function refresh(): Promise<void> {
  // Build marker so it's obvious which version is loaded after a reload.
  const v = document.getElementById("version");
  if (v) v.textContent = `v${browser.runtime.getManifest().version}`;

  // 1. Do we even have host access? (Firefox lets users revoke/never grant it.)
  let hasMonarchAccess = true;
  try {
    hasMonarchAccess = await browser.permissions.contains({ origins: MONARCH_ORIGINS });
  } catch {
    // permissions API hiccup — assume granted and let the other checks speak
  }

  let status: StatusResponse | undefined;
  try {
    const message: Message = { type: "get-status" };
    status = (await browser.runtime.sendMessage(message)) as StatusResponse;
  } catch {
    setText("monarch-status", "Background not reachable — try reloading the extension.", false);
    return;
  }

  const probe = status?.probe ?? null;

  // Success: the live API check passed.
  if (probe?.ok && status?.monarch) {
    const host = new URL(status.monarch.origin).host;
    setText("monarch-status", `Connected to Monarch (${host}) — API check OK`, true);
    setText("probe", probe.note);
    const read = status.read;
    if (read?.ok) {
      setText(
        "read",
        `Amazon transactions: ${read.amazonCount} found${read.totalCount !== null ? ` (${read.totalCount.toLocaleString()} total in Monarch)` : ""}`,
        true,
      );
    } else if (read) {
      setText("read", `Transaction read failed — ${read.note}`, false);
    }
    const amazon = status.amazon;
    if (amazon?.signedIn) {
      setText("amazon", `Amazon: signed in — ${amazon.note}`, true);
    } else if (amazon && amazon.ok) {
      setText("amazon", "Amazon: not signed in — open amazon.com and sign in, then reload Monarch.", false);
    } else if (amazon) {
      setText("amazon", `Amazon: ${amazon.note}`, false);
    } else {
      setText("amazon", "Amazon: checking…");
    }
    setText(
      "debug",
      status.monarch.authMethod === "bearer"
        ? `auth: bearer token ${status.monarch.tokenPreview}`
        : "auth: session cookie",
    );
    return;
  }

  // We ran but the API check failed — show the reason.
  if (status?.monarch && probe) {
    setText("monarch-status", "Found Monarch, but the API check failed.", false);
    setText("probe", probe.note);
    setText("debug", "Open DevTools (F12) on the Monarch tab and copy the [Amazarch] diagnostic.");
    return;
  }

  // No connection attempt recorded — say why as precisely as we can.
  if (!hasMonarchAccess) {
    setText(
      "monarch-status",
      "Firefox has not granted Amazarch access to Monarch's site. Open about:addons → Amazarch → Permissions and enable app.monarch.com / app.monarchmoney.com, then reload the Monarch tab.",
      false,
    );
    return;
  }
  const origins = status?.contentScriptOrigins ?? [];
  if (origins.length === 0) {
    setText(
      "monarch-status",
      "No Monarch session yet — open (or reload) app.monarch.com while signed in.",
      false,
    );
  } else {
    setText(
      "monarch-status",
      `Amazarch is running on ${origins.map((o) => new URL(o).host).join(", ")} — connecting… reopen this popup in a few seconds, or check the [Amazarch] console diagnostic.`,
      false,
    );
  }
}

// --- Settings (Auto match + sub-toggles) --------------------------------------

function checkbox(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

function monthsLabel(months: number): string {
  return months % 12 === 0 ? `${months / 12} year${months === 12 ? "" : "s"}` : `${months} months`;
}

async function initSettings(): Promise<void> {
  const master = checkbox("auto-match");
  const note = checkbox("auto-note");
  const rename = checkbox("auto-rename");
  const lookback = document.getElementById("lookback") as HTMLSelectElement;
  const subs = document.getElementById("auto-subs");
  const hint = document.getElementById("settings-hint");
  const lookbackHint = document.getElementById("lookback-hint");
  if (!master || !note || !rename || !lookback) return;

  const s = await loadSettings();
  master.checked = s.autoMatch;
  note.checked = s.autoNote;
  rename.checked = s.autoRename;
  // Select the stored lookback; add an option for a non-standard stored value.
  if (!Array.from(lookback.options).some((o) => o.value === String(s.lookbackMonths))) {
    const extra = document.createElement("option");
    extra.value = String(s.lookbackMonths);
    extra.textContent = monthsLabel(s.lookbackMonths);
    lookback.append(extra);
  }
  lookback.value = String(s.lookbackMonths);

  // How-far-back status: show whether the next sync is deep or fast, and let
  // the user re-run the deep fetch at the same depth.
  const reflectLookback = async (): Promise<void> => {
    if (!lookbackHint) return;
    const months = Number(lookback.value);
    const done = await loadDeepSync();
    lookbackHint.textContent = "";
    if (months <= 3) {
      lookbackHint.textContent = "Every sync reads Amazon's default window (past 3 months).";
      return;
    }
    if (done && done.months >= months) {
      lookbackHint.append(
        `Deep sync done (${monthsLabel(done.months)}) — later syncs read the last 3 months. `,
      );
      const again = document.createElement("button");
      again.className = "linkish";
      again.textContent = "Fetch deep again on next sync";
      again.addEventListener("click", async () => {
        await clearDeepSync();
        await reflectLookback();
      });
      lookbackHint.append(again);
    } else {
      lookbackHint.textContent =
        `The next sync reads ${monthsLabel(months)} of order history year by year — ` +
        "it takes noticeably longer than a normal sync. Later syncs only read recent orders.";
    }
  };
  await reflectLookback();

  const reflect = (cur: AmazarchSettings): void => {
    note.disabled = !cur.autoMatch;
    rename.disabled = !cur.autoMatch;
    subs?.classList.toggle("off", !cur.autoMatch);
    if (hint) {
      hint.textContent = !cur.autoMatch
        ? ""
        : !cur.autoNote && !cur.autoRename
          ? "Auto match is on but no action is selected — nothing will be applied."
          : "Applies on the next Sync. Every auto-applied action gets an Undo button in the panel.";
    }
  };
  reflect(s);

  const onChange = async (): Promise<void> => {
    const cur: AmazarchSettings = {
      autoMatch: master.checked,
      autoNote: note.checked,
      autoRename: rename.checked,
      lookbackMonths: Number(lookback.value) || s.lookbackMonths,
    };
    reflect(cur);
    await reflectLookback();
    try {
      await saveSettings(cur);
    } catch {
      if (hint) hint.textContent = "Could not save settings — try reopening the popup.";
    }
  };
  master.addEventListener("change", onChange);
  note.addEventListener("change", onChange);
  rename.addEventListener("change", onChange);
  lookback.addEventListener("change", onChange);
}

// --- Amazon accounts (multi-account, D11) -------------------------------------

async function initAccounts(): Promise<void> {
  const el = document.getElementById("accounts");
  if (!el) return;
  try {
    const accounts = summarizeAccounts(await loadOrderStore(), null);
    if (accounts.length === 0) {
      el.textContent = "";
      return;
    }
    const names = accounts.map((a) => `${a.label} (${a.count})`).join(", ");
    el.textContent =
      accounts.length === 1
        ? `Amazon account: ${names}`
        : `Amazon accounts: ${names} — the panel matches all of them. Switch accounts on amazon.com and Sync to add more.`;
  } catch {
    el.textContent = "";
  }
}

void refresh();
void initSettings();
void initAccounts();
