// Dependency-free, server-rendered inline-SVG charts.
// These are plain functions (server components) — no client JS, no chart lib,
// so the build stays lean and renders instantly at request time.

// Theme colors mirrored from globals.css. (CSS var() does not resolve inside
// SVG presentation attributes, so we use the hex values directly here.)
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
// Rating vs. installs scatter — the strategy chart. x = rating, y = installs
// (log scale), the 2.5–3.5★ opportunity zone shaded, dots sized by # ratings.
// ----------------------------------------------------------------------------
export function OpportunityScatter({ points }) {
  const pts = (points || []).filter(
    (p) => p.rating != null && p.install_count != null && Number(p.install_count) > 0
  );
  if (pts.length === 0) {
    return <p className="empty">No install data yet — the scatter fills in as extensions are scraped.</p>;
  }

  const W = 480, H = 280;
  const padL = 46, padR = 14, padT = 16, padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const installs = pts.map((p) => Number(p.install_count));
  const loL = Math.log10(Math.min(...installs));
  const hiL = Math.log10(Math.max(...installs));
  const span = hiL - loL || 1;

  const x = (r) => padL + ((Math.max(1, Math.min(5, Number(r))) - 1) / 4) * plotW;
  const y = (v) => padT + plotH - ((Math.log10(Number(v)) - loL) / span) * plotH;

  const maxRC = Math.max(...pts.map((p) => Number(p.rating_count) || 0), 1);
  const radius = (rc) => 2.5 + Math.sqrt((Number(rc) || 0) / maxRC) * 5;

  const yTicks = [loL, (loL + hiL) / 2, hiL].map((l) => Math.pow(10, l));
  const xTicks = [1, 2, 3, 4, 5];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Rating versus installs scatter plot">
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

      {/* points (zone dots drawn last so they sit on top) */}
      {pts
        .slice()
        .sort((a, b) => {
          const az = Number(a.rating) >= ZONE_MIN && Number(a.rating) <= ZONE_MAX ? 1 : 0;
          const bz = Number(b.rating) >= ZONE_MIN && Number(b.rating) <= ZONE_MAX ? 1 : 0;
          return az - bz;
        })
        .map((p, i) => {
          const inZone = Number(p.rating) >= ZONE_MIN && Number(p.rating) <= ZONE_MAX;
          return (
            <circle
              key={i}
              cx={x(p.rating)}
              cy={y(p.install_count)}
              r={radius(p.rating_count)}
              fill={inZone ? GOLD : ACCENT}
              opacity={inZone ? 0.85 : 0.5}
              stroke={inZone ? BG : "none"}
              strokeWidth={inZone ? 0.6 : 0}
            >
              <title>{`${p.name || p.ext_id} — ${Number(p.rating).toFixed(1)}★, ${fmtCompact(p.install_count)} installs${p.rating_count ? `, ${fmtCompact(p.rating_count)} ratings` : ""}`}</title>
            </circle>
          );
        })}
    </svg>
  );
}
