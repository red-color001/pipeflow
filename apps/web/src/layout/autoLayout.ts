import dagre from 'dagre';
import type { NodeDTO, EdgeDTO } from '@pipeflow/shared';

export type LayoutDir = 'LR' | 'TB' | 'RL' | 'BT';

export interface LaidOutPos { id: string; x: number; y: number }

// Run dagre layout. Returns new (x,y) per node. Existing node sizes (w,h) are
// honored. Edges are treated as plain DAG edges; cycles still work but may
// produce odd routing.
export function autoLayout(
  nodes: NodeDTO[],
  edges: EdgeDTO[],
  dir: LayoutDir = 'LR',
): LaidOutPos[] {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: dir,
    ranksep: 90,
    nodesep: 48,
    edgesep: 24,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    g.setNode(n.id, { width: n.w, height: n.h });
  }
  for (const e of edges) {
    if (!g.hasNode(e.from) || !g.hasNode(e.to)) continue;
    g.setEdge(e.from, e.to, {}, String(e.id));
  }

  dagre.layout(g);

  return nodes.map((n) => {
    const p = g.node(n.id);
    // dagre returns center coords; convert to top-left.
    return {
      id: n.id,
      x: Math.round(p.x - n.w / 2),
      y: Math.round(p.y - n.h / 2),
    };
  });
}
