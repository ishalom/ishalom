/**
 * Legal-action filtering (spec §5.1.2 step 5).
 *
 * Kept separate from the EV computation so that the game engine and the solver
 * agree on legality by construction rather than by convention.
 */

import { isPair } from './hand.ts';
import type { BlackjackRules } from './rules.ts';
import { ACE, TEN, type BjRank } from './shoe.ts';

export type BlackjackAction = 'stand' | 'hit' | 'double' | 'split' | 'surrender';

/**
 * Everything the engine grades.
 *
 * Insurance is a decision point in its own right (spec §5.1.3) and not a
 * `BlackjackAction` — the player's own hand never enters it. It is named here
 * rather than smuggled in as a hit or a stand, because a chart cell that says
 * "hit" when it means "take insurance" is a cell that reads correctly only to
 * whoever wrote it.
 */
export type GradedAction = BlackjackAction | 'takeInsurance' | 'declineInsurance';

export const ALL_ACTIONS: readonly BlackjackAction[] = [
  'stand',
  'hit',
  'double',
  'split',
  'surrender',
];

/**
 * True for the five actions that are played on a hand.
 *
 * `GradedAction` is a wider set than the chart's grid, the letters table, or the
 * rule-sensitivity comparison can speak about. Rather than each of them casting
 * and hoping, they ask.
 */
export function isHandAction(action: GradedAction): action is BlackjackAction {
  return (ALL_ACTIONS as readonly string[]).includes(action);
}

/** Everything about a hand's history that changes which actions are legal. */
export interface HandContext {
  /** Cards currently held, as bucketed ranks. */
  cards: readonly BjRank[];
  /** Best total, from `handValue`. */
  total: number;
  soft: boolean;
  /** True when this hand came out of a split. */
  fromSplit: boolean;
  /** How many hands the player currently holds, including this one. */
  handCount: number;
  /** True for a split-ace hand that has already received its one card. */
  splitAcesResolved?: boolean;
  /**
   * Set when this hand is two ten-valued cards of *different* rank — a jack and
   * a king rather than two kings. Only the dealer of the cards knows this; by
   * the time a hand reaches the solver it is a pair of tens and nothing more.
   *
   * Left undefined, a ten-pair is assumed to be unlike, which is what it is 12
   * times in 16. Under `splitUnlikeTens` that assumption costs nothing, because
   * splitting tens is never the best play in the first place.
   */
  unlikeTens?: boolean;
}

function doubleTotalAllowed(total: number, rules: BlackjackRules): boolean {
  switch (rules.double) {
    case 'any2':
      return true;
    case '9-11':
      return total >= 9 && total <= 11;
    case '10-11':
      return total >= 10 && total <= 11;
  }
}

export function legalActions(ctx: HandContext, rules: BlackjackRules): BlackjackAction[] {
  const actions: BlackjackAction[] = ['stand'];
  const isInitial = ctx.cards.length === 2;
  const splitAces = ctx.fromSplit && ctx.cards[0] === ACE;

  // A split ace gets exactly one card and is then finished, unless the house
  // allows hitting split aces.
  const frozen = splitAces && !rules.hitSplitAces;

  if (!frozen && ctx.total < 21) actions.push('hit');

  if (!frozen && isInitial && doubleTotalAllowed(ctx.total, rules)) {
    if (!ctx.fromSplit || rules.das) actions.push('double');
  }

  if (isPair(ctx.cards) && ctx.handCount < rules.maxSplitHands) {
    const resplittingAces = ctx.fromSplit && ctx.cards[0] === ACE;
    // A house that splits only identical ranks does not see a jack and a king
    // as a pair at all, so the hand is a hard twenty and nothing else.
    const unsplittableTens =
      !rules.splitUnlikeTens && ctx.cards[0] === TEN && ctx.unlikeTens !== false;
    if ((!resplittingAces || rules.resplitAces) && !unsplittableTens) actions.push('split');
  }

  if (isInitial && !ctx.fromSplit && rules.surrender !== 'none') actions.push('surrender');

  return actions;
}
