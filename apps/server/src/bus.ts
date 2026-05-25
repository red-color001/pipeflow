import { Server } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents } from '@pipeflow/shared';

export type IO = Server<ClientToServerEvents, ServerToClientEvents>;

let ioInstance: IO | null = null;

export function setIO(io: IO) { ioInstance = io; }
export function getIO(): IO {
  if (!ioInstance) throw new Error('socket.io not initialized');
  return ioInstance;
}

export function emit<K extends keyof ServerToClientEvents>(
  event: K,
  ...args: Parameters<ServerToClientEvents[K]>
) {
  getIO().of('/diagram').emit(event as any, ...args);
}
