/**
 * Client-side animation ledger for physical coins and cards.
 *
 * The authoritative balances always come from the latest server snapshot. While a transfer is
 * animating, the number shown for an anchor is derived from that snapshot plus the coins that
 * are still "in the air":
 *
 *   shown(anchor) = server(anchor) + coins not yet launched FROM anchor − coins not yet landed AT anchor
 *
 * So the display always converges on the server value. There is no separate client counter
 * that could drift, coins can't disappear, and nothing replays after a refresh, because a
 * reconnect snapshot carries no events.
 */
import { create } from 'zustand';
import type { Role } from '../../shared/constants';
import type { GameEvent } from '../../shared/types';
import { sound } from './sound';

export interface CoinFlight {
  id: number;
  from: string;
  to: string;
  value: number;
  start: number;
  dur: number;
  arc: number;
  spin: number;
  jx: number;
  jy: number;
}

export interface CardFlight {
  id: number;
  from: string;
  to: string;
  role: Role | null;
  start: number;
  dur: number;
  /** Card slot ('<pid>:<slot>') kept empty until this flight finishes */
  hideKey?: string;
  /** Pause at the start (e.g. a proof card is shown before it returns to the deck) */
  hold?: number;
}

export interface Ribbon {
  id: number;
  title: string;
  sub?: string;
  tone: 'red' | 'gold' | 'silver' | 'teal';
}

export interface Impact {
  id: number;
  playerId: string;
  kind: 'coup' | 'assassinate' | 'challenge' | 'block' | 'reveal';
  at: number;
}

interface FxState {
  now: number;
  coins: CoinFlight[];
  cards: CardFlight[];
  ribbon: Ribbon | null;
  impacts: Impact[];
  shakeAt: number;
}

export const useTableFx = create<FxState>(() => ({ now: performance.now(), coins: [], cards: [], ribbon: null, impacts: [], shakeAt: 0 }));

let seq = 1;
let coinQueueEnd = 0;
let cardQueueEnd = 0;
let ticker: ReturnType<typeof setInterval> | null = null;
let lastCoinSound = 0;
const ribbonQueue: Ribbon[] = [];
let ribbonBusy = false;

const COIN_DUR = 640;
const COIN_STAGGER = 95;
const CARD_DUR = 460;

function ensureTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    const now = performance.now();
    const st = useTableFx.getState();
    const coins = st.coins.filter((f) => now < f.start + f.dur + 60);
    const cards = st.cards.filter((f) => now < f.start + (f.hold ?? 0) + f.dur + 320);
    const impacts = st.impacts.filter((i) => now < i.at + 1600);
    useTableFx.setState({ now, coins, cards, impacts });
    if (!coins.length && !cards.length && !impacts.length && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }, 33);
}

export function resetTableFx() {
  coinQueueEnd = 0;
  cardQueueEnd = 0;
  ribbonQueue.length = 0;
  useTableFx.setState({ coins: [], cards: [], impacts: [], ribbon: null, now: performance.now() });
}

/** Split `amount` coins into at most `max` sprites that still add up exactly. */
function split(amount: number, max = 12): number[] {
  if (amount <= max) return Array(amount).fill(1);
  const base = Math.floor(amount / max);
  const extra = amount % max;
  return Array.from({ length: max }, (_, i) => base + (i < extra ? 1 : 0));
}

export function queueCoins(from: string, to: string, amount: number, minStart = 0) {
  if (amount <= 0) return;
  const now = performance.now();
  let start = Math.max(now + 40, coinQueueEnd, minStart);
  // Never let animations lag far behind the game: compress when the queue is long.
  const backlog = start - now;
  const stagger = backlog > 1800 ? 45 : COIN_STAGGER;
  const dur = backlog > 1800 ? 420 : COIN_DUR;
  if (backlog > 3500) start = now + 40;
  const parts = split(amount);
  const flights: CoinFlight[] = parts.map((value, i) => ({
    id: seq++,
    from,
    to,
    value,
    start: start + i * stagger,
    dur: dur + Math.random() * 120,
    arc: 70 + Math.random() * 70,
    spin: (Math.random() < 0.5 ? -1 : 1) * (240 + Math.random() * 300),
    jx: (Math.random() - 0.5) * 18,
    jy: (Math.random() - 0.5) * 10,
  }));
  coinQueueEnd = start + (parts.length - 1) * stagger + dur * 0.55;
  for (const f of flights) {
    setTimeout(() => {
      const t = performance.now();
      if (t - lastCoinSound > 55) {
        lastCoinSound = t;
        sound.play(to === 'treasury' ? 'spend' : 'coin', 0.35);
      }
    }, Math.max(0, f.start + f.dur - now));
  }
  useTableFx.setState((s) => ({ coins: [...s.coins, ...flights] }));
  ensureTicker();
}

export function queueCard(from: string, to: string, opts: { role?: Role | null; hideKey?: string; delay?: number; hold?: number; dur?: number } = {}) {
  const now = performance.now();
  const start = Math.max(now + 20, opts.delay !== undefined ? now + opts.delay : cardQueueEnd);
  const f: CardFlight = { id: seq++, from, to, role: opts.role ?? null, start, dur: opts.dur ?? CARD_DUR, hideKey: opts.hideKey, hold: opts.hold };
  if (opts.delay === undefined) cardQueueEnd = start + 120;
  useTableFx.setState((s) => ({ cards: [...s.cards, f] }));
  ensureTicker();
  return f;
}

export function pushRibbon(r: Omit<Ribbon, 'id'>, reduced: boolean) {
  if (ribbonQueue.length > 2) ribbonQueue.shift();
  ribbonQueue.push({ ...r, id: seq++ });
  pumpRibbon(reduced);
}

function pumpRibbon(reduced: boolean) {
  if (ribbonBusy) return;
  const next = ribbonQueue.shift();
  if (!next) return;
  ribbonBusy = true;
  useTableFx.setState({ ribbon: next });
  setTimeout(
    () => {
      useTableFx.setState({ ribbon: null });
      setTimeout(() => {
        ribbonBusy = false;
        pumpRibbon(reduced);
      }, 160);
    },
    reduced ? 850 : 1150,
  );
}

export function impact(playerId: string, kind: Impact['kind']) {
  useTableFx.setState((s) => ({ impacts: [...s.impacts, { id: seq++, playerId, kind, at: performance.now() }] }));
  ensureTicker();
}

export function shake() {
  useTableFx.setState({ shakeAt: performance.now() });
}

// ───────────── Derived values ─────────────

export function shownCoins(anchor: string, server: number, coins: CoinFlight[], now: number): number {
  let v = server;
  for (const f of coins) {
    if (f.from === anchor && now < f.start) v += f.value;
    if (f.to === anchor && now < f.start + f.dur) v -= f.value;
  }
  return Math.max(0, v);
}

export function slotHidden(key: string, cards: CardFlight[], now: number): boolean {
  return cards.some((f) => f.hideKey === key && now < f.start + (f.hold ?? 0) + f.dur);
}

/** The local player's dealt cards stay face-down for a moment after landing, then flip. */
export function slotFaceDown(key: string, cards: CardFlight[], now: number): boolean {
  return cards.some((f) => f.hideKey === key && now < f.start + (f.hold ?? 0) + f.dur + 280);
}

// ───────────── Server event → physical animation ─────────────

export function animateEvents(events: GameEvent[], opts: { me: string; reduced: boolean; names: (id: string) => string; physical: boolean }) {
  const proofRole: Record<string, Role> = {};
  const { physical, reduced } = opts;
  const name = opts.names;
  for (const e of events) {
    switch (e.t) {
      case 'deal': {
        sound.play('deal');
        if (physical) {
          const now = performance.now();
          const n = e.order.length;
          // Deal round-robin, one card at a time, like a real dealer.
          for (let r = 0; r < 2; r++)
            e.order.forEach((pid, i) => {
              const k = r * n + i;
              queueCard('deck', `${pid}:${r}`, { hideKey: `${pid}:${r}`, delay: 250 + k * 115 });
              if (k % 3 === 0) setTimeout(() => sound.play('deal', 0.5), 250 + k * 115);
            });
          // Starting coins slide out of the treasury after the cards.
          const coinsAt = now + 250 + 2 * n * 115 + 300;
          e.order.forEach((pid) => queueCoins('treasury', pid, 2, coinsAt));
        }
        pushRibbon({ title: 'The court assembles', sub: 'Two influence and two coins each', tone: 'gold' }, reduced);
        break;
      }
      case 'turn':
        if (e.playerId === opts.me) sound.play('turn');
        break;
      case 'coins':
        if (physical) queueCoins(e.from, e.to, e.amount);
        else sound.play(e.to === 'treasury' ? 'spend' : 'coin');
        break;
      case 'challenge':
        sound.play('challenge');
        impact(e.challengerId, 'challenge');
        pushRibbon({ title: 'Challenge!', sub: `${name(e.challengerId)} doubts ${name(e.claimantId)}`, tone: 'red' }, reduced);
        break;
      case 'proof':
        if (e.success) proofRole[e.playerId] = e.role;
        sound.play(e.success ? 'flip' : 'block');
        pushRibbon(
          e.success
            ? { title: 'Claim proven', sub: `${name(e.playerId)} reveals the ${cap(e.role)}`, tone: 'gold' }
            : { title: 'Bluff exposed', sub: `${name(e.playerId)} has no ${cap(e.role)}`, tone: 'red' },
          reduced,
        );
        break;
      case 'replace': {
        if (!physical) break;
        const key = `${e.playerId}:${e.slot}`;
        const role = proofRole[e.playerId] ?? null;
        // The proven card is shown face-up, returns to the deck, and a fresh card is dealt back.
        queueCard(key, 'deck', { role, hideKey: key, delay: 80, hold: 700, dur: 480 });
        queueCard('deck', key, { hideKey: key, delay: 80 + 700 + 480 + 180, dur: 480 });
        setTimeout(() => sound.play('deal'), 1450);
        break;
      }
      case 'block':
        sound.play('block');
        impact(e.playerId, 'block');
        pushRibbon({ title: `${cap(e.role)} block`, sub: `${name(e.playerId)} blocks ${name(e.actorId)}`, tone: 'teal' }, reduced);
        break;
      case 'blocked':
        sound.play('block');
        pushRibbon({ title: 'Blocked', sub: `${name(e.blockerId)} stops ${name(e.actorId)}`, tone: 'silver' }, reduced);
        break;
      case 'reveal':
        sound.play('flip');
        impact(e.playerId, 'reveal');
        break;
      case 'coup':
        sound.play('coup');
        impact(e.targetId, 'coup');
        if (!reduced) shake();
        pushRibbon({ title: 'Coup', sub: `${name(e.actorId)} overthrows ${name(e.targetId)}`, tone: 'red' }, reduced);
        break;
      case 'assassinate':
        sound.play('assassinate');
        impact(e.targetId, 'assassinate');
        pushRibbon({ title: 'Assassination', sub: `${name(e.actorId)} strikes ${name(e.targetId)}`, tone: 'red' }, reduced);
        break;
      case 'exchange':
        if (physical) {
          if (!e.done) {
            queueCard('deck', e.playerId, { delay: 60 });
            queueCard('deck', e.playerId, { delay: 200 });
            sound.play('deal');
          } else {
            queueCard(e.playerId, 'deck', { delay: 60 });
            queueCard(e.playerId, 'deck', { delay: 200 });
          }
        }
        break;
      case 'eliminated':
        sound.play('eliminate');
        pushRibbon({ title: 'Exiled', sub: `${name(e.playerId)} has lost all influence`, tone: 'red' }, reduced);
        break;
      case 'victory':
        sound.play(e.playerId === opts.me ? 'victory' : 'defeat');
        break;
      case 'steal':
      case 'declare':
        break;
    }
  }
}

const cap = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);
