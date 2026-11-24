import { describe, expect, it } from 'vitest';
import { CoupEngine } from '../../src/shared/engine.js';
import { BotBrain } from '../../src/shared/bot.js';
import { seededRng } from '../../src/shared/rng.js';
import { ACTIONS, ROLES, type Difficulty } from '../../src/shared/constants.js';
import type { GameCommand } from '../../src/shared/types.js';
import { checkConservation, IDS } from './helpers.js';

function playBotGame(seed: number, difficulties: Difficulty[], ids: readonly string[] = IDS) {
  let t = 0;
  const e = new CoupEngine({
    players: ids.map((id) => ({ id, name: id, avatar: 'duke' as const, isBot: true })),
    rng: seededRng(seed),
    now: () => t,
  });
  const bots = ids.map((id, i) => new BotBrain(id, difficulties[i % difficulties.length]!, seed * 31 + i));
  let n = 0;
  let steps = 0;
  while (e.phase !== 'GAME_OVER' && steps++ < 5000) {
    const events = e.drainEvents();
    bots.forEach((b) => b.observe(events));
    const state = e.publicState();
    const pr = state.prompt!;
    let acted = false;
    for (const b of bots) {
      if (!pr.playerIds.includes(b.id) || pr.responded.includes(b.id)) continue;
      const cmd = b.decide(state, e.privateState(b.id)!);
      if (!cmd) continue;
      const r = e.handle(b.id, { actionId: `s${seed}-${n++}`, promptId: pr.id, command: cmd });
      expect(r.ok, `${b.id} ${JSON.stringify(cmd)} ${r.error}`).toBe(true);
      checkConservation(e);
      acted = true;
      break;
    }
    if (!acted) {
      t = pr.deadline;
      e.tick();
      checkConservation(e);
    }
  }
  return e;
}

describe('full six-player bot matches through the engine', () => {
  for (const diff of ['easy', 'medium', 'hard'] as Difficulty[]) {
    it(`completes 60 ${diff} matches with exactly one winner and conserved cards/coins`, () => {
      for (let seed = 1; seed <= 60; seed++) {
        const e = playBotGame(seed, [diff]);
        expect(e.phase).toBe('GAME_OVER');
        const alive = e.players.filter((p) => !p.eliminated);
        expect(alive).toHaveLength(1);
        expect(e.winnerId).toBe(alive[0]!.id);
        // Losers keep both revealed cards on the table.
        for (const p of e.players.filter((x) => x.eliminated)) expect(p.hand.every((h) => h.revealed)).toBe(true);
        for (const p of e.players.filter((x) => x.eliminated)) expect(p.coins).toBe(0);
        checkConservation(e);
      }
    });
  }

  for (const n of [2, 3, 4, 5]) {
    it(`completes 40 ${n}-player matches`, () => {
      for (let seed = 1; seed <= 40; seed++) {
        const e = playBotGame(500 + seed, ['medium', 'hard'], IDS.slice(0, n));
        expect(e.phase).toBe('GAME_OVER');
        expect(e.players).toHaveLength(n);
        expect(e.players.filter((p) => !p.eliminated)).toHaveLength(1);
        expect(e.deck.length).toBe(15 - 2 * n);
        checkConservation(e);
      }
    });
  }

  it('hard bots beat easy bots more often than not', () => {
    let hardWins = 0;
    const games = 150;
    for (let seed = 1; seed <= games; seed++) {
      const e = playBotGame(1000 + seed, ['hard', 'easy']);
      const idx = IDS.indexOf(e.winnerId as (typeof IDS)[number]);
      if (idx % 2 === 0) hardWins++;
    }
    expect(hardWins / games).toBeGreaterThan(0.5);
  });
});

describe('fuzzing: random commands never break invariants', () => {
  it('survives 120 games of random, mostly invalid input', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const rng = seededRng(seed);
      let t = 0;
      const e = new CoupEngine({ players: IDS.map((id) => ({ id, name: id, avatar: 'duke' as const })), rng: seededRng(seed + 7), now: () => t });
      let steps = 0;
      while (e.phase !== 'GAME_OVER' && steps++ < 4000) {
        const pid = IDS[rng.int(6)]!;
        const priv = e.privateState(pid)!;
        const options: GameCommand[] = [
          { type: 'action', action: ACTIONS[rng.int(ACTIONS.length)]!, targetId: IDS[rng.int(6)] },
          { type: 'challenge' },
          { type: 'pass' },
          { type: 'block', role: ROLES[rng.int(5)]! },
          { type: 'prove' },
          { type: 'concede' },
          { type: 'lose', slot: rng.int(2) },
          { type: 'exchange', keep: (priv.exchangeOptions ?? priv.hand.map((h) => h.card)).slice(rng.int(2)).map((c) => c.id).slice(0, 1 + rng.int(2)) },
        ];
        const cmd = options[rng.int(options.length)]!;
        const promptId = rng.int(10) === 0 ? rng.int(1000) : (e.prompt?.id ?? 0);
        e.handle(pid, { actionId: `f${seed}-${steps}`, promptId, command: cmd });
        if (rng.int(15) === 0) {
          t += 31_000;
          e.tick();
        }
        checkConservation(e);
        const alive = e.players.filter((p) => !p.eliminated).length;
        expect(alive).toBeGreaterThanOrEqual(1);
        if (e.phase !== 'GAME_OVER') {
          expect(e.prompt).not.toBeNull();
          expect(e.players[e.turnIndex]!.eliminated).toBe(false);
        }
      }
    }
  });
});
