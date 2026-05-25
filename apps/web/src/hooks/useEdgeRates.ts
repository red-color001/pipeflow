import { useEffect, useState } from 'react';
import { onFlow } from '../store';

export interface EdgeRate {
  rate: number;        // events/sec (5s window)
  p95: number | null;  // p95 latency_ms (5s window)
}

interface Sample { t: number; latency?: number }

// Rolling 5-second per-edge rate + p95 latency. Aggregated from the flow-event
// pub-sub. Recomputes every 500ms, not on every event, to keep cheap.
export function useEdgeRates(): Map<number, EdgeRate> {
  const [rates, setRates] = useState<Map<number, EdgeRate>>(() => new Map());

  useEffect(() => {
    const samples = new Map<number, Sample[]>();
    const WINDOW_MS = 5000;

    const off = onFlow((e) => {
      const t = Date.now();
      let arr = samples.get(e.edge_id);
      if (!arr) { arr = []; samples.set(e.edge_id, arr); }
      arr.push({ t, latency: e.latency_ms });
      // Trim oldest
      const cutoff = t - WINDOW_MS;
      while (arr.length && arr[0].t < cutoff) arr.shift();
    });

    const interval = setInterval(() => {
      const now = Date.now();
      const cutoff = now - WINDOW_MS;
      const next = new Map<number, EdgeRate>();
      samples.forEach((arr, id) => {
        while (arr.length && arr[0].t < cutoff) arr.shift();
        if (arr.length === 0) return;
        const rate = arr.length / (WINDOW_MS / 1000);
        const lats = arr
          .map((s) => s.latency)
          .filter((v): v is number => typeof v === 'number')
          .sort((a, b) => a - b);
        const p95 = lats.length
          ? lats[Math.min(lats.length - 1, Math.floor(lats.length * 0.95))]
          : null;
        next.set(id, { rate, p95 });
      });
      setRates(next);
    }, 500);

    return () => { off(); clearInterval(interval); };
  }, []);

  return rates;
}
