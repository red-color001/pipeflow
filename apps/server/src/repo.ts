import type { NodeDTO, EdgeDTO, ClusterDTO, AgentStatus, NodeKind, ColorKey } from '@pipeflow/shared';
import { query, one } from './db.js';

interface AgentRow {
  id: string; label: string; node_type: NodeKind; color: ColorKey;
  x: number; y: number; w: number; h: number;
  cluster_id: string | null; stub: boolean;
  last_seen_at: Date;
}

interface EdgeRow {
  id: number; from_agent: string; to_agent: string;
  color: ColorKey; dashed: boolean; label: string | null;
  source: 'agent' | 'manual';
}

interface ClusterRow {
  id: string; label: string;
  x: number; y: number; w: number; h: number;
  color: ColorKey; orient: 'V' | null; accepts_kinds: NodeKind[];
}

const LIVE_MS  = 15_000;
const STALE_MS = 45_000;

export function statusOf(lastSeen: Date, stub: boolean): AgentStatus {
  if (stub) return 'dead';
  const age = Date.now() - new Date(lastSeen).getTime();
  if (age < LIVE_MS)  return 'live';
  if (age < STALE_MS) return 'stale';
  return 'dead';
}

export function toNodeDTO(a: AgentRow): NodeDTO {
  return {
    id: a.id,
    label: a.label,
    kind: a.node_type,
    color: a.color,
    x: a.x, y: a.y, w: a.w, h: a.h,
    cluster_id: a.cluster_id,
    status: statusOf(a.last_seen_at, a.stub),
    stub: a.stub,
  };
}

export function toEdgeDTO(e: EdgeRow): EdgeDTO {
  return {
    id: e.id,
    from: e.from_agent,
    to: e.to_agent,
    color: e.color,
    dashed: e.dashed,
    label: e.label,
    source: e.source,
  };
}

export function toClusterDTO(c: ClusterRow): ClusterDTO {
  return {
    id: c.id,
    label: c.label,
    x: c.x, y: c.y, w: c.w, h: c.h,
    color: c.color,
    orient: c.orient,
    accepts_kinds: c.accepts_kinds,
  };
}

export async function listNodes(): Promise<NodeDTO[]> {
  const rows = await query<AgentRow>(`SELECT * FROM agents`);
  return rows.map(toNodeDTO);
}
export async function listEdges(): Promise<EdgeDTO[]> {
  const rows = await query<EdgeRow>(`SELECT * FROM edges`);
  return rows.map(toEdgeDTO);
}
export async function listClusters(): Promise<ClusterDTO[]> {
  const rows = await query<ClusterRow>(`SELECT * FROM clusters`);
  return rows.map(toClusterDTO);
}

export async function getAgent(id: string): Promise<AgentRow | null> {
  return one<AgentRow>(`SELECT * FROM agents WHERE id = $1`, [id]);
}
