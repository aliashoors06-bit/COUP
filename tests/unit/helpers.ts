import { randomUUID } from 'node:crypto';
import { CoupEngine } from '../../src/shared/engine.js';
import { ROLES, type Role, TOTAL_CARDS, TOTAL_COINS } from '../../src/shared/constants.js';
import { seededRng } from '../../src/shared/rng.js';
import type { GameCommand } from '../../src/shared/types.js';
import { expect } from 'vitest';

export const IDS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type Pid = (typeof IDS)[number];

/**
 * Build a controlled 15-card deck. Specify hands for any players and the top of the
 * Court Deck; everything else is filled with the remaining roles.
 */
export function deckFrom(hands: Partial<Record<Pid, [Role, Role]>>, court: Role[] = []): Role[] {
  const pool: Record<Role, number> = { duke: 3, assassin: 3, captain: 3, ambassador: 3, contessa: 3 };
  const take = (r: Role) => {
    if (pool[r] <= 0) throw new Error(`Too many ${r}`);
    pool[r]--;
    return r;
  };
  const slots: (Role | null)[] = Array(TOTAL_CARDS).fill(null);
  IDS.forEach((id, i) => {
    const h = hands[id];
    if (h) {
      slots[2 * i] = take(h[0]);
      slots[2 * i + 1] = take(h[1]);
    }
  });
  court.forEach((r, i) => (slots[12 + i] = take(r)));
  const rest = ROLES.flatMap((r) => Array<Role>(pool[r]).fill(r));
  return slots.map((s) => s ?? rest.shift()!);
}

export function setup(hands: Partial<Record<Pid, [Role, Role]>> = {}, court: Role[] = [], startingPlayerId = 'A') {
  let t = 1_000_000;
  const e = new CoupEngine({
    players: IDS.map((id) => ({ id, name: id, avatar: 'duke' as const })),
    deck: deckFrom(hands, court),
    noShuffle: true,
    startingPlayerId,
    rng: seededRng(42),
    now: () => t,
  });
  const cmd = (pid: string, command: GameCommand, promptId?: number) =>
    e.handle(pid, { actionId: randomUUID(), promptId: promptId ?? e.prompt?.id ?? -1, command });
  const ok = (pid: string, command: GameCommand) => {
    const r = cmd(pid, command);
    expect(r, `${pid} ${JSON.stringify(command)} → ${r.error}`).toEqual({ ok: true });
    checkConservation(e);
    return r;
  };
  /** Everybody still eligible in the current window passes. */
  const allPass = () => {
    const pr = e.prompt!;
    for (const id of pr.playerIds) if (!pr.responded.includes(id) && e.prompt === pr) ok(id, { type: 'pass' });
  };
  const advance = (ms: number) => {
    t += ms;
  };
  const p = (id: string) => e.players.find((x) => x.id === id)!;
  return { e, cmd, ok, allPass, advance, p, now: () => t };
}

export function checkConservation(e: CoupEngine) {
  expect(e.auditCards()).toBe(TOTAL_CARDS);
  expect(e.auditCoins()).toBe(TOTAL_COINS);
  for (const pl of e.players) expect(pl.coins).toBeGreaterThanOrEqual(0);
  expect(e.treasury).toBeGreaterThanOrEqual(0);
}
