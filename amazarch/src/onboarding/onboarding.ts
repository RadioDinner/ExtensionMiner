// The welcome / onboarding page (Phase 1 stranger-proofing). Renders the live
// setup checklist from computeOnboarding, polls so it updates as the user
// completes steps in other tabs, and offers per-step actions (grant access, open
// Monarch/Amazon) plus a scrubbed diagnostics copy. Opened automatically on
// install (see background/index.ts).
import browser from "webextension-polyfill";
import {
  computeOnboarding,
  loadOnboarding,
  markWelcomed,
  type OnboardingSignals,
  type OnboardingStep,
} from "../shared/onboarding";
import type { StatusResponse } from "../shared/messages";
import { buildDiagnosticReport } from "../shared/diagnostics";
import { collectDiagnostics } from "../shared/diagnostics-runtime";

const MONARCH_ORIGINS = ["https://app.monarchmoney.com/*", "https://app.monarch.com/*"];
const AMAZON_ORIGINS = ["https://www.amazon.com/*"];
const ALL_ORIGINS = [...MONARCH_ORIGINS, ...AMAZON_ORIGINS];

async function contains(origins: string[]): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins });
  } catch {
    return true;
  }
}

async function readSignals(): Promise<OnboardingSignals> {
  let status: StatusResponse | null = null;
  try {
    status = (await browser.runtime.sendMessage({ type: "get-status" })) as StatusResponse;
  } catch {
    /* background not up yet */
  }
  const [monarchAccess, amazonAccess, ob] = await Promise.all([
    contains(MONARCH_ORIGINS),
    contains(AMAZON_ORIGINS),
    loadOnboarding(),
  ]);
  return {
    hostAccess: monarchAccess && amazonAccess,
    monarchConnected: status?.probe?.ok === true,
    amazonSignedIn: status?.amazon ? status.amazon.signedIn : null,
    firstSyncDone: ob.firstSyncDone,
  };
}

function badge(status: OnboardingStep["status"]): string {
  return status === "done" ? "✓" : status === "current" ? "●" : "○";
}

function actionFor(step: OnboardingStep): { label: string; run: () => void } | null {
  switch (step.id) {
    case "access":
      return {
        label: "Grant access",
        run: () => {
          void browser.permissions.request({ origins: ALL_ORIGINS }).then(render);
        },
      };
    case "monarch":
      return { label: "Open Monarch", run: () => void browser.tabs.create({ url: "https://app.monarch.com" }) };
    case "sync":
      return { label: "Open Amazon to sign in", run: () => void browser.tabs.create({ url: "https://www.amazon.com/gp/css/order-history" }) };
  }
}

function el(tag: string, className?: string): HTMLElement {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

async function render(): Promise<void> {
  const board = computeOnboarding(await readSignals());
  const stepsEl = document.getElementById("steps");
  const doneNote = document.getElementById("done-note");
  const progress = document.getElementById("progress");
  if (!stepsEl) return;

  stepsEl.replaceChildren();
  for (const step of board.steps) {
    const row = el("div", `step ${step.status}`);
    const b = el("div", "badge");
    b.textContent = badge(step.status);
    row.append(b);
    const body = el("div");
    const title = el("div", "title");
    title.textContent = step.title;
    body.append(title);
    const detail = el("div", "detail");
    detail.textContent = step.detail;
    body.append(detail);
    if (step.status === "current") {
      const act = actionFor(step);
      if (act) {
        const wrap = el("div", "action");
        const btn = el("button") as HTMLButtonElement;
        btn.textContent = act.label;
        btn.addEventListener("click", act.run);
        wrap.append(btn);
        body.append(wrap);
      }
    }
    row.append(body);
    stepsEl.append(row);
  }

  const doneCount = board.steps.filter((s) => s.status === "done").length;
  if (progress) progress.textContent = `${doneCount} of ${board.steps.length} done`;
  if (doneNote) doneNote.style.display = board.complete ? "block" : "none";
}

async function copyDiagnostics(): Promise<void> {
  const report = buildDiagnosticReport(await collectDiagnostics());
  const out = document.getElementById("diag-out") as HTMLTextAreaElement | null;
  try {
    await navigator.clipboard.writeText(report);
    const btn = document.getElementById("diag");
    if (btn) btn.textContent = "✓ Copied";
  } catch {
    if (out) {
      out.style.display = "block";
      out.value = report;
      out.select();
    }
  }
}

function init(): void {
  const v = document.getElementById("version");
  if (v) v.textContent = `v${browser.runtime.getManifest().version}`;
  document.getElementById("recheck")?.addEventListener("click", () => void render());
  document.getElementById("diag")?.addEventListener("click", () => void copyDiagnostics());
  void markWelcomed();
  void render();
  // Poll so the checklist reflects steps completed in other tabs.
  setInterval(() => void render(), 3000);
}

init();
