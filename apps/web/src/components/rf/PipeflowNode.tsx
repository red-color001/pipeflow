import { memo, useState } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { NodeDTO } from '@pipeflow/shared';
import { COLORS } from '../../colors';
import { emitNodeDelete } from '../../socket';
import { useStore } from '../../store';

export type PipeflowNodeData = NodeDTO & Record<string, unknown>;
export type PipeflowNodeType = Node<PipeflowNodeData, 'pipeflow'>;

function PipeflowNodeImpl({ data, selected }: NodeProps<PipeflowNodeType>) {
  const n = data;
  const color = COLORS[n.color] || '#64748b';
  const small = n.kind === 'user' || n.kind === 'ext';
  const fontSize = small ? 12.5 : 13.5;
  const dim = n.status === 'dead' || n.stub;
  const stale = n.status === 'stale';
  const live = n.status === 'live' && !n.stub;
  const [hover, setHover] = useState(false);
  const stats = useStore((s) => s.stats.get(n.id));
  const showStats = !n.stub && stats !== undefined &&
    (stats.cpu_pct !== undefined || stats.mem_pct !== undefined);

  const onDelete = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (window.confirm(`Hapus node "${n.label}"?\nSemua edge yang terhubung akan ikut terhapus.`)) {
      emitNodeDelete(n.id);
    }
  };

  return (
    <div
      data-pipeflow-node-id={n.id}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        width: n.w,
        height: n.h,
        background: '#0b1220',
        border: `1.5px ${n.stub ? 'dashed' : 'solid'} ${color}`,
        borderRadius: n.kind === 'db' ? 8 : 9,
        opacity: dim ? 0.42 : 1,
        cursor: 'grab',
        boxShadow: selected ? `0 0 0 2px ${color}55` : undefined,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        color: '#e2e8f0',
      }}
    >
      {/* Accent bar */}
      <div
        style={{
          position: 'absolute', top: 0, left: 0,
          width: 3.5, height: '100%',
          background: color, borderTopLeftRadius: 2, borderBottomLeftRadius: 2,
          pointerEvents: 'none',
        }}
      />
      {/* Status indicator — hide on hover so delete button is unobstructed */}
      {live && !hover && (
        <>
          <div
            style={{
              position: 'absolute', top: 4, right: 4,
              width: 14, height: 14, borderRadius: '50%',
              background: '#34d39940',
              animation: 'pipeflowRadar 1.6s ease-in-out infinite',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute', top: 9, right: 9,
              width: 5, height: 5, borderRadius: '50%',
              background: '#34d399',
              pointerEvents: 'none',
            }}
          />
        </>
      )}
      {stale && !hover && (
        <div
          style={{
            position: 'absolute', top: 7, right: 7,
            width: 6, height: 6, borderRadius: '50%',
            background: '#fbbf24',
            animation: 'pipeflowBlink 1.4s ease-in-out infinite',
            pointerEvents: 'none',
          }}
        />
      )}
      {n.stub && !hover && (
        <div
          style={{
            position: 'absolute', top: 4, right: 6,
            fontSize: 9, fontWeight: 700,
            color: '#94a3b8', letterSpacing: '0.1em',
            pointerEvents: 'none',
          }}
        >
          STUB
        </div>
      )}
      {/* Label */}
      <div
        style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize, fontWeight: 600, letterSpacing: '0.01em',
          pointerEvents: 'none', userSelect: 'none',
        }}
      >
        {n.label}
      </div>

      {/* Delete button — hover only, inside top-right corner */}
      {hover && (
        <div
          className="nodrag nopan"
          onClick={onDelete}
          onMouseDown={(ev) => ev.stopPropagation()}
          title="Delete node"
          style={{
            position: 'absolute', top: 4, right: 4,
            width: 18, height: 18, borderRadius: '50%',
            background: '#f87171',
            border: '1.4px solid #0b1220',
            color: '#0b1220',
            fontSize: 13, fontWeight: 800, lineHeight: '13px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', zIndex: 10,
            boxShadow: '0 0 6px rgba(248,113,113,0.6)',
            pointerEvents: 'all',
          }}
        >
          ×
        </div>
      )}

      {/* Resource bars (CPU + MEM) — bottom of card, only when agent reports stats */}
      {showStats && (
        <div
          style={{
            position: 'absolute', left: 6, right: 6, bottom: 4,
            display: 'flex', flexDirection: 'column', gap: 2,
            pointerEvents: 'none',
          }}
        >
          <StatBar label="C" pct={stats!.cpu_pct} />
          <StatBar label="M" pct={stats!.mem_pct} />
        </div>
      )}

      {/* Handles (sockets) — strict directional: left = input, right = output. */}
      <Handle id="in"  type="target" position={Position.Left}  style={handleStyle(color)} />
      <Handle id="out" type="source" position={Position.Right} style={handleStyle(color)} />
    </div>
  );
}

function StatBar({ label, pct }: { label: string; pct?: number }) {
  if (pct === undefined) return null;
  const clamped = Math.max(0, Math.min(100, pct));
  // Color ramp: green → amber → red as pct rises.
  const fill = clamped < 60 ? '#34d399' : clamped < 85 ? '#fbbf24' : '#f87171';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{
        fontSize: 8, color: '#94a3b8', width: 8, textAlign: 'center',
        letterSpacing: '0.04em',
      }}>{label}</span>
      <div style={{
        flex: 1, height: 4, borderRadius: 2,
        background: 'rgba(148,163,184,0.18)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${clamped}%`, height: '100%', background: fill,
          transition: 'width 0.35s ease-out, background 0.35s',
        }} />
      </div>
      <span style={{
        fontSize: 8, color: '#cbd5e1', width: 22, textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
      }}>{clamped.toFixed(0)}%</span>
    </div>
  );
}

function handleStyle(color: string): React.CSSProperties {
  return {
    width: 12, height: 12,
    background: color,
    border: `1.6px solid ${color}`,
    opacity: 0.9,
  };
}

export const PipeflowNode = memo(PipeflowNodeImpl);
