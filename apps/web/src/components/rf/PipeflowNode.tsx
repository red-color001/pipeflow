import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { NodeDTO } from '@pipeflow/shared';
import { COLORS } from '../../colors';

// React Flow requires node data to satisfy Record<string, unknown>.
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

  return (
    <div
      data-pipeflow-node-id={n.id}
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
      {/* Status indicator */}
      {live && (
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
      {stale && (
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
      {n.stub && (
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

      {/* Handles (sockets) — both source AND target on every side so users
          can drag a connection from any side to any side. */}
      <Handle id="l-s" type="source" position={Position.Left}   style={handleStyle(color, 'L')} />
      <Handle id="l-t" type="target" position={Position.Left}   style={handleStyle(color, 'L', true)} />
      <Handle id="r-s" type="source" position={Position.Right}  style={handleStyle(color, 'R')} />
      <Handle id="r-t" type="target" position={Position.Right}  style={handleStyle(color, 'R', true)} />
      <Handle id="t-s" type="source" position={Position.Top}    style={handleStyle(color, 'T')} />
      <Handle id="t-t" type="target" position={Position.Top}    style={handleStyle(color, 'T', true)} />
      <Handle id="b-s" type="source" position={Position.Bottom} style={handleStyle(color, 'B')} />
      <Handle id="b-t" type="target" position={Position.Bottom} style={handleStyle(color, 'B', true)} />
    </div>
  );
}

function handleStyle(color: string, _side: 'L' | 'R' | 'T' | 'B', overlay = false): React.CSSProperties {
  return {
    width: 12, height: 12,
    background: overlay ? 'transparent' : color,
    border: `1.6px solid ${color}`,
    opacity: overlay ? 0 : 0.9,
  };
}

export const PipeflowNode = memo(PipeflowNodeImpl);
