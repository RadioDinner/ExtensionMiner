"use client";

import { useState } from "react";

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
  { key: "name", label: "Extension", num: false, get: (r) => (r.name || r.ext_id || "").toLowerCase(), cell: (r) => reviewLink(r) },
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

// Interactive "Opportunity zone" table: click any column header to sort (click
// again to flip direction), plus filters. All client-side over the rows the
// server already fetched — no new query.
export default function OpportunityZoneCard({ rows, monetization }) {
  const [sortKey, setSortKey] = useState("installs"); // matches the old default
  const [dir, setDir] = useState("desc");
  const [minInstalls, setMinInstalls] = useState(0);
  const [band, setBand] = useState("all");
  const [pricing, setPricing] = useState("all");
  const [savedOnly, setSavedOnly] = useState(false);
  const [category, setCategory] = useState("all");

  if (!rows || rows.length === 0) return <p className="empty">No data yet.</p>;

  const money = monetization || {};
  const categories = Array.from(new Set(rows.map((r) => r.store_category).filter(Boolean))).sort();

  function onSort(col) {
    if (col.key === sortKey) {
      setDir(dir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(col.key);
      setDir(col.num ? "desc" : "asc"); // numbers default high→low, text A→Z
    }
  }

  const filtered = rows.filter((r) => {
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
        <span className="filter-count">{sorted.length} of {rows.length}</span>
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
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.ext_id}>
                {COLUMNS.map((c) => (
                  <td key={c.key} className={c.num ? "num" : undefined}>{c.cell(r, money)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
