import type { NodeKind } from '@pipeflow/shared';
import { query } from './db.js';

// Region per node_kind. Free-floating: no cluster required.
// New agents pack into the first free slot inside their region.
interface Region { x: number; y: number; w: number; h: number; }

const REGIONS: Record<NodeKind, Region> = {
  user: { x:  20, y:  60, w:  200, h: 560 },
  ext:  { x:  20, y: 640, w:  200, h:  98 },
  fe:   { x: 250, y:  80, w: 1040, h: 100 },
  be:   { x: 250, y: 200, w: 1040, h: 100 },
  svc:  { x: 250, y: 360, w:  980, h: 100 },
  wk:   { x: 250, y: 480, w:  760, h: 100 },
  kf:   { x:1310, y:  80, w:  240, h: 410 },
  db:   { x:1580, y: 100, w:  200, h: 280 },
  obs:  { x: 250, y: 600, w: 1280, h:  90 },
};

const PAD = 14;
const GAP = 10;

interface NodePos { x: number; y: number; w: number; h: number; }

function nextSlot(region: Region, taken: NodePos[], nodeW: number, nodeH: number) {
  const innerX = region.x + PAD;
  const innerY = region.y + PAD;
  const innerW = region.w - PAD * 2;
  const innerH = region.h - PAD * 2;
  const cols = Math.max(1, Math.floor((innerW + GAP) / (nodeW + GAP)));
  const rows = Math.max(1, Math.floor((innerH + GAP) / (nodeH + GAP)));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = innerX + c * (nodeW + GAP);
      const y = innerY + r * (nodeH + GAP);
      const overlaps = taken.some(
        (t) => !(x + nodeW <= t.x || x >= t.x + t.w || y + nodeH <= t.y || y >= t.y + t.h)
      );
      if (!overlaps) return { x, y };
    }
  }
  return { x: innerX, y: innerY };
}

export interface PlaceResult {
  cluster_id: null;
  x: number; y: number; w: number; h: number;
}

export async function placeAgent(
  kind: NodeKind,
  preferW?: number,
  preferH?: number
): Promise<PlaceResult> {
  const w = preferW ?? 170;
  const h = preferH ?? 60;
  const region = REGIONS[kind];
  if (!region) return { cluster_id: null, x: 40, y: 40, w, h };
  const taken = await query<NodePos>(
    `SELECT x, y, w, h FROM agents WHERE node_type = $1`,
    [kind]
  );
  const pos = nextSlot(region, taken, w, h);
  return { cluster_id: null, x: pos.x, y: pos.y, w, h };
}
