// The Amazarch panel injected into the Monarch web app (SPEC.md D4). It shows
// the Amazon charges found in Monarch and — once fetched — the parsed Amazon
// orders, so parsing can be validated before matching is layered on.
import browser from "webextension-polyfill";
import { formatCents } from "../../shared/money";
import type { AmazonTxn } from "../../shared/monarch-read";
import type { AmazonOrderLite } from "../../shared/messages";
import { summarize, type MatchResult } from "../../shared/matcher";

const PANEL_ID = "amazarch-panel";

export interface PanelView {
  txns: AmazonTxn[];
  totalCount: number | null;
  capped: boolean;
  orders?: AmazonOrderLite[];
  amazonNote?: string;
  matches?: MatchResult[];
  diagnostic?: Record<string, number | string>;
  sample?: string;
  report?: string;
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
  draw(view);
  if (!guardStarted) {
    guardStarted = true;
    // Re-assert if Monarch's SPA removes our node on a route change.
    setInterval(() => {
      if (lastView && !document.getElementById(PANEL_ID) && document.body) draw(lastView);
    }, 2000);
  }
}

function draw(view: PanelView): void {
  if (!document.body) return;
  document.getElementById(PANEL_ID)?.remove();

  const version = browser.runtime.getManifest().version;
  const panel = el("div", {
    position: "fixed", right: "16px", bottom: "16px", "z-index": "2147483647",
    width: "340px", "max-height": "70vh", display: "flex", "flex-direction": "column",
    background: "#111827", color: "#f9fafb", "border-radius": "12px",
    "box-shadow": "0 8px 30px rgba(0,0,0,.35)", font: "13px/1.45 system-ui,sans-serif",
    overflow: "hidden",
  });
  panel.id = PANEL_ID;

  // Header
  const header = el("div", {
    display: "flex", "align-items": "center", "justify-content": "space-between",
    padding: "10px 12px", background: "#1f2937",
  });
  header.append(text("strong", `Amazarch v${version}`, {}));
  const close = el("button", {
    background: "none", border: "none", color: "#9ca3af", cursor: "pointer",
    "font-size": "14px", padding: "2px 4px",
  });
  close.textContent = "✕";
  close.addEventListener("click", () => panel.remove());
  header.append(close);
  panel.append(header);

  const body = el("div", { overflow: "auto" });

  // Section: proposed matches (the headline). Falls back to raw charge list
  // until Amazon orders have been read.
  if (view.matches) {
    const s = summarize(view.matches);
    body.append(sectionTitle("Proposed matches"));
    body.append(
      muted(`${s.auto} matched · ${s.review} review · ${s.unmatched} no order · ${s.refund} refunds`),
    );
    // Show matched/review first, then the rest.
    const ordered = [...view.matches].sort((a, b) => rank(a.status) - rank(b.status));
    for (const m of ordered.slice(0, 60)) {
      const meta = STATUS_META[m.status] ?? STATUS_META.unmatched!;
      const sub = m.order
        ? `${meta.icon} ${m.order.date} · ${m.order.itemTitles[0] ?? (m.order.orderId || "order")}${m.dayDiff !== null ? `  (+${m.dayDiff}d)` : ""}`
        : `${meta.icon} ${m.status === "refund" ? "refund — matched later" : "no matching order"}`;
      body.append(row(m.charge.merchantName, sub, formatCents(m.charge.amountCents), meta.color));
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

  panel.append(body);

  // Footer
  const orderCount = view.orders ? `${view.orders.length} Amazon orders read. ` : "";
  const total = view.totalCount !== null ? `${view.totalCount.toLocaleString()} Amazon txns in Monarch. ` : "";
  panel.append(text("div", `${orderCount}${total}Preview only — nothing written to Monarch yet.`, {
    padding: "8px 12px", background: "#1f2937", color: "#9ca3af", "font-size": "11px",
  }));

  document.body.appendChild(panel);
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
