import type { ClusterDTO } from '@pipeflow/shared';
import { COLORS } from '../colors';

interface Props {
  c: ClusterDTO;
}

export function Cluster({ c }: Props) {
  const color = COLORS[c.color] || '#64748b';
  const vertical = c.orient === 'V';
  return (
    <g className="cluster">
      <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={14}
            fill={color} fillOpacity={0.05}
            stroke={color} strokeOpacity={0.32} strokeWidth={1.2}
            strokeDasharray="5 5" />
      {vertical ? (
        <text x={c.x + 14} y={c.y + c.h / 2}
              fontSize={11} fontWeight={700}
              fill={color} fillOpacity={0.92}
              textAnchor="middle"
              transform={`rotate(-90 ${c.x + 14} ${c.y + c.h / 2})`}
              style={{ letterSpacing: '0.18em', textTransform: 'uppercase',
                       pointerEvents: 'none', userSelect: 'none',
                       fontFamily: "'JetBrains Mono', monospace" }}>
          {c.label}
        </text>
      ) : (
        <text x={c.x + 12} y={c.y + 19} fontSize={11} fontWeight={700}
              fill={color} fillOpacity={0.92}
              style={{ letterSpacing: '0.16em', textTransform: 'uppercase',
                       pointerEvents: 'none', userSelect: 'none',
                       fontFamily: "'JetBrains Mono', monospace" }}>
          {c.label}
        </text>
      )}
    </g>
  );
}
