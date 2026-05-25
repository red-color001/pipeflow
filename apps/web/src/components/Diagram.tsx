import { useEffect, useRef, useState, useMemo } from 'react';
import { useStore, onFlow } from '../store';
import { emitNodeMove, emitEdgeDelete } from '../socket';
import {
  computeSlots, portOf, cubicBetweenPorts, pathFromCubic, pathFreeform,
  bezierAt, withCentroid, OPP,
  type PositionedNode, type Side, type Port, type Cubic,
} from '../geometry';
import { COLORS } from '../colors';
import { Cluster } from './Cluster';
import { NodeShape } from './Node';

function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B/s`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB/s`;
  return `${(n / 1024 / 1024).toFixed(1)} MB/s`;
}

interface EdgeGeo {
  i: number; key: number;
  from: string; to: string;
  color: string;
  d: string;
  cubic: Cubic;     // raw control points — animation reads these, not the DOM
  dashed: boolean;
}

interface Props {
  running: boolean;
  setRunning: (v: boolean) => void;
  tweaks: {
    speedRef: React.MutableRefObject<number>;
    particleSizeRef: React.MutableRefObject<'small' | 'medium' | 'large'>;
    runningRef: React.MutableRefObject<boolean>;
    showGrid: boolean;
  };
}

export function Diagram({ running, setRunning, tweaks }: Props) {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const clusters = useStore((s) => s.clusters);
  const metrics = useStore((s) => s.metrics);

  const svgRef = useRef<SVGSVGElement>(null);
  const innerGRef = useRef<SVGGElement>(null);
  const pathRefs = useRef<Record<number, SVGPathElement>>({});
  const particleLayerRef = useRef<SVGGElement>(null);

  const [hoveredSocket, setHoveredSocket] = useState<{ nodeId: string; side: Side } | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [edgeDraft, setEdgeDraft] = useState<null | {
    from: { nodeId: string; side: Side; pos: { x: number; y: number } };
    to: { x: number; y: number };
    pull: boolean;
  }>(null);
  const [hoverEdgeKey, setHoverEdgeKey] = useState<number | null>(null);

  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const dragRef = useRef<{ x: number; y: number; sx: number; sy: number; v: typeof view } | null>(null);

  // Materialize positioned nodes for geometry.
  const positioned = useMemo(() => {
    const arr: PositionedNode[] = [];
    nodes.forEach((n) => arr.push(withCentroid(n)));
    return arr;
  }, [nodes]);

  const nodeMap = useMemo(() => {
    const m: Record<string, PositionedNode> = {};
    positioned.forEach((n) => { m[n.id] = n; });
    return m;
  }, [positioned]);

  const edgeList = useMemo(() => Array.from(edges.values()), [edges]);

  // Edge geometry
  const edgeGeo: EdgeGeo[] = useMemo(() => {
    const slots = computeSlots(edgeList, nodeMap);
    const out: EdgeGeo[] = [];
    edgeList.forEach((e, i) => {
      const a = nodeMap[e.from], b = nodeMap[e.to];
      if (!a || !b) return;
      const sa = slots[`${i}|a`], sb = slots[`${i}|b`];
      if (!sa || !sb) return;
      const pa = portOf(a, sa.side, sa.slot, sa.total);
      const pb = portOf(b, sb.side, sb.slot, sb.total);
      const cubic = cubicBetweenPorts(pa, pb, 0);
      out.push({
        i, key: e.id, from: e.from, to: e.to,
        color: COLORS[e.color] || '#94a3b8',
        d: pathFromCubic(cubic),
        cubic,
        dashed: !!e.dashed,
      });
    });
    return out;
  }, [edgeList, nodeMap]);

  // Live ref of current cubic per edge id. Animation tick reads this directly,
  // so dot motion stays attached to the latest node positions without
  // depending on DOM mutation timing.
  const cubicsRef = useRef<Map<number, Cubic>>(new Map());
  useEffect(() => {
    const m = new Map<number, Cubic>();
    edgeGeo.forEach((e) => m.set(e.key, e.cubic));
    cubicsRef.current = m;
  }, [edgeGeo]);

  // Pan / zoom
  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const ctm = svg.getScreenCTM(); if (!ctm) return;
      const sp = pt.matrixTransform(ctm.inverse());
      const v = viewRef.current;
      const wx = (sp.x - v.tx) / v.scale, wy = (sp.y - v.ty) / v.scale;
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      const ns = Math.max(0.3, Math.min(5, v.scale * factor));
      setView({ scale: ns, tx: sp.x - wx * ns, ty: sp.y - wy * ns });
    };
    svg.addEventListener('wheel', handler, { passive: false });
    return () => svg.removeEventListener('wheel', handler);
  }, []);

  // Active pointers on the SVG, for pinch-zoom tracking.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; cx: number; cy: number; scale: number; tx: number; ty: number } | null>(null);

  useEffect(() => {
    const move = (ev: PointerEvent) => {
      // Update pointer tracker.
      if (pointersRef.current.has(ev.pointerId)) {
        pointersRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      }

      // Pinch-zoom takes priority over pan when 2 fingers active.
      if (pointersRef.current.size === 2) {
        const pts = [...pointersRef.current.values()];
        const ndist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const ncx = (pts[0].x + pts[1].x) / 2;
        const ncy = (pts[0].y + pts[1].y) / 2;
        if (!pinchRef.current) {
          pinchRef.current = {
            dist: ndist, cx: ncx, cy: ncy,
            scale: viewRef.current.scale, tx: viewRef.current.tx, ty: viewRef.current.ty,
          };
        } else {
          const p = pinchRef.current;
          const factor = ndist / p.dist;
          const ns = Math.max(0.3, Math.min(5, p.scale * factor));
          const svg = svgRef.current; if (!svg) return;
          const ctm = svg.getScreenCTM(); if (!ctm) return;
          const svgPt = svg.createSVGPoint(); svgPt.x = p.cx; svgPt.y = p.cy;
          const sp = svgPt.matrixTransform(ctm.inverse());
          const wx = (sp.x - p.tx) / p.scale, wy = (sp.y - p.ty) / p.scale;
          setView({ scale: ns, tx: sp.x - wx * ns, ty: sp.y - wy * ns });
        }
        dragRef.current = null; // cancel any in-flight pan
        return;
      }

      const d = dragRef.current; if (!d) return;
      const dx = (ev.clientX - d.x) / d.sx;
      const dy = (ev.clientY - d.y) / d.sy;
      setView({ ...d.v, tx: d.v.tx + dx, ty: d.v.ty + dy });
    };
    const up = (ev: PointerEvent) => {
      pointersRef.current.delete(ev.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;
      if (pointersRef.current.size === 0) {
        if (dragRef.current) { dragRef.current = null; document.body.style.cursor = ''; }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    // Left mouse, touch, or pen — anything except right-click.
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // Always track for pinch detection, even on data-no-pan elements.
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const target = e.target as Element;
    if (target.closest && target.closest('[data-no-pan]')) return;
    e.preventDefault();
    const ctm = svgRef.current!.getScreenCTM(); if (!ctm) return;
    dragRef.current = { x: e.clientX, y: e.clientY, sx: ctm.a, sy: ctm.d, v: viewRef.current };
    document.body.style.cursor = 'grabbing';
  };

  const zoomBy = (f: number) => {
    const v = viewRef.current;
    const cx = 1820 / 2, cy = 740 / 2;
    const wx = (cx - v.tx) / v.scale, wy = (cy - v.ty) / v.scale;
    const ns = Math.max(0.3, Math.min(5, v.scale * f));
    setView({ scale: ns, tx: cx - wx * ns, ty: cy - wy * ns });
  };
  const resetView = () => setView({ scale: 1, tx: 0, ty: 0 });
  const fitToContent = () => {
    if (positioned.length === 0) { resetView(); return; }
    const pad = 60;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of positioned) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
    }
    const cw = maxX - minX + pad * 2;
    const ch = maxY - minY + pad * 2;
    const scale = Math.min(1820 / cw, 740 / ch, 2);
    const tx = (1820 - cw * scale) / 2 - (minX - pad) * scale;
    const ty = (740  - ch * scale) / 2 - (minY - pad) * scale;
    setView({ scale, tx, ty });
  };

  // ── Drag a node (sends node:move on release) ────────────────────────
  const onNodeDown = (id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    const inner = innerGRef.current; if (!inner) return;
    const ctm = inner.getScreenCTM(); if (!ctm) return;
    const node = nodeMap[id]; if (!node) return;
    const startX = e.clientX, startY = e.clientY;
    const baseX = node.x, baseY = node.y;
    let lastX = baseX, lastY = baseY;
    const targetEl = e.currentTarget as Element;
    // Capture so subsequent move/up events come to us even off-element.
    try { targetEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / ctm.a;
      const dy = (ev.clientY - startY) / ctm.d;
      lastX = Math.round(baseX + dx);
      lastY = Math.round(baseY + dy);
      useStore.getState().upsertNode({ ...node, x: lastX, y: lastY });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      try { targetEl.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (lastX !== baseX || lastY !== baseY) emitNodeMove(id, lastX, lastY);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // ── Drag from socket to create an edge ──────────────────────────────
  const onSocketDown = (nodeId: string, side: Side, posSvg: { x: number; y: number }, e: React.PointerEvent) => {
    const inner = innerGRef.current; if (!inner) return;
    e.preventDefault(); e.stopPropagation();
    const isPull = side === 'L' || side === 'T';
    const startPos = { x: posSvg.x, y: posSvg.y };
    setEdgeDraft({ from: { nodeId, side, pos: startPos }, to: startPos, pull: isPull });

    const move = (ev: PointerEvent) => {
      const pt = svgRef.current!.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      const cur = pt.matrixTransform(inner.getScreenCTM()!.inverse());
      // Touch doesn't fire mouseenter on sockets — resolve target by hit-testing.
      if (ev.pointerType !== 'mouse') {
        const el = document.elementFromPoint(ev.clientX, ev.clientY) as Element | null;
        const nodeG = el?.closest?.('g.node[data-id]') as SVGGElement | null;
        const overId = nodeG?.getAttribute('data-id') || null;
        if (overId && overId !== nodeId) {
          (window as any).__hoveredSocketRef = { nodeId: overId, side: isPull ? 'R' : 'L' };
        } else {
          (window as any).__hoveredSocketRef = null;
        }
      }
      setEdgeDraft({ from: { nodeId, side, pos: startPos }, to: { x: cur.x, y: cur.y }, pull: isPull });
    };
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.style.cursor = '';
      const target = (window as any).__hoveredSocketRef as { nodeId: string; side: Side } | null;
      if (target && target.nodeId !== nodeId) {
        const from = isPull ? target.nodeId : nodeId;
        const to   = isPull ? nodeId : target.nodeId;
        await fetch(`${import.meta.env.VITE_API_URL ?? '/api'}/topology/edges`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ from, to, dashed: isPull }),
        });
      }
      setEdgeDraft(null);
    };
    document.body.style.cursor = 'crosshair';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  useEffect(() => {
    (window as any).__hoveredSocketRef = hoveredSocket;
  }, [hoveredSocket]);

  // ── Event-driven animation ─────────────────────────────────────────
  // Each `flow:event` from the socket → one dot rides the matching edge
  // from start to end. Mounts ONCE — re-running on every store update would
  // flush in-flight particles. Path geometry is resolved lazily on spawn,
  // and a tiny cache (keyed by edge id) invalidates when the SVGPathElement
  // identity changes (e.g. edge re-rendered after a node move).
  useEffect(() => {
    const layer = particleLayerRef.current;
    if (!layer) return;

    // Cubic curves come from cubicsRef (kept in sync with React state).
    // No DOM reads, no length caching — every frame is computed from the
    // current control points, so dot motion follows node drags smoothly.
    function getCubic(edgeId: number): Cubic | null {
      return cubicsRef.current.get(edgeId) ?? null;
    }

    const FREE: SVGCircleElement[] = [];
    const dotLayer = layer;
    function acquireDot(): SVGCircleElement {
      const reused = FREE.pop();
      if (reused) { reused.setAttribute('display', ''); return reused; }
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dotLayer.appendChild(el);
      return el;
    }
    function releaseDot(el: SVGCircleElement) { el.setAttribute('display', 'none'); FREE.push(el); }

    interface P { el: SVGCircleElement; edgeId: number; t: number; }
    const particles: P[] = [];

    // Cap high enough to never truncate at realistic traffic volume. When the
    // ceiling IS reached (degenerate burst), drop the NEW spawn rather than
    // killing established particles — killing the oldest looked like dots
    // "putus setengah" right before reaching their destination.
    const MAX_PARTICLES = 400;
    function spawnOnEdge(edgeId: number, color: string, R: number) {
      const cubic = getCubic(edgeId);
      if (!cubic) return;
      if (particles.length >= MAX_PARTICLES) return;
      const dot = acquireDot();
      dot.setAttribute('fill', color);
      dot.setAttribute('r', String(R));
      dot.setAttribute('opacity', '1');
      dot.setAttribute('cx', String(cubic.p0.x));
      dot.setAttribute('cy', String(cubic.p0.y));
      particles.push({ el: dot, edgeId, t: 0 });
    }

    const unsub = onFlow((ev) => {
      if (!tweaks.runningRef.current) return;
      const sizeKey = tweaks.particleSizeRef.current ?? 'medium';
      const R_DOT = sizeKey === 'small' ? 2.5 : sizeKey === 'large' ? 7 : 4;
      const colorCss = COLORS[ev.color] || '#94a3b8';
      spawnOnEdge(ev.edge_id, colorCss, R_DOT);
    });

    let prev = performance.now();
    let rafId = 0;
    const BASE = 0.32;

    function tick(now: number) {
      // When the tab is hidden the browser already throttles rAF, but we
      // can also bail early and skip the dt accumulation jump.
      if (document.hidden) {
        prev = now;
        rafId = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const isRunning = tweaks.runningRef.current;
      const speedScale = tweaks.speedRef.current ?? 1;
      const sizeKey = tweaks.particleSizeRef.current ?? 'medium';
      const R_DOT = sizeKey === 'small' ? 2.5 : sizeKey === 'large' ? 7 : 4;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (!isRunning) continue;
        p.t += BASE * speedScale * dt;
        p.el.setAttribute('r', String(R_DOT));
        if (p.t >= 1) {
          releaseDot(p.el);
          particles.splice(i, 1);
          continue;
        }
        // Read current control points each frame, evaluate Bezier in JS.
        // Survives node drags without any DOM coupling.
        const cubic = getCubic(p.edgeId);
        if (!cubic) {
          // Edge actually deleted — only then drop the dot.
          releaseDot(p.el);
          particles.splice(i, 1);
          continue;
        }
        const pt = bezierAt(cubic, p.t);
        p.el.setAttribute('cx', String(pt.x));
        p.el.setAttribute('cy', String(pt.y));
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      unsub();
      particles.forEach((p) => p.el.remove());
      FREE.forEach((el) => el.remove());
    };
    // Mount once. tweaks is memoized; pathRefs.current is mutated by React
    // refs as edges render. Lazy resolveEdge handles all new/changed edges.
  }, [tweaks]);

  return (
    <>
      <svg ref={svgRef}
           viewBox="0 0 1820 740"
           preserveAspectRatio="xMidYMid meet"
           onPointerDown={onPointerDown}
           style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab',
                    touchAction: 'none', userSelect: 'none' }}>
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

        {/* Stage handles the background; SVG paints only the grid overlay
            so the viewBox letterbox area stays the same color. */}
        {tweaks.showGrid && <rect width="1820" height="740" fill="url(#grid)"/>}

        <g ref={innerGRef} transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          {clusters.map((c) => <Cluster key={c.id} c={c} />)}

          <g className="edges">
            {edgeGeo.map((e) => {
              const isHover = hoverEdgeKey === e.key;
              return (
                <g key={e.key} data-no-pan>
                  {/* Wide invisible hitbox — easier to grab without overlapping nodes.
                      Pointer events so it works for both mouse hover AND touch tap. */}
                  <path d={e.d} fill="none" stroke="transparent" strokeWidth={18}
                        style={{ cursor: 'pointer', touchAction: 'none' }}
                        onPointerEnter={(ev) => { if (ev.pointerType === 'mouse') setHoverEdgeKey(e.key); }}
                        onPointerLeave={(ev) => { if (ev.pointerType === 'mouse') setHoverEdgeKey(null); }}
                        onPointerDown={(ev) => {
                          // Tap on touch toggles the × overlay; second tap on × deletes.
                          if (ev.pointerType !== 'mouse') {
                            ev.stopPropagation();
                            setHoverEdgeKey(isHover ? null : e.key);
                          }
                        }} />
                  {/* Soft glow underlay on hover */}
                  {isHover && (
                    <path d={e.d} fill="none" stroke={e.color}
                          strokeWidth={6} strokeOpacity={0.18} strokeLinecap="round"
                          pointerEvents="none" />
                  )}
                  <path ref={(el) => { if (el) pathRefs.current[e.key] = el; }}
                        d={e.d} fill="none" stroke={e.color}
                        strokeWidth={isHover ? 2.6 : e.dashed ? 1.2 : 1.8}
                        strokeOpacity={isHover ? 1 : e.dashed ? 0.32 : 0.55}
                        strokeDasharray={e.dashed ? '4 6' : undefined}
                        strokeLinecap="round" pointerEvents="none" />
                  {isHover && (() => {
                    const path = pathRefs.current[e.key];
                    if (!path) return null;
                    const mid = path.getPointAtLength((path.getTotalLength() || 0) / 2);
                    return (
                      <g style={{ cursor: 'pointer' }}
                         onClick={() => emitEdgeDelete(e.key)}>
                        {/* Larger click target around the X */}
                        <circle cx={mid.x} cy={mid.y} r={16} fill="transparent"/>
                        <circle cx={mid.x} cy={mid.y} r={11}
                                fill="#1a0808" stroke="#f87171" strokeWidth={1.6}/>
                        <text x={mid.x} y={mid.y + 4.5} fontSize={13} fontWeight={700}
                              textAnchor="middle" fill="#f87171"
                              style={{ fontFamily: 'monospace', userSelect: 'none' }}>×</text>
                      </g>
                    );
                  })()}
                </g>
              );
            })}
          </g>

          {/* No filter — SVG Gaussian blur on a layer is the single biggest
              CPU drain at ~30+ dots. We add per-dot glow via box-shadow-ish
              radial fill if needed instead. */}
          <g ref={particleLayerRef} className="particles"/>

          {edgeDraft && (() => {
            const pa: Port = { x: edgeDraft.from.pos.x, y: edgeDraft.from.pos.y, n: edgeDraft.from.side };
            const pb: Port = { x: edgeDraft.to.x, y: edgeDraft.to.y, n: OPP[edgeDraft.from.side] };
            const d = pathFreeform(pa, pb);
            const col = edgeDraft.pull ? '#22d3ee' : '#fbbf24';
            return (
              <g pointerEvents="none">
                <path d={d} fill="none" stroke={col} strokeWidth={2}
                      strokeDasharray={edgeDraft.pull ? '3 5' : '6 4'}
                      strokeLinecap="round" opacity={0.9}/>
                <circle cx={pb.x} cy={pb.y} r={5} fill={col} opacity={0.95}/>
                <text x={pa.x + (edgeDraft.from.side === 'L' ? -12 : edgeDraft.from.side === 'R' ? 12 : 0)}
                      y={pa.y + (edgeDraft.from.side === 'T' ? -10 : edgeDraft.from.side === 'B' ? 16 : -10)}
                      fontSize={10} fontWeight={700} fill={col} textAnchor="middle"
                      style={{ fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.1em' }}>
                  {edgeDraft.pull ? 'PULL' : 'PUSH'}
                </text>
              </g>
            );
          })()}

          {positioned.map((n) => (
            <g key={n.id} data-no-pan>
              <NodeShape n={n}
                         onSocketDown={onSocketDown}
                         hoveredSocket={hoveredSocket}
                         setHoveredSocket={setHoveredSocket}
                         onNodeDown={onNodeDown}
                         onNodeHover={setHoveredNode} />
            </g>
          ))}

          {/* Node hover tooltip — sits above the node, shows live metrics */}
          {hoveredNode && (() => {
            const n = nodeMap[hoveredNode]; if (!n) return null;
            const m = metrics.get(hoveredNode);
            const lines: Array<[string, string]> = [];
            lines.push(['kind',   n.kind]);
            lines.push(['status', n.status]);
            if (m) {
              lines.push(['in',  `${m.in_rate.toFixed(1)} ev/s`]);
              lines.push(['out', `${m.out_rate.toFixed(1)} ev/s`]);
              if (m.bytes_in > 0)    lines.push(['bytes/s', formatBytes(m.bytes_in)]);
              if (m.p95_latency_ms)  lines.push(['p95', `${Math.round(m.p95_latency_ms)} ms`]);
              if (m.bottleneck)      lines.push(['⚠', 'bottleneck']);
            }
            const TW = 180, TH = 14 + lines.length * 14 + 12;
            // Position above the node; flip below if it'd clip the top.
            const placeAbove = n.y - TH - 12 > 10;
            const TX = Math.max(10, Math.min(1810 - TW, n.cx - TW / 2));
            const TY = placeAbove ? n.y - TH - 12 : n.y + n.h + 12;
            return (
              <g pointerEvents="none" style={{ opacity: 0.96 }}>
                <rect x={TX} y={TY} width={TW} height={TH} rx={6}
                      fill="#0a0f1c" stroke="#334155" strokeWidth={1}/>
                <text x={TX + 10} y={TY + 14} fontSize={11} fontWeight={700}
                      fill="#e2e8f0"
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                  {n.label}
                </text>
                {lines.map(([k, v], i) => (
                  <g key={k}>
                    <text x={TX + 10} y={TY + 28 + i * 14}
                          fontSize={10} fill="#94a3b8"
                          style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                      {k}
                    </text>
                    <text x={TX + TW - 10} y={TY + 28 + i * 14}
                          fontSize={10} fill={k === '⚠' ? '#fca5a5' : '#e2e8f0'}
                          textAnchor="end"
                          style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                      {v}
                    </text>
                  </g>
                ))}
              </g>
            );
          })()}

          {/* Bottleneck overlay — pulsing border + backlog queue viz.
              Box position picks the first cardinal side that doesn't clip
              any other node's bounding rect (with a small margin). */}
          {positioned.map((n) => {
            const m = metrics.get(n.id);
            if (!m || !m.bottleneck) return null;
            const QW = 158, QH = 62, GAP = 10, MARGIN = 4;
            const candidates: Array<{ x: number; y: number; side: 'T' | 'B' | 'L' | 'R' }> = [
              { side: 'T', x: n.cx - QW / 2,  y: n.y - QH - GAP },
              { side: 'B', x: n.cx - QW / 2,  y: n.y + n.h + GAP },
              { side: 'R', x: n.x + n.w + GAP, y: n.cy - QH / 2 },
              { side: 'L', x: n.x - QW - GAP, y: n.cy - QH / 2 },
            ];
            // Hit-test against every other node (including bottleneck node body).
            const overlapsAny = (x: number, y: number) => {
              for (const other of positioned) {
                if (other.id === n.id) continue;
                const ox = other.x - MARGIN, oy = other.y - MARGIN;
                const ow = other.w + MARGIN * 2, oh = other.h + MARGIN * 2;
                if (!(x + QW <= ox || x >= ox + ow || y + QH <= oy || y >= oy + oh)) {
                  return true;
                }
              }
              // Also clip-test against the 1820x740 viewBox.
              if (x < 0 || y < 0 || x + QW > 1820 || y + QH > 740) return true;
              return false;
            };
            const pick = candidates.find((c) => !overlapsAny(c.x, c.y)) ?? candidates[0];
            const QX = pick.x, QY = pick.y;
            const dots = Array.from({ length: Math.min(m.backlog, 32) });
            // Connector line origin on the node side closest to the box.
            const connFrom = pick.side === 'T' ? { x: n.cx, y: n.y }
                          : pick.side === 'B' ? { x: n.cx, y: n.y + n.h }
                          : pick.side === 'L' ? { x: n.x, y: n.cy }
                          :                     { x: n.x + n.w, y: n.cy };
            const connTo = pick.side === 'T' ? { x: QX + QW / 2, y: QY + QH }
                        : pick.side === 'B' ? { x: QX + QW / 2, y: QY }
                        : pick.side === 'L' ? { x: QX + QW,     y: QY + QH / 2 }
                        :                     { x: QX,          y: QY + QH / 2 };
            return (
              <g key={`bn-${n.id}`} pointerEvents="none">
                <rect x={n.x - 3} y={n.y - 3} width={n.w + 6} height={n.h + 6} rx={11}
                      fill="none" stroke="#fca5a5" strokeWidth={1.5} opacity={0.6}>
                  <animate attributeName="opacity" values="0.2;0.85;0.2" dur="1.1s" repeatCount="indefinite"/>
                </rect>
                <line x1={connFrom.x} y1={connFrom.y} x2={connTo.x} y2={connTo.y}
                      stroke="#fca5a5" strokeWidth={1.2} strokeDasharray="3 3" opacity={0.55}/>
                <rect x={QX} y={QY} width={QW} height={QH} rx={6}
                      fill="#180808" stroke="#fca5a5" strokeWidth={1.4} strokeDasharray="5 4"/>
                <text x={QX + 10} y={QY + 14} fontSize={9} fontWeight={700} fill="#fca5a5"
                      style={{ fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.14em' }}>
                  ⚠ BACKLOG · {m.backlog} ev/s
                </text>
                {dots.map((_, i) => {
                  const col = i % 16, row = Math.floor(i / 16);
                  return <circle key={i} cx={QX + 12 + col * 8.5} cy={QY + 24 + row * 8.5}
                                 r={2.8} fill="#fca5a5" opacity={0.9}/>;
                })}
                {m.backlog > 32 && (
                  <text x={QX + QW - 8} y={QY + QH - 8} fontSize={9} fill="#fca5a5" textAnchor="end">
                    +{m.backlog - 32}
                  </text>
                )}
                {m.p95_latency_ms !== undefined && (
                  <text x={QX + QW - 10} y={QY + 14} fontSize={9} fill="#fca5a5" textAnchor="end"
                        style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                    p95 {Math.round(m.p95_latency_ms)}ms
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="playctl">
        <button onClick={() => setRunning(true)} className={running ? 'pc on' : 'pc'} title="Start">▶ Start</button>
        <button onClick={() => setRunning(false)} className={!running ? 'pc off' : 'pc'} title="Stop">■ Stop</button>
      </div>

      <div className="zoomctl">
        <button onClick={() => zoomBy(1.25)} title="Zoom in">＋</button>
        <div className="z">{Math.round(view.scale * 100)}%</div>
        <button onClick={() => zoomBy(0.8)} title="Zoom out">−</button>
        <button onClick={fitToContent} title="Fit to content">⛶</button>
        <button onClick={resetView} title="Reset view (1:1)">⟲</button>
      </div>

      {positioned.length > 0 && (
        <Minimap nodes={positioned} view={view} setView={setView}/>
      )}
    </>
  );
}

// ── Minimap ────────────────────────────────────────────────────────────
function Minimap({
  nodes, view, setView,
}: {
  nodes: PositionedNode[];
  view: { scale: number; tx: number; ty: number };
  setView: (v: { scale: number; tx: number; ty: number }) => void;
}) {
  const MW = 200, MH = 100;
  const VW = 1820, VH = 740;
  const sx = MW / VW, sy = MH / VH;

  // Viewport rect in world coords.
  const vx = -view.tx / view.scale;
  const vy = -view.ty / view.scale;
  const vw = VW / view.scale;
  const vh = VH / view.scale;

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / sx;
    const my = (e.clientY - rect.top) / sy;
    // Center the viewport on the clicked point.
    setView({
      scale: view.scale,
      tx: VW / 2 - mx * view.scale,
      ty: VH / 2 - my * view.scale,
    });
  };

  return (
    <div style={{
      position: 'absolute', right: 18, top: 18,
      background: 'rgba(7,11,24,0.88)', backdropFilter: 'blur(10px)',
      border: '1px solid var(--line)', borderRadius: 8,
      padding: 6, zIndex: 4,
    }}>
      <svg width={MW} height={MH} viewBox={`0 0 ${MW} ${MH}`}
           style={{ cursor: 'pointer', display: 'block' }}
           onClick={onClick}>
        <rect width={MW} height={MH} fill="#040711"/>
        {nodes.map((n) => (
          <rect key={n.id} x={n.x * sx} y={n.y * sy} width={n.w * sx} height={n.h * sy}
                fill={n.status === 'live' ? '#34d399' : n.status === 'stale' ? '#fbbf24' : '#475569'}
                fillOpacity={n.stub ? 0.3 : 0.7} rx={1}/>
        ))}
        <rect x={vx * sx} y={vy * sy} width={vw * sx} height={vh * sy}
              fill="none" stroke="#818cf8" strokeWidth={1.2}
              strokeDasharray="3 2" opacity={0.9}/>
      </svg>
    </div>
  );
}
