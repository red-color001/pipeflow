import { Router } from 'express';
import { z } from 'zod';
import { query, one } from '../db.js';
import { emit } from '../bus.js';
import { listNodes, listEdges, listClusters, getAgent, toNodeDTO, toEdgeDTO } from '../repo.js';

const router = Router();

router.get('/', async (_req, res) => {
  const [nodes, edges, clusters] = await Promise.all([listNodes(), listEdges(), listClusters()]);
  res.json({ nodes, edges, clusters });
});

const MoveSchema = z.object({
  id: z.string(),
  x: z.number().int(),
  y: z.number().int(),
});

// Used by UI for manual node move (also exposed as socket event).
router.post('/nodes/move', async (req, res) => {
  const parsed = MoveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await query(`UPDATE agents SET x = $2, y = $3 WHERE id = $1`, [parsed.data.id, parsed.data.x, parsed.data.y]);
  const fresh = await getAgent(parsed.data.id);
  if (fresh) emit('node:updated', toNodeDTO(fresh));
  res.status(204).end();
});

const EdgeAddSchema = z.object({
  from: z.string(), to: z.string(),
  dashed: z.boolean().optional(),
});

router.post('/edges', async (req, res) => {
  const parsed = EdgeAddSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { from, to, dashed } = parsed.data;
  const a = await getAgent(from); const b = await getAgent(to);
  if (!a || !b) return res.status(404).json({ error: 'unknown agent(s)' });
  const inserted = await one<{ id: number }>(
    `INSERT INTO edges (from_agent, to_agent, color, dashed, source)
     VALUES ($1, $2, 'indigo', $3, 'manual')
     ON CONFLICT (from_agent, to_agent, source) DO UPDATE SET dashed = EXCLUDED.dashed
     RETURNING id`,
    [from, to, !!dashed]
  );
  if (inserted) {
    const row = await one(`SELECT * FROM edges WHERE id = $1`, [inserted.id]);
    if (row) emit('edge:added', toEdgeDTO(row as any));
  }
  res.json({ ok: true });
});

router.delete('/edges/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const row = await one(`SELECT * FROM edges WHERE id = $1`, [id]);
  if (!row) return res.status(404).end();
  await query(`DELETE FROM edges WHERE id = $1`, [id]);
  // Persist suppression so re-registration doesn't recreate it.
  if ((row as any).source === 'agent') {
    await query(
      `INSERT INTO edge_suppressions (from_agent, to_agent) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [(row as any).from_agent, (row as any).to_agent]
    );
  }
  emit('edge:removed', id);
  res.status(204).end();
});

router.post('/reset', async (_req, res) => {
  // Wipe all edges + agents (keep clusters seeded).
  await query(`DELETE FROM edges`);
  await query(`DELETE FROM agents`);
  await query(`DELETE FROM edge_suppressions`);
  res.json({ ok: true });
});

export default router;
