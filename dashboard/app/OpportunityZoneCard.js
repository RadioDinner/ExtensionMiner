"use client";

import { useState, useTransition } from "react";
import { dismissFromZone, restoreToZone } from "./actions";

// Preset reasons for dismissing an extension from the zone (user-defined set).
const REASONS = ["Too large", "Too complex", "Uninterested", "Publisher owned"];

// --- small formatters (kept local, like the other page components) ----------
function fmt(n) {
  return n == null ? "—" : Number(n).toLocaleString();
}
function stars(r) {
  return r == null ? "—" : `${Number(r).toFixed(1)}★`;
}
function fmtUSD(n) {
  if (n == null) return "—";
  const v = Number(n);
  if (!isFinite(v)) return "—";
  if (v <= 0) return "$0";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(v)}`;
}
function savedCount(row) {
  return row?.reviews?.[0]?.count ?? null;
}
function pricingCell(m) {
  if (!m || !m.pricing_model) return "—";
  const label = m.pricing_model.charAt(0).toUpperCase() + m.pricing_model.slice(1);
  const range =
    m.revenue_low_usd != null && m.revenue_high_usd != null
      ? ` · est ${fmtUSD(m.revenue_low_usd)}–${fmtUSD(m.revenue_high_usd)}/mo`
      : "";
  const title = `${m.monetization_summary || label}${range}${m.confidence ? ` (${m.confidence} confidence)` : ""}`;
  return <span className="pill" title={title}>{label}</span>;
}
function reviewLink(row) {
  if (!row.ext_id) return row.name || "—";
  return <a href={`/reviews/${encodeURIComponent(row.ext_id)}`}>{row.name || row.ext_id}</a>;
}
// Does the user pay? Derived from the monetization profile (may be absent).
function moneyStatus(m) {
  if (!m || !m.pricing_model || m.pricing_model === "unknown") return "unknown";
  if (m.has_paid_tier || ["paid", "freemium", "subscription"].includes(m.pricing_model)) return "paid";
  return "free";
}

// Every column: how to read its value (for sorting) and render its cell. One
// source of truth drives both the header and the body.
const COLUMNS = [
  { key: "name", label: "Extension", num: false, get: (r) => (r.name || r.ext_id || "").toLowerCase(), cell: (r, _money, dd) => (
      <>
        {reviewLink(r)}
        {dd && dd.has(r.ext_id) ? <span className="dd-mark" title="Deep-dive researched">🔬</span> : null}
      </>
    ) },
  { key: "category", label: "Category", num: false, get: (r) => r.store_category, cell: (r) => <span className="pill">{r.store_category || "—"}</span> },
  { key: "rating", label: "Rating", num: true, get: (r) => r.rating, cell: (r) => stars(r.rating) },
  { key: "ratings", label: "Ratings", num: true, get: (r) => r.rating_count, cell: (r) => fmt(r.rating_count) },
  { key: "saved", label: "Saved", num: true, get: (r) => savedCount(r), cell: (r) => fmt(savedCount(r)) },
  { key: "installs", label: "Installs", num: true, get: (r) => r.install_count, cell: (r) => fmt(r.install_count) },
  { key: "pricing", label: "Pricing", num: false, get: (r, money) => money[r.ext_id]?.pricing_model, cell: (r, money) => pricingCell(money[r.ext_id]) },
  { key: "revenue", label: "Est. /mo", num: true, get: (r, money) => money[r.ext_id]?.estimated_monthly_revenue_usd, cell: (r, money) => (money[r.ext_id] ? fmtUSD(money[r.ext_id].estimated_monthly_revenue_usd) : "—") },
];

const INSTALL_PRESETS = [
  { v: 0, label: "Any installs" },
  { v: 10_000, label: "10k+ installs" },
  { v: 100_000, label: "100k+ installs" },
  { v: 1_000_000, label: "1M+ installs" },
];

// Per-row "Remove from zone" control: a ✕ that opens a small reason menu. Picking
// a reason dismisses the extension (server action); the zone backfills on reload.
function RemoveControl({ extId }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState(null);

  function pick(reason) {
    setError(null);
    start(async () => {
      const res = await dismissFromZone(extId, reason);
      if (!res || !res.ok) setError((res && res.error) || "Couldn't remove.");
      else setOpen(false);
    });
  }

  return (
    <span className="zone-remove">
      <button
        className="btn-remove"
        disabled={pending}
        onClick={() => setOpen((o) => !o)}
        title="Remove from the opportunity zone"
      >
        {pending ? "…" : "✕"}
      </button>
      {open && (
        <>
          <div className="zone-remove-backdrop" onClick={() => setOpen(false)} />
          <div className="zone-remove-menu">
            <div className="zone-remove-title">Remove — reason?</div>
            {REASONS.map((r) => (
              <button key={r} className="zone-reason" disabled={pending} onClick={() => pick(r)}>{r}</button>
            ))}
            {error ? <div className="deepdive-error">{error}</div> : null}
          </div>
        </>
      )}
    </span>
  );
}

// One dismissed extension, with its reason + a Restore button.
function DismissedRow({ d }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState(null);
  function restore() {
    setError(null);
    start(async () => {
      const res = await restoreToZone(d.ext_id);
      if (!res || !res.ok) setError((res && res.error) || "Couldn't restore.");
    });
  }
  return (
    <li>
      <a href={`/reviews/${encodeURIComponent(d.ext_id)}`}>{d.name || d.ext_id}</a>
      {d.reason ? <span className="pill">{d.reason}</span> : null}
      <span className="dismissed-meta">{stars(d.rating)} · {fmt(d.install_count)} installs</span>
      <button className="btn-link" disabled={pending} onClick={restore}>{pending ? "…" : "restore"}</button>
      {error ? <span className="deepdive-error">{error}</span> : null}
    </li>
  );
}

// Collapsible list of dismissed extensions (with reasons) + restore.
function DismissedSection({ dismissed }) {
  const [show, setShow] = useState(false);
  if (!dismissed || dismissed.length === 0) return null;
  return (
    <div className="zone-dismissed">
      <button className="btn-link" onClick={() => setShow((s) => !s)}>
        {show ? "Hide" : "Show"} dismissed from zone ({dismissed.length})
      </button>
      {show && (
        <ul className="dismissed-list">
          {dismissed.map((d) => <DismissedRow key={d.ext_id} d={d} />)}
        </ul>
      )}
    </div>
  );
}

// Interactive "Opportunity zone" table: click any column header to sort (click
// again to flip direction), plus filters. All client-side over the rows the
// server already fetched — no new query.
export default function OpportunityZoneCard({ rows, monetization, deepDived, dismissed }) {
  const [sortKey, setSortKey] = useState("installs"); // matches the old default
  const [dir, setDir] = useState("desc");
  const [minInstalls, setMinInstalls] = useState(0);
  const [band, setBand] = useState("all");
  const [pricing, setPricing] = useState("all");
  const [savedOnly, setSavedOnly] = useState(false);
  const [category, setCategory] = useState("all");

  const safeRows = rows || [];
  // Show nothing only when there's truly nothing — but still surface the
  // dismissed list (so the user can restore) even if every row is dismissed.
  if (safeRows.length === 0) {
    return (
      <>
        <p className="empty">No data yet.</p>
        <DismissedSection dismissed={dismissed} />
      </>
    );
  }

  const money = monetization || {};
  const dd = new Set(deepDived || []);
  const categories = Array.from(new Set(safeRows.map((r) => r.store_category).filter(Boolean))).sort();

  function onSort(col) {
    if (col.key === sortKey) {
      setDir(dir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(col.key);
      setDir(col.num ? "desc" : "asc"); // numbers default high→low, text A→Z
    }
  }

  const filtered = safeRows.filter((r) => {
    if (minInstalls && !(Number(r.install_count) >= minInstalls)) return false;
    if (band === "lower" && !(r.rating != null && r.rating < 3.0)) return false;
    if (band === "upper" && !(r.rating != null && r.rating >= 3.0)) return false;
    if (savedOnly && !(savedCount(r) > 0)) return false;
    if (category !== "all" && r.store_category !== category) return false;
    if (pricing !== "all") {
      const s = moneyStatus(money[r.ext_id]);
      if (pricing === "paid" && s !== "paid") return false;
      if (pricing === "unpaid" && s !== "free") return false;
      if (pricing === "unknown" && s !== "unknown") return false;
    }
    return true;
  });

  const col = COLUMNS.find((c) => c.key === sortKey) || COLUMNS[0];
  const sorted = [...filtered].sort((a, b) => {
    const va = col.get(a, money);
    const vb = col.get(b, money);
    if (va == null && vb == null) return 0;
    if (va == null) return 1; // nulls always last, regardless of direction
    if (vb == null) return -1;
    const base = col.num ? Number(va) - Number(vb) : String(va).localeCompare(String(vb));
    return dir === "asc" ? base : -base;
  });

  return (
    <>
      <div className="filters">
        <label>
          Installs{" "}
          <select value={minInstalls} onChange={(e) => setMinInstalls(Number(e.target.value))}>
            {INSTALL_PRESETS.map((p) => (
              <option key={p.v} value={p.v}>{p.label}</option>
            ))}
          </select>
        </label>
        <label>
          Rating{" "}
          <select value={band} onChange={(e) => setBand(e.target.value)}>
            <option value="all">Whole zone</option>
            <option value="lower">2.5–3.0★</option>
            <option value="upper">3.0–3.5★</option>
          </select>
        </label>
        <label>
          Pricing{" "}
          <select value={pricing} onChange={(e) => setPricing(e.target.value)}>
            <option value="all">All</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Free / ad-supported</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label>
          Category{" "}
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label title="Only extensions we've saved reviews for">
          <input type="checkbox" checked={savedOnly} onChange={(e) => setSavedOnly(e.target.checked)} />
          {" "}Has saved reviews
        </label>
        <span className="filter-count">{sorted.length} of {safeRows.length}</span>
      </div>

      {sorted.length === 0 ? (
        <p className="empty">No extensions match this filter.</p>
      ) : (
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={`sortable${c.num ? " num" : ""}`}
                  onClick={() => onSort(c)}
                  title="Click to sort (click again to flip)"
                >
                  {c.label}
                  {sortKey === c.key ? <span className="sort-ind">{dir === "asc" ? " ▲" : " ▼"}</span> : null}
                </th>
              ))}
              <th title="Remove from the zone"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.ext_id}>
                {COLUMNS.map((c) => (
                  <td key={c.key} className={c.num ? "num" : undefined}>{c.cell(r, money, dd)}</td>
                ))}
                <td className="zone-actions"><RemoveControl extId={r.ext_id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DismissedSection dismissed={dismissed} />
    </>
  );
}
