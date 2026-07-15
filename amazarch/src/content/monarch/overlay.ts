// The Amazarch panel injected into the Monarch web app (SPEC.md D4). M1 shows
// the Amazon transactions found in Monarch; later milestones add proposed
// matches and the review queue here.
import browser from "webextension-polyfill";
import { formatCents } from "../../shared/money";
import type { AmazonTxn } from "../../shared/monarch-read";

const PANEL_ID = "amazarch-panel";

// Keep the last render so we can re-assert the panel if Monarch's SPA wipes it
// on a route change (React can replace document.body's subtree).
let lastRender: { rows: AmazonTxn[]; totalCount: number | null; capped: boolean } | null = null;
let guardStarted = false;

export function renderPanel(rows: AmazonTxn[], totalCount: number | null, capped: boolean): void {
  lastRender = { rows, totalCount, capped };
  draw(rows, totalCount, capped);
  if (!guardStarted) {
    guardStarted = true;
    // Cheap, robust re-assert if the SPA removes our node.
    setInterval(() => {
      if (lastRender && !document.getElementById(PANEL_ID) && document.body) {
        draw(lastRender.rows, lastRender.totalCount, lastRender.capped);
      }
    }, 2000);
  }
}

function draw(rows: AmazonTxn[], totalCount: number | null, capped: boolean): void {
  if (!document.body) return;
  document.getElementById(PANEL_ID)?.remove();

  const version = browser.runtime.getManifest().version;
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.setAttribute(
    "style",
    [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483647",
      "width:320px",
      "max-height:60vh",
      "display:flex",
      "flex-direction:column",
      "background:#111827",
      "color:#f9fafb",
      "border-radius:12px",
      "box-shadow:0 8px 30px rgba(0,0,0,.35)",
      "font:13px/1.45 system-ui,sans-serif",
      "overflow:hidden",
    ].join(";"),
  );

  const header = document.createElement("div");
  header.setAttribute(
    "style",
    "display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#1f2937;",
  );
  const title = document.createElement("strong");
  title.textContent = `Amazarch v${version} — ${rows.length} Amazon charge${rows.length === 1 ? "" : "s"} in Monarch`;
  const close = document.createElement("button");
  close.textContent = "✕";
  close.setAttribute(
    "style",
    "background:none;border:none;color:#9ca3af;cursor:pointer;font-size:14px;padding:2px 4px;",
  );
  close.addEventListener("click", () => panel.remove());
  header.append(title, close);

  const list = document.createElement("div");
  list.setAttribute("style", "overflow-y:auto;padding:4px 0;");
  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.setAttribute("style", "padding:12px;color:#9ca3af;");
    empty.textContent = "No Amazon transactions found.";
    list.appendChild(empty);
  } else {
    for (const row of rows) {
      const item = document.createElement("div");
      item.setAttribute(
        "style",
        "display:flex;justify-content:space-between;gap:8px;padding:6px 12px;border-top:1px solid #1f2937;",
      );
      const left = document.createElement("div");
      left.setAttribute("style", "min-width:0;");
      const merchant = document.createElement("div");
      merchant.textContent = row.merchantName;
      merchant.setAttribute("style", "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;");
      const date = document.createElement("div");
      date.textContent = row.date;
      date.setAttribute("style", "color:#9ca3af;font-size:11px;");
      left.append(merchant, date);
      const amount = document.createElement("div");
      amount.textContent = formatCents(row.amountCents);
      amount.setAttribute("style", "white-space:nowrap;color:#a7f3d0;");
      item.append(left, amount);
      list.appendChild(item);
    }
  }

  const footer = document.createElement("div");
  footer.setAttribute("style", "padding:8px 12px;background:#1f2937;color:#9ca3af;font-size:11px;");
  const total = totalCount !== null ? `${totalCount.toLocaleString()} total txns in Monarch. ` : "";
  const cap = capped ? "Showing a capped subset. " : "";
  footer.textContent = `${total}${cap}These are your Monarch bank charges. Next: fetch Amazon orders and match them here.`;

  panel.append(header, list, footer);
  document.body.appendChild(panel);
}
