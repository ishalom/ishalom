/**
 * A deliberately naive poker evaluator, to disagree with the fast one.
 *
 * `src/poker/evaluator.ts` is written for speed: it never sorts, never groups,
 * and reads the whole hand out of four suit bitmasks. This one does the obvious
 * thing instead — sort the ranks, count them with a map, check the categories in
 * order with explicit conditionals — and returns a comparable array rather than
 * a packed integer, so a mistake in the bit packing cannot be mirrored here.
 *
 * For seven cards it does exactly what the fast evaluator refuses to do: tries
 * all 21 five-card subsets and keeps the best. That makes it the definition of
 * correctness that §14.1's exhaustive check measures the fast path against.
 */

import { NUM_SUITS, type Card } from '../../src/core/cards.ts';

/**
 * `[category, ...kickers]`, compared left to right. Categories use the same
 * numbering as the fast evaluator, which is the only thing the two share.
 */
export type ReferenceScore = number[];

export function compareReference(a: ReferenceScore, b: ReferenceScore): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? -1;
    const y = b[i] ?? -1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Straight high card for a descending, de-duplicated rank list, or -1. */
function straightHigh(descending: readonly number[]): number {
  if (descending.length < 5) return -1;
  for (let i = 0; i + 4 < descending.length; i++) {
    if (descending[i]! - descending[i + 4]! === 4) return descending[i]!;
  }
  // The wheel: an ace playing below the deuce, which the gap test above misses
  // because the ace sorts to the front.
  if (
    descending[0] === 12 &&
    descending.includes(3) &&
    descending.includes(2) &&
    descending.includes(1) &&
    descending.includes(0)
  ) {
    return 3; // a five-high straight
  }
  return -1;
}

export function referenceEvaluate5(cards: readonly Card[]): ReferenceScore {
  if (cards.length !== 5) throw new Error('referenceEvaluate5 takes exactly five cards');

  const ranks = cards.map((c) => Math.floor(c / NUM_SUITS));
  const suits = cards.map((c) => c % NUM_SUITS);

  const byRank = new Map<number, number>();
  for (const r of ranks) byRank.set(r, (byRank.get(r) ?? 0) + 1);

  // Sort by count first, then by rank, so kickers come out in the order poker
  // compares them.
  const groups = [...byRank.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]);
  const order = groups.map((g) => g[0]);

  const isFlush = suits.every((s) => s === suits[0]);
  const distinctDescending = [...new Set(ranks)].sort((a, b) => b - a);
  const straight = straightHigh(distinctDescending);

  if (isFlush && straight >= 0) return [8, straight];
  if (shape[0] === 4) return [7, order[0]!, order[1]!];
  if (shape[0] === 3 && shape[1] === 2) return [6, order[0]!, order[1]!];
  if (isFlush) return [5, ...distinctDescending];
  if (straight >= 0) return [4, straight];
  if (shape[0] === 3) return [3, ...order];
  if (shape[0] === 2 && shape[1] === 2) return [2, ...order];
  if (shape[0] === 2) return [1, ...order];
  return [0, ...distinctDescending];
}

/** Best five-card score among all 21 subsets of a seven-card hand. */
export function referenceEvaluate7(cards: readonly Card[]): ReferenceScore {
  if (cards.length !== 7) throw new Error('referenceEvaluate7 takes exactly seven cards');
  let best: ReferenceScore | null = null;
  const subset: Card[] = new Array<Card>(5);
  for (let a = 0; a < 3; a++) {
    for (let b = a + 1; b < 4; b++) {
      for (let c = b + 1; c < 5; c++) {
        for (let d = c + 1; d < 6; d++) {
          for (let e = d + 1; e < 7; e++) {
            subset[0] = cards[a]!;
            subset[1] = cards[b]!;
            subset[2] = cards[c]!;
            subset[3] = cards[d]!;
            subset[4] = cards[e]!;
            const score = referenceEvaluate5(subset);
            if (best === null || compareReference(score, best) > 0) best = score;
          }
        }
      }
    }
  }
  return best!;
}
