"use client";

import { useState } from "react";

// One sortable review list, reused everywhere reviews are shown. The server
// can't hand a client component a render function, so this owns both layouts
// via `variant`: "saved" (the per-extension page) and "helpful" (the home
// community-upvoted list).

function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

function StarRow({ n }) {
  const filled = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return (
    <span className="stars" title={`${n ?? "?"} of 5`}>
      {"★".repeat(filled)}
      <span className="off">{"★".repeat(5 - filled)}</span>
    </span>
  );
}

function reviewLinkFor(extId, label) {
  if (!extId) return label || "—";
  return <a href={`/reviews/${encodeURIComponent(extId)}`}>{label || extId}</a>;
}

// Comparators that always push missing values to the bottom, whatever the dir.
function cmpBy(getVal, dir) {
  return (a, b) => {
    const va = getVal(a);
    const vb = getVal(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return dir * (va - vb);
  };
}
const getDate = (r) => {
  const t = Date.parse(r.reviewed_at);
  return isNaN(t) ? null : t;
};
const getStars = (r) => (r.stars == null ? null : Number(r.stars));

const SORTS = {
  "date-desc": { label: "Newest first", cmp: cmpBy(getDate, -1) },
  "date-asc": { label: "Oldest first", cmp: cmpBy(getDate, 1) },
  "rating-desc": { label: "Highest rating", cmp: cmpBy(getStars, -1) },
  "rating-asc": { label: "Lowest rating", cmp: cmpBy(getStars, 1) },
};

export default function ReviewList({ rows, variant = "saved", defaultSort = "date-desc" }) {
  const [sort, setSort] = useState(SORTS[defaultSort] ? defaultSort : "date-desc");
  if (!rows || rows.length === 0) return null;

  const sorted = [...rows].sort(SORTS[sort].cmp);

  return (
    <>
      <div className="filters">
        <label>
          Sort{" "}
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {Object.entries(SORTS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </label>
        <span className="filter-count">{rows.length} review{rows.length === 1 ? "" : "s"}</span>
      </div>

      <ul className="reviews">
        {sorted.map((rv, i) => (
          <li key={i} className="review">
            <div className="review-head">
              <StarRow n={rv.stars} />
              <span className="author">{rv.author || "Anonymous"}</span>
              {variant === "helpful" ? (
                <>
                  <span className="badge-helpful">👍 Helpful</span>
                  <span className="ext-ref">
                    {reviewLinkFor(rv.extensions?.ext_id, rv.extensions?.name)}
                    {rv.extensions?.store_category ? <span className="pill">{rv.extensions.store_category}</span> : null}
                  </span>
                </>
              ) : (
                rv.helpful_ranked ? <span className="badge-helpful">👍 Helpful</span> : null
              )}
              <span className="date">{fmtDate(rv.reviewed_at)}</span>
              {variant !== "helpful" && rv.helpful_count ? (
                <span className="helpful">{Number(rv.helpful_count).toLocaleString()} found helpful</span>
              ) : null}
            </div>
            <p className="review-body">
              {rv.body ? rv.body : <em className="muted">(no review text)</em>}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
