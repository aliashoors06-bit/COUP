import express from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { RoomManager, type RoomManagerOptions } from './rooms.js';

export interface StartOptions extends RoomManagerOptions {
  port?: number;
  serveStatic?: boolean;
}

export async function startServer(opts: StartOptions = {}): Promise<{ http: HttpServer; io: Server; rooms: RoomManager; port: number; close: () => Promise<void> }> {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  const http = createServer(app);
  const origins = process.env.CLIENT_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean);
  const io = new Server(http, {
    cors: origins?.length ? { origin: origins } : undefined,
    maxHttpBufferSize: 16_384,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });
  const rooms = new RoomManager(io, opts);

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, rooms: rooms.rooms.size });
  });

  if (opts.serveStatic) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [path.resolve(here, '../../dist'), path.resolve(process.cwd(), 'dist')];
    const dist = candidates.find((d) => existsSync(path.join(d, 'index.html')));
    if (dist) {
      app.use(
        express.static(dist, {
          index: false,
          setHeaders(res, file) {
            if (file.includes(`${path.sep}assets${path.sep}`) && /\.(js|css|png|webp|wav|svg)$/.test(file))
              res.setHeader('Cache-Control', 'public, max-age=604800');
          },
        }),
      );
      app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    } else {
      console.warn('[coup] dist/ not found — run `npm run build` first. Serving API only.');
    }
  }

  const port = await new Promise<number>((resolve) => {
    http.listen(opts.port ?? 0, () => {
      const addr = http.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });

  const close = () =>
    new Promise<void>((resolve) => {
      rooms.close();
      io.close(() => resolve());
    });

  return { http, io, rooms, port, close };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT ?? 3001);
  const production = process.env.NODE_ENV === 'production';
  startServer({ port, serveStatic: production, log: console.error }).then(({ port: p }) => {
    console.log(`[coup] server listening on http://localhost:${p}${production ? '' : ' (API only — open the Vite dev server on :5173)'}`);
  });
}
