import { query } from './db.js';
import { emit } from './bus.js';
import { statusOf } from './repo.js';
import type { AgentStatus } from '@pipeflow/shared';

interface Row { id: string; last_seen_at: Date; stub: boolean; }

// In-memory cache of last broadcast status per agent — avoids spamming the UI
// every 5s when nothing changed.
const lastBroadcast = new Map<string, AgentStatus>();

export function startLivenessLoop(intervalMs = 5_000) {
  const tick = async () => {
    try {
      const rows = await query<Row>(`SELECT id, last_seen_at, stub FROM agents`);
      for (const r of rows) {
        const status = statusOf(r.last_seen_at, r.stub);
        if (lastBroadcast.get(r.id) !== status) {
          lastBroadcast.set(r.id, status);
          emit('agent:status', { id: r.id, status });
        }
      }
      // Drop entries for agents that no longer exist.
      const ids = new Set(rows.map((r) => r.id));
      for (const id of lastBroadcast.keys()) {
        if (!ids.has(id)) lastBroadcast.delete(id);
      }
    } catch (err) {
      console.error('liveness loop error:', err);
    }
  };
  setInterval(tick, intervalMs);
  tick();
}
