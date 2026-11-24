/**
 * COUP — authoritative rules engine.
 *
 * Pure TypeScript, no I/O. The server owns one instance per match; tests drive it directly.
 * All randomness comes from an injected Rng and all time from an injected clock, so every
 * scenario is reproducible.
 *
 * ── Deterministic digital rulings (documented in README "Rules clarifications") ──
 *  1. Reaction windows are resolved in the order the server receives messages. The first valid
 *     challenge (or block) closes the window; later responses to the same prompt are rejected as
 *     stale. Messages are processed strictly one at a time, so ties are impossible.
 *  2. A Pass only declines the current reaction window. When every eligible player has passed,
 *     the window closes immediately; an expired timer counts as Pass for everyone left.
 *  3. Costs (Coup 7, Assassinate 3) are paid to the treasury on declaration. A successfully
 *     challenged Assassin claim refunds the 3 coins; a blocked assassination does not.
 *  4. When a player holds only one hidden card, losing influence reveals it automatically.
 *  5. Eliminated players' coins return to the treasury at the end of the current turn, after any
 *     pending theft from them has been settled.
 *  6. Treasury rewards are capped by what the treasury holds.
 *  7. Timeouts: turn → Income (or a Coup on a random opponent when mandatory); proof decision →
 *     prove if the card is held, otherwise concede; influence selection → random hidden card;
 *     exchange → keep the original cards.
 *  8. The game ends the instant only one player has influence, even mid-action.
 */
import {
  ACTION_META,
  ACTIONS,
  CARDS_PER_ROLE,
  DEFAULT_TIMERS,
  MANDATORY_COUP_AT,
  ROLE_META,
  ROLES,
  STARTING_COINS,
  TOTAL_CARDS,
  TOTAL_COINS,
  type ActionType,
  type Avatar,
  type Role,
  type TimerSettings,
} from './constants.js';
import { secureRng, shuffle, type Rng } from './rng.js';
import type {
  Card,
  CommandEnvelope,
  EngineResult,
  GameCommand,
  GameEvent,
  HandSlot,
  LogEntry,
  MatchSummary,
  Phase,
  PlayerStats,
  PrivateState,
  Prompt,
  PromptKind,
  PublicGameState,
  PublicPending,
  PublicPlayer,
} from './types.js';

export interface EnginePlayerInit {
  id: string;
  name: string;
  avatar: Avatar;
  isBot?: boolean;
}

export interface EngineOptions {
  players: EnginePlayerInit[];
  timers?: TimerSettings;
  rng?: Rng;
  now?: () => number;
  /** Player who takes the first turn (e.g. the previous winner). Random when omitted. */
  startingPlayerId?: string;
  /**
   * Controlled deck for tests: 15 roles. Player i receives deck[2i] and deck[2i+1];
   * the remaining cards form the Court Deck, top first. When `noShuffle` is set the
   * Court Deck is never shuffled, making replacement draws predictable.
   */
  deck?: Role[];
  noShuffle?: boolean;
}

interface EnginePlayer {
  id: string;
  name: string;
  avatar: Avatar;
  seat: number;
  coins: number;
  hand: HandSlot[];
  eliminated: boolean;
  isBot: boolean;
}

interface Pending {
  id: string;
  actorId: string;
  action: ActionType;
  targetId: string | null;
  claim: Role | null;
  costPaid: number;
  actorBluffed: boolean;
  challengerId: string | null;
  actionChallenge: 'none' | 'proven' | 'failed';
  blockerId: string | null;
  blockRole: Role | null;
  blockerBluffed: boolean;
  blockChallengerId: string | null;
  blockChallenge: 'none' | 'proven' | 'failed';
  status: 'pending' | 'blocked' | 'cancelled' | 'resolved';
}

type Continuation = 'after_action_challenge' | 'execute' | 'block_succeeds' | 'end_turn';

const PHASE_FOR_PROMPT: Record<PromptKind, Phase> = {
  action: 'WAITING_FOR_ACTION',
  action_challenge: 'ACTION_CHALLENGE_WINDOW',
  prove_action: 'RESOLVING_ACTION_CHALLENGE',
  block: 'COUNTERACTION_WINDOW',
  block_challenge: 'BLOCK_CHALLENGE_WINDOW',
  prove_block: 'RESOLVING_BLOCK_CHALLENGE',
  lose_influence: 'WAITING_FOR_INFLUENCE_SELECTION',
  exchange: 'WAITING_FOR_EXCHANGE_SELECTION',
};

const ACTION_NOUN: Record<ActionType, string> = {
  income: 'Income',
  foreign_aid: 'Foreign Aid',
  coup: 'Coup',
  tax: 'Tax',
  assassinate: 'assassination',
  steal: 'theft',
  exchange: 'Exchange',
};

const emptyStats = (): PlayerStats => ({
  coinsEarned: 0,
  coupsPerformed: 0,
  assassinationsAttempted: 0,
  challengesWon: 0,
  challengesLost: 0,
  blocksSuccessful: 0,
  claimsMade: 0,
  claimsProven: 0,
  bluffsCaught: 0,
  bluffsMade: 0,
  bluffsUndetected: 0,
});

const label = (r: Role) => ROLE_META[r].label;

export class CoupEngine {
  readonly players: EnginePlayer[];
  deck: Card[] = [];
  treasury = TOTAL_COINS;
  phase: Phase = 'GAME_SETUP';
  version = 0;
  turnIndex = 0;
  turnNumber = 1;
  pending: Pending | null = null;
  prompt: Prompt | null = null;
  winnerId: string | null = null;
  summary: MatchSummary | null = null;
  readonly timers: TimerSettings;
  readonly startedAt: number;

  private readonly rng: Rng;
  private readonly now: () => number;
  private readonly noShuffle: boolean;
  private promptSeq = 0;
  private pendingSeq = 0;
  private logSeq = 0;
  private log: LogEntry[] = [];
  private events: GameEvent[] = [];
  private lossQueue: { playerId: string; reason: string }[] = [];
  private continuation: Continuation = 'end_turn';
  private exchangeDrawn: Card[] = [];
  private seenActionIds = new Set<string>();
  private seenOrder: string[] = [];
  private stats: Record<string, PlayerStats> = {};

  constructor(opts: EngineOptions) {
    if (opts.players.length < 2 || opts.players.length > 6) throw new Error('COUP requires 2–6 players');
    this.rng = opts.rng ?? secureRng;
    this.now = opts.now ?? Date.now;
    this.timers = { ...DEFAULT_TIMERS, ...(opts.timers ?? {}) };
    this.noShuffle = !!opts.noShuffle;
    this.startedAt = this.now();

    // ── Build and shuffle the 15-card deck ──
    let roles: Role[];
    if (opts.deck) {
      if (opts.deck.length !== TOTAL_CARDS) throw new Error('Controlled deck must contain 15 cards');
      for (const r of ROLES) {
        if (opts.deck.filter((x) => x === r).length !== CARDS_PER_ROLE) throw new Error('Controlled deck must have 3 of each role');
      }
      roles = [...opts.deck];
    } else {
      roles = shuffle(ROLES.flatMap((r) => Array<Role>(CARDS_PER_ROLE).fill(r)), this.rng);
    }
    const cards: Card[] = roles.map((role, i) => ({ id: this.cardId(i), role }));

    this.players = opts.players.map((p, seat) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      seat,
      coins: 0,
      hand: [],
      eliminated: false,
      isBot: !!p.isBot,
    }));
    for (const p of this.players) this.stats[p.id] = emptyStats();

    // ── Deal two cards and two coins to each player ──
    this.players.forEach((p, i) => {
      p.hand = [
        { card: cards[2 * i]!, revealed: false },
        { card: cards[2 * i + 1]!, revealed: false },
      ];
      p.coins = STARTING_COINS;
      this.treasury -= STARTING_COINS;
    });
    this.deck = cards.slice(this.players.length * 2);

    const startIdx = opts.startingPlayerId
      ? this.players.findIndex((p) => p.id === opts.startingPlayerId)
      : this.rng.int(this.players.length);
    this.turnIndex = startIdx >= 0 ? startIdx : 0;

    this.addLog('system', 'The court is assembled. Each player receives two influence and two coins.', []);
    this.emit({ t: 'deal', order: this.players.map((p) => p.id) });
    this.startTurn();
  }

  // ────────────────────────── Public API ──────────────────────────

  get currentPlayer(): EnginePlayer {
    return this.players[this.turnIndex]!;
  }

  /** Validate and apply a command from a player. */
  handle(playerId: string, env: CommandEnvelope): EngineResult {
    // A command arriving after its deadline must not win the race against the timer.
    this.tick();
    if (this.phase === 'GAME_OVER') return this.fail('The match is over');
    if (this.seenActionIds.has(env.actionId)) return this.fail('Duplicate request ignored');
    const player = this.player(playerId);
    if (!player) return this.fail('Unknown player');
    if (!this.prompt || env.promptId !== this.prompt.id) return this.fail('That decision has already closed');
    this.rememberActionId(env.actionId);
    const res = this.dispatch(player, env.command);
    if (res.ok) this.version++;
    return res;
  }

  /** Process an expired timer. Returns true if anything changed. */
  tick(now = this.now()): boolean {
    let changed = false;
    // Loop: a timeout may immediately open another (already expired) prompt only in pathological
    // clock situations; cap iterations defensively.
    for (let i = 0; i < 10 && this.prompt && now >= this.prompt.deadline && this.phase !== 'GAME_OVER'; i++) {
      this.handleTimeout(this.prompt);
      changed = true;
    }
    if (changed) this.version++;
    return changed;
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  publicState(): PublicGameState {
    const p = this.pending;
    const pending: PublicPending | null = p
      ? {
          id: p.id,
          actorId: p.actorId,
          action: p.action,
          targetId: p.targetId,
          claim: p.claim,
          costPaid: p.costPaid,
          challengerId: p.challengerId,
          blockerId: p.blockerId,
          blockRole: p.blockRole,
          blockChallengerId: p.blockChallengerId,
          status: p.status,
        }
      : null;
    return {
      version: this.version,
      phase: this.phase,
      players: this.players.map((pl) => this.publicPlayer(pl)),
      deckCount: this.deck.length,
      treasury: this.treasury,
      currentPlayerId: this.currentPlayer.id,
      turnNumber: this.turnNumber,
      pending,
      prompt: this.prompt ? { ...this.prompt, playerIds: [...this.prompt.playerIds], responded: [...this.prompt.responded] } : null,
      log: this.log.slice(-200),
      winnerId: this.winnerId,
      summary: this.summary,
      timers: this.timers,
      startedAt: this.startedAt,
    };
  }

  privateState(playerId: string): PrivateState | null {
    const p = this.player(playerId);
    if (!p) return null;
    const exchanging =
      this.prompt?.kind === 'exchange' && this.prompt.playerIds[0] === playerId
        ? [...p.hand.filter((s) => !s.revealed).map((s) => s.card), ...this.exchangeDrawn]
        : null;
    return {
      playerId,
      hand: p.hand.map((s) => ({ card: { ...s.card }, revealed: s.revealed })),
      exchangeOptions: exchanging ? exchanging.map((c) => ({ ...c })) : null,
    };
  }

  alivePlayers(): EnginePlayer[] {
    return this.players.filter((p) => !p.eliminated);
  }

  /** Total cards across deck, hands (hidden + revealed) and temporary exchange draws. */
  auditCards(): number {
    return this.deck.length + this.exchangeDrawn.length + this.players.reduce((n, p) => n + p.hand.length, 0);
  }

  /** Total coins across treasury and player balances. */
  auditCoins(): number {
    return this.treasury + this.players.reduce((n, p) => n + p.coins, 0);
  }

  /** Legal actions for a player at the start of their turn (bluffs are always legal). */
  legalActions(playerId: string): ActionType[] {
    const p = this.player(playerId);
    if (!p || p.eliminated || this.phase !== 'WAITING_FOR_ACTION' || this.currentPlayer.id !== playerId) return [];
    if (p.coins >= MANDATORY_COUP_AT) return ['coup'];
    return ACTIONS.filter((a) => p.coins >= ACTION_META[a].cost);
  }

  // ────────────────────────── Dispatch ──────────────────────────

  private dispatch(p: EnginePlayer, cmd: GameCommand): EngineResult {
    if (p.eliminated) return this.fail('Exiled players cannot act');
    switch (cmd.type) {
      case 'action':
        return this.declareAction(p, cmd.action, cmd.targetId ?? null);
      case 'pass':
        return this.pass(p);
      case 'challenge':
        return this.challenge(p);
      case 'block':
        return this.block(p, cmd.role);
      case 'prove':
        return this.prove(p);
      case 'concede':
        return this.concede(p);
      case 'lose':
        return this.loseChoice(p, cmd.slot);
      case 'exchange':
        return this.exchangeChoice(p, cmd.keep);
      default:
        return this.fail('Unknown command');
    }
  }

  // ────────────────────────── Turn flow ──────────────────────────

  private startTurn() {
    this.pending = null;
    this.phase = 'TURN_START';
    const p = this.currentPlayer;
    this.emit({ t: 'turn', playerId: p.id });
    this.openPrompt('action', [p.id]);
  }

  private declareAction(p: EnginePlayer, action: ActionType, targetId: string | null): EngineResult {
    if (!this.prompt || this.prompt.kind !== 'action') return this.fail('It is not time to choose an action');
    if (this.currentPlayer.id !== p.id) return this.fail('It is not your turn');
    const meta = ACTION_META[action];
    if (!meta) return this.fail('Unknown action');
    if (p.coins >= MANDATORY_COUP_AT && action !== 'coup') return this.fail('With 10 or more coins you must launch a Coup');
    if (p.coins < meta.cost) return this.fail(`${meta.label} costs ${meta.cost} coins`);
    let target: EnginePlayer | null = null;
    if (meta.targeted) {
      target = targetId ? this.player(targetId) ?? null : null;
      if (!target) return this.fail('Choose a target');
      if (target.id === p.id) return this.fail('You cannot target yourself');
      if (target.eliminated) return this.fail('That player has been exiled');
    }

    this.phase = 'ACTION_DECLARED';
    this.prompt = null;
    if (meta.cost > 0) {
      p.coins -= meta.cost;
      this.treasury += meta.cost;
      this.emit({ t: 'coins', from: p.id, to: 'treasury', amount: meta.cost });
    }
    const pending: Pending = {
      id: `a${++this.pendingSeq}`,
      actorId: p.id,
      action,
      targetId: target?.id ?? null,
      claim: meta.claim,
      costPaid: meta.cost,
      actorBluffed: meta.claim ? !this.holds(p, meta.claim) : false,
      challengerId: null,
      actionChallenge: 'none',
      blockerId: null,
      blockRole: null,
      blockerBluffed: false,
      blockChallengerId: null,
      blockChallenge: 'none',
      status: 'pending',
    };
    this.pending = pending;
    const st = this.stats[p.id]!;
    if (meta.claim) {
      st.claimsMade++;
      if (pending.actorBluffed) st.bluffsMade++;
    }
    if (action === 'coup') st.coupsPerformed++;
    if (action === 'assassinate') st.assassinationsAttempted++;

    this.addLog(meta.claim ? 'claim' : 'action', this.describeDeclaration(p, action, target), [p.id, ...(target ? [target.id] : [])]);
    this.emit({ t: 'declare', playerId: p.id, action, targetId: target?.id ?? null, claim: meta.claim });

    if (meta.challengeable) {
      this.openPrompt('action_challenge', this.aliveIdsExcept(p.id), { role: meta.claim! });
    } else {
      this.afterActionChallenge();
    }
    return { ok: true };
  }

  private afterActionChallenge() {
    const pd = this.pending!;
    const actor = this.player(pd.actorId)!;
    if (actor.eliminated) {
      pd.status = 'cancelled';
      this.addLog('system', `${actor.name} has been exiled; the ${ACTION_NOUN[pd.action]} is abandoned.`, [actor.id]);
      return this.endTurn();
    }
    const meta = ACTION_META[pd.action];
    let blockers: string[] = [];
    if (meta.blockScope === 'any') blockers = this.aliveIdsExcept(actor.id);
    else if (meta.blockScope === 'target' && pd.targetId) {
      const t = this.player(pd.targetId)!;
      if (!t.eliminated) blockers = [t.id];
    }
    if (blockers.length > 0) {
      this.openPrompt('block', blockers, { blockRoles: [...meta.blockedBy] });
    } else {
      this.execute();
    }
  }

  private pass(p: EnginePlayer): EngineResult {
    const pr = this.prompt;
    if (!pr || !['action_challenge', 'block', 'block_challenge'].includes(pr.kind)) return this.fail('Nothing to pass on');
    if (!pr.playerIds.includes(p.id)) return this.fail('You are not eligible to respond');
    if (pr.responded.includes(p.id)) return this.fail('You already responded');
    pr.responded.push(p.id);
    if (pr.responded.length >= pr.playerIds.length) this.closeWindowAllPassed(pr);
    return { ok: true };
  }

  private closeWindowAllPassed(pr: Prompt) {
    this.prompt = null;
    if (pr.kind === 'action_challenge') this.afterActionChallenge();
    else if (pr.kind === 'block') this.execute();
    else if (pr.kind === 'block_challenge') this.blockSucceeds();
  }

  private challenge(p: EnginePlayer): EngineResult {
    const pr = this.prompt;
    const pd = this.pending;
    if (!pr || !pd || (pr.kind !== 'action_challenge' && pr.kind !== 'block_challenge')) return this.fail('There is no claim to challenge');
    if (!pr.playerIds.includes(p.id)) return this.fail('You cannot challenge this claim');
    if (pr.responded.includes(p.id)) return this.fail('You already passed on this claim');

    if (pr.kind === 'action_challenge') {
      const actor = this.player(pd.actorId)!;
      pd.challengerId = p.id;
      this.addLog('challenge', `${p.name} challenges ${actor.name}'s ${label(pd.claim!)} claim!`, [p.id, actor.id]);
      this.emit({ t: 'challenge', challengerId: p.id, claimantId: actor.id, role: pd.claim! });
      this.openPrompt('prove_action', [actor.id], { role: pd.claim! });
    } else {
      const blocker = this.player(pd.blockerId!)!;
      pd.blockChallengerId = p.id;
      this.addLog('challenge', `${p.name} challenges ${blocker.name}'s ${label(pd.blockRole!)} block!`, [p.id, blocker.id]);
      this.emit({ t: 'challenge', challengerId: p.id, claimantId: blocker.id, role: pd.blockRole! });
      this.openPrompt('prove_block', [blocker.id], { role: pd.blockRole! });
    }
    return { ok: true };
  }

  private block(p: EnginePlayer, role: Role): EngineResult {
    const pr = this.prompt;
    const pd = this.pending;
    if (!pr || !pd || pr.kind !== 'block') return this.fail('There is nothing to block');
    if (!pr.playerIds.includes(p.id)) return this.fail('You cannot block this action');
    if (pr.responded.includes(p.id)) return this.fail('You already passed');
    if (!pr.blockRoles?.includes(role)) return this.fail(`${label(role)} cannot block this action`);

    pd.blockerId = p.id;
    pd.blockRole = role;
    pd.blockerBluffed = !this.holds(p, role);
    const st = this.stats[p.id]!;
    st.claimsMade++;
    if (pd.blockerBluffed) st.bluffsMade++;
    const actor = this.player(pd.actorId)!;
    this.addLog('block', `${p.name} claims ${label(role)} to block ${actor.name}'s ${ACTION_NOUN[pd.action]}.`, [p.id, actor.id]);
    this.phase = 'BLOCK_DECLARED';
    this.emit({ t: 'block', playerId: p.id, role, actorId: actor.id });
    this.openPrompt('block_challenge', this.aliveIdsExcept(p.id), { role });
    return { ok: true };
  }

  private prove(p: EnginePlayer): EngineResult {
    const pr = this.prompt;
    const pd = this.pending;
    if (!pr || !pd || (pr.kind !== 'prove_action' && pr.kind !== 'prove_block')) return this.fail('Nothing to prove');
    if (pr.playerIds[0] !== p.id) return this.fail('You were not challenged');
    const role = pr.role!;
    const slot = p.hand.findIndex((s) => !s.revealed && s.card.role === role);
    if (slot < 0) return this.fail(`You do not hold an unrevealed ${label(role)}`);
    const challengerId = pr.kind === 'prove_action' ? pd.challengerId! : pd.blockChallengerId!;
    const challenger = this.player(challengerId)!;
    this.prompt = null;

    this.addLog('challenge', `${p.name} reveals ${label(role)} and proves the claim. ${challenger.name} loses one influence.`, [p.id, challenger.id]);
    this.emit({ t: 'proof', playerId: p.id, role, success: true });
    this.stats[p.id]!.claimsProven++;
    this.stats[challenger.id]!.challengesLost++;

    // Return the proven card to the Court Deck, shuffle, draw a secret replacement.
    const proven = p.hand[slot]!.card;
    this.deck.push(proven);
    this.shuffleDeck();
    const replacement = this.deck.shift()!;
    p.hand[slot] = { card: replacement, revealed: false };
    this.emit({ t: 'replace', playerId: p.id, slot });
    this.addLog('system', `${p.name} shuffles the ${label(role)} into the Court Deck and draws a replacement.`, [p.id]);

    if (pr.kind === 'prove_action') {
      pd.actionChallenge = 'proven';
      this.queueLoss(challenger.id, 'lost a challenge');
      this.runLosses('after_action_challenge');
    } else {
      pd.blockChallenge = 'proven';
      this.queueLoss(challenger.id, 'lost a challenge');
      this.runLosses('block_succeeds');
    }
    return { ok: true };
  }

  private concede(p: EnginePlayer): EngineResult {
    const pr = this.prompt;
    const pd = this.pending;
    if (!pr || !pd || (pr.kind !== 'prove_action' && pr.kind !== 'prove_block')) return this.fail('Nothing to concede');
    if (pr.playerIds[0] !== p.id) return this.fail('You were not challenged');
    const role = pr.role!;
    const challengerId = pr.kind === 'prove_action' ? pd.challengerId! : pd.blockChallengerId!;
    const challenger = this.player(challengerId)!;
    this.prompt = null;

    this.addLog('challenge', `${p.name} cannot prove the ${label(role)} claim. The challenge succeeds.`, [p.id, challenger.id]);
    this.emit({ t: 'proof', playerId: p.id, role, success: false });
    this.stats[p.id]!.bluffsCaught++;
    this.stats[challenger.id]!.challengesWon++;

    if (pr.kind === 'prove_action') {
      pd.actionChallenge = 'failed';
      pd.status = 'cancelled';
      if (pd.costPaid > 0) {
        const refund = Math.min(pd.costPaid, this.treasury);
        this.treasury -= refund;
        p.coins += refund;
        this.emit({ t: 'coins', from: 'treasury', to: p.id, amount: refund });
        this.addLog('coins', `${p.name}'s ${pd.costPaid} coins are refunded.`, [p.id]);
      }
      this.addLog('action', `The ${ACTION_NOUN[pd.action]} is cancelled.`, [p.id]);
      this.queueLoss(p.id, 'was caught bluffing');
      this.runLosses('end_turn');
    } else {
      pd.blockChallenge = 'failed';
      this.addLog('block', `The block fails.`, [p.id]);
      this.queueLoss(p.id, 'was caught bluffing');
      this.runLosses('execute');
    }
    return { ok: true };
  }

  private blockSucceeds() {
    const pd = this.pending!;
    const blocker = this.player(pd.blockerId!)!;
    const actor = this.player(pd.actorId)!;
    pd.status = 'blocked';
    this.stats[blocker.id]!.blocksSuccessful++;
    if (pd.blockerBluffed && pd.blockChallenge === 'none') this.stats[blocker.id]!.bluffsUndetected++;
    if (pd.actorBluffed && pd.actionChallenge === 'none') this.stats[actor.id]!.bluffsUndetected++;
    const noun = ACTION_NOUN[pd.action];
    this.addLog('block', `The ${noun} is blocked by ${blocker.name}.`, [blocker.id, actor.id]);
    this.emit({ t: 'blocked', actorId: actor.id, blockerId: blocker.id });
    this.endTurn();
  }

  private execute() {
    const pd = this.pending!;
    const actor = this.player(pd.actorId)!;
    this.phase = 'RESOLVING_ACTION';
    this.prompt = null;
    if (actor.eliminated) {
      pd.status = 'cancelled';
      return this.endTurn();
    }
    if (pd.actorBluffed && pd.actionChallenge === 'none') this.stats[actor.id]!.bluffsUndetected++;
    pd.status = 'resolved';
    const target = pd.targetId ? this.player(pd.targetId)! : null;

    switch (pd.action) {
      case 'income':
      case 'foreign_aid':
      case 'tax': {
        this.pay(actor, ACTION_META[pd.action].gain);
        return this.endTurn();
      }
      case 'coup': {
        this.emit({ t: 'coup', actorId: actor.id, targetId: target!.id });
        this.addLog('action', `The Coup strikes ${target!.name}.`, [actor.id, target!.id]);
        this.queueLoss(target!.id, 'was overthrown in a Coup');
        return this.runLosses('end_turn');
      }
      case 'assassinate': {
        if (target!.eliminated) {
          this.addLog('action', `${target!.name} is already exiled; the assassination has no effect.`, [target!.id]);
          return this.endTurn();
        }
        this.emit({ t: 'assassinate', actorId: actor.id, targetId: target!.id });
        this.addLog('action', `${actor.name} assassinates ${target!.name}.`, [actor.id, target!.id]);
        this.queueLoss(target!.id, 'was assassinated');
        return this.runLosses('end_turn');
      }
      case 'steal': {
        const amount = Math.min(2, target!.coins);
        target!.coins -= amount;
        actor.coins += amount;
        this.stats[actor.id]!.coinsEarned += amount;
        this.emit({ t: 'steal', actorId: actor.id, targetId: target!.id, amount });
        if (amount > 0) this.emit({ t: 'coins', from: target!.id, to: actor.id, amount });
        this.addLog(
          'coins',
          amount > 0
            ? `${actor.name} steals ${amount} coin${amount === 1 ? '' : 's'} from ${target!.name}.`
            : `${target!.name} has no coins; ${actor.name} steals nothing.`,
          [actor.id, target!.id],
        );
        return this.endTurn();
      }
      case 'exchange': {
        const n = Math.min(2, this.deck.length);
        this.exchangeDrawn = this.deck.splice(0, n);
        this.emit({ t: 'exchange', playerId: actor.id, done: false });
        this.addLog('action', `${actor.name} draws ${n} cards from the Court Deck in secret.`, [actor.id]);
        this.openPrompt('exchange', [actor.id]);
        return;
      }
    }
  }

  private exchangeChoice(p: EnginePlayer, keep: string[]): EngineResult {
    const pr = this.prompt;
    if (!pr || pr.kind !== 'exchange' || pr.playerIds[0] !== p.id) return this.fail('You are not exchanging');
    const hiddenSlots = p.hand.map((s, i) => (s.revealed ? -1 : i)).filter((i) => i >= 0);
    const options = [...hiddenSlots.map((i) => p.hand[i]!.card), ...this.exchangeDrawn];
    const unique = new Set(keep);
    if (unique.size !== keep.length) return this.fail('Duplicate card selection');
    if (keep.length !== hiddenSlots.length) return this.fail(`Choose exactly ${hiddenSlots.length} card${hiddenSlots.length === 1 ? '' : 's'} to keep`);
    if (!keep.every((id) => options.some((c) => c.id === id))) return this.fail('Invalid card selection');
    this.applyExchange(p, keep, hiddenSlots, options);
    return { ok: true };
  }

  private applyExchange(p: EnginePlayer, keep: string[], hiddenSlots: number[], options: Card[]) {
    this.prompt = null;
    const keepSet = new Set(keep);
    const kept = options.filter((c) => keepSet.has(c.id));
    const returned = options.filter((c) => !keepSet.has(c.id));
    // Slots that keep their own card stay put; the rest are filled with newly kept cards.
    const newcomers = kept.filter((c) => !hiddenSlots.some((i) => p.hand[i]!.card.id === c.id));
    for (const i of hiddenSlots) {
      if (!keepSet.has(p.hand[i]!.card.id)) p.hand[i] = { card: newcomers.shift()!, revealed: false };
    }
    this.deck.push(...returned);
    this.exchangeDrawn = [];
    this.shuffleDeck();
    this.emit({ t: 'exchange', playerId: p.id, done: true });
    this.addLog('action', `${p.name} returns two cards to the Court Deck, which is shuffled.`, [p.id]);
    this.endTurn();
  }

  // ────────────────────────── Influence ──────────────────────────

  private queueLoss(playerId: string, reason: string) {
    this.lossQueue.push({ playerId, reason });
  }

  private runLosses(cont: Continuation) {
    this.continuation = cont;
    this.processLossQueue();
  }

  private processLossQueue() {
    while (this.lossQueue.length > 0) {
      const { playerId, reason } = this.lossQueue[0]!;
      const p = this.player(playerId)!;
      const hidden = p.hand.map((s, i) => (s.revealed ? -1 : i)).filter((i) => i >= 0);
      if (hidden.length === 0) {
        this.lossQueue.shift();
        continue;
      }
      if (hidden.length === 1) {
        this.lossQueue.shift();
        this.revealSlot(p, hidden[0]!);
        if (this.phase === 'GAME_OVER') return;
        continue;
      }
      this.openPrompt('lose_influence', [p.id], { reason });
      return;
    }
    this.resume();
  }

  private loseChoice(p: EnginePlayer, slot: number): EngineResult {
    const pr = this.prompt;
    if (!pr || pr.kind !== 'lose_influence' || pr.playerIds[0] !== p.id) return this.fail('You do not need to lose influence');
    const s = p.hand[slot];
    if (!Number.isInteger(slot) || !s) return this.fail('Invalid card');
    if (s.revealed) return this.fail('That card is already revealed');
    this.prompt = null;
    this.lossQueue.shift();
    this.revealSlot(p, slot);
    if (this.phase !== 'GAME_OVER') this.processLossQueue();
    return { ok: true };
  }

  private revealSlot(p: EnginePlayer, slot: number) {
    const s = p.hand[slot]!;
    s.revealed = true;
    this.addLog('loss', `${p.name} loses one influence, revealing ${label(s.card.role)}.`, [p.id]);
    this.emit({ t: 'reveal', playerId: p.id, slot, role: s.card.role });
    if (p.hand.every((h) => h.revealed)) {
      p.eliminated = true;
      this.addLog('elimination', `${p.name} has been EXILED from the court.`, [p.id]);
      this.emit({ t: 'eliminated', playerId: p.id });
      const alive = this.alivePlayers();
      if (alive.length === 1) this.endGame(alive[0]!);
    }
  }

  private resume() {
    const cont = this.continuation;
    this.continuation = 'end_turn';
    switch (cont) {
      case 'after_action_challenge':
        return this.afterActionChallenge();
      case 'execute':
        return this.execute();
      case 'block_succeeds':
        return this.blockSucceeds();
      case 'end_turn':
        return this.endTurn();
    }
  }

  // ────────────────────────── Turn end / game end ──────────────────────────

  private endTurn() {
    if (this.phase === 'GAME_OVER') return;
    this.phase = 'TURN_END';
    this.prompt = null;
    this.sweepEliminatedCoins();
    // Advance clockwise to the next surviving player.
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (this.turnIndex + i) % n;
      if (!this.players[idx]!.eliminated) {
        this.turnIndex = idx;
        break;
      }
    }
    this.turnNumber++;
    this.startTurn();
  }

  private sweepEliminatedCoins() {
    for (const p of this.players) {
      if (p.eliminated && p.coins > 0) {
        const amt = p.coins;
        p.coins = 0;
        this.treasury += amt;
        this.emit({ t: 'coins', from: p.id, to: 'treasury', amount: amt });
        this.addLog('coins', `${p.name}'s ${amt} coin${amt === 1 ? '' : 's'} return to the treasury.`, [p.id]);
      }
    }
  }

  private endGame(winner: EnginePlayer) {
    this.sweepEliminatedCoins();
    this.phase = 'GAME_OVER';
    this.prompt = null;
    this.lossQueue = [];
    if (this.pending && this.pending.status === 'pending') this.pending.status = 'resolved';
    // Return any cards drawn for an interrupted exchange (cannot normally happen).
    if (this.exchangeDrawn.length) {
      this.deck.push(...this.exchangeDrawn);
      this.exchangeDrawn = [];
    }
    this.winnerId = winner.id;
    const per = this.stats;
    const sum = (k: keyof PlayerStats) => Object.values(per).reduce((n, s) => n + s[k], 0);
    const finalHands: Record<string, Role[]> = {};
    for (const p of this.players) finalHands[p.id] = p.hand.filter((s) => !s.revealed).map((s) => s.card.role);
    this.summary = {
      winnerId: winner.id,
      durationMs: this.now() - this.startedAt,
      turns: this.turnNumber,
      coups: sum('coupsPerformed'),
      assassinationsAttempted: sum('assassinationsAttempted'),
      successfulChallenges: sum('challengesWon'),
      failedChallenges: sum('challengesLost'),
      successfulBlocks: sum('blocksSuccessful'),
      coinsEarned: sum('coinsEarned'),
      perPlayer: JSON.parse(JSON.stringify(per)),
      finalHands,
    };
    this.addLog('victory', `${winner.name} is the last power standing and wins the match!`, [winner.id]);
    this.emit({ t: 'victory', playerId: winner.id });
  }

  // ────────────────────────── Timeouts ──────────────────────────

  private handleTimeout(pr: Prompt) {
    switch (pr.kind) {
      case 'action': {
        const p = this.currentPlayer;
        if (p.coins >= MANDATORY_COUP_AT) {
          const opponents = this.aliveIdsExcept(p.id);
          const target = opponents[this.rng.int(opponents.length)]!;
          this.addLog('system', `${p.name}'s time expired — a mandatory Coup is launched automatically.`, [p.id]);
          this.declareAction(p, 'coup', target);
        } else {
          this.addLog('system', `${p.name}'s time expired — Income is taken automatically.`, [p.id]);
          this.declareAction(p, 'income', null);
        }
        return;
      }
      case 'action_challenge':
      case 'block':
      case 'block_challenge':
        pr.responded = [...pr.playerIds];
        this.closeWindowAllPassed(pr);
        return;
      case 'prove_action':
      case 'prove_block': {
        const p = this.player(pr.playerIds[0]!)!;
        if (this.holds(p, pr.role!)) this.prove(p);
        else this.concede(p);
        return;
      }
      case 'lose_influence': {
        const p = this.player(pr.playerIds[0]!)!;
        const hidden = p.hand.map((s, i) => (s.revealed ? -1 : i)).filter((i) => i >= 0);
        this.loseChoice(p, hidden[this.rng.int(hidden.length)]!);
        return;
      }
      case 'exchange': {
        const p = this.player(pr.playerIds[0]!)!;
        const hiddenSlots = p.hand.map((s, i) => (s.revealed ? -1 : i)).filter((i) => i >= 0);
        const options = [...hiddenSlots.map((i) => p.hand[i]!.card), ...this.exchangeDrawn];
        this.addLog('system', `${p.name}'s time expired — the original cards are kept.`, [p.id]);
        this.applyExchange(p, hiddenSlots.map((i) => p.hand[i]!.card.id), hiddenSlots, options);
        return;
      }
    }
  }

  // ────────────────────────── Helpers ──────────────────────────

  private openPrompt(kind: PromptKind, playerIds: string[], extra: Partial<Prompt> = {}) {
    const duration = this.durationFor(kind);
    this.phase = PHASE_FOR_PROMPT[kind];
    this.prompt = {
      id: ++this.promptSeq,
      kind,
      playerIds,
      responded: [],
      deadline: this.now() + duration * 1000,
      duration,
      ...extra,
    };
  }

  private durationFor(kind: PromptKind): number {
    const t = this.timers;
    switch (kind) {
      case 'action':
        return t.turn;
      case 'action_challenge':
      case 'block_challenge':
        return t.challenge;
      case 'block':
        return t.counter;
      case 'prove_action':
      case 'prove_block':
        return t.proof;
      case 'lose_influence':
        return t.influence;
      case 'exchange':
        return t.exchange;
    }
  }

  private pay(p: EnginePlayer, amount: number) {
    const got = Math.min(amount, this.treasury);
    this.treasury -= got;
    p.coins += got;
    this.stats[p.id]!.coinsEarned += got;
    if (got > 0) this.emit({ t: 'coins', from: 'treasury', to: p.id, amount: got });
    const short = got < amount ? ` (the treasury could only pay ${got})` : '';
    this.addLog('coins', `${p.name} receives ${got} coin${got === 1 ? '' : 's'}${short}.`, [p.id]);
  }

  private describeDeclaration(p: EnginePlayer, action: ActionType, target: EnginePlayer | null): string {
    const t = target?.name ?? '';
    switch (action) {
      case 'income':
        return `${p.name} takes Income.`;
      case 'foreign_aid':
        return `${p.name} attempts to take Foreign Aid.`;
      case 'coup':
        return `${p.name} pays 7 coins and launches a Coup against ${t}!`;
      case 'tax':
        return `${p.name} claims Duke and attempts to collect Tax.`;
      case 'assassinate':
        return `${p.name} claims Assassin, pays 3 coins and attempts to assassinate ${t}.`;
      case 'steal':
        return `${p.name} claims Captain and attempts to steal from ${t}.`;
      case 'exchange':
        return `${p.name} claims Ambassador and attempts an Exchange.`;
    }
  }

  private holds(p: EnginePlayer, role: Role): boolean {
    return p.hand.some((s) => !s.revealed && s.card.role === role);
  }

  private player(id: string): EnginePlayer | undefined {
    return this.players.find((p) => p.id === id);
  }

  private aliveIdsExcept(id: string): string[] {
    return this.players.filter((p) => !p.eliminated && p.id !== id).map((p) => p.id);
  }

  private publicPlayer(p: EnginePlayer): PublicPlayer {
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      seat: p.seat,
      coins: p.coins,
      influence: p.hand.filter((s) => !s.revealed).length,
      slots: p.hand.map((s) => (s.revealed ? { revealed: true as const, role: s.card.role } : { revealed: false as const })),
      eliminated: p.eliminated,
      isBot: p.isBot,
    };
  }

  private shuffleDeck() {
    if (!this.noShuffle) shuffle(this.deck, this.rng);
  }

  private cardId(i: number): string {
    return `c${i.toString(36)}${this.rng.int(2 ** 30).toString(36)}`;
  }

  private rememberActionId(id: string) {
    this.seenActionIds.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > 2000) this.seenActionIds.delete(this.seenOrder.shift()!);
  }

  private emit(e: GameEvent) {
    this.events.push(e);
  }

  private addLog(kind: LogEntry['kind'], text: string, playerIds: string[]) {
    this.log.push({ id: ++this.logSeq, ts: this.now(), text, kind, playerIds });
  }

  private fail(error: string): EngineResult {
    return { ok: false, error };
  }
}
