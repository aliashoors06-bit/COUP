import { randomBytes, randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { CoupEngine } from '../shared/engine.js';
import { BotBrain } from '../shared/bot.js';
import { AVATARS, DEFAULT_TIMERS, PLAYER_COUNT, TOTAL_CARDS, TOTAL_COINS, type Avatar, type Difficulty } from '../shared/constants.js';
import {
  AvatarSchema,
  ChatSchema,
  CommandEnvelopeSchema,
  CreateRoomSchema,
  JoinRoomSchema,
  KickSchema,
  PracticeSchema,
  ReactionSchema,
  ReadySchema,
  ResumeSchema,
  SettingsSchema,
} from '../shared/schemas.js';
import type { ChatMessage, CommandEnvelope, GameEvent, GameUpdate, LobbyPlayer, RoomSettings, RoomState } from '../shared/types.js';
import type { ZodSchema } from 'zod';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BOT_NAMES = ['Vesper', 'Aurelio', 'Marguerite', 'Sterling', 'Octavia', 'Lucien', 'Celeste', 'Barnaby', 'Isolde', 'Thaddeus'];
const ROOM_IDLE_MS = 10 * 60_000;

export interface Seat {
  id: string;
  token: string;
  name: string;
  avatar: Avatar;
  ready: boolean;
  connected: boolean;
  socketId: string | null;
  isBot: boolean;
  difficulty?: Difficulty;
  botControlled: boolean;
  disconnectedAt: number | null;
  rematchVote: boolean;
  left: boolean;
}

export interface Room {
  code: string;
  practice: boolean;
  difficulty: Difficulty | null;
  hostId: string;
  seats: Seat[];
  settings: RoomSettings;
  status: 'lobby' | 'playing' | 'finished';
  engine: CoupEngine | null;
  chat: ChatMessage[];
  lastWinnerId: string | null;
  brains: Map<string, BotBrain>;
  promptTimer: NodeJS.Timeout | null;
  botTimers: Map<string, { promptId: number; timer: NodeJS.Timeout }>;
  takeoverTimers: Map<string, NodeJS.Timeout>;
  lastActivity: number;
}

type Ack = (res: Record<string, unknown>) => void;

interface SocketData {
  roomCode?: string;
  playerId?: string;
  bucket: { tokens: number; last: number };
  chat: number[];
}

const newId = () => randomBytes(9).toString('base64url');
const newToken = () => randomBytes(32).toString('hex');

export interface RoomManagerOptions {
  /** Scale bot thinking delays (tests use small values). */
  botDelayScale?: number;
  log?: (...args: unknown[]) => void;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private sweeper: NodeJS.Timeout;
  private botDelayScale: number;
  private log: (...args: unknown[]) => void;

  constructor(
    private io: Server,
    opts: RoomManagerOptions = {},
  ) {
    this.botDelayScale = opts.botDelayScale ?? 1;
    this.log = opts.log ?? (() => {});
    io.on('connection', (socket) => this.onConnection(socket));
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
  }

  close() {
    clearInterval(this.sweeper);
    for (const r of this.rooms.values()) this.disposeRoom(r);
  }

  // ───────────────────────── Connection ─────────────────────────

  private onConnection(socket: Socket) {
    const data = socket.data as SocketData;
    data.bucket = { tokens: 30, last: Date.now() };
    data.chat = [];

    const on = <T>(event: string, schema: ZodSchema<T> | null, fn: (payload: T, ack: Ack) => void) => {
      socket.on(event, (raw: unknown, maybeAck?: unknown) => {
        const ack: Ack = typeof maybeAck === 'function' ? (maybeAck as Ack) : typeof raw === 'function' ? (raw as Ack) : () => {};
        if (!this.rateLimit(data)) return ack({ ok: false, error: 'Slow down — too many requests' });
        let payload: T = undefined as T;
        if (schema) {
          const parsed = schema.safeParse(raw);
          if (!parsed.success) return ack({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' });
          payload = parsed.data;
        }
        try {
          fn(payload, ack);
        } catch (err) {
          this.log('handler error', event, err);
          ack({ ok: false, error: 'Server error' });
        }
      });
    };

    on('room:create', CreateRoomSchema, (p, ack) => {
      this.detach(socket);
      const room = this.createRoom(false, null);
      const seat = this.addHumanSeat(room, p.name, p.avatar);
      room.hostId = seat.id;
      this.attach(socket, room, seat);
      this.system(room, `${seat.name} created the room.`);
      ack({ ok: true, code: room.code, playerId: seat.id, token: seat.token });
      this.emitRoom(room);
    });

    on('room:join', JoinRoomSchema, (p, ack) => {
      const room = this.rooms.get(p.code);
      if (!room || room.practice) return ack({ ok: false, error: 'Room not found' });
      if (room.status !== 'lobby') return ack({ ok: false, error: 'That match is already in progress' });
      if (this.activeSeats(room).length >= PLAYER_COUNT) return ack({ ok: false, error: 'The room is full (6/6)' });
      this.detach(socket);
      const seat = this.addHumanSeat(room, p.name, p.avatar);
      this.attach(socket, room, seat);
      this.system(room, `${seat.name} joined the room.`);
      ack({ ok: true, code: room.code, playerId: seat.id, token: seat.token });
      this.emitRoom(room);
    });

    on('room:resume', ResumeSchema, (p, ack) => {
      const room = this.rooms.get(p.code);
      const seat = room?.seats.find((s) => s.token === p.token && !s.left);
      if (!room || !seat) return ack({ ok: false, error: 'Session expired' });
      // Kick any stale socket still bound to this seat.
      if (seat.socketId && seat.socketId !== socket.id) {
        const old = this.io.sockets.sockets.get(seat.socketId);
        if (old) {
          (old.data as SocketData).roomCode = undefined;
          old.emit('room:replaced');
          old.leave(`room:${room.code}`);
        }
      }
      this.detach(socket);
      this.attach(socket, room, seat);
      const t = room.takeoverTimers.get(seat.id);
      if (t) clearTimeout(t);
      room.takeoverTimers.delete(seat.id);
      if (seat.botControlled) {
        seat.botControlled = false;
        room.brains.delete(seat.id);
        this.clearBotTimer(room, seat.id);
        this.system(room, `${seat.name} reconnected and retakes their seat.`);
      } else if (seat.disconnectedAt) {
        this.system(room, `${seat.name} reconnected.`);
      }
      seat.disconnectedAt = null;
      ack({ ok: true, code: room.code, playerId: seat.id, token: seat.token });
      socket.emit('chat:history', room.chat);
      this.emitRoom(room);
      if (room.engine) this.emitGameTo(room, seat, []);
    });

    on('practice:create', PracticeSchema, (p, ack) => {
      this.detach(socket);
      const room = this.createRoom(true, p.difficulty);
      const seat = this.addHumanSeat(room, p.name, p.avatar);
      room.hostId = seat.id;
      seat.ready = true;
      const names = [...BOT_NAMES].sort(() => randomInt(3) - 1);
      for (let i = 0; i < PLAYER_COUNT - 1; i++) {
        room.seats.push({
          id: newId(),
          token: newToken(),
          name: names[i]!,
          avatar: AVATARS[(i + 1) % AVATARS.length]!,
          ready: true,
          connected: true,
          socketId: null,
          isBot: true,
          difficulty: p.difficulty,
          botControlled: false,
          disconnectedAt: null,
          rematchVote: true,
          left: false,
        });
      }
      this.attach(socket, room, seat);
      ack({ ok: true, code: room.code, playerId: seat.id, token: seat.token });
      this.startGame(room);
    });

    on('room:ready', ReadySchema, (p, ack) => {
      const ctx = this.ctx(socket);
      if (!ctx || ctx.room.status !== 'lobby') return ack({ ok: false, error: 'Not in a lobby' });
      ctx.seat.ready = p.ready;
      ack({ ok: true });
      this.emitRoom(ctx.room);
    });

    on('room:avatar', AvatarSchema, (p, ack) => {
      const ctx = this.ctx(socket);
      if (!ctx || ctx.room.status !== 'lobby') return ack({ ok: false, error: 'Not in a lobby' });
      ctx.seat.avatar = p.avatar;
      ack({ ok: true });
      this.emitRoom(ctx.room);
    });

    on('room:kick', KickSchema, (p, ack) => {
      const ctx = this.ctx(socket);
      if (!ctx) return ack({ ok: false, error: 'Not in a room' });
      const { room, seat } = ctx;
      if (room.hostId !== seat.id) return ack({ ok: false, error: 'Only the host can remove players' });
      if (room.status !== 'lobby') return ack({ ok: false, error: 'Players can only be removed before the match' });
      const target = room.seats.find((s) => s.id === p.playerId);
      if (!target || target.id === seat.id) return ack({ ok: false, error: 'Invalid player' });
      room.seats = room.seats.filter((s) => s.id !== target.id);
      if (target.socketId) {
        const ts = this.io.sockets.sockets.get(target.socketId);
        if (ts) {
          ts.emit('room:kicked');
          ts.leave(`room:${room.code}`);
          (ts.data as SocketData).roomCode = undefined;
        }
      }
      this.system(room, `${target.name} was removed by the host.`);
      ack({ ok: true });
      this.emitRoom(room);
    });

    on('room:settings', SettingsSchema, (p, ack) => {
      const ctx = this.ctx(socket);
      if (!ctx) return ack({ ok: false, error: 'Not in a room' });
      if (ctx.room.hostId !== ctx.seat.id) return ack({ ok: false, error: 'Only the host can change settings' });
      if (ctx.room.status !== 'lobby') return ack({ ok: false, error: 'Settings are locked during a match' });
      ctx.room.settings = p;
      ack({ ok: true });
      this.emitRoom(ctx.room);
    });

    on('room:start', null, (_p, ack) => {
      const ctx = this.ctx(socket);
      if (!ctx) return ack({ ok: false, error: 'Not in a room' });
      const { room, seat } = ctx;
      if (room.hostId !== seat.id) return ack({ ok: false, error: 'Only the host can start the match' });
      if (room.status !== 'lobby') return ack({ ok: false, error: 'The match has already started' });
      const seats = this.activeSeats(room);
      if (seats.length !== PLAYER_COUNT) return ack({ ok: false, error: 'COUP needs exactly six players' });
      if (!seats.every((s) => s.connected && s.ready)) return ack({ ok: false, error: 'Every player must be connected and ready' });
      ack({ ok: true });
      this.startGame(room);
    });

    on('room:chat', ChatSchema, (p, ack) => {
      const ctx = this.ctx(socket);
      if (!ctx) return ack({ ok: false, error: 'Not in a room' });
      if (!this.chatLimit(data)) return ack({ ok: false, error: 'You are sending messages too quickly' });
      this.pushChat(ctx.room, { id: newId(), playerId: ctx.seat.id, name: ctx.seat.name, text: p.text, ts: Date.now(), kind: 'chat' });
      ack({ ok: true });
    });

    on('room:reaction', ReactionSchema, (p, ack) => {
      const ctx = this.ctx(socket);
      if (!ctx) return ack({ ok: false, error: 'Not in a room' });
      if (!this.chatLimit(data)) return ack({ ok: false, error: 'Slow down' });
      this.pushChat(ctx.room, { id: newId(), playerId: ctx.seat.id, name: ctx.seat.name, text: p.emoji, ts: Date.now(), kind: 'reaction' });
      ack({ ok: true });
    });

    on('game:command', CommandEnvelopeSchema, (env, ack) => {
      const ctx = this.ctx(socket);
      if (!ctx || !ctx.room.engine) return ack({ ok: false, error: 'No match in progress' });
      const res = this.applyCommand(ctx.room, ctx.seat.id, env);
      ack(res as unknown as Record<string, unknown>);
    });

    on('game:rematch', ReadySchema, (p, ack) => {
      const ctx = this.ctx(socket);
      if (!ctx || ctx.room.status !== 'finished') return ack({ ok: false, error: 'The match is not over' });
      const { room, seat } = ctx;
      if (this.activeSeats(room).length !== PLAYER_COUNT || room.seats.some((s) => s.left))
        return ack({ ok: false, error: 'Someone left — return to the lobby to fill the table' });
      seat.rematchVote = p.ready;
      ack({ ok: true });
      this.emitRoom(room);
      const humans = room.seats.filter((s) => !s.isBot);
      if (humans.every((s) => s.rematchVote && s.connected)) this.startGame(room);
    });

    on('room:toLobby', null, (_p, ack) => {
      const ctx = this.ctx(socket);
      if (!ctx) return ack({ ok: false, error: 'Not in a room' });
      const { room, seat } = ctx;
      if (room.practice) return ack({ ok: false, error: 'Practice rooms have no lobby' });
      if (room.hostId !== seat.id) return ack({ ok: false, error: 'Only the host can return everyone to the lobby' });
      if (room.status !== 'finished') return ack({ ok: false, error: 'Finish the match first' });
      this.toLobby(room);
      ack({ ok: true });
    });

    on('room:leave', null, (_p, ack) => {
      const ctx = this.ctx(socket);
      if (ctx) this.leave(ctx.room, ctx.seat, socket);
      ack({ ok: true });
    });

    socket.on('disconnect', () => {
      const ctx = this.ctx(socket);
      if (!ctx) return;
      const { room, seat } = ctx;
      if (seat.socketId !== socket.id) return;
      seat.connected = false;
      seat.socketId = null;
      seat.disconnectedAt = Date.now();
      seat.rematchVote = false;
      room.lastActivity = Date.now();
      this.system(room, `${seat.name} disconnected.`);
      if (room.hostId === seat.id) this.transferHost(room);
      if (room.status === 'playing' && room.settings.disconnectPolicy === 'bot' && !room.practice) {
        const t = setTimeout(() => this.botTakeover(room, seat), room.settings.botTakeoverAfter * 1000);
        t.unref?.();
        room.takeoverTimers.set(seat.id, t);
      }
      this.emitRoom(room);
      if (room.engine) this.broadcastGame(room, []);
    });
  }

  // ───────────────────────── Room lifecycle ─────────────────────────

  private createRoom(practice: boolean, difficulty: Difficulty | null): Room {
    let code: string;
    do {
      code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room: Room = {
      code,
      practice,
      difficulty,
      hostId: '',
      seats: [],
      settings: { timers: { ...DEFAULT_TIMERS }, disconnectPolicy: 'bot', botTakeoverAfter: 45 },
      status: 'lobby',
      engine: null,
      chat: [],
      lastWinnerId: null,
      brains: new Map(),
      promptTimer: null,
      botTimers: new Map(),
      takeoverTimers: new Map(),
      lastActivity: Date.now(),
    };
    this.rooms.set(code, room);
    return room;
  }

  private addHumanSeat(room: Room, rawName: string, avatar: Avatar): Seat {
    let name = rawName;
    const taken = new Set(room.seats.map((s) => s.name.toLowerCase()));
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${rawName.slice(0, 13)} ${i}`;
    const seat: Seat = {
      id: newId(),
      token: newToken(),
      name,
      avatar,
      ready: false,
      connected: true,
      socketId: null,
      isBot: false,
      botControlled: false,
      disconnectedAt: null,
      rematchVote: false,
      left: false,
    };
    room.seats.push(seat);
    return seat;
  }

  private startGame(room: Room) {
    this.clearTimers(room);
    const seats = room.seats.filter((s) => !s.left);
    room.engine = new CoupEngine({
      players: seats.map((s) => ({ id: s.id, name: s.name, avatar: s.avatar, isBot: s.isBot })),
      timers: room.settings.timers,
      startingPlayerId: room.lastWinnerId ?? undefined,
    });
    room.status = 'playing';
    room.brains = new Map();
    for (const s of room.seats) {
      s.rematchVote = s.isBot;
      if (s.isBot) room.brains.set(s.id, new BotBrain(s.id, s.difficulty ?? 'medium'));
      else if (s.botControlled) room.brains.set(s.id, new BotBrain(s.id, 'medium'));
    }
    this.system(room, room.lastWinnerId ? 'A rematch begins! The previous winner takes the first turn.' : 'The match begins!');
    this.emitRoom(room);
    this.afterChange(room);
  }

  private toLobby(room: Room) {
    this.clearTimers(room);
    room.engine = null;
    room.status = 'lobby';
    room.lastWinnerId = null;
    room.brains.clear();
    room.seats = room.seats.filter((s) => !s.left && !(s.botControlled && !s.connected));
    for (const s of room.seats) {
      s.ready = false;
      s.rematchVote = false;
      s.botControlled = false;
    }
    if (!room.seats.some((s) => s.id === room.hostId)) this.transferHost(room);
    this.system(room, 'Everyone returns to the lobby.');
    this.emitRoom(room);
    this.io.to(`room:${room.code}`).emit('game:cleared');
  }

  private leave(room: Room, seat: Seat, socket: Socket) {
    socket.leave(`room:${room.code}`);
    (socket.data as SocketData).roomCode = undefined;
    (socket.data as SocketData).playerId = undefined;
    if (room.status === 'lobby') {
      room.seats = room.seats.filter((s) => s.id !== seat.id);
      this.system(room, `${seat.name} left the room.`);
    } else {
      seat.left = true;
      seat.connected = false;
      seat.socketId = null;
      seat.rematchVote = false;
      this.system(room, `${seat.name} left the match.`);
      if (room.status === 'playing' && !room.practice) this.botTakeover(room, seat);
    }
    if (room.hostId === seat.id) this.transferHost(room);
    if (!room.seats.some((s) => !s.isBot && !s.left)) {
      this.disposeRoom(room);
      return;
    }
    this.emitRoom(room);
    if (room.engine) this.broadcastGame(room, []);
  }

  private botTakeover(room: Room, seat: Seat) {
    room.takeoverTimers.delete(seat.id);
    if (room.status !== 'playing' || seat.connected || seat.botControlled) return;
    seat.botControlled = true;
    room.brains.set(seat.id, new BotBrain(seat.id, 'medium'));
    this.system(room, `An automated stand-in now plays for ${seat.name}.`);
    this.emitRoom(room);
    this.scheduleBots(room);
  }

  private transferHost(room: Room) {
    const next = room.seats.find((s) => !s.isBot && !s.left && s.connected && s.id !== room.hostId);
    if (next) {
      room.hostId = next.id;
      this.system(room, `${next.name} is now the host.`);
    }
  }

  private disposeRoom(room: Room) {
    this.clearTimers(room);
    for (const t of room.takeoverTimers.values()) clearTimeout(t);
    this.rooms.delete(room.code);
  }

  private sweep() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const anyone = room.seats.some((s) => !s.isBot && s.connected);
      if (!anyone && now - room.lastActivity > ROOM_IDLE_MS) this.disposeRoom(room);
    }
  }

  // ───────────────────────── Game flow ─────────────────────────

  applyCommand(room: Room, playerId: string, env: CommandEnvelope) {
    const engine = room.engine!;
    const res = engine.handle(playerId, env);
    room.lastActivity = Date.now();
    // Even a rejected command may have triggered an overdue timer inside handle().
    this.afterChange(room);
    return res;
  }

  private afterChange(room: Room) {
    const engine = room.engine;
    if (!engine) return;
    this.assertInvariants(room);
    const events = engine.drainEvents();
    for (const b of room.brains.values()) b.observe(events);
    this.broadcastGame(room, events);
    if (engine.phase === 'GAME_OVER') {
      this.clearTimers(room);
      if (room.status !== 'finished') {
        room.status = 'finished';
        room.lastWinnerId = engine.winnerId;
        for (const s of room.seats) s.rematchVote = s.isBot;
        this.emitRoom(room);
      }
      return;
    }
    this.schedulePromptTimer(room);
    this.scheduleBots(room);
  }

  private schedulePromptTimer(room: Room) {
    if (room.promptTimer) clearTimeout(room.promptTimer);
    const pr = room.engine?.prompt;
    if (!pr) return;
    const delay = Math.max(0, pr.deadline - Date.now()) + 25;
    room.promptTimer = setTimeout(() => {
      room.promptTimer = null;
      if (room.engine?.tick()) this.afterChange(room);
      else this.schedulePromptTimer(room);
    }, delay);
  }

  private scheduleBots(room: Room) {
    const engine = room.engine;
    const pr = engine?.prompt;
    if (!engine || !pr) return;
    for (const [id, brain] of room.brains) {
      const existing = room.botTimers.get(id);
      if (existing && existing.promptId === pr.id) continue;
      if (existing) this.clearBotTimer(room, id);
      if (!pr.playerIds.includes(id) || pr.responded.includes(id)) continue;
      const promptId = pr.id;
      const timer = setTimeout(() => {
        room.botTimers.delete(id);
        if (!room.engine || room.engine.prompt?.id !== promptId || !room.brains.has(id)) return;
        const cmd = brain.decide(room.engine.publicState(), room.engine.privateState(id)!);
        if (!cmd) return;
        this.applyCommand(room, id, { actionId: newId() + newId(), promptId, command: cmd });
      }, Math.round(brain.thinkTime() * this.botDelayScale));
      room.botTimers.set(id, { promptId, timer });
    }
  }

  private clearBotTimer(room: Room, id: string) {
    const t = room.botTimers.get(id);
    if (t) clearTimeout(t.timer);
    room.botTimers.delete(id);
  }

  private clearTimers(room: Room) {
    if (room.promptTimer) clearTimeout(room.promptTimer);
    room.promptTimer = null;
    for (const id of [...room.botTimers.keys()]) this.clearBotTimer(room, id);
  }

  private assertInvariants(room: Room) {
    const e = room.engine!;
    if (e.auditCards() !== TOTAL_CARDS || e.auditCoins() !== TOTAL_COINS) {
      this.log(`INVARIANT VIOLATION in room ${room.code}: cards=${e.auditCards()} coins=${e.auditCoins()}`);
    }
  }

  // ───────────────────────── Emitters ─────────────────────────

  private broadcastGame(room: Room, events: GameEvent[]) {
    for (const seat of room.seats) if (seat.socketId) this.emitGameTo(room, seat, events);
  }

  private emitGameTo(room: Room, seat: Seat, events: GameEvent[]) {
    const engine = room.engine;
    if (!engine || !seat.socketId) return;
    const update: GameUpdate & { serverNow: number } = {
      state: engine.publicState(),
      private: engine.privateState(seat.id),
      events,
      serverNow: Date.now(),
    };
    this.io.to(seat.socketId).emit('game:update', update);
  }

  roomState(room: Room): RoomState {
    return {
      code: room.code,
      practice: room.practice,
      difficulty: room.difficulty,
      hostId: room.hostId,
      players: room.seats
        .filter((s) => !(s.left && room.status === 'lobby'))
        .map(
          (s, seat): LobbyPlayer => ({
            id: s.id,
            name: s.name,
            avatar: s.avatar,
            ready: s.ready,
            connected: s.connected || s.isBot,
            isHost: s.id === room.hostId,
            isBot: s.isBot,
            botControlled: s.botControlled,
            difficulty: s.difficulty,
            seat,
            rematchVote: s.rematchVote,
          }),
        ),
      settings: room.settings,
      status: room.status,
      maxPlayers: PLAYER_COUNT,
    };
  }

  private emitRoom(room: Room) {
    this.io.to(`room:${room.code}`).emit('room:state', this.roomState(room));
  }

  private system(room: Room, text: string) {
    this.pushChat(room, { id: newId(), playerId: '', name: 'Court', text, ts: Date.now(), kind: 'system' });
  }

  private pushChat(room: Room, msg: ChatMessage) {
    room.chat.push(msg);
    if (room.chat.length > 100) room.chat.shift();
    this.io.to(`room:${room.code}`).emit('chat:message', msg);
  }

  // ───────────────────────── Helpers ─────────────────────────

  private attach(socket: Socket, room: Room, seat: Seat) {
    const data = socket.data as SocketData;
    data.roomCode = room.code;
    data.playerId = seat.id;
    seat.socketId = socket.id;
    seat.connected = true;
    room.lastActivity = Date.now();
    socket.join(`room:${room.code}`);
  }

  /** Leave any room this socket is currently bound to (e.g. creating a new room). */
  private detach(socket: Socket) {
    const ctx = this.ctx(socket);
    if (ctx) this.leave(ctx.room, ctx.seat, socket);
  }

  private ctx(socket: Socket): { room: Room; seat: Seat } | null {
    const data = socket.data as SocketData;
    if (!data.roomCode || !data.playerId) return null;
    const room = this.rooms.get(data.roomCode);
    const seat = room?.seats.find((s) => s.id === data.playerId);
    if (!room || !seat || seat.left) return null;
    return { room, seat };
  }

  private activeSeats(room: Room) {
    return room.seats.filter((s) => !s.left);
  }

  private rateLimit(data: SocketData): boolean {
    const now = Date.now();
    const b = data.bucket;
    b.tokens = Math.min(30, b.tokens + ((now - b.last) / 1000) * 15);
    b.last = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private chatLimit(data: SocketData): boolean {
    const now = Date.now();
    data.chat = data.chat.filter((t) => now - t < 5000);
    if (data.chat.length >= 5) return false;
    data.chat.push(now);
    return true;
  }
}
