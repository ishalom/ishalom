/**
 * Poker hand values as comparable integers (spec §6.4).
 *
 * A hand's strength is one non-negative integer: bigger is better, equal means a
 * tie. That is all the UTH solvers need — they compare millions of showdowns and
 * never ask *why* one hand beat another — so the representation is built for
 * comparison speed, with the human-readable decomposition available separately.
 *
 * Layout, 24 bits:
 *
 *     cccc rrrr rrrr rrrr rrrr rrrr
 *     │    │
 *     │    └── five significant ranks, four bits each, most significant first
 *     └─────── category, 0 (high card) .. 8 (straight flush)
 *
 * "Significant ranks" means whatever decides the hand within its category: the
 * pair rank then three kickers for a pair, the trips rank then the pair rank for
 * a full house, the high card for a straight. Unused slots are zero. Two hands in
 * different categories never compare on their rank slots, because the category
 * outranks every one of them.
 */

/** 0 = deuce .. 12 = ace, matching `core/cards`. */
export type Rank = number;

export const HIGH_CARD = 0;
export const PAIR = 1;
export const TWO_PAIR = 2;
export const THREE_OF_A_KIND = 3;
export const STRAIGHT = 4;
export const FLUSH = 5;
export const FULL_HOUSE = 6;
export const FOUR_OF_A_KIND = 7;
export const STRAIGHT_FLUSH = 8;

export type HandCategory = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const CATEGORY_NAMES: readonly string[] = [
  'high card',
  'pair',
  'two pair',
  'three of a kind',
  'straight',
  'flush',
  'full house',
  'four of a kind',
  'straight flush',
];

export const CATEGORY_SHIFT = 20;

/** Every possible value is strictly below this. */
export const MAX_HAND_VALUE = (STRAIGHT_FLUSH + 1) << CATEGORY_SHIFT;

export function categoryOf(value: number): HandCategory {
  return (value >>> CATEGORY_SHIFT) as HandCategory;
}

/**
 * How many rank slots each category actually uses.
 *
 * This has to be a table rather than "read until you hit a zero": rank 0 is the
 * deuce, so an unused slot and a deuce look identical. The count is fixed per
 * category — a seven-card hand with one pair always has three kickers, a flush
 * always has five ranks — which is also why comparing two values in the same
 * category is sound despite the ambiguity.
 */
export const SIGNIFICANT_RANK_COUNT: readonly number[] = [
  5, // high card: five ranks
  4, // pair: the pair, then three kickers
  3, // two pair: both pairs, then one kicker
  3, // trips: the trips, then two kickers
  1, // straight: the high card
  5, // flush: five ranks
  2, // full house: trips then pair
  2, // quads: the quads, then one kicker
  1, // straight flush: the high card
];

/** The ranks that decide this hand within its category, most significant first. */
export function significantRanks(value: number): Rank[] {
  const count = SIGNIFICANT_RANK_COUNT[categoryOf(value)]!;
  const ranks: Rank[] = [];
  for (let i = 0; i < count; i++) {
    ranks.push((value >>> (16 - 4 * i)) & 0xf);
  }
  return ranks;
}

const RANK_NAMES = '23456789TJQKA';

/** Human-readable form, for feedback copy and for test failure messages. */
export function describeHandValue(value: number): string {
  const category = categoryOf(value);
  const ranks = significantRanks(value)
    .map((r) => RANK_NAMES[r] ?? '?')
    .join('');
  return ranks.length > 0 ? `${CATEGORY_NAMES[category]} (${ranks})` : CATEGORY_NAMES[category]!;
}

/** Assemble a value from a category and up to five significant ranks. */
export function makeHandValue(category: HandCategory, ...ranks: Rank[]): number {
  let value = category << CATEGORY_SHIFT;
  for (let i = 0; i < ranks.length && i < 5; i++) {
    value |= ranks[i]! << (16 - 4 * i);
  }
  return value;
}
