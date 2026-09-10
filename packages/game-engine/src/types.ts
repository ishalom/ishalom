/**
 * The records the app persists (spec §11).
 *
 * These are plain data: the game engine produces them, the session controller
 * and persistence layers consume them. Nothing here knows about the UI.
 */

import type {
  BlackjackAction,
  BlackjackRules,
  Card,
  GradedAction,
  SeverityTier,
} from '@evtrainer/ev-engine';

/**
 * Everything the engine grades. Defined in the EV engine, beside
 * `BlackjackAction`, because the strategy chart has to name insurance too.
 * Re-exported here so this package's own types read as one set.
 */
export type { GradedAction };

/** A hand in play, or one of several after a split. */
export interface PlayerHand {
  cards: Card[];
  /** Units staked on this hand. Doubling moves this from 1 to 2. */
  bet: number;
  doubled: boolean;
  fromSplit: boolean;
  surrendered: boolean;
  /** True once the player can take no further action on it. */
  finished: boolean;
  /** Net units, filled in at settlement. */
  net: number | null;
}

/** Spec §11, Decision. One graded choice. */
export interface DecisionRecord {
  sequenceIndex: number;
  /** Which hand of a split this belonged to. */
  handIndex: number;
  scenarioKey: string;
  legalActions: GradedAction[];
  /** EV of every legal action, in units — the vector §7.1 puts on the card. */
  evByAction: Partial<Record<GradedAction, number>>;
  optimalAction: GradedAction;
  chosenAction: GradedAction;
  /** EV given up, never negative. */
  evCost: number;
  severityTier: SeverityTier;
  timeToDecideMs: number | null;
}

/** Spec §11, Hand. */
export interface HandRecord {
  id: number;
  rules: BlackjackRules;
  /** Cards in dealing order, which is all Replay mode needs to reconstruct it. */
  dealtCards: Card[];
  playerCards: Card[][];
  dealerCards: Card[];
  /** Units staked before any doubling or splitting. */
  baseBet: number;
  insuranceTaken: boolean;
  netUnits: number;
  decisions: DecisionRecord[];
}

export type Phase =
  /** No hand in progress. */
  | 'idle'
  /** Dealer shows an ace; the insurance decision is pending. */
  | 'insurance'
  /** Awaiting the player's action on the active hand. */
  | 'player'
  /** The hand is over and settled. */
  | 'settled';

/** What the UI needs to draw the table, and nothing more. */
export interface TableView {
  phase: Phase;
  hands: readonly PlayerHand[];
  activeHandIndex: number;
  /** The dealer's cards the player can see. The hole card stays out until it turns. */
  dealerVisible: readonly Card[];
  dealerRevealed: boolean;
  legalActions: readonly BlackjackAction[];
  insuranceOffered: boolean;
  insuranceTaken: boolean;
  netUnits: number | null;
}

/**
 * A `DecisionRecord` is already everything the feedback card in §7.1 needs:
 * what was played, what maximises EV, the EV of every legal action, the cost of
 * the error and its severity tier. The wording is the feedback layer's job.
 */
