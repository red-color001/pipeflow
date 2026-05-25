import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents, TopologyDTO } from '@pipeflow/shared';
import { useStore, emitFlow } from './store';
import { authHeaders, clearSession, getAuth } from './auth';

// Default to relative URLs so the bundle works on any host/IP — nginx proxies
// /api/ → server:4000 and /socket.io/ → server:4000.
const API = import.meta.env.VITE_API_URL ?? '/api';
const WS  = import.meta.env.VITE_SOCKET_URL ?? '';

export type DiagramSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: DiagramSocket | null = null;

export function getSocket(): DiagramSocket {
  if (socket) return socket;
  const token = getAuth().token ?? '';
  socket = io(`${WS}/diagram`, {
    transports: ['websocket'],
    auth: { token },
  });
  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') {
      clearSession();
    }
  });
  socket.on('node:added',   (n) => useStore.getState().upsertNode(n));
  socket.on('node:updated', (n) => useStore.getState().upsertNode(n));
  socket.on('node:removed', (id) => useStore.getState().removeNode(id));
  socket.on('edge:added',   (e) => useStore.getState().upsertEdge(e));
  socket.on('edge:removed', (id) => useStore.getState().removeEdge(id));
  socket.on('agent:status', ({ id, status }) => useStore.getState().setStatus(id, status));
  socket.on('flow:event', (e) => emitFlow(e));
  socket.on('node:metric', (m) => useStore.getState().setMetric(m));
  return socket;
}

export async function fetchTopology(): Promise<void> {
  const r = await fetch(`${API}/topology`, { headers: authHeaders() });
  if (r.status === 401) {
    clearSession();
    throw new Error('unauthorized');
  }
  if (!r.ok) throw new Error(`topology fetch failed: ${r.status}`);
  const data: TopologyDTO = await r.json();
  useStore.getState().setAll(data);
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function emitNodeMove(id: string, x: number, y: number) {
  getSocket().emit('node:move', { id, x, y });
}

export function emitEdgeDelete(id: number) {
  getSocket().emit('edge:delete', id);
}

export function emitNodeDelete(id: string) {
  getSocket().emit('node:delete', id);
}
