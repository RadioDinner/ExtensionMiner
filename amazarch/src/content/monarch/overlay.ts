// The Amazarch panel injected into the Monarch web app (SPEC.md D4). It shows
// the Amazon charges found in Monarch and — once fetched — the parsed Amazon
// orders, so parsing can be validated before matching is layered on.
import browser from "webextension-polyfill";
import { formatCents } from "../../shared/money";
import type { AmazonTxn } from "../../shared/monarch-read";
import type { AmazonAccountSummary, AmazonOrderLite } from "../../shared/messages";
import { summarize, type MatchResult } from "../../shared/matcher";
import type { WriteGate } from "../../shared/write-gate";

const PANEL_ID = "amazarch-panel";

export interface ApplyOutcome {
  ok: boolean;
  note: string;
  /** From write verification: true = Monarch's response confirms the change;
   *  false = Monarch reported the field unchanged; null/undefined = unknown. */
  verified?: boolean | null;
}

export interface ApplyResult extends ApplyOutcome {
  undo?: () => Promise<ApplyOutcome>;
}

export interface PanelView {
  txns: AmazonTxn[];
  totalCount: number | null;
  capped: boolean;
  orders?: AmazonOrderLite[];
  amazonNote?: string;
  matches?: MatchResult[];
  synced?: boolean; // false = connected but no sync run yet (light state)
  syncNote?: string; // body text shown in the light state
  status?: string; // initial status-line text (updated live via setPanelStatus)
  onSync?: () => Promise<void>;
  onApply?: (m: MatchResult) => Promise<ApplyResult>;
  onRename?: (m: MatchResult) => Promise<ApplyResult>;
  accounts?: AmazonAccountSummary[]; // known Amazon accounts (multi-account, D11)
  activeAccount?: string | null; // the account signed in during the last sync
  onForgetAccount?: (label: string) => void; // drop an account's cached orders
  gate?: WriteGate; // licensing/kill-switch state for the write actions
  onStartTrial?: () => Promise<void>; // paywall CTA: start the free trial
  onBuy?: () => void; // paywall CTA: open checkout / manage subscription
  diagnostic?: Record<string, number | string>;
  sample?: string;
  report?: string;
}

// --- Panel UI state (draggable + minimizable), persisted in storage.local -----

export interface PanelUiState {
  x: number | null; // left px; null = default corner
  y: number | null; // top px; null = default corner
  minimized: boolean; // collapsed to a floating chip
}

const UI_KEY = "amazarchPanelUi";

/** Pure: coerce stored UI state into a valid object. x/y only count when both
 *  are finite numbers (a half-set position falls back to the default corner). */
export function parsePanelUi(raw: unknown): PanelUiState {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const x = num(o["x"]);
  const y = num(o["y"]);
  const both = x !== null && y !== null;
  return { x: both ? x : null, y: both ? y : null, minimized: o["minimized"] === true };
}

/** Pure: keep a box of size w×h fully on screen with a margin. */
export function clampToViewport(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
  margin = 8,
): { x: number; y: number } {
  const maxX = Math.max(margin, vw - w - margin);
  const maxY = Math.max(margin, vh - h - margin);
  return {
    x: Math.min(Math.max(x, margin), maxX),
    y: Math.min(Math.max(y, margin), maxY),
  };
}

const STATUS_META: Record<string, { icon: string; color: string }> = {
  auto: { icon: "✓", color: "#a7f3d0" },
  review: { icon: "?", color: "#fcd34d" },
  unmatched: { icon: "—", color: "#9ca3af" },
  refund: { icon: "↩", color: "#93c5fd" },
};

let lastView: PanelView | null = null;
let guardStarted = false;

export function renderPanel(view: PanelView): void {
  lastView = view;
  ensureUiLoaded();
  draw(view);
  if (!guardStarted) {
    guardStarted = true;
    // Fallback re-assert if the panel ever disappears. Attaching to <html>
    // (below) keeps it out of Monarch's React <body> tree, so this rarely fires.
    setInterval(() => {
      if (lastView && !document.getElementById(PANEL_ID) && document.documentElement) draw(lastView);
    }, 8000);
  }
}

// Draggable/minimizable position, kept in a module var (so it survives the
// frequent full redraws) and mirrored to storage.local (so it survives reloads).
let uiState: PanelUiState = { x: null, y: null, minimized: false };
let uiLoadStarted = false;

function ensureUiLoaded(): void {
  if (uiLoadStarted) return;
  uiLoadStarted = true;
  void browser.storage.local
    .get(UI_KEY)
    .then((got) => {
      const loaded = parsePanelUi((got as Record<string, unknown>)?.[UI_KEY]);
      const changed = loaded.x !== uiState.x || loaded.y !== uiState.y || loaded.minimized !== uiState.minimized;
      uiState = loaded;
      // Re-draw once with the restored position/minimized state.
      if (changed && lastView) draw(lastView);
    })
    .catch(() => {});
}

function savePanelUi(): void {
  void browser.storage.local.set({ [UI_KEY]: uiState }).catch(() => {});
}

// Once a positioned element is in the DOM its real size is known — re-clamp so a
// panel restored from a chip dragged near an edge (or after a viewport resize)
// never renders off-screen. No-op when using the default corner.
function clampAfterAppend(node: HTMLElement): void {
  if (uiState.x === null || uiState.y === null) return;
  const c = clampToViewport(uiState.x, uiState.y, node.offsetWidth, node.offsetHeight, window.innerWidth, window.innerHeight);
  if (c.x !== uiState.x || c.y !== uiState.y) {
    uiState.x = c.x;
    uiState.y = c.y;
    applyPosition(node);
    savePanelUi();
  }
}

// Apply the current position to a fixed element: a stored x/y pins it via
// left/top, otherwise it sits in the default bottom-right corner.
function applyPosition(node: HTMLElement): void {
  if (uiState.x !== null && uiState.y !== null) {
    node.style.left = `${uiState.x}px`;
    node.style.top = `${uiState.y}px`;
    node.style.right = "auto";
    node.style.bottom = "auto";
  } else {
    node.style.right = "16px";
    node.style.bottom = "16px";
    node.style.left = "auto";
    node.style.top = "auto";
  }
}

// Make `handle` drag `moveTarget` around, persisting the clamped position. A
// press that doesn't move past a small threshold is treated as a click and
// forwarded to onTap (used to restore the minimized chip). Presses that start
// on a <button> are ignored so the header's buttons keep working.
function attachDrag(handle: HTMLElement, moveTarget: HTMLElement, onTap?: () => void): void {
  handle.style.cursor = "grab";
  handle.addEventListener("pointerdown", (ev: Event) => {
    const e = ev as PointerEvent;
    if ((e.target as HTMLElement | null)?.closest("button")) return;
    e.preventDefault();
    const rect = moveTarget.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    handle.style.cursor = "grabbing";
    const onMove = (mv: Event): void => {
      const m = mv as PointerEvent;
      const dx = m.clientX - startX;
      const dy = m.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      const c = clampToViewport(
        rect.left + dx, rect.top + dy,
        moveTarget.offsetWidth, moveTarget.offsetHeight,
        window.innerWidth, window.innerHeight,
      );
      uiState.x = c.x;
      uiState.y = c.y;
      applyPosition(moveTarget);
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      handle.style.cursor = "grab";
      if (moved) savePanelUi();
      else if (onTap) onTap();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

// Collapse to / restore from the floating chip.
function setMinimized(min: boolean): void {
  uiState.minimized = min;
  savePanelUi();
  if (lastView) draw(lastView);
}

// The minimized floating chip — click to pop the panel back out; draggable too.
function drawChip(): void {
  const host = document.documentElement;
  if (!host) return;
  const chip = el("div", {
    position: "fixed", "z-index": "2147483647",
    display: "flex", "align-items": "center", gap: "6px",
    padding: "8px 12px", "border-radius": "999px",
    background: "#111827", color: "#f9fafb",
    "box-shadow": "0 4px 16px rgba(0,0,0,.35)", font: "12px/1 system-ui,sans-serif",
    "user-select": "none",
  });
  chip.id = PANEL_ID;
  applyPosition(chip);
  chip.append(text("span", "◧ Amazarch", {}));
  chip.title = "Click to open Amazarch — drag to move";
  attachDrag(chip, chip, () => setMinimized(false));
  host.appendChild(chip);
}

// Update the status label in place (no full re-render).
export function setPanelStatus(text: string): void {
  const el = document.getElementById(`${PANEL_ID}-label`);
  if (el) el.textContent = text;
}

// Update the independent vanity timer (a heartbeat that ticks every second
// regardless of which sync phase is showing).
export function setPanelTimer(text: string): void {
  const el = document.getElementById(`${PANEL_ID}-timer`);
  if (el) el.textContent = text;
}

function draw(view: PanelView): void {
  const host = document.documentElement;
  if (!host) return;
  document.getElementById(PANEL_ID)?.remove();

  // Minimized: show only the floating chip.
  if (uiState.minimized) {
    drawChip();
    return;
  }

  const version = browser.runtime.getManifest().version;
  const panel = el("div", {
    position: "fixed", "z-index": "2147483647",
    width: "340px", "max-height": "70vh", display: "flex", "flex-direction": "column",
    background: "#111827", color: "#f9fafb", "border-radius": "12px",
    "box-shadow": "0 8px 30px rgba(0,0,0,.35)", font: "13px/1.45 system-ui,sans-serif",
    overflow: "hidden",
  });
  panel.id = PANEL_ID;
  applyPosition(panel);

  // Header — doubles as the drag handle (grab anywhere but the buttons).
  const header = el("div", {
    display: "flex", "align-items": "center", "justify-content": "space-between",
    padding: "10px 12px", background: "#1f2937", "user-select": "none",
  });
  header.append(text("strong", `Amazarch v${version}`, {}));
  attachDrag(header, panel);
  const right = el("div", { display: "flex", "align-items": "center", gap: "8px" });
  if (view.onSync) {
    const sync = el("button", {
      padding: "4px 10px", cursor: "pointer", border: "none", "border-radius": "6px",
      background: "#2563eb", color: "#fff", font: "11px system-ui,sans-serif",
    }) as HTMLButtonElement;
    sync.textContent = "Sync now";
    sync.addEventListener("click", async () => {
      sync.disabled = true;
      sync.textContent = "Syncing…";
      try {
        await view.onSync!();
      } finally {
        sync.disabled = false;
        sync.textContent = "Sync now";
      }
    });
    right.append(sync);
  }
  const minimize = el("button", {
    background: "none", border: "none", color: "#9ca3af", cursor: "pointer",
    "font-size": "16px", padding: "2px 4px", "line-height": "1",
  });
  minimize.textContent = "—";
  minimize.title = "Minimize to a floating icon";
  minimize.addEventListener("click", () => setMinimized(true));
  right.append(minimize);
  const close = el("button", {
    background: "none", border: "none", color: "#9ca3af", cursor: "pointer",
    "font-size": "14px", padding: "2px 4px",
  });
  close.textContent = "✕";
  close.title = "Close (reopens on the next sync)";
  close.addEventListener("click", () => {
    lastView = null; // otherwise the 8s guard resurrects the panel the user just closed
    panel.remove();
  });
  right.append(close);
  header.append(right);
  panel.append(header);

  // Live status line: an independent vanity timer + the current phase label.
  const status = el("div", {
    display: "flex", gap: "8px", "align-items": "baseline",
    padding: "6px 12px", "font-size": "11px", color: "#93c5fd",
    "border-bottom": "1px solid #1f2937", "min-height": "16px",
  });
  const timer = el("span", { color: "#a7f3d0", "font-variant-numeric": "tabular-nums", "min-width": "28px" });
  timer.id = `${PANEL_ID}-timer`;
  const label = el("span", {});
  label.id = `${PANEL_ID}-label`;
  label.textContent = view.status ?? "";
  status.append(timer, label);
  panel.append(status);

  // Licensing / kill-switch banner (trial countdown, paywall, or paused notice).
  const banner = gateBanner(view);
  if (banner) panel.append(banner);

  // Light state: connected but no sync run yet — do nothing heavy on page load.
  if (view.onSync && !view.synced) {
    const body0 = el("div", { padding: "12px" });
    body0.append(text("div", "Connected to Monarch.", { color: "#a7f3d0", "margin-bottom": "6px" }));
    body0.append(
      text("div", view.syncNote ?? "Click “Sync now” to read your Amazon orders and match them to your Monarch charges.", {
        color: "#9ca3af", "font-size": "12px",
      }),
    );
    panel.append(body0);
    host.appendChild(panel);
    clampAfterAppend(panel);
    return;
  }

  const body = el("div", { overflow: "auto" });

  // Section: proposed matches (the headline). Falls back to raw charge list
  // until Amazon orders have been read.
  if (view.matches) {
    const s = summarize(view.matches);
    body.append(sectionTitle("Proposed matches"));
    body.append(
      muted(`${s.auto} matched · ${s.review} review · ${s.unmatched} no order · ${s.refund} refunds unmatched`),
    );
    // Show matched/review first, then the rest.
    const ordered = [...view.matches].sort((a, b) => rank(a.status) - rank(b.status));
    for (const m of ordered.slice(0, 60)) {
      const meta = STATUS_META[m.status] ?? STATUS_META.unmatched!;
      // Matched refunds keep the ↩ marker (their status icon would hide what
      // kind of match this is); status still drives the row color.
      const icon = m.kind === "refund" ? "↩" : meta.icon;
      const label = m.order ? (m.order.itemTitles[0] ?? (m.order.orderId || "order")) : "";
      const dd = fmtDayDiff(m.dayDiff);
      const sub = m.order
        ? m.kind === "refund"
          ? `${icon} ${m.refundMatch === "partial" ? "partial refund of" : "refund of"} ${m.order.date} order · ${label}${dd}`
          : `${icon} ${m.order.date} · ${label}${dd}`
        : `${icon} ${m.status === "refund" ? "refund — no order matched in the sync window" : "no matching order"}`;
      body.append(row(m.charge.merchantName, sub, formatCents(m.charge.amountCents), meta.color));
      // Click-to-apply actions for a matched charge or refund (notes + rename).
      // Hidden when writes are gated (paywall/paused) — the banner explains why.
      const writesAllowed = view.gate ? view.gate.allowed : true;
      if (writesAllowed && m.order && (m.status === "auto" || m.status === "review")) {
        const actions = el("div", { display: "flex", gap: "6px", padding: "0 12px 8px", "flex-wrap": "wrap" });
        if (view.onApply) {
          actions.append(actionButton("Add note", `${m.charge.id}:note`, () => view.onApply!(m)));
        }
        if (view.onRename) {
          actions.append(actionButton("Rename merchant", `${m.charge.id}:rename`, () => view.onRename!(m)));
        }
        body.append(actions);
      }
    }
    if (view.matches.length > 60) body.append(muted(`…and ${view.matches.length - 60} more`));
  } else {
    body.append(sectionTitle(`${view.txns.length} Amazon charge${view.txns.length === 1 ? "" : "s"} in Monarch`));
    if (view.txns.length === 0) {
      body.append(muted("No Amazon transactions found."));
    } else {
      for (const t of view.txns.slice(0, 50)) {
        body.append(row(t.merchantName, t.date, formatCents(t.amountCents)));
      }
      if (view.txns.length > 50) body.append(muted(`…and ${view.txns.length - 50} more`));
    }
  }

  // Section: parsed Amazon orders (once fetched)
  if (view.orders) {
    body.append(sectionTitle(`${view.orders.length} Amazon order${view.orders.length === 1 ? "" : "s"} parsed`));
    if (view.orders.length === 0) {
      body.append(muted(view.amazonNote ?? "No orders parsed."));
      // One-click copy of the full redacted diagnostic — no DevTools, no
      // hunting for a text box. Puts the report straight on the clipboard.
      if (view.report) {
        const wrap = el("div", { padding: "6px 12px" });
        const btn = el("button", {
          width: "100%", padding: "8px", cursor: "pointer", border: "none",
          "border-radius": "6px", background: "#2563eb", color: "#fff",
          font: "12px system-ui,sans-serif",
        });
        btn.textContent = "📋 Copy diagnostic to clipboard";
        const report = view.report;
        btn.addEventListener("click", () => {
          navigator.clipboard.writeText(report).then(
            () => { btn.textContent = "✓ Copied — paste it to the dev"; },
            () => { btn.textContent = "Copy failed — use the text box below"; },
          );
        });
        wrap.append(btn);
        body.append(wrap);
      }
      // Fallback: show the redacted diagnostic counts in-panel too.
      if (view.diagnostic) {
        body.append(sectionTitle("Order-parse diagnostic (counts only)"));
        for (const [k, v] of Object.entries(view.diagnostic)) {
          body.append(row(k, "", String(v)));
        }
      }
      if (view.report) {
        body.append(sectionTitle("…or select all in this box, copy, paste"));
        const ta = document.createElement("textarea");
        ta.readOnly = true;
        ta.value = view.report;
        ta.setAttribute(
          "style",
          "width:calc(100% - 24px);margin:4px 12px 8px;height:120px;background:#0b1220;color:#cbd5e1;border:1px solid #334155;border-radius:6px;font:11px/1.4 monospace;padding:6px;",
        );
        ta.addEventListener("focus", () => ta.select());
        body.append(ta);
      }
    } else {
      for (const o of view.orders.slice(0, 50)) {
        const label = o.itemTitles[0]
          ? o.itemTitles[0] + (o.itemTitles.length > 1 ? ` +${o.itemTitles.length - 1}` : "")
          : o.orderId || "order";
        body.append(row(label, o.date, formatCents(o.totalCents)));
      }
    }
  }

  // Section: Amazon accounts (multi-account, D11). Amazon allows only one active
  // session at a time, so we accumulate each account's orders and prompt the
  // user to switch accounts to sync the other one.
  if (view.accounts && view.accounts.length > 0) {
    body.append(sectionTitle("Amazon accounts"));
    for (const a of view.accounts) {
      body.append(accountRow(a, view.onForgetAccount));
    }
    const active = view.activeAccount;
    body.append(
      muted(
        active
          ? `Signed in as ${active}. To include another account, switch accounts on amazon.com, then Sync again.`
          : "Switch accounts on amazon.com and Sync to add another account.",
      ),
    );
  }

  panel.append(body);

  // Footer
  const orderCount = view.orders ? `${view.orders.length} Amazon orders read. ` : "";
  const total = view.totalCount !== null ? `${view.totalCount.toLocaleString()} Amazon txns in Monarch. ` : "";
  panel.append(text("div", `${orderCount}${total}Writes happen only when you click a button (or via your Auto match settings) — refresh Monarch to see applied changes.`, {
    padding: "8px 12px", background: "#1f2937", color: "#9ca3af", "font-size": "11px",
  }));

  host.appendChild(panel);
  clampAfterAppend(panel);
}

function el(tag: string, style: Record<string, string>): HTMLElement {
  const node = document.createElement(tag);
  node.setAttribute("style", Object.entries(style).map(([k, v]) => `${k}:${v}`).join(";"));
  return node;
}
function text(tag: string, content: string, style: Record<string, string>): HTMLElement {
  const node = el(tag, style);
  node.textContent = content;
  return node;
}
function sectionTitle(t: string): HTMLElement {
  return text("div", t, {
    padding: "8px 12px 4px", color: "#93c5fd", "font-size": "11px",
    "text-transform": "uppercase", "letter-spacing": ".04em",
  });
}
function muted(t: string): HTMLElement {
  return text("div", t, { padding: "4px 12px", color: "#9ca3af" });
}
function row(left: string, sub: string, right: string, subColor = "#9ca3af"): HTMLElement {
  const item = el("div", {
    display: "flex", "justify-content": "space-between", gap: "8px",
    padding: "6px 12px", "border-top": "1px solid #1f2937",
  });
  const l = el("div", { "min-width": "0" });
  l.append(text("div", left, { "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }));
  l.append(text("div", sub, { color: subColor, "font-size": "11px", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }));
  item.append(l);
  item.append(text("div", right, { "white-space": "nowrap", color: "#e5e7eb" }));
  return item;
}

function rank(status: string): number {
  return { auto: 0, review: 1, unmatched: 2, refund: 3 }[status] ?? 4;
}

// The licensing / kill-switch strip. Nothing when writes are freely allowed
// (unconfigured or a fully-licensed user); a subtle countdown during the trial;
// a prominent paywall/paused/update notice when writes are blocked.
function gateBanner(view: PanelView): HTMLElement | null {
  const g = view.gate;
  if (!g) return null;
  if (g.allowed && (g.reason === "ok" || g.reason === "unconfigured")) return null;

  const blocked = !g.allowed;
  const bar = el("div", {
    display: "flex", "align-items": "center", "justify-content": "space-between", gap: "8px",
    padding: "8px 12px", "font-size": "12px",
    background: blocked ? "#3f1d1d" : "#1e293b",
    color: blocked ? "#fecaca" : "#bfdbfe",
    "border-bottom": "1px solid #1f2937",
  });
  const msg = g.message || (g.reason === "trial" ? "Free trial" : "");
  bar.append(text("span", msg, { "min-width": "0", "line-height": "1.35" }));

  // CTA button, per the gate's requested action.
  const cta =
    g.cta === "trial" && view.onStartTrial
      ? { label: "Start free trial", run: () => void view.onStartTrial!() }
      : g.cta === "buy" && view.onBuy
        ? { label: "Subscribe", run: () => view.onBuy!() }
        : g.reason === "trial" && view.onBuy
          ? { label: "Subscribe", run: () => view.onBuy!() } // let a trial user upgrade early
          : null;
  if (cta) {
    const btn = el("button", {
      flex: "0 0 auto", padding: "4px 10px", cursor: "pointer", border: "none",
      "border-radius": "6px", background: "#2563eb", color: "#fff", font: "11px system-ui,sans-serif",
    }) as HTMLButtonElement;
    btn.textContent = cta.label;
    btn.addEventListener("click", cta.run);
    bar.append(btn);
  }
  return bar;
}

/** Compact relative time, e.g. "just now", "3h ago", "2d ago". */
export function ago(then: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// One Amazon-account row: active dot + label, order count + last-sync sub-line,
// and a ✕ to forget its cached orders.
function accountRow(a: AmazonAccountSummary, onForget?: (label: string) => void): HTMLElement {
  const item = el("div", {
    display: "flex", "justify-content": "space-between", "align-items": "center",
    gap: "8px", padding: "6px 12px", "border-top": "1px solid #1f2937",
  });
  const l = el("div", { "min-width": "0" });
  l.append(
    text("div", `${a.active ? "● " : "○ "}${a.label}`, {
      color: a.active ? "#a7f3d0" : "#e5e7eb",
      "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis",
    }),
  );
  const when = a.lastSync ? ` · synced ${ago(a.lastSync)}` : "";
  l.append(text("div", `${a.count} order${a.count === 1 ? "" : "s"}${when}`, { color: "#9ca3af", "font-size": "11px" }));
  item.append(l);
  if (onForget) {
    const forget = el("button", {
      background: "none", border: "1px solid #374151", color: "#9ca3af", cursor: "pointer",
      "border-radius": "6px", "font-size": "11px", padding: "2px 6px",
    }) as HTMLButtonElement;
    forget.textContent = "Forget";
    forget.title = `Forget ${a.label}'s cached orders`;
    forget.addEventListener("click", () => onForget(a.label));
    item.append(forget);
  }
  return item;
}

/** "  (+3d)" / "  (-1d)" — charges may be dated up to backDays BEFORE the
 *  order, so the sign comes from the value (a literal "+" prefix rendered
 *  "(+-1d)"). Exported for tests. */
export function fmtDayDiff(dd: number | null): string {
  if (dd === null) return "";
  return `  (${dd >= 0 ? "+" : ""}${dd}d)`;
}

// Armed-but-unused undos, keyed by charge id + action. Button state otherwise
// lives in the element's closure, and draw() rebuilds the panel from scratch
// (Sync re-render, the 8s guard) — without this registry a redraw would
// silently discard a pending undo.
const armedUndos = new Map<string, { undo: () => Promise<ApplyOutcome>; label: string }>();

/** Pre-arm a button's undo from outside (auto-apply). Same rules as a manual
 *  click: only an ok, non-refuted result that changed something arms — the
 *  next renderPanel() picks it up via the registry. */
export function armUndo(key: string, r: ApplyResult): void {
  if (!r.ok || r.verified === false || !r.undo) return;
  armedUndos.set(key, { undo: r.undo, label: `✓ ${r.note} — undo` });
}

// A click-to-apply button that runs an action, then flips to an Undo affordance.
// ONE listener + an explicit state machine. (Through v0.4.10 the undo was wired
// by assigning btn.onclick while the original addEventListener handler stayed
// attached, so clicking Undo ALSO re-ran the action: two racing writes, and
// whichever response landed last set the label — Undo looked like a no-op, and
// clicks after "Undone" silently re-applied the action.)
//
// Verification semantics: verified === false is Monarch AFFIRMING the change
// did not take effect — a refuted apply returns to idle (retry; there is
// nothing to undo), a refuted undo stays armed (retry is idempotent-safe).
// verified === null (unknown) is labeled "(unconfirmed)", never a plain ✓ path
// identical to a confirmed one.
export function actionButton(label: string, key: string, run: () => Promise<ApplyResult>): HTMLElement {
  const btn = el("button", {
    padding: "5px 10px", cursor: "pointer", border: "1px solid #374151",
    "border-radius": "6px", background: "#1f2937", color: "#e5e7eb",
    font: "11px system-ui,sans-serif",
  }) as HTMLButtonElement;
  // idle → (apply) → armed → (undo) → spent; failures return to the previous
  // state so the click can be retried. "busy" guards re-entry mid-flight.
  let state: "idle" | "busy" | "armed" | "spent" = "idle";
  let undo: (() => Promise<ApplyOutcome>) | null = null;
  const restored = armedUndos.get(key);
  if (restored) {
    state = "armed";
    undo = restored.undo;
    btn.textContent = restored.label;
  } else {
    btn.textContent = label;
  }
  const arm = (u: () => Promise<ApplyOutcome>, text: string): void => {
    state = "armed";
    undo = u;
    btn.textContent = text;
    armedUndos.set(key, { undo: u, label: text });
  };
  const disarm = (to: "idle" | "spent", text: string): void => {
    state = to;
    undo = null;
    btn.textContent = text;
    armedUndos.delete(key);
  };
  btn.addEventListener("click", async () => {
    if (state === "busy" || state === "spent") return;
    const from = state;
    state = "busy";
    btn.disabled = true;
    btn.textContent = from === "idle" ? "Working…" : "Undoing…";
    try {
      if (from === "idle") {
        const r = await run();
        if (!r.ok) {
          disarm("idle", `Failed: ${r.note} — retry`);
        } else if (r.verified === false) {
          disarm("idle", `⚠ ${r.note} — retry`); // refuted: nothing applied, nothing to undo
        } else if (r.undo) {
          arm(r.undo, `✓ ${r.note} — undo`);
        } else {
          disarm("spent", `✓ ${r.note}`);
        }
      } else {
        const u = await undo!();
        if (!u.ok) {
          arm(undo!, `Undo failed: ${u.note} — retry`); // re-arm so the warning survives a redraw
        } else if (u.verified === false) {
          arm(undo!, "⚠ Undo not applied — retry"); // refuted: the field still holds the applied value
        } else {
          disarm("spent", u.verified === null ? "Undone (unconfirmed)" : "Undone ✓");
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (from === "armed" && undo) {
        arm(undo, `Undo failed: ${msg} — retry`);
      } else {
        state = from;
        btn.textContent = `Failed: ${msg} — retry`;
      }
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}
