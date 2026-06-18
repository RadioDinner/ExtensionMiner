"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// Theme colors mirror globals.css (CSS vars don't resolve in SVG attributes).
const ACCENT = "#5b8cff";
const GOLD = "#f6c453";
const MUTED = "#97a0b3";
const LINE = "#232b3a";
const BG = "#0b0e14";

// The opportunity sweet spot — kept in sync with lib/queries.js.
const ZONE_MIN = 2.5;
const ZONE_MAX = 3.5;

function fmtCompact(n) {
  if (n == null) return "—";
  const v = Number(n);
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + "k";
  return String(Math.round(v));
}

function reviewHref(extId) {
  return `/reviews/${encodeURIComponent(extId)}`;
}

// Group near-coincident points into one clickable circle. Points that land on
// (almost) the same spot — same rating + similar install magnitude — collapse to
// a single circle that "represents the group", so clicking it can surface them
// all instead of fighting overplotted dots.
function buildClusters(pts, x, y, cell) {
  const map = new Map();
  for (const p of pts) {
    const cx = x(p.rating);
    const cy = y(p.install_count);
    const key = `${Math.round(cx / cell)}:${Math.round(cy / cell)}`;
    let c = map.get(key);
    if (!c) {
      c = { items: [], sx: 0, sy: 0, totalRC: 0 };
      map.set(key, c);
    }
    c.items.push({ ...p, _cx: cx, _cy: cy });
    c.sx += cx;
    c.sy += cy;
    c.totalRC += Number(p.rating_count) || 0;
  }
  const clusters = [];
  for (const c of map.values()) {
    const n = c.items.length;
    const cx = c.sx / n;
    const cy = c.sy / n;
    // Sort the members so the most-reviewed sits first in the popover list.
    c.items.sort((a, b) => (Number(b.rating_count) || 0) - (Number(a.rating_count) || 0));
    const rep = c.items[0];
    const inZone = Number(rep.rating) >= ZONE_MIN && Number(rep.rating) <= ZONE_MAX;
    clusters.push({ cx, cy, items: c.items, totalRC: c.totalRC, inZone, rep });
  }
  return clusters;
}

// One SVG scatter (used at two sizes). Self-contained: it owns the popover that
// opens when you click a circle holding more than one extension; a single-
// extension circle navigates straight to that extension's page.
function Scatter({ points, width, height, big }) {
  const router = useRouter();
  const [selected, setSelected] = useState(null); // a cluster, or null

  const pts = useMemo(
    () =>
      (points || []).filter(
        (p) => p.rating != null && p.install_count != null && Number(p.install_count) > 0
      ),
    [points]
  );

  const padL = 46, padR = 14, padT = 16, padB = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const model = useMemo(() => {
    if (pts.length === 0) return null;
    const installs = pts.map((p) => Number(p.install_count));
    const loL = Math.log10(Math.min(...installs));
    const hiL = Math.log10(Math.max(...installs));
    const span = hiL - loL || 1;
    const x = (r) => padL + ((Math.max(1, Math.min(5, Number(r))) - 1) / 4) * plotW;
    const y = (v) => padT + plotH - ((Math.log10(Number(v)) - loL) / span) * plotH;
    const cell = big ? 7 : 8; // svg units; how close counts as "the same spot"
    const clusters = buildClusters(pts, x, y, cell);
    const maxRC = Math.max(...clusters.map((c) => c.totalRC), 1);
    const rScale = big ? 9 : 5;
    const radius = (rc) => 2.5 + Math.sqrt((Number(rc) || 0) / maxRC) * rScale;
    const yTicks = [loL, (loL + hiL) / 2, hiL].map((l) => Math.pow(10, l));
    // Label the biggest clusters when expanded (room to read them).
    const labeled = big
      ? new Set([...clusters].sort((a, b) => b.totalRC - a.totalRC).slice(0, 12))
      : new Set();
    return { x, y, clusters, radius, yTicks, labeled };
  }, [pts, plotW, plotH, big]);

  if (pts.length === 0) {
    return <p className="empty">No install data yet — the scatter fills in as extensions are scraped.</p>;
  }

  const { x, y, clusters, radius, yTicks, labeled } = model;
  const xTicks = [1, 2, 3, 4, 5];

  function onPick(c) {
    if (c.items.length === 1) {
      const id = c.items[0].ext_id;
      if (id) router.push(reviewHref(id));
    } else {
      setSelected((cur) => (cur === c ? null : c));
    }
  }

  // Draw zone clusters last so they sit on top.
  const ordered = [...clusters].sort((a, b) => (a.inZone ? 1 : 0) - (b.inZone ? 1 : 0));

  return (
    <div className="scatter-wrap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "auto" }}
        role="img"
        aria-label="Rating versus installs scatter plot (click a point to open its extension)"
      >
        {/* opportunity zone band */}
        <rect x={x(ZONE_MIN)} y={padT} width={x(ZONE_MAX) - x(ZONE_MIN)} height={plotH} fill={GOLD} opacity={0.08} />
        <text x={(x(ZONE_MIN) + x(ZONE_MAX)) / 2} y={padT + 11} textAnchor="middle" fontSize="9" fill={GOLD} opacity={0.9}>zone</text>

        {/* axes */}
        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke={LINE} />
        <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke={LINE} />

        {/* y gridlines + labels (installs, log) */}
        {yTicks.map((v, i) => {
          const yy = y(v);
          return (
            <g key={`y${i}`}>
              <line x1={padL} y1={yy} x2={padL + plotW} y2={yy} stroke={LINE} opacity={0.4} />
              <text x={padL - 6} y={yy + 3} textAnchor="end" fontSize="9" fill={MUTED}>{fmtCompact(v)}</text>
            </g>
          );
        })}

        {/* x labels (rating) */}
        {xTicks.map((r) => (
          <text key={`x${r}`} x={x(r)} y={padT + plotH + 14} textAnchor="middle" fontSize="9" fill={MUTED}>{`${r}★`}</text>
        ))}

        {/* clustered points */}
        {ordered.map((c, i) => {
          const multi = c.items.length > 1;
          const rr = radius(c.totalRC) + (multi ? 1 : 0);
          const title = multi
            ? `${c.items.length} extensions near ${Number(c.rep.rating).toFixed(1)}★, ${fmtCompact(c.rep.install_count)} installs — click to list`
            : `${c.rep.name || c.rep.ext_id} — ${Number(c.rep.rating).toFixed(1)}★, ${fmtCompact(c.rep.install_count)} installs${c.rep.rating_count ? `, ${fmtCompact(c.rep.rating_count)} ratings` : ""}`;
          return (
            <g key={i} className="scatter-pt" onClick={() => onPick(c)} style={{ cursor: "pointer" }}>
              <circle
                cx={c.cx}
                cy={c.cy}
                r={rr}
                fill={c.inZone ? GOLD : ACCENT}
                opacity={c.inZone ? 0.85 : 0.5}
                stroke={multi ? "#fff" : c.inZone ? BG : "none"}
                strokeWidth={multi ? 0.9 : c.inZone ? 0.6 : 0}
              >
                <title>{title}</title>
              </circle>
              {multi && (
                <text x={c.cx} y={c.cy + 3} textAnchor="middle" fontSize={big ? 9 : 7} fill={BG} fontWeight="700" pointerEvents="none">
                  {c.items.length}
                </text>
              )}
              {labeled.has(c) && !multi && (
                <text x={c.cx + rr + 3} y={c.cy + 3} fontSize="9" fill={MUTED} pointerEvents="none">
                  {(c.rep.name || "").slice(0, 22)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {selected && (
        <>
          <div className="scatter-backdrop" onClick={() => setSelected(null)} />
          <div
            className="scatter-pop"
            style={{ left: `${(selected.cx / width) * 100}%`, top: `${(selected.cy / height) * 100}%` }}
          >
            <div className="scatter-pop-head">
              <strong>{selected.items.length} extensions here</strong>
              <button className="btn-link" onClick={() => setSelected(null)}>close</button>
            </div>
            <ul className="scatter-pop-list">
              {selected.items.slice(0, 12).map((p) => (
                <li key={p.ext_id}>
                  <a href={reviewHref(p.ext_id)}>{p.name || p.ext_id}</a>
                  <span className="scatter-pop-meta">
                    {Number(p.rating).toFixed(1)}★ · {fmtCompact(p.install_count)}
                  </span>
                </li>
              ))}
              {selected.items.length > 12 && (
                <li className="scatter-pop-more">+{selected.items.length - 12} more</li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

// The card: a normal-size scatter inline, with an Expand button that opens a
// large, more-detailed view in a modal (click points there too). Replaces the
// old server-rendered OpportunityScatter so it can be interactive.
export default function ScatterCard({ points }) {
  const [expanded, setExpanded] = useState(false);

  // Close the modal on Escape.
  useEffect(() => {
    if (!expanded) return;
    function onKey(e) {
      if (e.key === "Escape") setExpanded(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  return (
    <div className="card scatter-card">
      <div className="card-head">
        <div>
          <h3>Rating vs. installs</h3>
          <p className="sub">Demand (installs, log) against satisfaction (rating). Gold dots in the shaded band are the targets. Click a dot to open it; a numbered dot lists the extensions stacked there.</p>
        </div>
        <button className="btn-expand" onClick={() => setExpanded(true)} title="Expand for a larger, more detailed view">⤢ Expand</button>
      </div>
      <div className="chart"><Scatter points={points} width={480} height={300} big={false} /></div>

      {expanded && (
        <div className="scatter-modal-backdrop" onClick={() => setExpanded(false)}>
          <div className="scatter-modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-head">
              <h3>Rating vs. installs — expanded</h3>
              <button className="btn-expand" onClick={() => setExpanded(false)} title="Close (Esc)">✕ Close</button>
            </div>
            <Scatter points={points} width={760} height={520} big={true} />
          </div>
        </div>
      )}
    </div>
  );
}
