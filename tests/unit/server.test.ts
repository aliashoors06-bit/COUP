import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { startServer } from '../../src/server/index.js';
import { BotBrain } from '../../src/shared/bot.js';
import { TOTAL_CARDS, TOTAL_COINS } from '../../src/shared/constants.js';
import type { GameUpdate, RoomState } from '../../src/shared/types.js';

type Srv = Awaited<ReturnType<typeof startServer>>;
let srv: Srv;
let url: string;

beforeAll(async () => {
  srv = await startServer({ port: 0, botDelayScale: 0.02 });
  url = `http://localhost:${srv.port}`;
});
afterAll(async () => {
  await srv.close();
});

interface Client {
  s: Socket;
  name: string;
  playerId: string;
  token: string;
  code: string;
  room: RoomState | null;
  game: (GameUpdate & { serverNow: number }) | null;
  updates: (GameUpdate & { serverNow: number })[];
  brain?: BotBrain;
}

const emit = <T = any>(s: Socket, ev: string, payload?: unknown): Promise<T> =>
  new Promise((res) => (payload === undefined ? s.emit(ev, res) : s.emit(ev, payload, res)));

async function connect(name: string): Promise<Client> {
  const s = ioc(url, { transports: ['websocket'], forceNew: true });
  await new Promise<void>((r) => s.on('connect', () => r()));
  const c: Client = { s, name, playerId: '', token: '', code: '', room: null, game: null, updates: [] };
  s.on('room:state', (r: RoomState) => (c.room = r));
  s.on('game:update', (u: any) => {
    c.game = u;
    c.updates.push(u);
  });
  return c;
}

const waitFor = async (fn: () => boolean, ms = 10_000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

async function sixPlayerRoom() {
  const host = await connect('Host');
  const res = await emit(host.s, 'room:create', { name: 'Host', avatar: 'duke' });
  expect(res.ok).toBe(true);
  Object.assign(host, { playerId: res.playerId, token: res.token, code: res.code });
  const clients = [host];
  for (let i = 1; i < 6; i++) {
    const c = await connect(`P${i}`);
    const r = await emit(c.s, 'room:join', { name: `P${i}`, avatar: 'captain', code: res.code });
    expect(r.ok, r.error).toBe(true);
    Object.assign(c, { playerId: r.playerId, token: r.token, code: r.code });
    clients.push(c);
  }
  await waitFor(() => clients.every((c) => c.room?.players.length === 6));
  return clients;
}

/** Drive a client with a bot brain that only sees what the client receives. */
function autoplay(c: Client, stopOn?: () => boolean) {
  c.brain = new BotBrain(c.playerId, 'medium', c.name.length * 97);
  let lastPrompt = -1;
  const act = async () => {
    const u = c.game;
    if (!u || !u.private || stopOn?.()) return;
    const pr = u.state.prompt;
    if (!pr || pr.id === lastPrompt) return;
    const cmd = c.brain!.decide(u.state, u.private);
    if (!cmd) return;
    lastPrompt = pr.id;
    const r = await emit(c.s, 'game:command', { actionId: randomUUID(), promptId: pr.id, command: cmd });
    if (!r.ok) lastPrompt = -1; // e.g. window closed by someone else; wait for next update
  };
  c.s.on('game:update', (u: GameUpdate) => {
    c.brain!.observe(u.events);
    void act();
  });
  void act();
}

describe('lobby', () => {
  it('creates a room with a six-character code, enforces six seats and readiness', async () => {
    const clients = await sixPlayerRoom();
    const [host] = clients;
    expect(host!.code).toMatch(/^[A-Z0-9]{6}$/);

    // A seventh player cannot join.
    const seventh = await connect('Seven');
    const r7 = await emit(seventh.s, 'room:join', { name: 'Seven', avatar: 'duke', code: host!.code });
    expect(r7.ok).toBe(false);
    expect(r7.error).toMatch(/full/);

    // Cannot start until everyone is ready.
    expect((await emit(host!.s, 'room:start')).ok).toBe(false);
    for (const c of clients.slice(0, 5)) expect((await emit(c.s, 'room:ready', { ready: true })).ok).toBe(true);
    expect((await emit(host!.s, 'room:start')).ok).toBe(false);

    // Only the host may kick, and only in the lobby.
    expect((await emit(clients[1]!.s, 'room:kick', { playerId: clients[2]!.playerId })).ok).toBe(false);
    const kicked = new Promise<void>((r) => clients[5]!.s.once('room:kicked', () => r()));
    expect((await emit(host!.s, 'room:kick', { playerId: clients[5]!.playerId })).ok).toBe(true);
    await kicked;
    await waitFor(() => host!.room?.players.length === 5);

    // Now the seventh can take the free seat.
    const r7b = await emit(seventh.s, 'room:join', { name: 'Seven', avatar: 'duke', code: host!.code });
    expect(r7b.ok).toBe(true);
    await emit(seventh.s, 'room:ready', { ready: true });
    await waitFor(() => host!.room?.players.length === 6 && host!.room.players.every((p) => p.ready));
    expect((await emit(clients[1]!.s, 'room:start')).ok).toBe(false); // not host
    expect((await emit(host!.s, 'room:start')).ok).toBe(true);
    await waitFor(() => !!host!.game);
    for (const c of [...clients, seventh]) c.s.close();
  });

  it('validates input with zod and rate-limits chat', async () => {
    const c = await connect('X');
    expect((await emit(c.s, 'room:create', { name: '', avatar: 'duke' })).ok).toBe(false);
    expect((await emit(c.s, 'room:create', { name: 'X', avatar: 'nope' })).ok).toBe(false);
    expect((await emit(c.s, 'room:join', { name: 'X', avatar: 'duke', code: 'ZZZZZZ' })).ok).toBe(false);
    const r = await emit(c.s, 'room:create', { name: 'X', avatar: 'duke' });
    expect(r.ok).toBe(true);
    const results = [];
    for (let i = 0; i < 7; i++) results.push((await emit(c.s, 'room:chat', { text: `hi ${i}` })).ok);
    expect(results.filter((x) => !x).length).toBeGreaterThan(0);
    c.s.close();
  });

  it('transfers host when the host disconnects', async () => {
    const clients = await sixPlayerRoom();
    const oldHost = clients[0]!.playerId;
    clients[0]!.s.close();
    await waitFor(() => !!clients[1]!.room && clients[1]!.room.hostId !== oldHost);
    expect(clients[1]!.room!.players.find((p) => p.id === oldHost)?.connected).toBe(false);
    for (const c of clients) c.s.close();
  });
});

describe('six-player match over the network', () => {
  it('plays a complete match with six clients, protects private cards, and rematches', async () => {
    const clients = await sixPlayerRoom();
    const host = clients[0]!;
    for (const c of clients) await emit(c.s, 'room:ready', { ready: true });
    await waitFor(() => host.room!.players.every((p) => p.ready));
    for (const c of clients) autoplay(c);
    expect((await emit(host.s, 'room:start')).ok).toBe(true);

    await waitFor(() => clients.every((c) => c.game?.state.phase === 'GAME_OVER'), 60_000);
    const final = host.game!.state;
    expect(final.winnerId).toBeTruthy();
    expect(final.players.filter((p) => !p.eliminated)).toHaveLength(1);
    expect(final.summary?.winnerId).toBe(final.winnerId);
    const coins = final.treasury + final.players.reduce((n, p) => n + p.coins, 0);
    expect(coins).toBe(TOTAL_COINS);
    const visibleCards = final.deckCount + final.players.reduce((n, p) => n + p.slots.length, 0);
    expect(visibleCards).toBe(TOTAL_CARDS);

    // Privacy: every update a client received only contained its own hand,
    // and opponents' hidden slots never carried a role.
    for (const c of clients) {
      for (const u of c.updates) {
        expect(u.private?.playerId).toBe(c.playerId);
        for (const p of u.state.players) for (const s of p.slots) if (!s.revealed) expect(Object.keys(s)).toEqual(['revealed']);
        const json = JSON.stringify(u.state);
        for (const other of clients) {
          if (other === c) continue;
          const theirIds = other.updates.flatMap((x) => x.private?.hand.map((h) => h.card.id) ?? []);
          for (const id of new Set(theirIds)) expect(json).not.toContain(id);
        }
      }
    }

    // Duplicate request ids are ignored.
    await waitFor(() => host.room?.status === 'finished');
    // Rematch: all six vote; previous winner starts, everything resets.
    const winner = final.winnerId;
    for (const c of clients) c.updates = [];
    for (const c of clients) expect((await emit(c.s, 'game:rematch', { ready: true })).ok).toBe(true);
    await waitFor(() => clients.every((c) => c.updates.some((u) => u.state.phase !== 'GAME_OVER')));
    const fresh = clients[0]!.updates.find((u) => u.state.phase !== 'GAME_OVER')!.state;
    expect(fresh.turnNumber).toBeLessThanOrEqual(2);
    expect(fresh.players.every((p) => p.slots.length === 2)).toBe(true);
    expect(fresh.summary).toBeNull();
    expect(fresh.log.some((l) => l.text.includes('assembled'))).toBe(true);
    const first = clients[0]!.updates[0]!.state;
    expect(first.currentPlayerId).toBe(winner);
    for (const c of clients) c.s.close();
  }, 90_000);

  it('rejects duplicate and stale commands, and restores state after reconnecting', async () => {
    const clients = await sixPlayerRoom();
    const host = clients[0]!;
    for (const c of clients) await emit(c.s, 'room:ready', { ready: true });
    await waitFor(() => host.room!.players.every((p) => p.ready));
    expect((await emit(host.s, 'room:start')).ok).toBe(true);
    await waitFor(() => clients.every((c) => !!c.game));
    const st = host.game!.state;
    const current = clients.find((c) => c.playerId === st.currentPlayerId)!;
    const other = clients.find((c) => c !== current)!;

    // Not your turn.
    expect((await emit(other.s, 'game:command', { actionId: randomUUID(), promptId: st.prompt!.id, command: { type: 'action', action: 'income' } })).ok).toBe(false);
    // Duplicate request id.
    const env = { actionId: randomUUID(), promptId: st.prompt!.id, command: { type: 'action', action: 'income' } };
    expect((await emit(current.s, 'game:command', env)).ok).toBe(true);
    expect((await emit(current.s, 'game:command', env)).ok).toBe(false);
    // Malformed command.
    expect((await emit(current.s, 'game:command', { actionId: 'x', promptId: 1, command: { type: 'hack' } })).ok).toBe(false);

    // Disconnect a player and reconnect with the session token: hand is restored.
    const victim = clients[3]!;
    const handBefore = victim.game!.private!.hand.map((h) => h.card.id);
    victim.s.close();
    await waitFor(() => host.room!.players.find((p) => p.id === victim.playerId)?.connected === false);
    const again = await connect(victim.name);
    const r = await emit(again.s, 'room:resume', { code: victim.code, token: victim.token });
    expect(r.ok).toBe(true);
    expect(r.playerId).toBe(victim.playerId);
    await waitFor(() => !!again.game);
    expect(again.game!.private!.hand.map((h) => h.card.id)).toEqual(handBefore);
    await waitFor(() => host.room!.players.find((p) => p.id === victim.playerId)?.connected === true);
    // A bogus token is refused.
    const thief = await connect('Thief');
    expect((await emit(thief.s, 'room:resume', { code: victim.code, token: 'f'.repeat(64) })).ok).toBe(false);
    for (const c of [...clients, again, thief]) c.s.close();
  });

  it('practice mode: one human vs five bots plays to completion', async () => {
    const c = await connect('Solo');
    const r = await emit(c.s, 'practice:create', { name: 'Solo', avatar: 'contessa', difficulty: 'hard' });
    expect(r.ok).toBe(true);
    c.playerId = r.playerId;
    await waitFor(() => !!c.game);
    expect(c.game!.state.players.filter((p) => p.isBot)).toHaveLength(5);
    autoplay(c);
    await waitFor(() => c.game?.state.phase === 'GAME_OVER', 60_000);
    expect(c.game!.state.winnerId).toBeTruthy();
    c.s.close();
  }, 70_000);
});
