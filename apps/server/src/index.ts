import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import agentsRouter from './routes/agents.js';
import topologyRouter from './routes/topology.js';
import layoutsRouter from './routes/layouts.js';
import { setIO } from './bus.js';
import { startLivenessLoop } from './liveness.js';
import { startMetricsLoop } from './metrics.js';
import { seedClusters } from './seed/clusters.js';
import { query, one } from './db.js';
import { toNodeDTO } from './repo.js';
import type { ServerToClientEvents, ClientToServerEvents } from '@pipeflow/shared';

const PORT = Number(process.env.PORT ?? 4000);
const RAW_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
// '*' or empty → reflect any origin (good for LAN / multi-host setups).
// Comma-separated list → exact allow-list.
const CORS_ORIGIN: any = (RAW_ORIGIN === '*' || RAW_ORIGIN.trim() === '')
  ? true
  : RAW_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '256kb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use('/agents', agentsRouter);
app.use('/topology', topologyRouter);
app.use('/layouts', layoutsRouter);

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CORS_ORIGIN },
});
setIO(io);

const diagram = io.of('/diagram');
diagram.on('connection', (socket) => {
  socket.on('node:move', async ({ id, x, y }) => {
    await query(`UPDATE agents SET x = $2, y = $3 WHERE id = $1`, [id, x, y]);
    const row = await one(`SELECT * FROM agents WHERE id = $1`, [id]);
    if (row) diagram.emit('node:updated', toNodeDTO(row as any));
  });

  socket.on('edge:delete', async (id) => {
    const row = await one(`SELECT * FROM edges WHERE id = $1`, [id]);
    if (!row) return;
    await query(`DELETE FROM edges WHERE id = $1`, [id]);
    if ((row as any).source === 'agent') {
      await query(
        `INSERT INTO edge_suppressions (from_agent, to_agent) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [(row as any).from_agent, (row as any).to_agent]
      );
    }
    diagram.emit('edge:removed', id);
  });

  socket.on('node:delete', async (id) => {
    const attached = await query<{ id: number }>(
      `SELECT id FROM edges WHERE from_agent = $1 OR to_agent = $1`,
      [id]
    );
    await query(`DELETE FROM edges WHERE from_agent = $1 OR to_agent = $1`, [id]);
    await query(`DELETE FROM agents WHERE id = $1`, [id]);
    for (const e of attached) diagram.emit('edge:removed', e.id);
    diagram.emit('node:removed', id);
  });

  socket.on('topology:reset', async () => {
    await query(`DELETE FROM edges`);
    await query(`DELETE FROM agents`);
    await query(`DELETE FROM edge_suppressions`);
    // Clients should refetch /topology after this.
  });
});

httpServer.listen(PORT, async () => {
  console.log(`pipeflow-server listening on :${PORT}`);
  await seedClusters().catch((e) => console.error('seedClusters failed:', e));
  startLivenessLoop();
  startMetricsLoop();
});
