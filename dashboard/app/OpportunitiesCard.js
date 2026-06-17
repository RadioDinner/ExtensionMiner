"use client";

import { useState } from "react";

// Complaint types come from the ranking schema (opportunities.complaint_type).
const COMPLAINT_TYPES = ["all", "bug", "missing_feature", "pricing", "abandonment", "other"];
const SORTS = {
  "score-desc": { label: "Score (high → low)", cmp: (a, b) => (b.score ?? -1) - (a.score ?? -1) },
  "score-asc": { label: "Score (low → high)", cmp: (a, b) => (a.score ?? -1) - (b.score ?? -1) },
};

// Does the user pay? Derived from the monetization profile (may be absent).
function moneyStatus(m) {
  if (!m || !m.pricing_model || m.pricing_model === "unknown") return "unknown";
  if (m.has_paid_tier || ["paid", "freemium", "subscription"].includes(m.pricing_model)) return "paid";
  return "free"; // free or ad-supported — the user doesn't pay
}

function reviewLinkFor(extId, label) {
  if (!extId) return label || "—";
  return <a href={`/reviews/${encodeURIComponent(extId)}`}>{label || extId}</a>;
}

// Interactive "Scored opportunities" card: filter by complaint type + paid/unpaid,
// sort by score. All client-side over the rows the server already fetched.
export default function OpportunitiesCard({ rows, monetization }) {
  const [type, setType] = useState("all");
  const [pricing, setPricing] = useState("all");
  const [sort, setSort] = useState("score-desc");

  if (!rows || rows.length === 0) {
    return <p className="empty">No scored opportunities yet — run the Claude ranking layer after scraping.</p>;
  }

  const money = monetization || {};
  const filtered = rows
    .filter((r) => {
      if (type !== "all" && r.complaint_type !== type) return false;
      if (pricing !== "all") {
        const s = moneyStatus(money[r.extensions?.ext_id]);
        if (pricing === "paid" && s !== "paid") return false;
        if (pricing === "unpaid" && s !== "free") return false;
        if (pricing === "unknown" && s !== "unknown") return false;
      }
      return true;
    })
    .sort(SORTS[sort].cmp);

  return (
    <>
      <div className="filters">
        <label>
          Type{" "}
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {COMPLAINT_TYPES.map((t) => (
              <option key={t} value={t}>{t === "all" ? "All types" : t}</option>
            ))}
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
          Sort{" "}
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {Object.entries(SORTS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </label>
        <span className="filter-count">{filtered.length} of {rows.length}</span>
      </div>

      {filtered.length === 0 ? (
        <p className="empty">No opportunities match this filter.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="num">Score</th>
              <th>Extension</th>
              <th>Top fixable complaint</th>
              <th>Type</th>
              <th>Fixable</th>
              <th>Pricing</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const m = money[r.extensions?.ext_id];
              return (
                <tr key={i}>
                  <td className="num">{r.score == null ? "—" : Number(r.score).toFixed(1)}</td>
                  <td>{reviewLinkFor(r.extensions?.ext_id, r.extensions?.name)}</td>
                  <td>{r.top_complaint || "—"}</td>
                  <td><span className="pill">{r.complaint_type || "—"}</span></td>
                  <td>{r.fixable || "—"}</td>
                  <td>{m && m.pricing_model ? <span className="pill" title={m.monetization_summary || ""}>{m.pricing_model}</span> : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
