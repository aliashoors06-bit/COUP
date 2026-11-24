import { io, type Socket } from 'socket.io-client';

const url = import.meta.env.VITE_SERVER_URL || undefined;

export const socket: Socket = io(url ?? '/', {
  autoConnect: true,
  transports: ['websocket', 'polling'],
  reconnectionDelay: 500,
  reconnectionDelayMax: 4000,
});

export interface Ack {
  ok: boolean;
  error?: string;
  [k: string]: unknown;
}

/** Emit with acknowledgement and timeout. */
export function request(event: string, payload?: unknown, timeoutMs = 8000): Promise<Ack> {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, error: 'Not connected to the server — retrying…' });
      return;
    }
    const t = setTimeout(() => resolve({ ok: false, error: 'The server did not respond' }), timeoutMs);
    const done = (res: Ack) => {
      clearTimeout(t);
      resolve(res ?? { ok: false, error: 'No response' });
    };
    if (payload === undefined) socket.emit(event, done);
    else socket.emit(event, payload, done);
  });
}
