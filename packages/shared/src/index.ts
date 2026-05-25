export type NodeKind = 'user' | 'ext' | 'fe' | 'be' | 'svc' | 'wk' | 'kf' | 'db' | 'obs';
export type AgentStatus = 'live' | 'stale' | 'dead';

export type ColorKey =
  | 'indigo' | 'teal' | 'amber' | 'red' | 'violet' | 'orange'
  | 'green' | 'cyan' | 'pink' | 'purple' | 'yorange' | 'neutral';

export interface TargetDecl {
  to: string;
  color?: ColorKey;
  dashed?: boolean;
  label?: string;
}

export interface RegisterPayload {
  id: string;
  label: string;
  node_type: NodeKind;
  color?: ColorKey;
  service?: string;
  host?: string;
  version?: string;
  w?: number;
  h?: number;
  targets?: TargetDecl[];
}

export interface NodeDTO {
  id: string;
  label: string;
  kind: NodeKind;
  color: ColorKey;
  x: number;
  y: number;
  w: number;
  h: number;
  cluster_id: string | null;
  status: AgentStatus;
  stub: boolean;
}

export interface EdgeDTO {
  id: number;
  from: string;
  to: string;
  color: ColorKey;
  dashed: boolean;
  label?: string | null;
  source: 'agent' | 'manual';
}

export interface ClusterDTO {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: ColorKey;
  orient?: 'V' | null;
  accepts_kinds: NodeKind[];
}

export interface TopologyDTO {
  nodes: NodeDTO[];
  edges: EdgeDTO[];
  clusters: ClusterDTO[];
}

export interface FlowEvent {
  from: string;
  to: string;
  edge_id: number;
  color: ColorKey;
  bytes?: number;
  latency_ms?: number;
}

// Per-node rolling metrics derived from flow events. Server pushes these
// every ~1s. Used by the UI to render bottleneck overlays.
export interface NodeMetric {
  id: string;
  in_rate: number;        // events/sec into node, 5s window
  out_rate: number;       // events/sec out of node, 5s window
  bytes_in: number;       // bytes/sec into node, 5s window
  backlog: number;        // virtual queue length (in_rate − out_rate, clamped)
  bottleneck: boolean;    // sustained imbalance ≥ 10s
  p95_latency_ms?: number;
}

// Host resource stats pushed by the agent on each heartbeat. Optional —
// agents without psutil (or sandboxed environments) simply omit fields.
export interface NodeStats {
  id: string;
  cpu_pct?: number;          // 0–100, normalised across all cores
  mem_pct?: number;          // 0–100
  mem_used_bytes?: number;
  mem_total_bytes?: number;
  at?: number;               // unix ms, server-stamped
}

export interface ServerToClientEvents {
  'node:added':   (n: NodeDTO) => void;
  'node:updated': (n: NodeDTO) => void;
  'node:removed': (id: string) => void;
  'edge:added':   (e: EdgeDTO) => void;
  'edge:removed': (id: number) => void;
  'agent:status': (p: { id: string; status: AgentStatus }) => void;
  'flow:event':   (e: FlowEvent) => void;
  'node:metric':  (m: NodeMetric) => void;
  'node:stats':   (s: NodeStats) => void;
}

export interface ClientToServerEvents {
  'edge:delete':    (id: number) => void;
  'node:delete':    (id: string) => void;
  'node:move':      (p: { id: string; x: number; y: number }) => void;
  'topology:reset': () => void;
}
