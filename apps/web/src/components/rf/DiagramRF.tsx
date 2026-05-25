import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Panel,
  type NodeChange, type EdgeChange, type Connection,
  useReactFlow, useViewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { useStore } from '../../store';
import type { NodeDTO, NodeMetric } from '@pipeflow/shared';
import { COLORS } from '../../colors';
import { PipeflowNode, type PipeflowNodeType } from './PipeflowNode';
import { PipeflowEdge, type PipeflowEdgeType } from './PipeflowEdge';
import { ParticleLayer } from './ParticleLayer';
import { emitNodeMove } from '../../socket';
import { authHeaders } from '../../auth';
import { useEdgeRates } from '../../hooks/useEdgeRates';

const nodeTypes = { pipeflow: PipeflowNode };
const edgeTypes = { pipeflow: PipeflowEdge };

interface Props {
  running: boolean;
  particleSize?: 'small' | 'medium' | 'large';
}

export function DiagramRF(props: Props) {
  return (
    <ReactFlowProvider>
      <DiagramRFInner {...props} />
    </ReactFlowProvider>
  );
}

const selectNodes  = (s: ReturnType<typeof useStore.getState>) => s.nodes;
const selectEdges  = (s: ReturnType<typeof useStore.getState>) => s.edges;
const selectMetric = (s: ReturnType<typeof useStore.getState>) => s.metrics;

function DiagramRFInner({ running, particleSize = 'medium' }: Props) {
  const storeNodes = useStore(selectNodes);
  const storeEdges = useStore(selectEdges);
  const metrics = useStore(selectMetric);
  const edgeRates = useEdgeRates();
  const { fitView } = useReactFlow();

  // Convert store nodes → React Flow nodes. Use position from store.
  const rfNodes = useMemo<PipeflowNodeType[]>(() => {
    const arr: PipeflowNodeType[] = [];
    storeNodes.forEach((n) => {
      arr.push({
        id: n.id,
        type: 'pipeflow',
        position: { x: n.x, y: n.y },
        data: n as NodeDTO & Record<string, unknown>,
        width: n.w,
        height: n.h,
        draggable: true,
        deletable: false,
      });
    });
    return arr;
  }, [storeNodes]);

  // Convert store edges → React Flow edges. Inject per-edge rate/p95 from the
  // rolling flow-event aggregator so PipeflowEdge can render labels.
  const rfEdges = useMemo<PipeflowEdgeType[]>(() => {
    const arr: PipeflowEdgeType[] = [];
    storeEdges.forEach((e) => {
      const r = edgeRates.get(e.id);
      arr.push({
        id: `e-${e.id}`,
        type: 'pipeflow',
        source: e.from,
        target: e.to,
        // We let React Flow auto-route through the closest handles unless we
        // pin them. Free routing keeps things tidy with many edges.
        data: {
          edgeId: e.id,
          color: e.color,
          dashed: e.dashed,
          rate: r?.rate,
          p95: r?.p95 ?? null,
        },
      });
    });
    return arr;
  }, [storeEdges, edgeRates]);

  // Drag-in-progress position cache (per node) — committed to server on stop.
  const pendingPos = useRef<Map<string, { x: number; y: number }>>(new Map());

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    for (const c of changes) {
      if (c.type === 'position' && c.position) {
        // Update local store immediately so edge geometry tracks the drag.
        const cur = useStore.getState().nodes.get(c.id);
        if (cur) {
          useStore.getState().upsertNode({
            ...cur,
            x: Math.round(c.position.x),
            y: Math.round(c.position.y),
          });
          pendingPos.current.set(c.id, {
            x: Math.round(c.position.x),
            y: Math.round(c.position.y),
          });
        }
        // When the drag ends, RF sends a change with `dragging: false`. Emit
        // the final position to the server then.
        if ((c as any).dragging === false) {
          const p = pendingPos.current.get(c.id);
          if (p) {
            emitNodeMove(c.id, p.x, p.y);
            pendingPos.current.delete(c.id);
          }
        }
      }
    }
  }, [rfNodes]);

  // We don't allow free-form RF edge changes here; deletions go through the
  // edge × button which calls emitEdgeDelete. RF still expects the prop, so
  // we provide a noop.
  const onEdgesChange = useCallback((_changes: EdgeChange[]) => { /* noop */ }, []);

  const onConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return;
    fetch(`${import.meta.env.VITE_API_URL ?? '/api'}/topology/edges`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ from: conn.source, to: conn.target, dashed: false }),
    }).then(async (r) => {
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        console.error('connect edge failed:', r.status, j);
      }
    }).catch((e) => console.error('connect edge error:', e));
  }, []);

  // Auto-fit when first nodes arrive.
  const didFit = useRef(false);
  useEffect(() => {
    if (didFit.current) return;
    if (rfNodes.length === 0) return;
    didFit.current = true;
    setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 100);
  }, [rfNodes, fitView]);

  // ── Auto-layout (dagre) ────────────────────────────────────────────────
  // Re-flows all nodes into a tidy DAG with no overlap, then commits each
  // new position to the server via node:move. Direction toggles LR/TB.
  const [layingOut, setLayingOut] = useState(false);
  const runAutoLayout = useCallback((rankdir: 'LR' | 'TB') => {
    if (layingOut) return;
    const nodes = useStore.getState().nodes;
    const edges = useStore.getState().edges;
    if (nodes.size === 0) return;
    setLayingOut(true);

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir,
      nodesep: 60,   // gap between siblings (perpendicular to rank)
      ranksep: 90,   // gap between ranks (along flow direction)
      edgesep: 24,
      marginx: 40,
      marginy: 40,
    });
    g.setDefaultEdgeLabel(() => ({}));

    nodes.forEach((n) => {
      g.setNode(n.id, { width: n.w, height: n.h });
    });
    edges.forEach((e) => {
      if (nodes.has(e.from) && nodes.has(e.to)) g.setEdge(e.from, e.to);
    });

    try {
      dagre.layout(g);
    } catch (err) {
      console.error('auto-layout failed:', err);
      setLayingOut(false);
      return;
    }

    nodes.forEach((n) => {
      const pos = g.node(n.id);
      if (!pos) return;
      // dagre centers at (x,y); RF positions at top-left.
      const x = Math.round(pos.x - n.w / 2);
      const y = Math.round(pos.y - n.h / 2);
      if (x === n.x && y === n.y) return;
      useStore.getState().upsertNode({ ...n, x, y });
      emitNodeMove(n.id, x, y);
    });

    setTimeout(() => {
      fitView({ padding: 0.2, duration: 500 });
      setLayingOut(false);
    }, 80);
  }, [fitView, layingOut]);

  return (
    <>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        connectionRadius={28}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        minZoom={0.3}
        maxZoom={5}
        colorMode="dark"
        snapToGrid
        snapGrid={[14, 14]}
        style={{ background: 'transparent' }}
      >
        <Background gap={28} color="#1e293b" />
        <Controls showInteractive={false} />
        <Panel position="top-right">
          <div className="autoLayoutPanel">
            <button
              className="autoLayoutBtn"
              onClick={() => runAutoLayout('LR')}
              disabled={layingOut}
              title="Auto-layout horizontal (left → right)"
            >
              <span className="alIcon">⇆</span> Auto-Layout
            </button>
            <button
              className="autoLayoutBtn alSecondary"
              onClick={() => runAutoLayout('TB')}
              disabled={layingOut}
              title="Auto-layout vertical (top → bottom)"
            >
              ⇅
            </button>
          </div>
        </Panel>
        <MiniMap
          nodeColor={(n) => {
            const d = (n.data as unknown as NodeDTO | undefined);
            return d ? (COLORS[d.color] || '#64748b') : '#475569';
          }}
          maskColor="rgba(7,11,24,0.7)"
          pannable
          zoomable
        />
        <ParticleLayer running={running} particleSize={particleSize} />
        <BottleneckOverlay metrics={metrics} />
      </ReactFlow>
    </>
  );
}

// ─── Bottleneck overlay ───────────────────────────────────────────────
// Rendered as an absolutely-positioned layer inside React Flow's viewport.
function BottleneckOverlay({ metrics }: { metrics: Map<string, NodeMetric> }) {
  const storeNodes = useStore(selectNodes);
  const { x: tx, y: ty, zoom } = useViewport();

  const items = useMemo(() => {
    const out: Array<{ n: NodeDTO; m: NodeMetric }> = [];
    storeNodes.forEach((n) => {
      const m = metrics.get(n.id);
      if (m && m.bottleneck) out.push({ n, m });
    });
    return out;
  }, [storeNodes, metrics]);

  if (items.length === 0) return null;

  return (
    <svg
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 5,
      }}
    >
      <g transform={`translate(${tx} ${ty}) scale(${zoom})`}>
        {items.map(({ n, m }) => {
          const QW = 158, QH = 62, GAP = 10;
          // Place above by default; flip below if too close to top.
          const placeAbove = n.y > QH + GAP + 4;
          const QX = n.x + n.w / 2 - QW / 2;
          const QY = placeAbove ? n.y - QH - GAP : n.y + n.h + GAP;
          const dots = Array.from({ length: Math.min(m.backlog, 32) });
          return (
            <g key={`bn-${n.id}`}>
              {/* Pulsing border */}
              <rect x={n.x - 3} y={n.y - 3} width={n.w + 6} height={n.h + 6} rx={11}
                    fill="none" stroke="#fca5a5" strokeWidth={1.5} opacity={0.6}>
                <animate attributeName="opacity" values="0.2;0.85;0.2" dur="1.1s" repeatCount="indefinite"/>
              </rect>
              <line x1={n.x + n.w / 2} y1={placeAbove ? n.y : n.y + n.h}
                    x2={n.x + n.w / 2} y2={placeAbove ? QY + QH : QY}
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
  );
}

