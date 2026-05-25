/* Pipeline diagram v4 — vertical USERS / KAFKA, draggable groups,
   socket connect/disconnect, start/stop animation.                          */
const { useEffect, useRef, useState, useMemo, useCallback } = React;

const P = window.PIPELINE;

// ─── Geometry helpers ────────────────────────────────────────────────
const SOCK = { L: "L", R: "R", T: "T", B: "B" };
const OPP  = { L: "R", R: "L", T: "B", B: "T" };

// Determine which side of node A→B and node B's side that edge touches.
function edgeSide(a, b) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  const horiz = Math.abs(dx) > Math.abs(dy) * 1.1;
  if (horiz) return [dx > 0 ? "R" : "L", dx > 0 ? "L" : "R"];
  return [dy > 0 ? "B" : "T", dy > 0 ? "T" : "B"];
}

// Pre-compute port slots so multiple edges on the same side fan out.
function computeSlots(edges, NODE) {
  const groups = {};
  edges.forEach((e, i) => {
    const a = NODE[e.from], b = NODE[e.to]; if (!a || !b) return;
    const [sa, sb] = edgeSide(a, b);
    const kA = `${e.from}|${sa}`, kB = `${e.to}|${sb}`;
    if (!groups[kA]) groups[kA] = [];
    if (!groups[kB]) groups[kB] = [];
    groups[kA].push({ i, end: "a", o: (sa==="L"||sa==="R") ? b.cy : b.cx });
    groups[kB].push({ i, end: "b", o: (sb==="L"||sb==="R") ? a.cy : a.cx });
  });
  const slots = {};
  Object.entries(groups).forEach(([key, list]) => {
    list.sort((p, q) => p.o - q.o);
    list.forEach((item, idx) => {
      slots[`${item.i}|${item.end}`] = { slot: idx, total: list.length, side: key.split("|")[1] };
    });
  });
  return slots;
}

function portOf(n, side, slot, total) {
  const frac = (slot + 1) / (total + 1);
  if (side === "L") return { x: n.x,         y: n.y + n.h * frac, n: "L" };
  if (side === "R") return { x: n.x + n.w,   y: n.y + n.h * frac, n: "R" };
  if (side === "T") return { x: n.x + n.w * frac, y: n.y,         n: "T" };
  return                  { x: n.x + n.w * frac, y: n.y + n.h,    n: "B" };
}

// Always return the four cardinal sockets of a node
function socketPos(n, side) {
  if (side === "L") return { x: n.x,         y: n.cy };
  if (side === "R") return { x: n.x + n.w,   y: n.cy };
  if (side === "T") return { x: n.cx,        y: n.y };
  return                  { x: n.cx,        y: n.y + n.h };
}

function pathBetweenPorts(pa, pb, bend = 0) {
  const horiz = pa.n === "L" || pa.n === "R";
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const k = 0.55;
  let c1, c2;
  if (horiz) {
    const off = Math.abs(dx) * k;
    const bendOff = bend * Math.max(60, Math.abs(dx) * 0.4);
    c1 = { x: pa.x + (pa.n === "R" ? off : -off), y: pa.y + bendOff };
    c2 = { x: pb.x + (pb.n === "L" ? -off :  off), y: pb.y + bendOff };
  } else {
    const off = Math.abs(dy) * k;
    const bendOff = bend * Math.max(60, Math.abs(dy) * 0.4);
    c1 = { x: pa.x + bendOff, y: pa.y + (pa.n === "B" ? off : -off) };
    c2 = { x: pb.x + bendOff, y: pb.y + (pb.n === "T" ? -off :  off) };
  }
  return `M ${pa.x} ${pa.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${pb.x} ${pb.y}`;
}

function pathFreeform(pa, pb) {
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const horiz = Math.abs(dx) > Math.abs(dy);
  const k = 0.55;
  let c1, c2;
  if (horiz) {
    c1 = { x: pa.x + dx*k, y: pa.y };
    c2 = { x: pb.x - dx*k, y: pb.y };
  } else {
    c1 = { x: pa.x, y: pa.y + dy*k };
    c2 = { x: pb.x, y: pb.y - dy*k };
  }
  return `M ${pa.x} ${pa.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${pb.x} ${pb.y}`;
}

// ─── Cluster background ──────────────────────────────────────────────
function Cluster({ id, label, x, y, w, h, color, orient, onDragStart, dragging }) {
  // For vertical-titled clusters, label runs down left edge.
  // Entire cluster background is the drag handle; nodes/sockets on top intercept their own events.
  const vertical = orient === "V";
  return (
    <g className="cluster">
      <rect x={x} y={y} width={w} height={h} rx={14}
            fill={color} fillOpacity={dragging ? 0.12 : 0.05}
            stroke={color} strokeOpacity={dragging ? 0.8 : 0.32} strokeWidth={1.2}
            strokeDasharray="5 5"
            style={{ cursor: "grab" }}
            onMouseDown={onDragStart} />
      {vertical ? (
        <text x={x + 14} y={y + h/2}
              fontSize={11} fontWeight={700}
              fill={color} fillOpacity={0.92}
              textAnchor="middle"
              transform={`rotate(-90 ${x + 14} ${y + h/2})`}
              style={{ letterSpacing: "0.18em", textTransform: "uppercase",
                       pointerEvents: "none", userSelect: "none",
                       fontFamily: "'JetBrains Mono', monospace" }}>
          {label}
        </text>
      ) : (
        <text x={x + 12} y={y + 19} fontSize={11} fontWeight={700}
              fill={color} fillOpacity={0.92}
              style={{ letterSpacing: "0.16em", textTransform: "uppercase",
                       pointerEvents: "none", userSelect: "none",
                       fontFamily: "'JetBrains Mono', monospace" }}>
          {label}
        </text>
      )}
    </g>
  );
}

// ─── Node ────────────────────────────────────────────────────────────
function Node({ n, dim, onSocketDown, hoveredSocket, setHoveredSocket }) {
  const small = n.kind === "user" || n.kind === "ext";
  const fontSize = small ? 12.5 : 13.5;
  const titlePad = n.kind === "kf" ? 12 : 6;
  return (
    <g className="node" data-id={n.id} opacity={dim ? 0.32 : 1}>
      <rect x={n.x} y={n.y} width={n.w} height={n.h}
            rx={n.kind === "db" ? 8 : 9}
            fill="#0b1220" stroke={n.color} strokeWidth={1.5}
            filter="url(#nodeGlow)" />
      <rect x={n.x} y={n.y} width={3.5} height={n.h} rx={2} fill={n.color} />
      <text x={n.cx} y={n.cy + 4.5} fontSize={fontSize} fontWeight={600}
            textAnchor="middle" fill="#e2e8f0"
            style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                     letterSpacing: "0.01em", pointerEvents: "none", userSelect:"none" }}>
        {n.label}
      </text>
      {/* Sockets — L/T = input (pull, hollow), R/B = output (push, filled) */}
      {["L","R","T","B"].map(side => {
        const p = socketPos(n, side);
        const isOutput = side === "R" || side === "B";
        const isHover = hoveredSocket && hoveredSocket.nodeId === n.id && hoveredSocket.side === side;
        return (
          <g key={side}>
            <circle cx={p.x} cy={p.y} r={isHover ? 7 : 5}
                    fill={isHover ? n.color : (isOutput ? n.color : "#0b1220")}
                    fillOpacity={isHover ? 1 : (isOutput ? 0.85 : 1)}
                    stroke={n.color}
                    strokeWidth={1.6}
                    style={{ cursor: "crosshair", transition: "r 0.12s" }}
                    onMouseDown={(e) => { e.stopPropagation(); onSocketDown(n.id, side, p, e); }}
                    onMouseEnter={() => setHoveredSocket({ nodeId: n.id, side })}
                    onMouseLeave={() => setHoveredSocket(null)} />
            {/* hitbox */}
            <circle cx={p.x} cy={p.y} r={11}
                    fill="transparent"
                    style={{ cursor: "crosshair" }}
                    onMouseDown={(e) => { e.stopPropagation(); onSocketDown(n.id, side, p, e); }}
                    onMouseEnter={() => setHoveredSocket({ nodeId: n.id, side })}
                    onMouseLeave={() => setHoveredSocket(null)} />
          </g>
        );
      })}
    </g>
  );
}

// ─── Bottleneck queue viz ─────────────────────────────────────────
function QueueViz({ x, y, color, count }) {
  const dots = Array.from({ length: Math.min(count, 32) });
  return (
    <g>
      {dots.map((_, i) => {
        const col = i % 16, row = Math.floor(i / 16);
        return <circle key={i}
                       cx={x + col * 8.5}
                       cy={y + row * 8.5}
                       r={2.8}
                       fill={color}
                       opacity={0.9} />;
      })}
      {count > 32 && (
        <text x={x + 138} y={y + 4} fontSize={9} fill={color} textAnchor="end">+{count - 32}</text>
      )}
    </g>
  );
}

// ─── Main diagram ────────────────────────────────────────────────────
function Diagram({ tweaks, edges, setEdges, running, setRunning }) {
  const svgRef = useRef(null);
  const innerGRef = useRef(null);
  const pathRefs = useRef({});
  const particleLayerRef = useRef(null);
  const [edgeGeo, setEdgeGeo] = useState([]);
  const [clusterOffsets, setClusterOffsets] = useState({});
  const [draggingCluster, setDraggingCluster] = useState(null);
  const [queueCounts, setQueueCounts] = useState({});
  const [hoveredSocket, setHoveredSocket] = useState(null);
  const [edgeDraft, setEdgeDraft] = useState(null);   // {from:{nodeId,side,pos}, to:{x,y}}
  const [hoverEdgeKey, setHoverEdgeKey] = useState(null);

  // pan / zoom view state
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const dragRef = useRef(null);

  const onWheel = (e) => {
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM(); if (!ctm) return;
    const sp = pt.matrixTransform(ctm.inverse());
    const v = viewRef.current;
    const wx = (sp.x - v.tx) / v.scale, wy = (sp.y - v.ty) / v.scale;
    const factor = e.deltaY < 0 ? 1.18 : 1/1.18;
    const ns = Math.max(0.3, Math.min(5, v.scale * factor));
    setView({ scale: ns, tx: sp.x - wx * ns, ty: sp.y - wy * ns });
  };
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest("[data-no-pan]")) return;
    e.preventDefault();
    const ctm = svgRef.current.getScreenCTM(); if (!ctm) return;
    dragRef.current = { x: e.clientX, y: e.clientY, sx: ctm.a, sy: ctm.d, v: viewRef.current };
    document.body.style.cursor = "grabbing";
  };
  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const handler = (e) => { e.preventDefault(); onWheel(e); };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, []);
  useEffect(() => {
    const move = (ev) => {
      const d = dragRef.current; if (!d) return;
      const dx = (ev.clientX - d.x) / d.sx;
      const dy = (ev.clientY - d.y) / d.sy;
      setView({ ...d.v, tx: d.v.tx + dx, ty: d.v.ty + dy });
    };
    const up = () => {
      if (dragRef.current) { dragRef.current = null; document.body.style.cursor = ""; }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);
  const resetView = () => setView({ scale: 1, tx: 0, ty: 0 });
  const zoomBy = (f) => {
    const v = viewRef.current;
    const cx = 1820/2, cy = 740/2;
    const wx = (cx - v.tx)/v.scale, wy = (cy - v.ty)/v.scale;
    const ns = Math.max(0.3, Math.min(5, v.scale * f));
    setView({ scale: ns, tx: cx - wx*ns, ty: cy - wy*ns });
  };

  // Cluster membership: each node belongs to the smallest cluster containing it
  const nodeCluster = useMemo(() => {
    const map = {};
    for (const n of P.NODES) {
      let best = null, bestArea = Infinity;
      for (const cl of P.CLUSTERS) {
        const [id, , cx, cy, cw, ch] = cl;
        if (n.cx >= cx && n.cx <= cx + cw && n.cy >= cy && n.cy <= cy + ch) {
          const area = cw * ch;
          if (area < bestArea) { best = id; bestArea = area; }
        }
      }
      map[n.id] = best;
    }
    return map;
  }, []);

  // Effective node positions (with cluster drag offsets applied)
  const effNODE = useMemo(() => {
    const out = {};
    for (const n of P.NODES) {
      const off = clusterOffsets[nodeCluster[n.id]] || { dx: 0, dy: 0 };
      out[n.id] = {
        ...n,
        x: n.x + off.dx, y: n.y + off.dy,
        cx: n.cx + off.dx, cy: n.cy + off.dy,
      };
    }
    return out;
  }, [clusterOffsets, nodeCluster]);

  // Cluster drag
  const onClusterDragStart = (clusterId, e) => {
    e.preventDefault(); e.stopPropagation();
    if (!innerGRef.current) return;
    const inner = innerGRef.current;
    const startCTM = inner.getScreenCTM(); if (!startCTM) return;
    const startX = e.clientX, startY = e.clientY;
    const startOff = clusterOffsets[clusterId] || { dx: 0, dy: 0 };
    setDraggingCluster(clusterId);
    document.body.style.cursor = "grabbing";
    const move = (ev) => {
      const dx = (ev.clientX - startX) / startCTM.a;
      const dy = (ev.clientY - startY) / startCTM.d;
      setClusterOffsets((prev) => ({ ...prev, [clusterId]: { dx: startOff.dx + dx, dy: startOff.dy + dy } }));
    };
    const up = () => {
      setDraggingCluster(null);
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // Build edge geometry
  useEffect(() => {
    const slots = computeSlots(edges, effNODE);
    const list = edges.map((e, i) => {
      const a = effNODE[e.from], b = effNODE[e.to];
      if (!a || !b) return null;
      const sa = slots[`${i}|a`], sb = slots[`${i}|b`];
      if (!sa || !sb) return null;
      const pa = portOf(a, sa.side, sa.slot, sa.total);
      const pb = portOf(b, sb.side, sb.slot, sb.total);
      const d = pathBetweenPorts(pa, pb, 0);
      return {
        i, key: e.key, from: e.from, to: e.to,
        color: P.C[e.color] || "#94a3b8",
        colorKey: e.color,
        d, dashed: !!e.dashed,
        bottleneck: e.bottleneck || null,
      };
    }).filter(Boolean);
    setEdgeGeo(list);
  }, [edges, effNODE]);

  // Socket drag handler — create new edge
  // L/T = input  (pull — dashed, data flows INTO this node)
  // R/B = output (push — solid, data flows OUT of this node)
  const onSocketDown = (nodeId, side, posSvg, e) => {
    const inner = innerGRef.current;
    if (!inner) return;
    e.preventDefault();
    e.stopPropagation();
    const ctm = inner.getScreenCTM(); if (!ctm) return;

    const isPull = side === "L" || side === "T";
    const startPos = { x: posSvg.x, y: posSvg.y };
    setEdgeDraft({
      from: { nodeId, side, pos: startPos },
      to: { x: startPos.x, y: startPos.y },
      pull: isPull,
    });

    const move = (ev) => {
      const pt = svgRef.current.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      const cur = pt.matrixTransform(inner.getScreenCTM().inverse());
      setEdgeDraft({
        from: { nodeId, side, pos: startPos },
        to: { x: cur.x, y: cur.y },
        pull: isPull,
      });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";

      const target = window.__hoveredSocketRef;
      if (target && target.nodeId !== nodeId) {
        // Push: data flows from origin→target. Pull: data flows target→origin (dashed).
        const newEdge = isPull
          ? { key: `usr_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
              from: target.nodeId, to: nodeId,
              color: "indigo", dashed: true, user: true }
          : { key: `usr_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
              from: nodeId, to: target.nodeId,
              color: "indigo", dashed: false, user: true };
        setEdges(prev => [...prev, newEdge]);
      }
      setEdgeDraft(null);
    };
    document.body.style.cursor = "crosshair";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // Mirror hoveredSocket into a window-level ref for the mouseUp handler to read
  useEffect(() => {
    window.__hoveredSocketRef = hoveredSocket;
  }, [hoveredSocket]);

  // Click-to-delete edge
  const removeEdge = (key) => {
    setEdges(prev => prev.filter(e => e.key !== key));
  };

  // ── Animation loop — fan-out from YTAPI through current edges ─────
  useEffect(() => {
    const layer = particleLayerRef.current;
    if (!layer || !edgeGeo.length) return;

    const SOURCE = "YTAPI";
    const MAX_DEPTH = 10;          // prevent infinite cycles
    const RESTART_DELAY_MS = 1400; // pause between waves

    // Build outgoing adjacency from non-dashed edges
    const outgoing = {};
    edgeGeo.forEach(e => {
      if (e.dashed) return;
      if (!outgoing[e.from]) outgoing[e.from] = [];
      outgoing[e.from].push({ toId: e.to, edgeI: e.i });
    });

    const edgeRefs = {};
    edgeGeo.forEach(e => {
      const el = pathRefs.current[e.i];
      if (el) edgeRefs[e.i] = { el, length: el.getTotalLength(), color: e.color,
                                bottleneck: e.bottleneck, dashed: e.dashed };
    });

    const FREE = [];
    function acquireDot() {
      let el = FREE.length ? FREE.pop() : null;
      if (el) { el.setAttribute("display", ""); return el; }
      el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      layer.appendChild(el);
      return el;
    }
    function releaseDot(el) { el.setAttribute("display", "none"); FREE.push(el); }

    const particles = [];

    function spawnFrom(nodeId, depth, R) {
      if (depth > MAX_DEPTH) return;
      const outs = outgoing[nodeId];
      if (!outs) return;
      for (const { toId, edgeI } of outs) {
        const ref = edgeRefs[edgeI]; if (!ref) continue;
        const dot = acquireDot();
        dot.setAttribute("fill", ref.color);
        dot.setAttribute("r", R);
        dot.setAttribute("opacity", "1");
        const pt = ref.el.getPointAtLength(0);
        dot.setAttribute("cx", pt.x); dot.setAttribute("cy", pt.y);
        particles.push({ el: dot, ref, toId, t: 0, depth });
      }
    }

    let prev = performance.now();
    let restartTimer = 0;
    let rafId;
    let lastWasRunning = false;

    rafId = requestAnimationFrame(tick);

    function tick(now) {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;

      const isRunning = tweaks.runningRef.current;
      const speedScale = tweaks.speedRef.current ?? 1;
      const bottleneckOn = tweaks.bottleneckRef.current !== false;
      const severity = tweaks.severityRef.current ?? 0.3;
      const sizeKey = tweaks.particleSizeRef.current ?? "medium";
      const R_DOT = sizeKey === "small" ? 3.5 : sizeKey === "large" ? 8 : 5;

      // On transition off→on, kick off a new wave immediately
      if (isRunning && !lastWasRunning) {
        spawnFrom(SOURCE, 0, R_DOT);
        restartTimer = 0;
      }
      lastWasRunning = isRunning;

      const BASE = 0.32;
      let backlog = 0;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (!isRunning) {
          // Stop advancing but keep dots visible where they are
          continue;
        }
        let s = BASE * speedScale;
        const isBn = bottleneckOn && p.ref.bottleneck && p.t > 0.6;
        if (isBn) { s *= severity; backlog++; }
        p.t += s * dt;
        p.el.setAttribute("r", R_DOT);
        if (p.t >= 1) {
          const arrived = p.toId;
          releaseDot(p.el);
          particles.splice(i, 1);
          // Continue propagation from arrived node
          spawnFrom(arrived, p.depth + 1, R_DOT);
          continue;
        }
        const pt = p.ref.el.getPointAtLength(p.t * p.ref.length);
        p.el.setAttribute("cx", pt.x); p.el.setAttribute("cy", pt.y);
      }

      // Wave restart when graph fully drained
      if (isRunning && particles.length === 0) {
        restartTimer += dt * 1000;
        if (restartTimer > RESTART_DELAY_MS) {
          restartTimer = 0;
          spawnFrom(SOURCE, 0, R_DOT);
        }
      } else if (particles.length > 0) {
        restartTimer = 0;
      }

      // Backlog viz at bottleneck node
      const bnNode = edgeGeo.find(e => e.bottleneck)?.bottleneck;
      if (bnNode) {
        const target = backlog > 0 ? Math.min(28, 3 + backlog * 3) : 0;
        setQueueCounts(prev => {
          const cur = prev[bnNode] || 0;
          if (cur === target) return prev;
          return target > 0 ? { [bnNode]: target } : {};
        });
      }

      rafId = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(rafId);
      particles.forEach(p => p.el.remove());
      FREE.forEach(el => el.remove());
    };
  }, [edgeGeo]);

  return (
    <>
    <svg ref={svgRef}
         viewBox="0 0 1820 740"
         preserveAspectRatio="xMidYMid meet"
         onMouseDown={onMouseDown}
         style={{ width: "100%", height: "100%", display: "block", cursor: "grab" }}>
      <defs>
        <filter id="nodeGlow" x="-20%" y="-30%" width="140%" height="160%">
          <feGaussianBlur stdDeviation="2.2" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="lineGlow" x="-10%" y="-50%" width="120%" height="200%">
          <feGaussianBlur stdDeviation="1.4" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="0.6" opacity="0.45"/>
        </pattern>
      </defs>

      <rect width="1820" height="740" fill="#050810"/>
      {tweaks.showGrid && <rect width="1820" height="740" fill="url(#grid)"/>}

      <g ref={innerGRef} transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>

      {/* Cluster backgrounds */}
      {P.CLUSTERS.map((c) => {
        const off = clusterOffsets[c[0]] || { dx: 0, dy: 0 };
        return (
          <g key={c[0]} transform={`translate(${off.dx} ${off.dy})`} data-no-pan>
            <Cluster id={c[0]} label={c[1]} x={c[2]} y={c[3]} w={c[4]} h={c[5]} color={c[6]} orient={c[7]}
                     dragging={draggingCluster === c[0]}
                     onDragStart={(e) => onClusterDragStart(c[0], e)} />
          </g>
        );
      })}

      {/* Edges */}
      <g className="edges">
        {edgeGeo.map((e) => (
          <g key={e.key} data-no-pan>
            {/* invisible wider hit-area for hover/click */}
            <path d={e.d} fill="none" stroke="transparent" strokeWidth={14}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHoverEdgeKey(e.key)}
                  onMouseLeave={() => setHoverEdgeKey(null)}
                  onClick={() => removeEdge(e.key)} />
            <path ref={(el) => { if (el) pathRefs.current[e.i] = el; }}
                  d={e.d}
                  fill="none"
                  stroke={e.color}
                  strokeWidth={hoverEdgeKey === e.key ? 2.6 : e.dashed ? 1 : 1.4}
                  strokeOpacity={hoverEdgeKey === e.key ? 0.95 : e.dashed ? 0.18 : 0.32}
                  strokeDasharray={e.dashed ? "4 6" : undefined}
                  strokeLinecap="round"
                  pointerEvents="none" />
            {hoverEdgeKey === e.key && (() => {
              // place X icon at midpoint of path
              const mid = pathRefs.current[e.i]?.getPointAtLength(
                (pathRefs.current[e.i]?.getTotalLength() || 0) / 2
              );
              if (!mid) return null;
              return (
                <g style={{ pointerEvents: "none" }}>
                  <circle cx={mid.x} cy={mid.y} r={9} fill="#0b1220" stroke="#f87171" strokeWidth={1.4}/>
                  <text x={mid.x} y={mid.y + 4} fontSize={11} fontWeight={700}
                        textAnchor="middle" fill="#f87171"
                        style={{ fontFamily: "monospace" }}>×</text>
                </g>
              );
            })()}
          </g>
        ))}
      </g>

      {/* Particles */}
      <g ref={particleLayerRef} className="particles" filter="url(#lineGlow)"/>

      {/* Draft edge being dragged */}
      {edgeDraft && (() => {
        const pa = { x: edgeDraft.from.pos.x, y: edgeDraft.from.pos.y,
                     n: edgeDraft.from.side };
        const pb = { x: edgeDraft.to.x, y: edgeDraft.to.y, n: OPP[edgeDraft.from.side] || "L" };
        const d = pathFreeform(pa, pb);
        const col = edgeDraft.pull ? "#22d3ee" : "#fbbf24";
        return (
          <g pointerEvents="none">
            <path d={d} fill="none" stroke={col} strokeWidth={2}
                  strokeDasharray={edgeDraft.pull ? "3 5" : "6 4"}
                  strokeLinecap="round" opacity={0.9}/>
            <circle cx={pb.x} cy={pb.y} r={5} fill={col} opacity={0.95}/>
            <text x={pa.x + (edgeDraft.from.side === "L" ? -12 : edgeDraft.from.side === "R" ? 12 : 0)}
                  y={pa.y + (edgeDraft.from.side === "T" ? -10 : edgeDraft.from.side === "B" ? 16 : -10)}
                  fontSize={10} fontWeight={700} fill={col} textAnchor="middle"
                  style={{ fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em" }}>
              {edgeDraft.pull ? "PULL" : "PUSH"}
            </text>
          </g>
        );
      })()}

      {/* Nodes */}
      {P.NODES.map((n) => {
        const off = clusterOffsets[nodeCluster[n.id]] || { dx: 0, dy: 0 };
        const e = effNODE[n.id];
        return (
          <g key={n.id} data-no-pan>
            <Node n={e}
                  dim={false}
                  onSocketDown={onSocketDown}
                  hoveredSocket={hoveredSocket}
                  setHoveredSocket={setHoveredSocket} />
          </g>
        );
      })}

      {/* Bottleneck queue viz */}
      {Object.entries(queueCounts).filter(([,c]) => c > 0).map(([id, count]) => {
        const n = effNODE[id];
        if (!n) return null;
        const QW = 158, QH = 62;
        const QX = n.cx - QW/2, QY = n.y - QH - 12;
        return (
          <g key={id} pointerEvents="none">
            <rect x={n.x-3} y={n.y-3} width={n.w+6} height={n.h+6} rx={11}
                  fill="none" stroke="#fca5a5" strokeWidth={1.5} opacity={0.6}>
              <animate attributeName="opacity" values="0.2;0.85;0.2" dur="1.1s" repeatCount="indefinite"/>
            </rect>
            <line x1={n.cx} y1={QY+QH} x2={n.cx} y2={n.y-2} stroke="#fca5a5" strokeWidth={1.2} strokeDasharray="3 3" opacity={0.55}/>
            <rect x={QX} y={QY} width={QW} height={QH} rx={6}
                  fill="#180808" stroke="#fca5a5" strokeWidth={1.4} strokeDasharray="5 4"/>
            <text x={QX + 10} y={QY + 14} fontSize={9} fontWeight={700} fill="#fca5a5"
                  style={{ fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.14em" }}>
              ⚠ BACKLOG · {count} msg
            </text>
            <QueueViz x={QX + 12} y={QY + 24} color="#fca5a5" count={count}/>
          </g>
        );
      })}

      </g>
    </svg>

    {/* Playback controls (top-center of stage) */}
    <div className="playctl">
      <button onClick={() => setRunning(true)} className={running ? "pc on" : "pc"} title="Start">
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 1.5 L10 6 L3 10.5 Z" fill="currentColor"/></svg>
        Start
      </button>
      <button onClick={() => setRunning(false)} className={!running ? "pc off" : "pc"} title="Stop">
        <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" fill="currentColor"/></svg>
        Stop
      </button>
      <div className="pcdiv"/>
      <button onClick={() => { setEdges(P.EDGES.map((e,i) => ({
        key: `e${i}`, from: e[0], to: e[1], color: e[2], ...(e[3]||{})
      }))); }} className="pc" title="Reset edges to default">
        ⟲ Reset edges
      </button>
    </div>

    <div className="zoomctl">
      <button onClick={() => zoomBy(1.25)} title="Zoom in">＋</button>
      <div className="z">{Math.round(view.scale * 100)}%</div>
      <button onClick={() => zoomBy(0.8)} title="Zoom out">−</button>
      <button onClick={resetView} title="Reset view">⟲</button>
    </div>
    </>
  );
}

// ─── Top-level shell ─────────────────────────────────────────────────
function App() {
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "speed": 1,
    "bottleneck": true,
    "severity": 0.25,
    "particleSize": "medium",
    "showGrid": true,
    "showLegend": true
  }/*EDITMODE-END*/;
  const [t, setTweak] = window.useTweaks(TWEAK_DEFAULTS);

  // Edges as state (mutable through socket drag / click-delete)
  const [edges, setEdges] = useState(() =>
    P.EDGES.map((e, i) => ({
      key: `e${i}`, from: e[0], to: e[1], color: e[2], ...(e[3] || {})
    }))
  );

  const [running, setRunning] = useState(true);

  // Refs for rAF loop
  const speedRef = useRef(t.speed);
  const bottleneckRef = useRef(t.bottleneck);
  const severityRef = useRef(t.severity);
  const particleSizeRef = useRef(t.particleSize);
  const runningRef = useRef(running);
  useEffect(() => { speedRef.current = t.speed; }, [t.speed]);
  useEffect(() => { bottleneckRef.current = t.bottleneck; }, [t.bottleneck]);
  useEffect(() => { severityRef.current = t.severity; }, [t.severity]);
  useEffect(() => { particleSizeRef.current = t.particleSize; }, [t.particleSize]);
  useEffect(() => { runningRef.current = running; }, [running]);

  const tweaks = { speedRef, bottleneckRef, severityRef, particleSizeRef, runningRef, showGrid: t.showGrid };

  const LEGEND = [
    ["indigo",  "User → UI"],
    ["teal",    "App API"],
    ["amber",   "Airflow"],
    ["red",     "Kafka pub/sub"],
    ["violet",  "KEDA scale"],
    ["orange",  "Admin / External"],
    ["green",   "DuckDB UI"],
    ["cyan",    "Observability"],
    ["pink",    "Lensa stack"],
    ["purple",  "Model loop"],
    ["yorange", "Kafka UI"],
  ];

  return (
    <div className="app">
      <header className="hdr">
        <div className="title">
          <div className="dot"/>
          <h1>Pipeline Data Flow <span className="sub">v4 · editable topology</span></h1>
        </div>
        <div className="meta">
          <span className="kv"><b>{P.NODES.length}</b> services</span>
          <span className="kv"><b>{edges.length}</b> connections</span>
          <span className={"kv " + (running ? "kvOn" : "kvOff")}>
            <span className={running ? "live" : "dead"}/>
            {running ? "live · 60fps" : "paused"}
          </span>
        </div>
      </header>

      <main className="stage">
        <Diagram tweaks={tweaks} edges={edges} setEdges={setEdges}
                 running={running} setRunning={setRunning}/>
        <div className="panhint">
          <kbd>scroll</kbd> zoom · <kbd>drag bg</kbd> pan · <kbd>drag group</kbd> move ·
          <kbd>drag R/B socket</kbd> push <span style={{color:"#fbbf24"}}>━━</span> ·
          <kbd>drag L/T socket</kbd> pull <span style={{color:"#22d3ee"}}>┄┄</span> ·
          <kbd>click line</kbd> delete
        </div>
      </main>

      {t.showLegend && (
        <div className="legend">
          <div className="legendHd">Flows</div>
          {LEGEND.map(([k, label]) => (
            <span key={k} className="legendRow">
              <span className="swatch" style={{ background: P.C[k], color: P.C[k] }}/>
              <span>{label}</span>
            </span>
          ))}
        </div>
      )}

      <window.TweaksPanel title="Tweaks">
        <window.TweakSection label="Flow"/>
        <window.TweakSlider label="Speed" value={t.speed} onChange={(v)=>setTweak("speed",v)}
                            min={0.2} max={3} step={0.1}/>
        <window.TweakRadio label="Dot size" value={t.particleSize}
                           onChange={(v)=>setTweak("particleSize",v)}
                           options={[{label:"S", value:"small"},{label:"M", value:"medium"},{label:"L", value:"large"}]}/>
        <window.TweakSection label="Bottleneck"/>
        <window.TweakToggle label="Bottleneck on" value={t.bottleneck}
                            onChange={(v)=>setTweak("bottleneck",v)}/>
        <window.TweakSlider label="Severity" value={t.severity}
                            onChange={(v)=>setTweak("severity",v)}
                            min={0.05} max={0.6} step={0.01}/>
        <window.TweakSection label="UI"/>
        <window.TweakToggle label="Legend" value={t.showLegend}
                            onChange={(v)=>setTweak("showLegend",v)}/>
        <window.TweakToggle label="Grid bg" value={t.showGrid}
                            onChange={(v)=>setTweak("showGrid",v)}/>
      </window.TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
