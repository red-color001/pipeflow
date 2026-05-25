import { query, one } from '../db.js';
import type { NodeKind } from '@pipeflow/shared';

type Seed = {
  id: string; label: string;
  x: number; y: number; w: number; h: number;
  color: string; orient: 'V' | null;
  accepts: NodeKind[];
};

// Ported from mockup/data-v4.js CLUSTERS, with accepts_kinds added
// so the layout engine knows where new agents drop.
const CLUSTERS: Seed[] = [
  { id: 'cl_user',  label: 'Users',           x:  20, y:  60, w:  200, h: 560, color: 'neutral', orient: 'V',  accepts: ['user'] },
  { id: 'cl_ext',   label: 'External',        x:  20, y: 640, w:  200, h:  98, color: 'orange',  orient: 'V',  accepts: ['ext']  },
  { id: 'cl_admin', label: 'Admin Console',   x: 250, y:  80, w:  190, h: 200, color: 'orange',  orient: null, accepts: ['fe', 'be'] },
  { id: 'cl_duck',  label: 'DuckDB UI',       x: 450, y:  80, w:  190, h: 200, color: 'green',   orient: null, accepts: ['fe', 'be'] },
  { id: 'cl_kafd',  label: 'Kafka UI',        x: 650, y:  80, w:  190, h: 200, color: 'yorange', orient: null, accepts: ['fe', 'be'] },
  { id: 'cl_app',   label: 'App API',         x: 860, y:  80, w:  220, h: 200, color: 'teal',    orient: null, accepts: ['fe', 'be'] },
  { id: 'cl_lensa', label: 'Lensa Stack',     x:1100, y:  80, w:  200, h: 290, color: 'pink',    orient: null, accepts: ['fe', 'be'] },
  { id: 'cl_orch',  label: 'Orchestration',   x: 250, y: 360, w:  380, h: 100, color: 'amber',   orient: null, accepts: ['svc'] },
  { id: 'cl_wk',    label: 'KEDA Workers',    x: 250, y: 460, w:  760, h: 100, color: 'violet',  orient: null, accepts: ['wk', 'svc'] },
  { id: 'cl_ml',    label: 'Model Learning',  x: 860, y: 360, w:  370, h: 100, color: 'purple',  orient: null, accepts: ['svc'] },
  { id: 'cl_kafka', label: 'Kafka (Strimzi)', x:1310, y:  80, w:  240, h: 410, color: 'red',     orient: 'V',  accepts: ['kf'] },
  { id: 'cl_data',  label: 'Data Stores',     x:1580, y: 100, w:  200, h: 280, color: 'teal',    orient: null, accepts: ['db'] },
  { id: 'cl_obs',   label: 'Observability',   x: 250, y: 580, w: 1280, h:  90, color: 'cyan',    orient: null, accepts: ['obs'] },
];

export async function seedClusters() {
  for (const c of CLUSTERS) {
    const existing = await one('SELECT id FROM clusters WHERE id = $1', [c.id]);
    if (existing) continue;
    await query(
      `INSERT INTO clusters (id, label, x, y, w, h, color, orient, accepts_kinds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [c.id, c.label, c.x, c.y, c.w, c.h, c.color, c.orient, c.accepts]
    );
  }
  console.log(`seeded ${CLUSTERS.length} clusters`);
}
