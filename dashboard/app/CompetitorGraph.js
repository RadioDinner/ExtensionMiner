"use client";

import { useEffect, useRef, useState } from "react";

// An Obsidian-style force-directed graph: the extension at the center, its
// competitors as linked nodes around it. Nodes are draggable; clicking a
// competitor opens its page in a new tab. Competitor data comes from the
// deep-dive pool (deep_dives.competitors: {name, url, pricing, ...}).

const W = 720;
const H = 460;
const CX = W / 2;
const CY = H / 2;
const L = Math.min(W, H) * 0.32; // desired link length (center → competitor)
const K_SPRING = 0.04; // pull toward the link length
const K_REPEL = 6000; // node-node repulsion
const DAMP = 0.82; // velocity damping
const MAX_TICKS = 320; // settle, then stop animating

function truncate(s, n) {
  s = s || "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// One physics tick. The node being dragged is held fixed.
function simulate(nodes, dragging) {
  const n = nodes.map((p) => ({ ...p }));
  for (let i = 0; i < n.length; i++) {
    if (i === dragging) {
      n[i].vx = 0;
      n[i].vy = 0;
      continue;
    }
    let fx = 0;
    let fy = 0;
    const dx = n[i].x - CX;
    const dy = n[i].y - CY;
    const d = Math.hypot(dx, dy) || 0.01;
    const spring = -K_SPRING * (d - L);
    fx += (dx / d) * spring;
    fy += (dy / d) * spring;
    for (let j = 0; j < n.length; j++) {
      if (i === j) continue;
      const rx = n[i].x - n[j].x;
      const ry = n[i].y - n[j].y;
      const rd2 = rx * rx + ry * ry || 0.01;
      const rd = Math.sqrt(rd2);
      const rep = K_REPEL / rd2;
      fx += (rx / rd) * rep;
      fy += (ry / rd) * rep;
    }
    n[i].vx = (n[i].vx + fx) * DAMP;
    n[i].vy = (n[i].vy + fy) * DAMP;
    n[i].x = Math.max(46, Math.min(W - 46, n[i].x + n[i].vx));
    n[i].y = Math.max(34, Math.min(H - 34, n[i].y + n[i].vy));
  }
  return n;
}

export default function CompetitorGraph({ name, competitors }) {
  const comps = (competitors || []).filter((c) => c && c.name);

  const svgRef = useRef(null);
  const rafRef = useRef(0);
  const tickRef = useRef(0);
  const dragRef = useRef(null); // index being dragged, or null
  const downRef = useRef(null); // pointer-down position, to tell a drag from a click
  const movedRef = useRef(false);

  // Deterministic initial layout (a circle) so server and client render the same.
  const [pos, setPos] = useState(() =>
    comps.map((_, i) => {
      const a = (2 * Math.PI * i) / Math.max(1, comps.length) - Math.PI / 2;
      return { x: CX + L * Math.cos(a), y: CY + L * Math.sin(a), vx: 0, vy: 0 };
    })
  );

  function runLoop() {
    cancelAnimationFrame(rafRef.current);
    const loop = () => {
      setPos((prev) => simulate(prev, dragRef.current));
      tickRef.current += 1;
      if (tickRef.current < MAX_TICKS || dragRef.current != null) {
        rafRef.current = requestAnimationFrame(loop);
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  useEffect(() => {
    if (comps.length === 0) return undefined;
    tickRef.current = 0;
    runLoop();
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comps.length]);

  function toSvg(e) {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (W / rect.width),
      y: (e.clientY - rect.top) * (H / rect.height),
    };
  }

  function onPointerDown(i, e) {
    e.stopPropagation();
    dragRef.current = i;
    downRef.current = toSvg(e);
    movedRef.current = false;
    svgRef.current?.setPointerCapture?.(e.pointerId);
    tickRef.current = 0; // keep the sim alive while dragging
    runLoop();
  }
  function onPointerMove(e) {
    if (dragRef.current == null) return;
    const p = toSvg(e);
    if (downRef.current && Math.hypot(p.x - downRef.current.x, p.y - downRef.current.y) > 6) {
      movedRef.current = true;
    }
    setPos((prev) => prev.map((q, i) => (i === dragRef.current ? { ...q, x: p.x, y: p.y, vx: 0, vy: 0 } : q)));
  }
  function onPointerUp(e) {
    if (dragRef.current == null) return;
    dragRef.current = null;
    svgRef.current?.releasePointerCapture?.(e.pointerId);
  }
  // Suppress the navigation that would follow a drag (vs. a real click).
  function onLinkClick(e) {
    if (movedRef.current) e.preventDefault();
    movedRef.current = false;
  }

  if (comps.length === 0) return null;

  return (
    <div className="graph-wrap">
      <svg
        ref={svgRef}
        className="competitor-graph"
        viewBox={`0 0 ${W} ${H}`}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        role="img"
        aria-label={`Competitor graph for ${name}`}
      >
        {pos.map((p, i) => (
          <line key={`e${i}`} x1={CX} y1={CY} x2={p.x} y2={p.y} className="graph-edge" />
        ))}

        {pos.map((p, i) => {
          const c = comps[i];
          const href = c.url || null;
          const title =
            [
              c.pricing && `Pricing: ${c.pricing}`,
              c.strengths && `Strengths: ${c.strengths}`,
              c.weaknesses && `Weaknesses: ${c.weaknesses}`,
            ]
              .filter(Boolean)
              .join("\n") || c.name;
          const node = (
            <g
              className={`graph-node${href ? " linked" : ""}`}
              transform={`translate(${p.x},${p.y})`}
              onPointerDown={(e) => onPointerDown(i, e)}
            >
              <title>{title}</title>
              <circle r="9" className="node-dot comp" />
              <text y="24" textAnchor="middle" className="node-label">{truncate(c.name, 22)}</text>
              {c.pricing ? <text y="38" textAnchor="middle" className="node-sub">{truncate(c.pricing, 18)}</text> : null}
            </g>
          );
          return href ? (
            <a key={`n${i}`} href={href} target="_blank" rel="noreferrer" onClick={onLinkClick}>
              {node}
            </a>
          ) : (
            <g key={`n${i}`}>{node}</g>
          );
        })}

        <g transform={`translate(${CX},${CY})`} className="graph-node center">
          <circle r="14" className="node-dot self" />
          <text y="33" textAnchor="middle" className="node-label self">{truncate(name, 26)}</text>
        </g>
      </svg>
      <p className="graph-hint muted">Drag nodes to rearrange · click a competitor to open its page ↗</p>
    </div>
  );
}
