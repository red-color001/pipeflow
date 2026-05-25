import type { NodeKind } from '@pipeflow/shared';
import { query } from './db.js';

interface NodePos { x: number; y: number; w: number; h: number; }

const GAP = 16;
const STEP = 24;       // spiral radial step
const ANGLE_STEP = 0.6; // radians per spiral sample

function overlaps(a: NodePos, taken: NodePos[]): boolean {
  return taken.some(
    (t) => !(a.x + a.w + GAP <= t.x || a.x >= t.x + t.w + GAP
          || a.y + a.h + GAP <= t.y || a.y >= t.y + t.h + GAP)
  );
}

function spiralSlot(anchorX: number, anchorY: number, taken: NodePos[], w: number, h: number) {
  // Try anchor itself first.
  const first = { x: Math.round(anchorX - w / 2), y: Math.round(anchorY - h / 2), w, h };
  if (!overlaps(first, taken)) return { x: first.x, y: first.y };
  // Archimedean spiral outward.
  let theta = 0;
  for (let i = 0; i < 2000; i++) {
    theta += ANGLE_STEP;
    const r = STEP * Math.sqrt(i + 1);
    const cx = anchorX + r * Math.cos(theta);
    const cy = anchorY + r * Math.sin(theta);
    const cand = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h };
    if (!overlaps(cand, taken)) return { x: cand.x, y: cand.y };
  }
  return { x: first.x, y: first.y };
}

export interface PlaceResult {
  cluster_id: null;
  x: number; y: number; w: number; h: number;
}

export async function placeAgent(
  _kind: NodeKind,
  preferW?: number,
  preferH?: number
): Promise<PlaceResult> {
  const w = preferW ?? 170;
  const h = preferH ?? 60;
  // Anchor = centroid of existing live (non-stub) nodes, else origin.
  const taken = await query<NodePos>(`SELECT x, y, w, h FROM agents`);
  const live = await query<NodePos>(`SELECT x, y, w, h FROM agents WHERE stub = false`);
  let ax = 0, ay = 0;
  if (live.length > 0) {
    for (const n of live) { ax += n.x + n.w / 2; ay += n.y + n.h / 2; }
    ax /= live.length;
    ay /= live.length;
  }
  const pos = spiralSlot(ax, ay, taken, w, h);
  return { cluster_id: null, x: pos.x, y: pos.y, w, h };
}
