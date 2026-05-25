import { Router } from 'express';
import { z } from 'zod';
import { query, one } from '../db.js';
import { emit } from '../bus.js';
import { getAgent, toNodeDTO } from '../repo.js';

const router = Router();

interface PresetRow {
  id: number;
  name: string;
  positions: Record<string, { x: number; y: number }>;
  created_at: Date;
  updated_at: Date;
}

router.get('/', async (_req, res) => {
  const rows = await query<PresetRow>(
    `SELECT id, name, positions, created_at, updated_at
       FROM layout_presets ORDER BY updated_at DESC`
  );
  res.json(rows.map((r) => ({
    id: r.id, name: r.name,
    nodes: Object.keys(r.positions ?? {}).length,
    created_at: r.created_at, updated_at: r.updated_at,
  })));
});

const SaveSchema = z.object({
  name: z.string().min(1).max(60).regex(/^[A-Za-z0-9 _.\-]+$/, 'safe chars only'),
});

// Snapshot CURRENT agent positions as a new preset (or overwrite by name).
router.post('/', async (req, res) => {
  const parsed = SaveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const rows = await query<{ id: string; x: number; y: number }>(
    `SELECT id, x, y FROM agents WHERE stub = false`
  );
  const positions: Record<string, { x: number; y: number }> = {};
  for (const r of rows) positions[r.id] = { x: r.x, y: r.y };
  const saved = await one<PresetRow>(
    `INSERT INTO layout_presets (name, positions)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (name) DO UPDATE SET
       positions  = EXCLUDED.positions,
       updated_at = now()
     RETURNING id, name, positions, created_at, updated_at`,
    [parsed.data.name, JSON.stringify(positions)]
  );
  res.json({ id: saved!.id, name: saved!.name, nodes: Object.keys(positions).length });
});

// Apply preset: update agents.x/y for every match, broadcast node:updated.
router.post('/:id/apply', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const preset = await one<PresetRow>(
    `SELECT id, name, positions FROM layout_presets WHERE id = $1`,
    [id]
  );
  if (!preset) return res.status(404).json({ error: 'not found' });
  let applied = 0;
  for (const [agentId, pos] of Object.entries(preset.positions ?? {})) {
    const updated = await query(
      `UPDATE agents SET x = $2, y = $3 WHERE id = $1 RETURNING id`,
      [agentId, pos.x, pos.y]
    );
    if (updated.length > 0) {
      applied++;
      const fresh = await getAgent(agentId);
      if (fresh) emit('node:updated', toNodeDTO(fresh));
    }
  }
  res.json({ ok: true, applied });
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  await query(`DELETE FROM layout_presets WHERE id = $1`, [id]);
  res.status(204).end();
});

export default router;
