import type { NodeMetric, FlowEvent } from '@pipeflow/shared';
import { emit } from './bus.js';

// Rolling-window flow aggregator. Lives in memory, no persistence — survives
// process lifetime only, which is fine for live dashboards.
//
// Each flow event drops a timestamped sample into two ring buffers:
//   - inEvents[to]    (what entered the destination node)
//   - outEvents[from] (what left the source node)
// On a 1s tick we compute rates over the last WINDOW_MS, decide bottleneck,
// and broadcast a NodeMetric for any node whose state changed.

interface Sample { t: number; bytes: number; latency?: number; }

const WINDOW_MS = 5_000;
const TICK_MS   = 1_000;
const BOTTLENECK_RATIO    = 1.3;
const BOTTLENECK_DUR_MS   = 10_000;

const inEvents:  Map<string, Sample[]> = new Map();
const outEvents: Map<string, Sample[]> = new Map();
const overSince: Map<string, number>   = new Map();   // first time imbalance seen
const lastSent:  Map<string, NodeMetric> = new Map(); // dedupe broadcasts

function push(map: Map<string, Sample[]>, key: string, s: Sample) {
  let arr = map.get(key);
  if (!arr) { arr = []; map.set(key, arr); }
  arr.push(s);
}

function trim(arr: Sample[] | undefined, cutoff: number) {
  if (!arr) return;
  // Samples are pushed in time order, so drop from the front.
  let i = 0;
  while (i < arr.length && arr[i].t < cutoff) i++;
  if (i > 0) arr.splice(0, i);
}

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

export function recordFlow(ev: FlowEvent) {
  const t = Date.now();
  const s: Sample = { t, bytes: ev.bytes ?? 0, latency: ev.latency_ms };
  push(inEvents,  ev.to,   s);
  push(outEvents, ev.from, s);
}

function snapshot(nodeId: string, now: number): NodeMetric {
  const ins  = inEvents.get(nodeId)  ?? [];
  const outs = outEvents.get(nodeId) ?? [];
  const windowSec = WINDOW_MS / 1000;
  const in_rate  = ins.length  / windowSec;
  const out_rate = outs.length / windowSec;
  const bytes_in = ins.reduce((a, s) => a + s.bytes, 0) / windowSec;
  const lat      = ins.map((s) => s.latency).filter((x): x is number => typeof x === 'number');
  const p95_latency_ms = percentile(lat, 0.95);

  // Bottleneck condition: more flowing in than out, sustained ≥ BOTTLENECK_DUR_MS.
  // Leaf sinks (no outgoing) are excluded — they're terminal by design.
  const hasOut = outs.length > 0 || outEvents.has(nodeId);
  const imbalanced = hasOut && in_rate > 0.5 && in_rate > out_rate * BOTTLENECK_RATIO;
  if (imbalanced) {
    if (!overSince.has(nodeId)) overSince.set(nodeId, now);
  } else {
    overSince.delete(nodeId);
  }
  const startedAt = overSince.get(nodeId);
  const bottleneck = !!(startedAt && now - startedAt >= BOTTLENECK_DUR_MS);

  const backlog = Math.max(0, Math.round((in_rate - out_rate) * windowSec));

  return { id: nodeId, in_rate, out_rate, bytes_in, backlog, bottleneck, p95_latency_ms };
}

function metricsEqual(a: NodeMetric, b: NodeMetric): boolean {
  // Compare with reasonable tolerance — sub-tick wobble shouldn't spam UI.
  const round = (n: number) => Math.round(n * 10) / 10;
  return (
    a.bottleneck === b.bottleneck &&
    round(a.in_rate)  === round(b.in_rate) &&
    round(a.out_rate) === round(b.out_rate) &&
    a.backlog === b.backlog &&
    Math.round((a.p95_latency_ms ?? 0) / 10) === Math.round((b.p95_latency_ms ?? 0) / 10)
  );
}

export function startMetricsLoop() {
  setInterval(() => {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    // Trim ring buffers and collect candidate nodes.
    const nodes = new Set<string>();
    for (const k of inEvents.keys())  { trim(inEvents.get(k),  cutoff); nodes.add(k); }
    for (const k of outEvents.keys()) { trim(outEvents.get(k), cutoff); nodes.add(k); }

    for (const id of nodes) {
      const m = snapshot(id, now);
      const prev = lastSent.get(id);
      if (!prev || !metricsEqual(prev, m)) {
        lastSent.set(id, m);
        emit('node:metric', m);
      }
      // GC empty entries so the map doesn't grow unbounded.
      const insEmpty  = (inEvents.get(id)  ?? []).length === 0;
      const outsEmpty = (outEvents.get(id) ?? []).length === 0;
      if (insEmpty && outsEmpty && !m.bottleneck) {
        inEvents.delete(id);
        outEvents.delete(id);
        overSince.delete(id);
        lastSent.delete(id);
        if (prev && (prev.in_rate > 0 || prev.out_rate > 0 || prev.bottleneck)) {
          // Send one final zero so the UI clears the overlay.
          emit('node:metric', { ...m, in_rate: 0, out_rate: 0, bytes_in: 0, backlog: 0, bottleneck: false });
        }
      }
    }
  }, TICK_MS);
}
