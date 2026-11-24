import type { ActionType, Avatar, Difficulty, Role, TimerSettings } from './constants.js';

export type Phase =
  | 'LOBBY'
  | 'GAME_SETUP'
  | 'TURN_START'
  | 'WAITING_FOR_ACTION'
  | 'ACTION_DECLARED'
  | 'ACTION_CHALLENGE_WINDOW'
  | 'RESOLVING_ACTION_CHALLENGE'
  | 'COUNTERACTION_WINDOW'
  | 'BLOCK_DECLARED'
  | 'BLOCK_CHALLENGE_WINDOW'
  | 'RESOLVING_BLOCK_CHALLENGE'
  | 'RESOLVING_ACTION'
  | 'WAITING_FOR_INFLUENCE_SELECTION'
  | 'WAITING_FOR_EXCHANGE_SELECTION'
  | 'TURN_END'
  | 'GAME_OVER';

export interface Card {
  id: string;
  role: Role;
}

export interface HandSlot {
  card: Card;
  revealed: boolean;
}

/** What other players may see about a card slot */
export type PublicSlot = { revealed: true; role: Role } | { revealed: false };

export interface PublicPlayer {
  id: string;
  name: string;
  avatar: Avatar;
  seat: number;
  coins: number;
  influence: number;
  slots: PublicSlot[];
  eliminated: boolean;
  isBot: boolean;
}

export type PromptKind =
  | 'action' // current player chooses an action
  | 'action_challenge' // others may challenge the actor's claim
  | 'block' // eligible players may block
  | 'block_challenge' // others may challenge the block
  | 'prove_action' // actor proves or concedes
  | 'prove_block' // blocker proves or concedes
  | 'lose_influence' // a player chooses a card to reveal
  | 'exchange'; // ambassador chooses cards

export interface Prompt {
  id: number;
  kind: PromptKind;
  /** Players who must / may respond */
  playerIds: string[];
  /** Players who already responded (pass) */
  responded: string[];
  deadline: number;
  duration: number;
  /** Roles that may be claimed when blocking */
  blockRoles?: Role[];
  /** Role under challenge (prove prompts) */
  role?: Role;
  /** Why influence is being lost */
  reason?: string;
}

export interface PublicPending {
  id: string;
  actorId: string;
  action: ActionType;
  targetId: string | null;
  claim: Role | null;
  costPaid: number;
  challengerId: string | null;
  blockerId: string | null;
  blockRole: Role | null;
  blockChallengerId: string | null;
  status: 'pending' | 'blocked' | 'cancelled' | 'resolved';
}

export interface LogEntry {
  id: number;
  ts: number;
  text: string;
  kind: 'action' | 'claim' | 'challenge' | 'block' | 'loss' | 'coins' | 'system' | 'elimination' | 'victory';
  playerIds: string[];
}

export interface PlayerStats {
  coinsEarned: number;
  coupsPerformed: number;
  assassinationsAttempted: number;
  challengesWon: number;
  challengesLost: number;
  blocksSuccessful: number;
  claimsMade: number;
  claimsProven: number;
  bluffsCaught: number;
  /** Only revealed in the post-match summary */
  bluffsMade: number;
  bluffsUndetected: number;
}

export interface MatchSummary {
  winnerId: string;
  durationMs: number;
  turns: number;
  coups: number;
  assassinationsAttempted: number;
  successfulChallenges: number;
  failedChallenges: number;
  successfulBlocks: number;
  coinsEarned: number;
  perPlayer: Record<string, PlayerStats>;
  /** Hidden cards of survivors, revealed only after the match ends */
  finalHands: Record<string, Role[]>;
}

export interface PublicGameState {
  version: number;
  phase: Phase;
  players: PublicPlayer[];
  deckCount: number;
  treasury: number;
  currentPlayerId: string;
  turnNumber: number;
  pending: PublicPending | null;
  prompt: Prompt | null;
  log: LogEntry[];
  winnerId: string | null;
  summary: MatchSummary | null;
  timers: TimerSettings;
  startedAt: number;
}

export interface PrivateState {
  playerId: string;
  hand: HandSlot[];
  /** Cards available during an Ambassador exchange (hand + drawn) */
  exchangeOptions: Card[] | null;
}

export type GameEvent =
  | { t: 'deal'; order: string[] }
  | { t: 'turn'; playerId: string }
  | { t: 'coins'; from: string | 'treasury'; to: string | 'treasury'; amount: number }
  | { t: 'declare'; playerId: string; action: ActionType; targetId: string | null; claim: Role | null }
  | { t: 'challenge'; challengerId: string; claimantId: string; role: Role }
  | { t: 'proof'; playerId: string; role: Role; success: boolean }
  | { t: 'replace'; playerId: string; slot: number }
  | { t: 'block'; playerId: string; role: Role; actorId: string }
  | { t: 'blocked'; actorId: string; blockerId: string }
  | { t: 'reveal'; playerId: string; slot: number; role: Role }
  | { t: 'coup'; actorId: string; targetId: string }
  | { t: 'assassinate'; actorId: string; targetId: string }
  | { t: 'steal'; actorId: string; targetId: string; amount: number }
  | { t: 'exchange'; playerId: string; done: boolean }
  | { t: 'eliminated'; playerId: string }
  | { t: 'victory'; playerId: string };

/** Commands a player can submit during a match */
export type GameCommand =
  | { type: 'action'; action: ActionType; targetId?: string | null }
  | { type: 'challenge' }
  | { type: 'pass' }
  | { type: 'block'; role: Role }
  | { type: 'prove' }
  | { type: 'concede' }
  | { type: 'lose'; slot: number }
  | { type: 'exchange'; keep: string[] };

export interface CommandEnvelope {
  /** Unique id generated by the client — duplicates are rejected */
  actionId: string;
  /** Prompt id this command answers — stale prompts are rejected */
  promptId: number;
  command: GameCommand;
}

export interface EngineResult {
  ok: boolean;
  error?: string;
}

// ---------- Lobby / room ----------

export interface LobbyPlayer {
  id: string;
  name: string;
  avatar: Avatar;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  isBot: boolean;
  botControlled: boolean;
  difficulty?: Difficulty;
  seat: number;
  rematchVote: boolean;
}

export type DisconnectPolicy = 'wait' | 'bot';

export interface RoomSettings {
  timers: TimerSettings;
  disconnectPolicy: DisconnectPolicy;
  /** Seconds before a bot takes over a disconnected seat */
  botTakeoverAfter: number;
}

export interface RoomState {
  code: string;
  practice: boolean;
  difficulty: Difficulty | null;
  hostId: string;
  players: LobbyPlayer[];
  settings: RoomSettings;
  status: 'lobby' | 'playing' | 'finished';
  maxPlayers: number;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  name: string;
  text: string;
  ts: number;
  kind: 'chat' | 'reaction' | 'system';
}

export interface GameUpdate {
  state: PublicGameState;
  private: PrivateState | null;
  events: GameEvent[];
}
