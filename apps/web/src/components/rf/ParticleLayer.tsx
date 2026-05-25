import { useEffect, useRef } from 'react';
import { useViewport } from '@xyflow/react';
import { COLORS } from '../../colors';
import { onFlow } from '../../store';

// Particles read SVG path elements directly from the DOM — React Flow
// renders them with `data-pipeflow-edge-id` so we can target each one.
// A single overlay SVG sits above the React Flow viewport and is panned/
// zoomed in step with it via the viewport transform.
export function ParticleLayer({
  running,
  particleSize = 'medium',
}: {
  running: boolean;
  particleSize?: 'small' | 'medium' | 'large';
}) {
  const layerRef = useRef<SVGGElement>(null);
  const runningRef = useRef(running);
  const sizeRef = useRef(particleSize);
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { sizeRef.current = particleSize; }, [particleSize]);

  const { x: tx, y: ty, zoom } = useViewport();

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const dotLayer: SVGGElement = layer;

    // Cache path elements + length keyed by edge id, invalidate by `d` attr.
    interface PathCache { el: SVGPathElement; length: number; d: string; }
    const cache: Record<number, PathCache> = {};
    function resolveEdge(edgeId: number): PathCache | null {
      let el: SVGPathElement | null = cache[edgeId]?.el ?? null;
      if (!el || !el.isConnected) {
        el = document.querySelector(
          `path.react-flow__edge-path[data-pipeflow-edge-id="${edgeId}"]`,
        ) as SVGPathElement | null;
      }
      if (!el) return null;
      const d = el.getAttribute('d') ?? '';
      const hit = cache[edgeId];
      if (hit && hit.el === el && hit.d === d) return hit;
      const fresh: PathCache = { el, length: el.getTotalLength(), d };
      cache[edgeId] = fresh;
      return fresh;
    }

    const FREE: SVGCircleElement[] = [];
    function acquireDot(): SVGCircleElement {
      const reused = FREE.pop();
      if (reused) { reused.setAttribute('display', ''); return reused; }
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dotLayer.appendChild(el);
      return el;
    }
    function releaseDot(el: SVGCircleElement) {
      el.setAttribute('display', 'none');
      FREE.push(el);
    }

    interface P { el: SVGCircleElement; edgeId: number; t: number; speed: number; }
    const particles: P[] = [];
    const MAX_PARTICLES = 400;

    function dotRadius(): number {
      const k = sizeRef.current;
      return k === 'small' ? 2.5 : k === 'large' ? 7 : 4;
    }

    // Map event latency_ms → per-particle speed multiplier.
    // 100ms = 1x (baseline). Higher latency → slower dot. Clamp keeps extremes sane.
    const REF_LATENCY_MS = 100;
    function latencyToSpeed(latency_ms?: number): number {
      if (!latency_ms || latency_ms <= 0) return 1;
      const k = REF_LATENCY_MS / latency_ms;
      return Math.max(0.25, Math.min(4, k));
    }

    function spawnOnEdge(edgeId: number, color: string, speed: number) {
      const ref = resolveEdge(edgeId);
      if (!ref) return;
      if (particles.length >= MAX_PARTICLES) return;
      const dot = acquireDot();
      dot.setAttribute('fill', color);
      dot.setAttribute('r', String(dotRadius()));
      dot.setAttribute('opacity', '1');
      const pt = ref.el.getPointAtLength(0);
      dot.setAttribute('cx', String(pt.x));
      dot.setAttribute('cy', String(pt.y));
      particles.push({ el: dot, edgeId, t: 0, speed });
    }

    // Default: edges show animated dashed flow for *any* traffic. Dots only
    // spawn for "heavy" bursts so they read as significant events, not
    // ambient noise. Threshold is bytes-based; tune as needed.
    const BURST_BYTES = 2000;
    const unsub = onFlow((ev) => {
      if (!runningRef.current) return;
      if ((ev.bytes ?? 0) < BURST_BYTES) return;
      spawnOnEdge(ev.edge_id, COLORS[ev.color] || '#94a3b8', latencyToSpeed(ev.latency_ms));
    });

    let prev = performance.now();
    let rafId = 0;
    const BASE = 0.32;

    function tick(now: number) {
      if (document.hidden) {
        prev = now;
        rafId = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const isRunning = runningRef.current;
      const R = dotRadius();

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (!isRunning) continue;
        p.t += BASE * p.speed * dt;
        p.el.setAttribute('r', String(R));
        if (p.t >= 1) {
          releaseDot(p.el);
          particles.splice(i, 1);
          continue;
        }
        const ref = resolveEdge(p.edgeId);
        if (!ref) {
          releaseDot(p.el);
          particles.splice(i, 1);
          continue;
        }
        const pt = ref.el.getPointAtLength(p.t * ref.length);
        p.el.setAttribute('cx', String(pt.x));
        p.el.setAttribute('cy', String(pt.y));
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      unsub();
      particles.forEach((p) => p.el.remove());
      FREE.forEach((el) => el.remove());
    };
  }, []);

  return (
    <svg
      style={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 4,
      }}
    >
      {/* The path elements live INSIDE the React Flow viewport (which is itself
          transformed). We don't apply the transform here — getPointAtLength
          on the original DOM paths returns coords already in world space, but
          React Flow's edge paths are positioned in the viewport's local
          coordinate system. Wrapping in the same translate/scale keeps the
          dots aligned with the edges. */}
      <g
        ref={layerRef}
        transform={`translate(${tx} ${ty}) scale(${zoom})`}
      />
    </svg>
  );
}
