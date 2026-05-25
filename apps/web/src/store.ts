import { create } from 'zustand';
import type { NodeDTO, EdgeDTO, ClusterDTO, AgentStatus, FlowEvent, NodeMetric } from '@pipeflow/shared';

// Tiny pub-sub for live flow events. Diagram subscribes once and uses the
// burst to spawn a particle on the matching edge. We keep it out of the
// reactive store to avoid React rerenders on every event.
type FlowListener = (e: FlowEvent) => void;
const flowListeners = new Set<FlowListener>();
export function onFlow(l: FlowListener): () => void {
  flowListeners.add(l);
  return () => flowListeners.delete(l);
}
export function emitFlow(e: FlowEvent) { flowListeners.forEach((l) => l(e)); }

interface State {
  nodes: Map<string, NodeDTO>;
  edges: Map<number, EdgeDTO>;
  clusters: ClusterDTO[];
  metrics: Map<string, NodeMetric>;

  setAll: (t: { nodes: NodeDTO[]; edges: EdgeDTO[]; clusters: ClusterDTO[] }) => void;
  upsertNode: (n: NodeDTO) => void;
  removeNode: (id: string) => void;
  upsertEdge: (e: EdgeDTO) => void;
  removeEdge: (id: number) => void;
  setStatus: (id: string, status: AgentStatus) => void;
  setMetric: (m: NodeMetric) => void;
}

export const useStore = create<State>((set) => ({
  nodes: new Map(),
  edges: new Map(),
  clusters: [],
  metrics: new Map(),

  setAll: ({ nodes, edges, clusters }) =>
    set({
      nodes: new Map(nodes.map((n) => [n.id, n])),
      edges: new Map(edges.map((e) => [e.id, e])),
      clusters,
      metrics: new Map(),
    }),

  upsertNode: (n) =>
    set((s) => {
      const m = new Map(s.nodes); m.set(n.id, n);
      return { nodes: m };
    }),

  removeNode: (id) =>
    set((s) => {
      const m = new Map(s.nodes); m.delete(id);
      return { nodes: m };
    }),

  upsertEdge: (e) =>
    set((s) => {
      const m = new Map(s.edges); m.set(e.id, e);
      return { edges: m };
    }),

  removeEdge: (id) =>
    set((s) => {
      const m = new Map(s.edges); m.delete(id);
      return { edges: m };
    }),

  setStatus: (id, status) =>
    set((s) => {
      const cur = s.nodes.get(id); if (!cur) return s;
      const m = new Map(s.nodes); m.set(id, { ...cur, status });
      return { nodes: m };
    }),

  setMetric: (mm) =>
    set((s) => {
      const m = new Map(s.metrics); m.set(mm.id, mm);
      return { metrics: m };
    }),
}));
