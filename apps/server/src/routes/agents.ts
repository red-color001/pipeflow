import { Router } from 'express';
import { z } from 'zod';
import { query, one } from '../db.js';
import { placeAgent } from '../layout.js';
import { emit } from '../bus.js';
import { getAgent, toNodeDTO, toEdgeDTO } from '../repo.js';
import { recordFlow } from '../metrics.js';
import type { ColorKey } from '@pipeflow/shared';

const router = Router();

const NodeKindEnum = z.enum(['user','ext','fe','be','svc','wk','kf','db','obs']);
const ColorEnum    = z.enum(['indigo','teal','amber','red','violet','orange','green','cyan','pink','purple','yorange','neutral']);

const TargetSchema = z.object({
  to:     z.string().min(1),
  color:  ColorEnum.optional(),
  dashed: z.boolean().optional(),
  label:  z.string().optional(),
});

const RegisterSchema = z.object({
  id:        z.string().min(1).max(120),
  label:     z.string().min(1).max(80),
  node_type: NodeKindEnum,
  color:     ColorEnum.optional(),
  service:   z.string().optional(),
  host:      z.string().optional(),
  version:   z.string().optional(),
  w:         z.number().int().min(60).max(400).optional(),
  h:         z.number().int().min(30).max(200).optional(),
  targets:   z.array(TargetSchema).max(64).optional(),
});

function authOK(req: any): boolean {
  const expected = process.env.AGENT_TOKEN;
  if (!expected) return false;
  const hdr = req.headers.authorization || '';
  const got = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
  return got === expected;
}

// ── POST /agents/register ─────────────────────────────────────────────
router.post('/register', async (req, res) => {
  if (!authOK(req)) return res.status(401).json({ error: 'unauthorized' });
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;

  const existing = await getAgent(p.id);
  const placement = existing && !existing.stub
    ? { cluster_id: existing.cluster_id, x: existing.x, y: existing.y, w: existing.w, h: existing.h }
    : await placeAgent(p.node_type, p.w, p.h);

  const color: ColorKey = p.color ?? 'neutral';

  await query(
    `INSERT INTO agents (id, service, node_type, color, label, host, version,
                         registered_at, last_seen_at, x, y, w, h, cluster_id, stub)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now(), $8,$9,$10,$11,$12, false)
     ON CONFLICT (id) DO UPDATE SET
       service       = EXCLUDED.service,
       node_type     = EXCLUDED.node_type,
       color         = EXCLUDED.color,
       label         = EXCLUDED.label,
       host          = EXCLUDED.host,
       version       = EXCLUDED.version,
       last_seen_at  = now(),
       x             = EXCLUDED.x,
       y             = EXCLUDED.y,
       w             = EXCLUDED.w,
       h             = EXCLUDED.h,
       cluster_id    = EXCLUDED.cluster_id,
       stub          = false`,
    [
      p.id, p.service ?? null, p.node_type, color, p.label, p.host ?? null, p.version ?? null,
      placement.x, placement.y, placement.w, placement.h, placement.cluster_id,
    ]
  );

  const fresh = (await getAgent(p.id))!;
  const wasNew = !existing;
  emit(wasNew ? 'node:added' : 'node:updated', toNodeDTO(fresh));

  // Handle declared targets: create stub nodes for missing endpoints, insert edges.
  for (const t of p.targets ?? []) {
    if (t.to === p.id) continue;
    // Skip if user previously suppressed this edge.
    const suppressed = await one(
      `SELECT 1 FROM edge_suppressions WHERE from_agent = $1 AND to_agent = $2`,
      [p.id, t.to]
    );
    if (suppressed) continue;

    let target = await getAgent(t.to);
    if (!target) {
      const stubPlace = await placeAgent('ext', 170, 60);
      await query(
        `INSERT INTO agents (id, node_type, color, label, x, y, w, h, cluster_id,
                             last_seen_at, stub)
         VALUES ($1, 'ext', 'neutral', $1, $2, $3, $4, $5, $6, now() - interval '1 hour', true)
         ON CONFLICT (id) DO NOTHING`,
        [t.to, stubPlace.x, stubPlace.y, stubPlace.w, stubPlace.h, stubPlace.cluster_id]
      );
      target = await getAgent(t.to);
      if (target) emit('node:added', toNodeDTO(target));
    }

    const edgeColor: ColorKey = t.color ?? color;
    const inserted = await one<{ id: number }>(
      `INSERT INTO edges (from_agent, to_agent, color, dashed, label, source)
       VALUES ($1, $2, $3, $4, $5, 'agent')
       ON CONFLICT (from_agent, to_agent, source) DO UPDATE SET
         color = EXCLUDED.color, dashed = EXCLUDED.dashed, label = EXCLUDED.label
       RETURNING id`,
      [p.id, t.to, edgeColor, !!t.dashed, t.label ?? null]
    );
    if (inserted) {
      const row = await one(`SELECT * FROM edges WHERE id = $1`, [inserted.id]);
      if (row) emit('edge:added', toEdgeDTO(row as any));
    }
  }

  res.json({ ok: true, id: p.id });
});

// ── POST /agents/:id/heartbeat ────────────────────────────────────────
// Optional body: { cpu_pct?, mem_pct?, mem_used_bytes?, mem_total_bytes? }.
// Empty body keeps backward compat with older agents that send no body.
const HeartbeatStatsSchema = z.object({
  cpu_pct:         z.number().min(0).max(100).optional(),
  mem_pct:         z.number().min(0).max(100).optional(),
  mem_used_bytes:  z.number().int().min(0).optional(),
  mem_total_bytes: z.number().int().min(0).optional(),
}).partial();

router.post('/:id/heartbeat', async (req, res) => {
  if (!authOK(req)) return res.status(401).json({ error: 'unauthorized' });
  const id = req.params.id;
  const result = await query(
    `UPDATE agents SET last_seen_at = now() WHERE id = $1 AND stub = false RETURNING id, last_seen_at, stub`,
    [id]
  );
  if (result.length === 0) return res.status(404).json({ error: 'unknown agent' });

  // Best-effort: persist + broadcast resource stats if the agent sent any.
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    const parsed = HeartbeatStatsSchema.safeParse(req.body);
    if (parsed.success) {
      const s = parsed.data;
      const hasAny =
        s.cpu_pct !== undefined ||
        s.mem_pct !== undefined ||
        s.mem_used_bytes !== undefined ||
        s.mem_total_bytes !== undefined;
      if (hasAny) {
        await query(
          `UPDATE agents
              SET cpu_pct         = COALESCE($2, cpu_pct),
                  mem_pct         = COALESCE($3, mem_pct),
                  mem_used_bytes  = COALESCE($4, mem_used_bytes),
                  mem_total_bytes = COALESCE($5, mem_total_bytes),
                  stats_at        = now()
            WHERE id = $1`,
          [id, s.cpu_pct ?? null, s.mem_pct ?? null, s.mem_used_bytes ?? null, s.mem_total_bytes ?? null]
        );
        emit('node:stats', {
          id,
          cpu_pct: s.cpu_pct,
          mem_pct: s.mem_pct,
          mem_used_bytes: s.mem_used_bytes,
          mem_total_bytes: s.mem_total_bytes,
          at: Date.now(),
        });
      }
    }
  }

  res.status(204).end();
});

// ── POST /agents/:id/flow ─────────────────────────────────────────────
// Body: { to: string, bytes?: number }. Looks up the agent-declared edge
// and broadcasts a flow:event so the UI can animate a particle on that edge.
const FlowSchema = z.object({
  to:         z.string().min(1),
  bytes:      z.number().int().min(0).optional(),
  latency_ms: z.number().min(0).optional(),
});

router.post('/:id/flow', async (req, res) => {
  if (!authOK(req)) return res.status(401).json({ error: 'unauthorized' });
  const parsed = FlowSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const fromId = req.params.id;
  const { to, bytes, latency_ms } = parsed.data;

  const edge = await one<{ id: number; color: ColorKey }>(
    `SELECT id, color FROM edges
      WHERE from_agent = $1 AND to_agent = $2
      ORDER BY id ASC LIMIT 1`,
    [fromId, to]
  );
  if (!edge) return res.status(404).json({ error: 'edge not found' });

  // Touch heartbeat too — flow implies the agent is alive.
  await query(
    `UPDATE agents SET last_seen_at = now() WHERE id = $1 AND stub = false`,
    [fromId]
  );

  const ev = { from: fromId, to, edge_id: edge.id, color: edge.color, bytes, latency_ms };
  recordFlow(ev);
  emit('flow:event', ev);
  res.status(204).end();
});

// ── POST /agents/:id/deregister ───────────────────────────────────────
router.post('/:id/deregister', async (req, res) => {
  if (!authOK(req)) return res.status(401).json({ error: 'unauthorized' });
  const id = req.params.id;
  // Soft-delete: mark stub + push back last_seen so liveness shows dead.
  await query(
    `UPDATE agents SET stub = true, last_seen_at = now() - interval '1 hour' WHERE id = $1`,
    [id]
  );
  const updated = await getAgent(id);
  if (updated) emit('node:updated', toNodeDTO(updated));
  emit('agent:status', { id, status: 'dead' });
  res.status(204).end();
});

export default router;
