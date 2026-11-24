export const ROLES = ['duke', 'assassin', 'captain', 'ambassador', 'contessa'] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = ['income', 'foreign_aid', 'coup', 'tax', 'assassinate', 'steal', 'exchange'] as const;
export type ActionType = (typeof ACTIONS)[number];

/** Maximum seats at a table */
export const PLAYER_COUNT = 6;
export const MIN_PLAYERS = 2;
export const CARDS_PER_ROLE = 3;
export const TOTAL_CARDS = ROLES.length * CARDS_PER_ROLE; // 15
export const TOTAL_COINS = 50;
export const STARTING_COINS = 2;
export const COUP_COST = 7;
export const ASSASSINATE_COST = 3;
export const MANDATORY_COUP_AT = 10;

export interface ActionMeta {
  type: ActionType;
  label: string;
  /** Coins paid by the actor when declaring */
  cost: number;
  /** Coins received from the treasury when the action resolves */
  gain: number;
  /** Character the actor must claim (null = general action) */
  claim: Role | null;
  targeted: boolean;
  challengeable: boolean;
  /** Characters that may block this action */
  blockedBy: Role[];
  /** Who may block: any surviving opponent, or the target only */
  blockScope: 'none' | 'any' | 'target';
  description: string;
}

export const ACTION_META: Record<ActionType, ActionMeta> = {
  income: {
    type: 'income', label: 'Income', cost: 0, gain: 1, claim: null, targeted: false,
    challengeable: false, blockedBy: [], blockScope: 'none',
    description: 'Take 1 coin from the treasury. Cannot be challenged or blocked.',
  },
  foreign_aid: {
    type: 'foreign_aid', label: 'Foreign Aid', cost: 0, gain: 2, claim: null, targeted: false,
    challengeable: false, blockedBy: ['duke'], blockScope: 'any',
    description: 'Take 2 coins. Any opponent may block by claiming Duke.',
  },
  coup: {
    type: 'coup', label: 'Coup', cost: COUP_COST, gain: 0, claim: null, targeted: true,
    challengeable: false, blockedBy: [], blockScope: 'none',
    description: 'Pay 7 coins. The target loses one influence. Cannot be challenged or blocked.',
  },
  tax: {
    type: 'tax', label: 'Tax', cost: 0, gain: 3, claim: 'duke', targeted: false,
    challengeable: true, blockedBy: [], blockScope: 'none',
    description: 'Claim Duke and take 3 coins. Can be challenged; cannot be blocked.',
  },
  assassinate: {
    type: 'assassinate', label: 'Assassinate', cost: ASSASSINATE_COST, gain: 0, claim: 'assassin', targeted: true,
    challengeable: true, blockedBy: ['contessa'], blockScope: 'target',
    description: 'Claim Assassin and pay 3 coins. The target loses one influence. The target may block with Contessa.',
  },
  steal: {
    type: 'steal', label: 'Steal', cost: 0, gain: 0, claim: 'captain', targeted: true,
    challengeable: true, blockedBy: ['captain', 'ambassador'], blockScope: 'target',
    description: 'Claim Captain and take up to 2 coins from a player. The target may block with Captain or Ambassador.',
  },
  exchange: {
    type: 'exchange', label: 'Exchange', cost: 0, gain: 0, claim: 'ambassador', targeted: false,
    challengeable: true, blockedBy: [], blockScope: 'none',
    description: 'Claim Ambassador. Draw 2 cards from the Court Deck, keep any, return 2. Cannot be blocked.',
  },
};

export const ROLE_META: Record<Role, { label: string; color: string; accent: string; ability: string }> = {
  duke: { label: 'Duke', color: '#7a1f2b', accent: '#d4af6a', ability: 'Tax: take 3 coins. Blocks Foreign Aid.' },
  assassin: { label: 'Assassin', color: '#3d2457', accent: '#b9a3d6', ability: 'Assassinate: pay 3 coins, target loses influence.' },
  captain: { label: 'Captain', color: '#1d2f57', accent: '#d4af6a', ability: 'Steal 2 coins. Blocks stealing.' },
  ambassador: { label: 'Ambassador', color: '#1f5a3f', accent: '#efe6cf', ability: 'Exchange cards with the Court Deck. Blocks stealing.' },
  contessa: { label: 'Contessa', color: '#a3263f', accent: '#f2b8c4', ability: 'Blocks assassination.' },
};

export interface TimerSettings {
  turn: number;
  challenge: number;
  counter: number;
  proof: number;
  influence: number;
  exchange: number;
}

export const DEFAULT_TIMERS: TimerSettings = {
  turn: 30,
  challenge: 8,
  counter: 8,
  proof: 15,
  influence: 20,
  exchange: 25,
};

export const TIMER_LIMITS: Record<keyof TimerSettings, [number, number]> = {
  turn: [10, 120],
  challenge: [4, 30],
  counter: [4, 30],
  proof: [5, 60],
  influence: [5, 60],
  exchange: [10, 90],
};

export const AVATARS = ['duke', 'assassin', 'captain', 'ambassador', 'contessa', 'card-back'] as const;
export type Avatar = (typeof AVATARS)[number];

export type Difficulty = 'easy' | 'medium' | 'hard';
