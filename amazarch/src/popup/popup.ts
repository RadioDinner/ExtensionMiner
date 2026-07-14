import browser from "webextension-polyfill";
import type { Message, StatusResponse } from "../shared/messages";

async function refresh(): Promise<void> {
  const el = document.getElementById("monarch-status");
  if (!el) return;
  const message: Message = { type: "get-status" };
  try {
    const status = (await browser.runtime.sendMessage(message)) as StatusResponse;
    if (status?.monarch) {
      const when = new Date(status.monarch.capturedAt).toLocaleTimeString();
      el.textContent = `Monarch session detected (${new URL(status.monarch.origin).host}, token ${status.monarch.tokenPreview}, ${when})`;
      el.classList.add("ok");
    } else {
      el.textContent = "No Monarch session yet — open the Monarch web app while signed in.";
    }
  } catch {
    el.textContent = "Background not reachable — try reloading the extension.";
  }
}

void refresh();
