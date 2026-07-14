// Monarch content script (runs on app.monarchmoney.com / app.monarch.com).
// M0 scope: token bridge — detect the user's Monarch session and report it to
// the background — plus a small "connected" pill to prove overlay injection.
import browser from "webextension-polyfill";
import { extractDeviceUuid, extractMonarchToken } from "../../shared/monarch-session";
import type { Message } from "../../shared/messages";

function detectSession(): void {
  const token = extractMonarchToken(localStorage.getItem("persist:root"));
  if (!token) return;
  const message: Message = {
    type: "monarch-session-detected",
    session: {
      token,
      deviceUuid: extractDeviceUuid(localStorage.getItem("monarchDeviceUUID")),
      origin: location.origin,
      capturedAt: Date.now(),
    },
  };
  void browser.runtime.sendMessage(message).then(() => showConnectedPill());
}

let pillShown = false;
function showConnectedPill(): void {
  if (pillShown) return;
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

// The token appears after the app hydrates; retry briefly instead of assuming
// it exists at document_idle.
let attempts = 0;
const timer = setInterval(() => {
  attempts += 1;
  const token = extractMonarchToken(localStorage.getItem("persist:root"));
  if (token || attempts >= 30) {
    clearInterval(timer);
    if (token) detectSession();
  }
}, 1000);
detectSession();
