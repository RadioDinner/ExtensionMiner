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
  // 1. Do we even have host access? (Firefox lets users revoke/never grant it.)
  let hasMonarchAccess = true;
  try {
    hasMonarchAccess = await browser.permissions.contains({ origins: MONARCH_ORIGINS });
  } catch {
    // permissions API hiccup — assume granted and let the other checks speak
  }

  const message: Message = { type: "get-status" };
  let status: StatusResponse | undefined;
  try {
    status = (await browser.runtime.sendMessage(message)) as StatusResponse;
  } catch {
    setText("monarch-status", "Background not reachable — try reloading the extension.", false);
    return;
  }

  if (status?.monarch) {
    const when = new Date(status.monarch.capturedAt).toLocaleTimeString();
    setText(
      "monarch-status",
      `Monarch session detected (${new URL(status.monarch.origin).host}, token ${status.monarch.tokenPreview}, ${when})`,
      true,
    );
    setText("debug", `found via ${status.monarch.strategy}`);
    return;
  }

  // No session — say WHY as precisely as we can.
  if (!hasMonarchAccess) {
    setText(
      "monarch-status",
      "Firefox has not granted Amazarch access to Monarch's site. Open about:addons → Amazarch → Permissions and enable access to app.monarch.com / app.monarchmoney.com, then reload the Monarch tab.",
      false,
    );
    return;
  }
  const origins = status?.contentScriptOrigins ?? [];
  if (origins.length === 0) {
    setText(
      "monarch-status",
      "No Monarch session yet — the Monarch page hasn't been visited since the extension loaded. Open (or reload) app.monarch.com while signed in.",
      false,
    );
  } else {
    setText(
      "monarch-status",
      `Amazarch is running on ${origins.map((o) => new URL(o).host).join(", ")} but couldn't find the session token. Open DevTools (F12) on the Monarch tab and copy the [Amazarch] diagnostic from the console.`,
      false,
    );
  }
}

void refresh();
