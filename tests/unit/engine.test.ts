import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CoupEngine } from '../../src/shared/engine.js';
import { ROLES } from '../../src/shared/constants.js';
import { checkConservation, IDS, setup } from './helpers.js';

describe('game setup', () => {
  it('deals 2 hidden cards and 2 coins to six players with 3 cards in the Court Deck', () => {
    const e = new CoupEngine({ players: IDS.map((id) => ({ id, name: id, avatar: 'duke' as const })) });
    expect(e.players).toHaveLength(6);
    for (const p of e.players) {
      expect(p.hand).toHaveLength(2);
      expect(p.hand.every((s) => !s.revealed)).toBe(true);
      expect(p.coins).toBe(2);
    }
    expect(e.deck).toHaveLength(3);
    expect(e.treasury).toBe(38);
    const all = [...e.deck, ...e.players.flatMap((p) => p.hand.map((s) => s.card))];
    for (const r of ROLES) expect(all.filter((c) => c.role === r)).toHaveLength(3);
    expect(new Set(all.map((c) => c.id)).size).toBe(15);
    expect(e.phase).toBe('WAITING_FOR_ACTION');
    checkConservation(e);
  });

  it('honours the starting player (rematch winner starts)', () => {
    const { e } = setup({}, [], 'D');
    expect(e.currentPlayer.id).toBe('D');
    expect(e.prompt?.kind).toBe('action');
    expect(e.prompt?.playerIds).toEqual(['D']);
  });

  it('never exposes hidden cards in public state', () => {
    const { e } = setup({ A: ['duke', 'captain'] });
    const pub = e.publicState();
    const json = JSON.stringify(pub);
    for (const p of pub.players) for (const s of p.slots) expect(s).toEqual({ revealed: false });
    for (const pl of e.players) for (const s of pl.hand) expect(json).not.toContain(s.card.id);
    expect(json).not.toMatch(/"role":"(duke|captain|assassin|ambassador|contessa)"/);
    // Private state is only the player's own hand.
    const priv = e.privateState('A')!;
    expect(priv.hand.map((s) => s.card.role)).toEqual(['duke', 'captain']);
    expect(priv.exchangeOptions).toBeNull();
  });
});

describe('general actions', () => {
  it('Income gives one coin, cannot be challenged or blocked, and advances clockwise', () => {
    const { e, ok, p } = setup();
    ok('A', { type: 'action', action: 'income' });
    expect(p('A').coins).toBe(3);
    expect(e.currentPlayer.id).toBe('B');
    expect(e.phase).toBe('WAITING_FOR_ACTION');
  });

  it('Foreign Aid is not challengeable; all passing grants two coins', () => {
    const { e, ok, allPass, p } = setup();
    ok('A', { type: 'action', action: 'foreign_aid' });
    expect(e.phase).toBe('COUNTERACTION_WINDOW');
    expect(e.prompt?.playerIds).toEqual(['B', 'C', 'D', 'E', 'F']);
    allPass();
    expect(p('A').coins).toBe(4);
    expect(e.currentPlayer.id).toBe('B');
  });

  it('Foreign Aid can be blocked by any opponent claiming Duke; only the first block counts', () => {
    const { e, ok, cmd, allPass, p } = setup({ C: ['duke', 'captain'] });
    ok('A', { type: 'action', action: 'foreign_aid' });
    const promptId = e.prompt!.id;
    ok('C', { type: 'block', role: 'duke' });
    // A simultaneous second block arrives for the old prompt and is rejected.
    const late = cmd('D', { type: 'block', role: 'duke' }, promptId);
    expect(late.ok).toBe(false);
    expect(e.phase).toBe('BLOCK_CHALLENGE_WINDOW');
    expect(e.prompt?.playerIds).toEqual(['A', 'B', 'D', 'E', 'F']);
    allPass();
    expect(p('A').coins).toBe(2);
    expect(e.pending?.status ?? 'blocked').toBeDefined();
    expect(e.currentPlayer.id).toBe('B');
  });

  it('Foreign Aid cannot be blocked with a non-Duke role and cannot be challenged', () => {
    const { ok, cmd } = setup();
    ok('A', { type: 'action', action: 'foreign_aid' });
    expect(cmd('B', { type: 'block', role: 'captain' }).ok).toBe(false);
    expect(cmd('B', { type: 'challenge' }).ok).toBe(false);
  });

  it('Coup costs 7, removes one influence and cannot be challenged or blocked', () => {
    const { e, ok, cmd, p } = setup();
    expect(cmd('A', { type: 'action', action: 'coup', targetId: 'C' }).ok).toBe(false); // only 2 coins
    p('A').coins = 7;
    e.treasury -= 5;
    ok('A', { type: 'action', action: 'coup', targetId: 'C' });
    expect(p('A').coins).toBe(0);
    expect(e.phase).toBe('WAITING_FOR_INFLUENCE_SELECTION');
    expect(e.prompt?.playerIds).toEqual(['C']);
    expect(cmd('B', { type: 'challenge' }).ok).toBe(false);
    ok('C', { type: 'lose', slot: 1 });
    expect(p('C').hand[1]!.revealed).toBe(true);
    expect(p('C').eliminated).toBe(false);
    expect(e.currentPlayer.id).toBe('B');
  });

  it('enforces the mandatory Coup at 10+ coins', () => {
    const { e, ok, cmd, p } = setup();
    p('A').coins = 10;
    e.treasury -= 8;
    expect(e.legalActions('A')).toEqual(['coup']);
    expect(cmd('A', { type: 'action', action: 'tax' }).ok).toBe(false);
    expect(cmd('A', { type: 'action', action: 'income' }).ok).toBe(false);
    ok('A', { type: 'action', action: 'coup', targetId: 'B' });
    expect(p('A').coins).toBe(3);
  });

  it('rejects invalid targets', () => {
    const { cmd, p, e } = setup();
    p('A').coins = 7;
    e.treasury -= 5;
    expect(cmd('A', { type: 'action', action: 'coup', targetId: 'A' }).ok).toBe(false);
    expect(cmd('A', { type: 'action', action: 'coup', targetId: 'Z' }).ok).toBe(false);
    expect(cmd('A', { type: 'action', action: 'coup' }).ok).toBe(false);
    expect(cmd('B', { type: 'action', action: 'income' }).ok).toBe(false); // not B's turn
  });
});

describe('character actions and bluffing', () => {
  it('allows claiming any character (bluffing) — Tax without a Duke succeeds when unchallenged', () => {
    const { e, ok, allPass, p } = setup({ A: ['captain', 'contessa'] });
    expect(e.legalActions('A')).toContain('tax');
    ok('A', { type: 'action', action: 'tax' });
    expect(e.phase).toBe('ACTION_CHALLENGE_WINDOW');
    allPass();
    expect(p('A').coins).toBe(5);
  });

  it('a proven Tax claim: challenger loses influence, card is replaced, tax is collected', () => {
    const { e, ok, p } = setup({ A: ['duke', 'captain'] }, ['ambassador']);
    const dukeId = p('A').hand[0]!.card.id;
    ok('A', { type: 'action', action: 'tax' });
    ok('B', { type: 'challenge' });
    expect(e.phase).toBe('RESOLVING_ACTION_CHALLENGE');
    ok('A', { type: 'prove' });
    // Proof card returned to deck; replacement (top of deck = ambassador) drawn.
    expect(p('A').hand[0]!.card.id).not.toBe(dukeId);
    expect(p('A').hand[0]!.card.role).toBe('ambassador');
    expect(e.deck.some((c) => c.id === dukeId)).toBe(true);
    expect(e.phase).toBe('WAITING_FOR_INFLUENCE_SELECTION');
    ok('B', { type: 'lose', slot: 0 });
    expect(p('A').coins).toBe(5);
    expect(e.currentPlayer.id).toBe('B');
    // The public log never names the replacement card.
    expect(e.publicState().log.map((l) => l.text).join(' ')).not.toMatch(/draws an? Ambassador/i);
  });

  it('a disproven Tax claim: claimant loses influence and gets nothing', () => {
    const { e, ok, cmd, p } = setup({ A: ['captain', 'contessa'] });
    ok('A', { type: 'action', action: 'tax' });
    ok('C', { type: 'challenge' });
    expect(cmd('A', { type: 'prove' }).ok).toBe(false);
    ok('A', { type: 'concede' });
    expect(e.prompt?.kind).toBe('lose_influence');
    ok('A', { type: 'lose', slot: 0 });
    expect(p('A').coins).toBe(2);
    expect(p('A').hand[0]!.revealed).toBe(true);
    expect(e.currentPlayer.id).toBe('B');
  });

  it('a player may concede even when holding the card', () => {
    const { ok, p } = setup({ A: ['duke', 'captain'] });
    ok('A', { type: 'action', action: 'tax' });
    ok('B', { type: 'challenge' });
    ok('A', { type: 'concede' });
    ok('A', { type: 'lose', slot: 1 });
    expect(p('A').coins).toBe(2);
    expect(p('B').hand.every((s) => !s.revealed)).toBe(true);
  });

  it('revealed cards never count as proof', () => {
    const { e, ok, cmd, p } = setup({ A: ['duke', 'captain'] });
    p('A').hand[0]!.revealed = true;
    ok('A', { type: 'action', action: 'tax' });
    ok('B', { type: 'challenge' });
    expect(cmd('A', { type: 'prove' }).ok).toBe(false);
    ok('A', { type: 'concede' });
    expect(p('A').eliminated).toBe(true);
    expect(e.currentPlayer.id).toBe('B');
  });

  it('a proven role can be replaced by the same role', () => {
    const { ok, p } = setup({ A: ['duke', 'captain'] }, ['duke']);
    ok('A', { type: 'action', action: 'tax' });
    ok('B', { type: 'challenge' });
    ok('A', { type: 'prove' });
    expect(p('A').hand[0]!.card.role).toBe('duke');
  });

  it('a player holding two copies of a role can prove with either', () => {
    const { ok, p } = setup({ A: ['duke', 'duke'] }, ['captain']);
    ok('A', { type: 'action', action: 'tax' });
    ok('B', { type: 'challenge' });
    ok('A', { type: 'prove' });
    const roles = p('A').hand.map((s) => s.card.role).sort();
    expect(roles).toEqual(['captain', 'duke']);
  });
});

describe('assassination', () => {
  const rich = (s: ReturnType<typeof setup>) => {
    s.p('A').coins = 5;
    s.e.treasury -= 3;
  };

  it('costs 3 coins; unchallenged and unblocked it removes one influence', () => {
    const s = setup({ A: ['assassin', 'duke'] });
    rich(s);
    s.ok('A', { type: 'action', action: 'assassinate', targetId: 'C' });
    expect(s.p('A').coins).toBe(2);
    s.allPass(); // challenge window
    expect(s.e.phase).toBe('COUNTERACTION_WINDOW');
    expect(s.e.prompt?.playerIds).toEqual(['C']); // only the target may block
    s.ok('C', { type: 'pass' });
    expect(s.e.prompt?.kind).toBe('lose_influence');
    s.ok('C', { type: 'lose', slot: 0 });
    expect(s.p('C').hand[0]!.revealed).toBe(true);
  });

  it('refunds the 3 coins when the Assassin claim is successfully challenged', () => {
    const s = setup({ A: ['duke', 'captain'] });
    rich(s);
    s.ok('A', { type: 'action', action: 'assassinate', targetId: 'C' });
    s.ok('B', { type: 'challenge' });
    s.ok('A', { type: 'concede' });
    expect(s.p('A').coins).toBe(5);
    s.ok('A', { type: 'lose', slot: 0 });
    expect(s.p('C').hand.every((h) => !h.revealed)).toBe(true);
  });

  it('does not refund a blocked assassination', () => {
    const s = setup({ A: ['assassin', 'duke'], C: ['contessa', 'captain'] });
    rich(s);
    s.ok('A', { type: 'action', action: 'assassinate', targetId: 'C' });
    s.allPass();
    s.ok('C', { type: 'block', role: 'contessa' });
    s.allPass();
    expect(s.p('A').coins).toBe(2);
    expect(s.p('C').hand.every((h) => !h.revealed)).toBe(true);
    expect(s.e.currentPlayer.id).toBe('B');
  });

  it('Contessa cannot block a Coup and Contessa cannot block steals', () => {
    const s = setup({ C: ['contessa', 'captain'] });
    s.ok('A', { type: 'action', action: 'steal', targetId: 'C' });
    s.allPass();
    expect(s.cmd('C', { type: 'block', role: 'contessa' }).ok).toBe(false);
  });

  it('a false Contessa block fails and the target loses both influence', () => {
    const s = setup({ A: ['assassin', 'duke'], C: ['captain', 'duke'] });
    rich(s);
    s.ok('A', { type: 'action', action: 'assassinate', targetId: 'C' });
    s.allPass();
    s.ok('C', { type: 'block', role: 'contessa' });
    s.ok('A', { type: 'challenge' });
    s.ok('C', { type: 'concede' });
    s.ok('C', { type: 'lose', slot: 0 }); // bluff penalty
    // Single remaining card is revealed automatically by the assassination.
    expect(s.p('C').eliminated).toBe(true);
    expect(s.p('C').hand.every((h) => h.revealed)).toBe(true);
    expect(s.e.currentPlayer.id).toBe('B');
  });

  it('target challenges the Assassin and loses: loses one for the challenge, may still block', () => {
    const s = setup({ A: ['assassin', 'duke'], C: ['captain', 'contessa'] }, ['ambassador']);
    rich(s);
    s.ok('A', { type: 'action', action: 'assassinate', targetId: 'C' });
    s.ok('C', { type: 'challenge' });
    s.ok('A', { type: 'prove' });
    s.ok('C', { type: 'lose', slot: 0 });
    expect(s.e.phase).toBe('COUNTERACTION_WINDOW');
    s.ok('C', { type: 'block', role: 'contessa' });
    s.allPass();
    expect(s.p('C').eliminated).toBe(false);
    expect(s.p('C').hand.filter((h) => !h.revealed).length).toBe(1);
  });

  it('target challenges the Assassin with one influence left and is eliminated; the attack ends', () => {
    const s = setup({ A: ['assassin', 'duke'], C: ['captain', 'contessa'] });
    rich(s);
    s.p('C').hand[0]!.revealed = true;
    s.ok('A', { type: 'action', action: 'assassinate', targetId: 'C' });
    s.ok('C', { type: 'challenge' });
    s.ok('A', { type: 'prove' });
    expect(s.p('C').eliminated).toBe(true);
    expect(s.e.currentPlayer.id).toBe('B');
    expect(s.p('A').coins).toBe(2);
  });
});

describe('stealing', () => {
  it('steals two coins when available', () => {
    const s = setup();
    s.ok('A', { type: 'action', action: 'steal', targetId: 'B' });
    s.allPass();
    s.ok('B', { type: 'pass' });
    expect(s.p('A').coins).toBe(4);
    expect(s.p('B').coins).toBe(0);
  });

  it('steals only one coin from a player with one coin', () => {
    const s = setup();
    s.p('B').coins = 1;
    s.e.treasury += 1;
    s.ok('A', { type: 'action', action: 'steal', targetId: 'B' });
    s.allPass();
    s.ok('B', { type: 'pass' });
    expect(s.p('A').coins).toBe(3);
    expect(s.p('B').coins).toBe(0);
  });

  it('steals nothing from a player with zero coins', () => {
    const s = setup();
    s.p('B').coins = 0;
    s.e.treasury += 2;
    s.ok('A', { type: 'action', action: 'steal', targetId: 'B' });
    s.allPass();
    s.ok('B', { type: 'pass' });
    expect(s.p('A').coins).toBe(2);
    expect(s.p('B').coins).toBe(0);
  });

  it('can be blocked by Captain or Ambassador (target only)', () => {
    const s = setup({ B: ['ambassador', 'duke'] });
    s.ok('A', { type: 'action', action: 'steal', targetId: 'B' });
    s.allPass();
    expect(s.e.prompt?.playerIds).toEqual(['B']);
    expect(s.cmd('C', { type: 'block', role: 'captain' }).ok).toBe(false);
    s.ok('B', { type: 'block', role: 'ambassador' });
    s.allPass();
    expect(s.p('A').coins).toBe(2);
    expect(s.p('B').coins).toBe(2);
  });

  it('a failed steal block that eliminates the target settles the theft before coins return to the treasury', () => {
    const s = setup({ B: ['duke', 'contessa'] });
    s.p('B').hand[0]!.revealed = true; // B has one influence left
    s.p('B').coins = 5;
    s.e.treasury -= 3;
    s.ok('A', { type: 'action', action: 'steal', targetId: 'B' });
    s.allPass();
    s.ok('B', { type: 'block', role: 'captain' });
    s.ok('A', { type: 'challenge' });
    s.ok('B', { type: 'concede' });
    expect(s.p('B').eliminated).toBe(true);
    expect(s.p('A').coins).toBe(4); // took 2
    expect(s.p('B').coins).toBe(0); // remaining 3 swept to treasury
    expect(s.e.treasury).toBe(38);
  });
});

describe('ambassador exchange', () => {
  it('exchanges with two influence: keep two of four, return two', () => {
    const s = setup({ A: ['ambassador', 'contessa'] }, ['duke', 'assassin', 'captain']);
    s.ok('A', { type: 'action', action: 'exchange' });
    s.allPass();
    expect(s.e.phase).toBe('WAITING_FOR_EXCHANGE_SELECTION');
    const opts = s.e.privateState('A')!.exchangeOptions!;
    expect(opts.map((c) => c.role)).toEqual(['ambassador', 'contessa', 'duke', 'assassin']);
    expect(s.e.privateState('B')!.exchangeOptions).toBeNull();
    expect(s.e.deck).toHaveLength(1);
    // invalid selections
    expect(s.cmd('A', { type: 'exchange', keep: [opts[2]!.id] }).ok).toBe(false);
    expect(s.cmd('A', { type: 'exchange', keep: [opts[2]!.id, opts[2]!.id] }).ok).toBe(false);
    expect(s.cmd('A', { type: 'exchange', keep: [opts[2]!.id, 'bogus'] }).ok).toBe(false);
    s.ok('A', { type: 'exchange', keep: [opts[2]!.id, opts[3]!.id] });
    expect(s.p('A').hand.map((h) => h.card.role).sort()).toEqual(['assassin', 'duke']);
    expect(s.e.deck).toHaveLength(3);
  });

  it('exchanges with one influence: keep one of three; revealed cards stay put', () => {
    const s = setup({ A: ['contessa', 'ambassador'] }, ['duke', 'assassin']);
    s.p('A').hand[0]!.revealed = true;
    s.ok('A', { type: 'action', action: 'exchange' });
    s.allPass();
    const opts = s.e.privateState('A')!.exchangeOptions!;
    expect(opts).toHaveLength(3);
    expect(opts.map((c) => c.role)).not.toContain('contessa');
    expect(s.cmd('A', { type: 'exchange', keep: [opts[1]!.id, opts[2]!.id] }).ok).toBe(false);
    s.ok('A', { type: 'exchange', keep: [opts[1]!.id] });
    expect(s.p('A').hand[0]!.revealed).toBe(true);
    expect(s.p('A').hand[0]!.card.role).toBe('contessa');
    expect(s.p('A').hand[1]!.card.role).toBe('duke');
  });

  it('exchange timeout keeps the original cards', () => {
    const s = setup({ A: ['ambassador', 'contessa'] });
    s.ok('A', { type: 'action', action: 'exchange' });
    s.allPass();
    s.advance(26_000);
    s.e.tick();
    expect(s.p('A').hand.map((h) => h.card.role)).toEqual(['ambassador', 'contessa']);
    expect(s.e.currentPlayer.id).toBe('B');
    checkConservation(s.e);
  });
});

describe('networking safety', () => {
  it('rejects duplicate action ids', () => {
    const { e, p } = setup();
    const env = { actionId: randomUUID(), promptId: e.prompt!.id, command: { type: 'action' as const, action: 'income' as const } };
    expect(e.handle('A', env).ok).toBe(true);
    expect(e.handle('A', env).ok).toBe(false);
    expect(p('A').coins).toBe(3);
  });

  it('two simultaneous challenges: only the first is accepted', () => {
    const s = setup({ A: ['duke', 'captain'] });
    s.ok('A', { type: 'action', action: 'tax' });
    const pid = s.e.prompt!.id;
    expect(s.cmd('B', { type: 'challenge' }, pid).ok).toBe(true);
    expect(s.cmd('C', { type: 'challenge' }, pid).ok).toBe(false);
    expect(s.e.pending?.challengerId).toBe('B');
  });

  it('rejects a reaction that arrives after its timer expired', () => {
    const s = setup({ A: ['duke', 'captain'] });
    s.ok('A', { type: 'action', action: 'tax' });
    const pid = s.e.prompt!.id;
    s.advance(8_001);
    const r = s.cmd('B', { type: 'challenge' }, pid);
    expect(r.ok).toBe(false);
    expect(s.p('A').coins).toBe(5);
    expect(s.e.currentPlayer.id).toBe('B');
  });

  it('eliminated players cannot act', () => {
    const s = setup();
    s.p('B').hand.forEach((h) => (h.revealed = true));
    s.p('B').eliminated = true;
    s.ok('A', { type: 'action', action: 'foreign_aid' });
    expect(s.e.prompt?.playerIds).not.toContain('B');
    expect(s.cmd('B', { type: 'block', role: 'duke' }).ok).toBe(false);
    s.allPass();
    // Turn skips B.
    expect(s.e.currentPlayer.id).toBe('C');
  });
});

describe('timers', () => {
  it('turn timeout takes Income', () => {
    const s = setup();
    s.advance(30_001);
    s.e.tick();
    expect(s.p('A').coins).toBe(3);
    expect(s.e.currentPlayer.id).toBe('B');
  });

  it('turn timeout with 10+ coins launches a Coup', () => {
    const s = setup();
    s.p('A').coins = 10;
    s.e.treasury -= 8;
    s.advance(30_001);
    s.e.tick();
    expect(s.p('A').coins).toBe(3);
    expect(s.e.prompt?.kind).toBe('lose_influence');
  });

  it('influence timeout reveals a random hidden card; proof timeout proves when possible', () => {
    const s = setup({ A: ['duke', 'captain'] });
    s.ok('A', { type: 'action', action: 'tax' });
    s.ok('B', { type: 'challenge' });
    s.advance(15_001);
    s.e.tick();
    expect(s.e.prompt?.kind).toBe('lose_influence');
    expect(s.e.prompt?.playerIds).toEqual(['B']);
    s.advance(20_001);
    s.e.tick();
    expect(s.p('B').hand.filter((h) => h.revealed)).toHaveLength(1);
    expect(s.p('A').coins).toBe(5);
    checkConservation(s.e);
  });

  it('reaction window closes immediately when everyone passes', () => {
    const s = setup();
    s.ok('A', { type: 'action', action: 'tax' });
    s.allPass();
    expect(s.e.currentPlayer.id).toBe('B');
  });
});

describe('edge cases', () => {
  it('treasury pays only what it holds', () => {
    const s = setup();
    s.p('B').coins += 37;
    s.e.treasury = 1;
    s.ok('A', { type: 'action', action: 'tax' });
    s.allPass();
    expect(s.p('A').coins).toBe(3);
    expect(s.e.treasury).toBe(0);
  });

  it('the actor can be eliminated while their action is pending (failed block challenge)', () => {
    const s = setup({ A: ['contessa', 'duke'], B: ['captain', 'duke'] });
    s.p('A').hand[0]!.revealed = true;
    s.ok('A', { type: 'action', action: 'steal', targetId: 'B' });
    s.allPass();
    s.ok('B', { type: 'block', role: 'captain' });
    s.ok('A', { type: 'challenge' });
    s.ok('B', { type: 'prove' });
    expect(s.p('A').eliminated).toBe(true);
    expect(s.p('B').coins).toBe(2);
    expect(s.e.currentPlayer.id).toBe('B');
  });

  it('ends the game immediately when one player remains, with a summary', () => {
    const s = setup();
    for (const id of ['B', 'C', 'D', 'E']) {
      s.p(id).hand.forEach((h) => (h.revealed = true));
      s.p(id).eliminated = true;
    }
    s.p('A').coins = 7;
    s.e.treasury -= 5;
    s.p('F').hand[0]!.revealed = true;
    s.ok('A', { type: 'action', action: 'coup', targetId: 'F' });
    expect(s.e.phase).toBe('GAME_OVER');
    expect(s.e.winnerId).toBe('A');
    expect(s.e.prompt).toBeNull();
    expect(s.e.summary?.coups).toBe(1);
    expect(s.e.summary?.finalHands['A']).toHaveLength(2);
    expect(s.cmd('A', { type: 'action', action: 'income' }).ok).toBe(false);
  });

  it('bluff statistics are recorded and only exposed in the final summary', () => {
    const s = setup({ A: ['captain', 'contessa'] });
    s.ok('A', { type: 'action', action: 'tax' });
    s.allPass();
    expect(s.e.publicState().summary).toBeNull();
  });
});
