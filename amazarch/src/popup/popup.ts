import browser from "webextension-polyfill";
import type { Message, StatusResponse } from "../shared/messages";

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

void refresh();
