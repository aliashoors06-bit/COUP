/**
 * Computer opponents. Bots only ever see what a human in their seat would see:
 * the public game state, their own private hand and the public event stream.
 */
import { ACTION_META, CARDS_PER_ROLE, MANDATORY_COUP_AT, ROLES, type ActionType, type Difficulty, type Role } from './constants.js';
import { seededRng, type Rng } from './rng.js';
import type { GameCommand, GameEvent, PrivateState, PublicGameState, PublicPlayer } from './types.js';

interface Profile {
  bluffRate: number;
  challengeBase: number;
  blockBluffRate: number;
  useDeduction: boolean;
  smartTargets: boolean;
  delay: [number, number];
}

const PROFILES: Record<Difficulty, Profile> = {
  easy: { bluffRate: 0.12, challengeBase: 0.1, blockBluffRate: 0.08, useDeduction: false, smartTargets: false, delay: [900, 2200] },
  medium: { bluffRate: 0.12, challengeBase: 0.1, blockBluffRate: 0.08, useDeduction: true, smartTargets: true, delay: [800, 2000] },
  hard: { bluffRate: 0.15, challengeBase: 0.12, blockBluffRate: 0.12, useDeduction: true, smartTargets: true, delay: [700, 1800] },
};

const ROLE_VALUE: Record<Role, number> = { duke: 5, assassin: 4.5, captain: 4, contessa: 3.5, ambassador: 2.5 };

export class BotBrain {
  readonly profile: Profile;
  private rng: Rng;
  /** How many times each player has claimed each role without being disproven */
  private claims: Record<string, Partial<Record<Role, number>>> = {};
  /** Roles each player was caught bluffing */
  private caught: Record<string, Partial<Record<Role, number>>> = {};

  constructor(
    readonly id: string,
    readonly difficulty: Difficulty,
    seed = Math.floor(Math.random() * 1e9),
  ) {
    this.profile = PROFILES[difficulty];
    this.rng = seededRng(seed);
  }

  thinkTime(): number {
    const [a, b] = this.profile.delay;
    return a + this.rng.int(b - a);
  }

  observe(events: GameEvent[]) {
    for (const e of events) {
      if (e.t === 'declare' && e.claim) this.bump(this.claims, e.playerId, e.claim, 1);
      if (e.t === 'block') this.bump(this.claims, e.playerId, e.role, 1);
      if (e.t === 'proof' && !e.success) {
        this.bump(this.caught, e.playerId, e.role, 1);
        this.bump(this.claims, e.playerId, e.role, -10);
      }
      if (e.t === 'proof' && e.success) {
        // The proven card was shuffled away; the claim is now weaker evidence.
        this.bump(this.claims, e.playerId, e.role, -1);
      }
    }
  }

  /** Returns the command this bot wants to issue for the current prompt, or null. */
  decide(state: PublicGameState, me: PrivateState): GameCommand | null {
    const pr = state.prompt;
    if (!pr || !pr.playerIds.includes(this.id) || pr.responded.includes(this.id)) return null;
    const self = state.players.find((p) => p.id === this.id);
    if (!self || self.eliminated) return null;
    const hand = me.hand.filter((s) => !s.revealed).map((s) => s.card.role);

    switch (pr.kind) {
      case 'action':
        return this.chooseAction(state, self, hand);
      case 'action_challenge':
        return this.considerChallenge(state, self, hand, state.pending!.actorId, pr.role!, 'action');
      case 'block':
        return this.considerBlock(state, self, hand, pr.blockRoles ?? []);
      case 'block_challenge':
        return this.considerChallenge(state, self, hand, state.pending!.blockerId!, pr.role!, 'block');
      case 'prove_action':
      case 'prove_block':
        return hand.includes(pr.role!) ? { type: 'prove' } : { type: 'concede' };
      case 'lose_influence': {
        const hidden = me.hand.map((s, i) => ({ s, i })).filter((x) => !x.s.revealed);
        hidden.sort((a, b) => this.value(a.s.card.role, state) - this.value(b.s.card.role, state));
        return { type: 'lose', slot: hidden[0]!.i };
      }
      case 'exchange': {
        const opts = me.exchangeOptions ?? [];
        const keepN = hand.length;
        const sorted = [...opts].sort((a, b) => this.value(b.role, state) - this.value(a.role, state));
        const keep: string[] = [];
        const kept: Role[] = [];
        // Prefer diversity: avoid duplicates when an alternative of similar value exists.
        for (const c of sorted) {
          if (keep.length >= keepN) break;
          if (kept.includes(c.role) && sorted.some((o) => !keep.includes(o.id) && o.id !== c.id && !kept.includes(o.role))) continue;
          keep.push(c.id);
          kept.push(c.role);
        }
        for (const c of sorted) if (keep.length < keepN && !keep.includes(c.id)) keep.push(c.id);
        return { type: 'exchange', keep };
      }
    }
  }

  // ─────────────── Action choice ───────────────

  private chooseAction(state: PublicGameState, self: PublicPlayer, hand: Role[]): GameCommand {
    const opponents = state.players.filter((p) => !p.eliminated && p.id !== this.id);
    const target = this.pickTarget(state, opponents);
    if (self.coins >= MANDATORY_COUP_AT) return { type: 'action', action: 'coup', targetId: target.id };
    if (self.coins >= 7 && (this.difficulty !== 'easy' || this.chance(0.75))) return { type: 'action', action: 'coup', targetId: target.id };

    const p = this.profile;
    const has = (r: Role) => hand.includes(r);
    const canBluff = (r: Role) => !p.useDeduction || this.visibleCopies(state, r) + this.count(hand, r) < CARDS_PER_ROLE;

    // Truthful options first, weighted by value.
    const options: { action: ActionType; targetId?: string; w: number }[] = [];
    if (has('assassin') && self.coins >= 3) options.push({ action: 'assassinate', targetId: target.id, w: 6 });
    if (has('duke')) options.push({ action: 'tax', w: 5 });
    const rich = this.pickStealTarget(state, opponents);
    if (has('captain') && rich && rich.coins >= 1) options.push({ action: 'steal', targetId: rich.id, w: rich.coins >= 2 ? 4.5 : 2 });
    if (has('ambassador') && !has('duke') && !has('assassin')) options.push({ action: 'exchange', w: 2.5 });

    // Bluffs.
    if (this.chance(p.bluffRate)) {
      const bluffs: { action: ActionType; targetId?: string; w: number }[] = [];
      if (!has('duke') && canBluff('duke')) bluffs.push({ action: 'tax', w: 4 });
      if (!has('captain') && canBluff('captain') && rich && rich.coins >= 2) bluffs.push({ action: 'steal', targetId: rich.id, w: 2 });
      if (!has('assassin') && canBluff('assassin') && self.coins >= 3 && this.difficulty === 'hard')
        bluffs.push({ action: 'assassinate', targetId: target.id, w: 1.5 });
      if (!has('ambassador') && canBluff('ambassador') && this.difficulty !== 'easy') bluffs.push({ action: 'exchange', w: 1 });
      options.push(...bluffs);
    }

    if (options.length > 0 && (this.difficulty !== 'easy' || this.chance(0.7))) {
      const pick = this.weighted(options);
      return { type: 'action', action: pick.action, targetId: pick.targetId ?? null };
    }
    // Economy fallback: Foreign Aid is risky if somebody keeps claiming Duke.
    const dukeClaimers = opponents.filter((o) => (this.claims[o.id]?.duke ?? 0) > 0).length;
    const faRisk = p.useDeduction ? dukeClaimers * 0.25 : 0.3;
    if (this.chance(1 - Math.min(0.8, faRisk))) return { type: 'action', action: 'foreign_aid' };
    return { type: 'action', action: 'income' };
  }

  private pickTarget(state: PublicGameState, opponents: PublicPlayer[]): PublicPlayer {
    if (!this.profile.smartTargets) return opponents[this.rng.int(opponents.length)]!;
    const scored = opponents.map((o) => {
      let s = o.coins * 1.2 + o.influence * 3;
      if (this.difficulty === 'hard') {
        s += (this.claims[o.id]?.assassin ?? 0) * 1.5 + (this.claims[o.id]?.duke ?? 0) * 0.8;
        if (o.coins >= 7) s += 4;
      }
      return { o, s: s + this.rng.int(100) / 50 };
    });
    scored.sort((a, b) => b.s - a.s);
    return scored[0]!.o;
  }

  private pickStealTarget(state: PublicGameState, opponents: PublicPlayer[]): PublicPlayer | null {
    const candidates = opponents.filter((o) => o.coins > 0);
    if (!candidates.length) return null;
    if (!this.profile.smartTargets) return candidates[this.rng.int(candidates.length)]!;
    // Avoid players who have claimed Captain / Ambassador (likely to block).
    const scored = candidates.map((o) => ({
      o,
      s: Math.min(o.coins, 2) * 2 + o.coins * 0.3 - ((this.claims[o.id]?.captain ?? 0) + (this.claims[o.id]?.ambassador ?? 0)) * 1.5,
    }));
    scored.sort((a, b) => b.s - a.s);
    return scored[0]!.o;
  }

  // ─────────────── Reactions ───────────────

  private considerChallenge(
    state: PublicGameState,
    self: PublicPlayer,
    hand: Role[],
    claimantId: string,
    role: Role,
    kind: 'action' | 'block',
  ): GameCommand {
    const pd = state.pending!;
    const claimant = state.players.find((p) => p.id === claimantId)!;
    const certainBluff = this.visibleCopies(state, role) + this.count(hand, role) >= CARDS_PER_ROLE;
    if (certainBluff && (this.profile.useDeduction || this.chance(0.5))) return { type: 'challenge' };

    // Being assassinated with one influence and no Contessa: dead anyway unless we act.
    if (kind === 'action' && pd.action === 'assassinate' && pd.targetId === this.id && self.influence === 1 && !hand.includes('contessa')) {
      // Prefer bluffing Contessa in the block window most of the time; otherwise challenge now.
      return this.chance(this.difficulty === 'easy' ? 0.5 : 0.35) ? { type: 'challenge' } : { type: 'pass' };
    }
    // Our own action was blocked.
    const ownBlocked = kind === 'block' && pd.actorId === this.id;

    let pHolds = this.estimateHolds(state, hand, claimant, role);
    if (!this.profile.useDeduction) pHolds = 0.6;
    let urge = (1 - pHolds) * this.profile.challengeBase * 2;
    if (ownBlocked) urge *= 1.6;
    if (kind === 'action' && pd.targetId === this.id) urge *= 1.5;
    if (kind === 'action' && pd.action === 'tax' && claimant.coins >= 4) urge *= 1.3; // stop them reaching 7
    if (self.influence === 1) urge *= 0.55; // risky with one life left
    // Only the most suspicious challenge when many players are watching (somebody else may).
    const watchers = state.prompt!.playerIds.length;
    if (watchers > 2 && !ownBlocked && pd.targetId !== this.id) urge *= 0.7;
    return this.chance(Math.min(0.85, urge)) ? { type: 'challenge' } : { type: 'pass' };
  }

  private considerBlock(state: PublicGameState, self: PublicPlayer, hand: Role[], roles: Role[]): GameCommand {
    const pd = state.pending!;
    const held = roles.find((r) => hand.includes(r));
    if (held) {
      // Blocking Foreign Aid truthfully reveals information; still usually worth it.
      if (pd.action === 'foreign_aid' && !this.chance(this.difficulty === 'easy' ? 0.6 : 0.85)) return { type: 'pass' };
      return { type: 'block', role: held };
    }
    const bluffable = roles.filter((r) => !this.profile.useDeduction || this.visibleCopies(state, r) < CARDS_PER_ROLE);
    if (!bluffable.length) return { type: 'pass' };
    const role = bluffable[this.rng.int(bluffable.length)]!;
    let rate = this.profile.blockBluffRate;
    if (pd.action === 'assassinate' && pd.targetId === this.id) rate = self.influence === 1 ? 0.85 : rate + 0.15;
    if (pd.action === 'steal' && self.coins < 2) rate *= 0.4;
    if (pd.action === 'foreign_aid') rate *= 0.6;
    return this.chance(rate) ? { type: 'block', role } : { type: 'pass' };
  }

  // ─────────────── Estimation ───────────────

  /** Probability that `p` holds at least one unrevealed `role`, from public info + own hand. */
  private estimateHolds(state: PublicGameState, myHand: Role[], p: PublicPlayer, role: Role): number {
    const unseen = CARDS_PER_ROLE - this.visibleCopies(state, role) - this.count(myHand, role);
    if (unseen <= 0) return 0;
    const pool = state.players.filter((x) => x.id !== this.id).reduce((n, x) => n + x.influence, 0) + state.deckCount;
    const h = p.influence;
    // Hypergeometric: P(at least one of `unseen` among h draws from pool)
    let none = 1;
    for (let i = 0; i < h; i++) none *= Math.max(0, pool - unseen - i) / Math.max(1, pool - i);
    let prob = 1 - none;
    // Bayesian update: a claim is itself evidence. Most claims are honest, so weight the
    // card-counting prior by how often players are believed to bluff.
    const bluffPrior = this.difficulty === 'hard' ? 0.3 : 0.4;
    prob = prob / (prob + (1 - prob) * bluffPrior);
    if (this.difficulty === 'hard') {
      const claimed = this.claims[p.id]?.[role] ?? 0;
      const caught = Object.values(this.caught[p.id] ?? {}).reduce((a, b) => a + (b ?? 0), 0);
      prob += Math.min(0.3, claimed * 0.12) - caught * 0.08;
      // Claiming many different roles is suspicious.
      const distinct = ROLES.filter((r) => (this.claims[p.id]?.[r] ?? 0) > 0).length;
      if (distinct > p.influence) prob -= 0.1 * (distinct - p.influence);
    }
    return Math.max(0.02, Math.min(0.98, prob));
  }

  private visibleCopies(state: PublicGameState, role: Role): number {
    return state.players.reduce((n, p) => n + p.slots.filter((s) => s.revealed && s.role === role).length, 0);
  }

  private value(role: Role, state: PublicGameState): number {
    let v = ROLE_VALUE[role];
    if (this.difficulty === 'hard' && role === 'contessa') {
      // Contessa matters more while assassins are still unseen.
      v += (CARDS_PER_ROLE - this.visibleCopies(state, 'assassin')) * 0.4;
    }
    return v;
  }

  // ─────────────── Utils ───────────────

  private count(hand: Role[], r: Role) {
    return hand.filter((x) => x === r).length;
  }

  private chance(p: number) {
    return this.rng.int(10000) < p * 10000;
  }

  private weighted<T extends { w: number }>(items: T[]): T {
    const total = items.reduce((n, i) => n + i.w, 0);
    let r = (this.rng.int(10000) / 10000) * total;
    for (const i of items) {
      r -= i.w;
      if (r <= 0) return i;
    }
    return items[items.length - 1]!;
  }

  private bump(map: Record<string, Partial<Record<Role, number>>>, id: string, role: Role, d: number) {
    const m = (map[id] ??= {});
    m[role] = Math.max(0, (m[role] ?? 0) + d);
  }
}

/** Convenience used by tests: validate a bot's command against action metadata. */
export function isAffordable(action: ActionType, coins: number) {
  return coins >= ACTION_META[action].cost;
}
