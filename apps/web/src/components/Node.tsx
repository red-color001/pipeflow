import type { PositionedNode, Side } from '../geometry';
import { socketPos } from '../geometry';
import { COLORS } from '../colors';

interface Props {
  n: PositionedNode;
  onSocketDown: (id: string, side: Side, pos: { x: number; y: number }, e: React.PointerEvent) => void;
  hoveredSocket: { nodeId: string; side: Side } | null;
  setHoveredSocket: (v: { nodeId: string; side: Side } | null) => void;
  onNodeDown: (id: string, e: React.PointerEvent) => void;
  onNodeHover?: (id: string | null) => void;
}

export function NodeShape({ n, onSocketDown, hoveredSocket, setHoveredSocket, onNodeDown, onNodeHover }: Props) {
  const color = COLORS[n.color] || '#64748b';
  const small = n.kind === 'user' || n.kind === 'ext';
  const fontSize = small ? 12.5 : 13.5;
  const dim = n.status === 'dead' || n.stub;
  const stale = n.status === 'stale';
  const live = n.status === 'live' && !n.stub;
  return (
    <g className="node" data-id={n.id} opacity={dim ? 0.42 : 1}>
      <rect x={n.x} y={n.y} width={n.w} height={n.h}
            rx={n.kind === 'db' ? 8 : 9}
            fill="#0b1220"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray={n.stub ? '4 4' : undefined}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => onNodeDown(n.id, e)}
            onPointerEnter={() => onNodeHover?.(n.id)}
            onPointerLeave={() => onNodeHover?.(null)} />
      <rect x={n.x} y={n.y} width={3.5} height={n.h} rx={2} fill={color} />
      {/* Status indicator dot (top-right corner) */}
      {live && (
        <>
          <circle cx={n.x + n.w - 9} cy={n.y + 9} r={5} fill="#34d399" opacity={0.25}>
            <animate attributeName="r" values="3.5;7;3.5" dur="1.6s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.5;0;0.5" dur="1.6s" repeatCount="indefinite"/>
          </circle>
          <circle cx={n.x + n.w - 9} cy={n.y + 9} r={2.6} fill="#34d399"/>
        </>
      )}
      {stale && (
        <circle cx={n.x + n.w - 9} cy={n.y + 9} r={3} fill="#fbbf24">
          <animate attributeName="opacity" values="0.3;1;0.3" dur="1.4s" repeatCount="indefinite"/>
        </circle>
      )}
      {n.stub && (
        <text x={n.x + n.w - 6} y={n.y + 12} fontSize={9} fontWeight={700}
              textAnchor="end" fill="#94a3b8"
              style={{ fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.1em', pointerEvents: 'none' }}>
          STUB
        </text>
      )}
      <text x={n.cx} y={n.cy + 4.5} fontSize={fontSize} fontWeight={600}
            textAnchor="middle" fill="#e2e8f0"
            style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                     letterSpacing: '0.01em', pointerEvents: 'none', userSelect: 'none' }}>
        {n.label}
      </text>
      {/* Sockets — bigger hit area, bigger hover state */}
      {(['L','R','T','B'] as Side[]).map((side) => {
        const p = socketPos(n, side);
        const isOutput = side === 'R' || side === 'B';
        const isHover = hoveredSocket && hoveredSocket.nodeId === n.id && hoveredSocket.side === side;
        return (
          <g key={side}>
            <circle cx={p.x} cy={p.y} r={isHover ? 9 : 6}
                    fill={isHover ? color : (isOutput ? color : '#0b1220')}
                    fillOpacity={isHover ? 1 : (isOutput ? 0.9 : 1)}
                    stroke={color} strokeWidth={1.8}
                    style={{ cursor: 'crosshair', transition: 'r 0.12s' }}
                    onPointerDown={(e) => { e.stopPropagation(); onSocketDown(n.id, side, p, e); }}
                    onPointerEnter={() => setHoveredSocket({ nodeId: n.id, side })}
                    onPointerLeave={() => setHoveredSocket(null)} />
            {/* Bigger invisible hitbox */}
            <circle cx={p.x} cy={p.y} r={20}
                    fill="transparent"
                    style={{ cursor: 'crosshair', touchAction: 'none' }}
                    onPointerDown={(e) => { e.stopPropagation(); onSocketDown(n.id, side, p, e); }}
                    onPointerEnter={() => setHoveredSocket({ nodeId: n.id, side })}
                    onPointerLeave={() => setHoveredSocket(null)} />
          </g>
        );
      })}
    </g>
  );
}
