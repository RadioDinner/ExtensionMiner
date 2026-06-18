// Dependency-free, server-rendered inline-SVG charts.
// These are plain functions (server components) — no client JS, no chart lib,
// so the build stays lean and renders instantly at request time.

// Theme colors mirrored from globals.css. (CSS var() does not resolve inside
// SVG presentation attributes, so we use the hex values directly here.)
const ACCENT = "#5b8cff";
const GOLD = "#f6c453";
const MUTED = "#97a0b3";
const LINE = "#232b3a";

function fmtCompact(n) {
  if (n == null) return "—";
  const v = Number(n);
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + "k";
  return String(Math.round(v));
}

// ----------------------------------------------------------------------------
// Rating distribution — half-star buckets, opportunity-zone bars highlighted.
// ----------------------------------------------------------------------------
const BUCKETS = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5];

function bucketIndex(r) {
  return Math.max(0, Math.min(7, Math.floor((Number(r) - 1.0) / 0.5)));
}

export function RatingHistogram({ points }) {
  const rated = (points || []).filter((p) => p.rating != null);
  if (rated.length === 0) return <p className="empty">No rating data yet.</p>;

  const counts = new Array(8).fill(0);
  for (const p of rated) counts[bucketIndex(p.rating)]++;
  const maxCount = Math.max(...counts, 1);

  const W = 480, H = 240;
  const padL = 28, padR = 10, padT = 18, padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const slot = plotW / 8;
  const barW = slot * 0.66;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Rating distribution histogram">
      <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke={LINE} />
      {counts.map((c, i) => {
        const zone = i === 3 || i === 4; // [2.5,3.0) and [3.0,3.5)
        const h = (c / maxCount) * plotH;
        const x = padL + i * slot + (slot - barW) / 2;
        const y = padT + plotH - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={h} rx={3} fill={zone ? GOLD : ACCENT} opacity={zone ? 0.95 : 0.75}>
              <title>{`${BUCKETS[i].toFixed(1)}–${(BUCKETS[i] + 0.5).toFixed(1)}★: ${c}`}</title>
            </rect>
            {c > 0 && (
              <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize="10" fill={MUTED}>{c}</text>
            )}
            <text x={x + barW / 2} y={padT + plotH + 14} textAnchor="middle" fontSize="10" fill={MUTED}>{BUCKETS[i].toFixed(1)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ----------------------------------------------------------------------------
// Rating vs. installs is now an interactive client component — see
// OpportunityScatter.js (clickable points + an expandable, detailed view).
// ----------------------------------------------------------------------------
