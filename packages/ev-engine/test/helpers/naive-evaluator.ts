/**
 * A deliberately naive poker hand evaluator, for §14.1's third bullet.
 *
 * This exists to disagree with `src/poker/evaluator.ts`. It shares none of its
 * approach: it sorts and counts ranks with ordinary arrays instead of bit
 * arithmetic over suit masks, it evaluates five cards at a time and takes the
 * best of all twenty-one subsets instead of reading a seven-card hand directly,
 * and it reaches its answer by the route a person would.
 *
 * It is slow and it allocates on every call. That is the point — it is easy to
 * read and hard to get subtly wrong, so when the two disagree the fast one is
 * the suspect.
 *
 * It does share `makeHandValue`, so both evaluators pack their answers the same
 * way. That is deliberate too: the fast evaluator builds its values inline with
 * shifts rather than calling the packer, so agreement here also checks that the
 * inline construction matches the documented layout.
 */

import { rankOf, suitOf, type Card } from '../../src/core/cards.ts';
import {
  FLUSH,
  FOUR_OF_A_KIND,
  FULL_HOUSE,
  HIGH_CARD,
  makeHandValue,
  PAIR,
  STRAIGHT,
  STRAIGHT_FLUSH,
  THREE_OF_A_KIND,
  TWO_PAIR,
  type HandCategory,
} from '../../src/poker/handValue.ts';

/** All 21 five-card subsets of seven cards, as index tuples. */
const FIVE_CARD_SUBSETS: number[][] = (() => {
  const out: number[][] = [];
  for (let a = 0; a < 7; a++)
    for (let b = a + 1; b < 7; b++)
      for (let c = b + 1; c < 7; c++)
        for (let d = c + 1; d < 7; d++)
          for (let e = d + 1; e < 7; e++) out.push([a, b, c, d, e]);
  return out;
})();

/** Straight high card for five distinct sorted-descending ranks, or -1. */
function straightHighOf(ranks: number[]): number {
  const distinct = [...new Set(ranks)].sort((x, y) => y - x);
  if (distinct.length !== 5) return -1;
  if (distinct[0]! - distinct[4]! === 4) return distinct[0]!;
  // The wheel: ace plays low, and the hand is a five-high straight.
  if (distinct[0] === 12 && distinct[1] === 3 && distinct[4] === 0) return 3;
  return -1;
}

/** Evaluate exactly five cards, the long way round. */
export function naiveEvaluate5(cards: readonly Card[]): number {
  if (cards.length !== 5) throw new Error('naiveEvaluate5 wants five cards');

  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const suits = cards.map(suitOf);
  const isFlush = suits.every((s) => s === suits[0]);
  const straightHigh = straightHighOf(ranks);

  // Group ranks by how often they appear, then order the groups by size first
  // and by rank second — which is exactly the order the significant-rank slots
  // want them in for every category.
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map(([, n]) => n).join('');
  const byRank = groups.map(([r]) => r);

  if (isFlush && straightHigh >= 0) return makeHandValue(STRAIGHT_FLUSH as HandCategory, straightHigh);
  if (shape === '41') return makeHandValue(FOUR_OF_A_KIND as HandCategory, byRank[0]!, byRank[1]!);
  if (shape === '32') return makeHandValue(FULL_HOUSE as HandCategory, byRank[0]!, byRank[1]!);
  if (isFlush) return makeHandValue(FLUSH as HandCategory, ...ranks);
  if (straightHigh >= 0) return makeHandValue(STRAIGHT as HandCategory, straightHigh);
  if (shape === '311') return makeHandValue(THREE_OF_A_KIND as HandCategory, byRank[0]!, byRank[1]!, byRank[2]!);
  if (shape === '221') return makeHandValue(TWO_PAIR as HandCategory, byRank[0]!, byRank[1]!, byRank[2]!);
  if (shape === '2111')
    return makeHandValue(PAIR as HandCategory, byRank[0]!, byRank[1]!, byRank[2]!, byRank[3]!);
  return makeHandValue(HIGH_CARD as HandCategory, ...ranks);
}

/** Best of the twenty-one five-card hands inside seven cards. */
export function naiveEvaluate7(cards: readonly Card[], offset = 0): number {
  let best = -1;
  const hand: Card[] = [0, 0, 0, 0, 0];
  for (const subset of FIVE_CARD_SUBSETS) {
    for (let i = 0; i < 5; i++) hand[i] = cards[offset + subset[i]!]!;
    const value = naiveEvaluate5(hand);
    if (value > best) best = value;
  }
  return best;
}
