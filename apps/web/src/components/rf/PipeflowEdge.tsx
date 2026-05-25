import { memo, useRef, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps, type Edge } from '@xyflow/react';
import type { ColorKey } from '@pipeflow/shared';
import { COLORS } from '../../colors';
import { emitEdgeDelete } from '../../socket';

export interface PipeflowEdgeData extends Record<string, unknown> {
  edgeId: number;
  color: ColorKey;
  dashed: boolean;
  rate?: number;       // events/sec (5s window)
  p95?: number | null; // p95 latency in ms
}

export type PipeflowEdgeType = Edge<PipeflowEdgeData, 'pipeflow'>;

function PipeflowEdgeImpl(props: EdgeProps<PipeflowEdgeType>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const [hover, setHover] = useState(false);
  const hoverOffT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterHover = () => {
    if (hoverOffT.current) { clearTimeout(hoverOffT.current); hoverOffT.current = null; }
    setHover(true);
  };
  const leaveHover = () => {
    if (hoverOffT.current) clearTimeout(hoverOffT.current);
    hoverOffT.current = setTimeout(() => setHover(false), 120);
  };

  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const colorCss = COLORS[data?.color ?? 'neutral'] || '#94a3b8';
  const dashed = !!data?.dashed;
  const edgeId = data?.edgeId;
  const rate = data?.rate;
  const p95 = data?.p95;
  const showLabel = (rate ?? 0) > 0 || (p95 ?? 0) > 0;

  return (
    <>
      {/* Glow underlay on hover */}
      {hover && (
        <path
          d={path}
          fill="none"
          stroke={colorCss}
          strokeWidth={6}
          strokeOpacity={0.18}
          strokeLinecap="round"
          pointerEvents="none"
        />
      )}
      <BaseEdge
        id={id}
        path={path}
        className="pipeflowEdgeFlow"
        style={{
          stroke: colorCss,
          strokeWidth: hover ? 2.6 : dashed ? 1.2 : 1.6,
          strokeOpacity: hover ? 1 : dashed ? 0.38 : 0.6,
          strokeDasharray: '6 8',
          strokeLinecap: 'round',
        }}
        {...({ 'data-pipeflow-edge-id': edgeId } as Record<string, unknown>)}
      />
      {/* Wide invisible hitbox for hover/click */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        style={{ cursor: 'pointer' }}
        onMouseEnter={enterHover}
        onMouseLeave={leaveHover}
      />
      {hover && edgeId != null && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            onClick={(ev) => {
              ev.stopPropagation();
              if (window.confirm('Hapus edge ini?')) emitEdgeDelete(edgeId);
            }}
            onMouseEnter={enterHover}
            onMouseLeave={leaveHover}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              width: 18, height: 18, borderRadius: '50%',
              background: '#f87171',
              border: '1.4px solid #0b1220',
              color: '#0b1220',
              fontSize: 12, fontWeight: 800, lineHeight: '13px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', pointerEvents: 'all',
              fontFamily: "'JetBrains Mono', monospace",
              boxShadow: '0 0 8px rgba(248,113,113,0.7)',
            }}
            title="Delete edge"
          >
            ×
          </div>
        </EdgeLabelRenderer>
      )}
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: 'rgba(11,18,32,0.85)',
              border: `1px solid ${colorCss}55`,
              borderRadius: 4,
              padding: '2px 6px',
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              color: '#cbd5e1',
              pointerEvents: 'none',
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
            }}
          >
            {(rate ?? 0) > 0 && <span style={{ color: colorCss }}>{formatRate(rate!)}</span>}
            {(rate ?? 0) > 0 && (p95 ?? 0) > 0 && <span style={{ opacity: 0.4 }}> · </span>}
            {(p95 ?? 0) > 0 && <span>{Math.round(p95!)}ms</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

function formatRate(r: number): string {
  if (r >= 1000) return `${(r / 1000).toFixed(1)}k/s`;
  if (r >= 100) return `${Math.round(r)}/s`;
  if (r >= 10) return `${r.toFixed(1)}/s`;
  return `${r.toFixed(2)}/s`;
}

export const PipeflowEdge = memo(PipeflowEdgeImpl);
