import type { NodeDTO, EdgeDTO } from '@pipeflow/shared';

export type Side = 'L' | 'R' | 'T' | 'B';
export const OPP: Record<Side, Side> = { L: 'R', R: 'L', T: 'B', B: 'T' };

export interface PositionedNode extends NodeDTO {
  cx: number; cy: number;
}

export function withCentroid(n: NodeDTO): PositionedNode {
  return { ...n, cx: n.x + n.w / 2, cy: n.y + n.h / 2 };
}

export function edgeSide(a: PositionedNode, b: PositionedNode): [Side, Side] {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  const horiz = Math.abs(dx) > Math.abs(dy) * 1.1;
  if (horiz) return [dx > 0 ? 'R' : 'L', dx > 0 ? 'L' : 'R'];
  return [dy > 0 ? 'B' : 'T', dy > 0 ? 'T' : 'B'];
}

export interface PortSlot { slot: number; total: number; side: Side; }

export function computeSlots(
  edges: EdgeDTO[],
  NODE: Record<string, PositionedNode>
): Record<string, PortSlot> {
  const groups: Record<string, Array<{ i: number; end: 'a' | 'b'; o: number }>> = {};
  edges.forEach((e, i) => {
    const a = NODE[e.from], b = NODE[e.to]; if (!a || !b) return;
    const [sa, sb] = edgeSide(a, b);
    const kA = `${e.from}|${sa}`, kB = `${e.to}|${sb}`;
    if (!groups[kA]) groups[kA] = [];
    if (!groups[kB]) groups[kB] = [];
    groups[kA].push({ i, end: 'a', o: (sa === 'L' || sa === 'R') ? b.cy : b.cx });
    groups[kB].push({ i, end: 'b', o: (sb === 'L' || sb === 'R') ? a.cy : a.cx });
  });
  const slots: Record<string, PortSlot> = {};
  Object.entries(groups).forEach(([key, list]) => {
    list.sort((p, q) => p.o - q.o);
    list.forEach((item, idx) => {
      slots[`${item.i}|${item.end}`] = { slot: idx, total: list.length, side: key.split('|')[1] as Side };
    });
  });
  return slots;
}

export interface Port { x: number; y: number; n: Side; }

export function portOf(n: PositionedNode, side: Side, slot: number, total: number): Port {
  const frac = (slot + 1) / (total + 1);
  if (side === 'L') return { x: n.x,        y: n.y + n.h * frac, n: 'L' };
  if (side === 'R') return { x: n.x + n.w,  y: n.y + n.h * frac, n: 'R' };
  if (side === 'T') return { x: n.x + n.w * frac, y: n.y,        n: 'T' };
  return                  { x: n.x + n.w * frac, y: n.y + n.h,   n: 'B' };
}

export function socketPos(n: PositionedNode, side: Side): { x: number; y: number } {
  if (side === 'L') return { x: n.x,         y: n.cy };
  if (side === 'R') return { x: n.x + n.w,   y: n.cy };
  if (side === 'T') return { x: n.cx,        y: n.y };
  return                  { x: n.cx,        y: n.y + n.h };
}

export interface Cubic {
  p0: { x: number; y: number };
  c1: { x: number; y: number };
  c2: { x: number; y: number };
  p3: { x: number; y: number };
}

export function cubicBetweenPorts(pa: Port, pb: Port, bend = 0): Cubic {
  const horiz = pa.n === 'L' || pa.n === 'R';
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const k = 0.55;
  let c1, c2;
  if (horiz) {
    const off = Math.abs(dx) * k;
    const bendOff = bend * Math.max(60, Math.abs(dx) * 0.4);
    c1 = { x: pa.x + (pa.n === 'R' ? off : -off), y: pa.y + bendOff };
    c2 = { x: pb.x + (pb.n === 'L' ? -off :  off), y: pb.y + bendOff };
  } else {
    const off = Math.abs(dy) * k;
    const bendOff = bend * Math.max(60, Math.abs(dy) * 0.4);
    c1 = { x: pa.x + bendOff, y: pa.y + (pa.n === 'B' ? off : -off) };
    c2 = { x: pb.x + bendOff, y: pb.y + (pb.n === 'T' ? -off :  off) };
  }
  return { p0: { x: pa.x, y: pa.y }, c1, c2, p3: { x: pb.x, y: pb.y } };
}

export function pathFromCubic(c: Cubic): string {
  return `M ${c.p0.x} ${c.p0.y} C ${c.c1.x} ${c.c1.y}, ${c.c2.x} ${c.c2.y}, ${c.p3.x} ${c.p3.y}`;
}

export function pathBetweenPorts(pa: Port, pb: Port, bend = 0): string {
  return pathFromCubic(cubicBetweenPorts(pa, pb, bend));
}

// Cubic Bezier eval at parameter t ∈ [0,1].
export function bezierAt(c: Cubic, t: number): { x: number; y: number } {
  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;
  return {
    x: b0 * c.p0.x + b1 * c.c1.x + b2 * c.c2.x + b3 * c.p3.x,
    y: b0 * c.p0.y + b1 * c.c1.y + b2 * c.c2.y + b3 * c.p3.y,
  };
}

export function pathFreeform(pa: Port, pb: Port): string {
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const horiz = Math.abs(dx) > Math.abs(dy);
  const k = 0.55;
  let c1, c2;
  if (horiz) {
    c1 = { x: pa.x + dx * k, y: pa.y };
    c2 = { x: pb.x - dx * k, y: pb.y };
  } else {
    c1 = { x: pa.x, y: pa.y + dy * k };
    c2 = { x: pb.x, y: pb.y - dy * k };
  }
  return `M ${pa.x} ${pa.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${pb.x} ${pb.y}`;
}
