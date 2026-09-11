/**
 * Which five cards make a seven-card hand (spec §6.4).
 *
 * `evaluate7` answers "how strong", which is all the solvers need. A player at
 * showdown needs "which cards": the five that are highlighted on the felt and
 * named in words. This finds them by the only honest route — the same evaluator,
 * asked about each of the 21 five-card subsets, keeping one whose value equals
 * the seven-card value. Nothing about poker hand shapes is re-implemented here,
 * so the cards shown can never disagree with the hand that was scored.
 */

import type { Card } from '../core/cards.ts';
import { evaluate7, evaluateSuitMasks } from './evaluator.ts';

/** The value of any set of up to seven cards, by the same evaluator as `evaluate7`. */
export function evaluateCards(cards: readonly Card[]): number {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  for (const card of cards) {
    const bit = 1 << (card >> 2);
    switch (card & 3) {
      case 0:
        s0 |= bit;
        break;
      case 1:
        s1 |= bit;
        break;
      case 2:
        s2 |= bit;
        break;
      default:
        s3 |= bit;
    }
  }
  return evaluateSuitMasks(s0, s1, s2, s3);
}

export interface BestFive {
  /** The seven-card value, identical to `evaluate7`. */
  value: number;
  /** Five of the seven cards, in the order they were given. */
  cards: Card[];
}

/**
 * The five cards that make the hand.
 *
 * When more than one subset scores the same — a kicker that plays from either
 * the board or the hand — the one keeping the earlier cards is returned, so the
 * answer is deterministic. Any of them is a correct "best five".
 */
export function bestFive(seven: readonly Card[]): BestFive {
  if (seven.length !== 7) throw new Error(`Expected seven cards, got ${seven.length}`);
  const value = evaluate7(seven);
  // Drop two cards, latest first, so the earliest cards are kept longest.
  for (let a = 6; a >= 1; a--) {
    for (let b = a - 1; b >= 0; b--) {
      const five = seven.filter((_, index) => index !== a && index !== b);
      if (evaluateCards(five) === value) return { value, cards: five };
    }
  }
  throw new Error('No five of these seven cards make the seven-card hand');
}
