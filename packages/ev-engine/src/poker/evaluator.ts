/**
 * Seven-card poker hand evaluator (spec §6.4).
 *
 * Both UTH modules depend on this, and it sits in the innermost loop of the flop
 * solver — nearly two million evaluations for a single decision — so the spec is
 * explicit that a naive implementation will dominate runtime.
 *
 * The naive approach is to enumerate all 21 five-card subsets of a seven-card
 * hand and take the best. This does not do that. It reads the hand as four
 * 13-bit rank masks, one per suit, and derives everything — how many of each
 * rank, whether a flush is present, whether a straight is present — with bitwise
 * operations over those four words. After the masks are built there are no loops
 * over cards, no per-call allocation, and no lookup table.
 *
 * That also answers spec §17's open question 5 — evaluator table size trading app
 * size against speed — in the cheapest possible direction: this scheme ships zero
 * table bytes. A 130 MB two-plus-two style table stays available if benchmarking
 * on low-end devices ever demands it, but it should not be needed.
 *
 * The result is a plain integer: bigger is better, and two hands compare equal
 * exactly when they tie under poker rules. Nothing else about the value is
 * meaningful and callers should not depend on its magnitude.
 */

import { NUM_SUITS, type Card } from '../core/cards.ts';

/** Hand categories, ordered so a larger value always beats a smaller one. */
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

/**
 * Five ranks at four bits each fill the low 20 bits of a score and the category
 * sits above them, so comparing categories and comparing kickers is a single
 * integer comparison.
 */
const CATEGORY_SHIFT = 20;

export function categoryOf(score: number): HandCategory {
  return ((score >>> CATEGORY_SHIFT) & 0xf) as HandCategory;
}

/** Highest rank index of a straight in `mask`, or -1. Rank 12 is an ace. */
function straightHigh(mask: number): number {
  // Shift the ranks up one place and hang the ace below the deuce, so the wheel
  // (A,2,3,4,5) becomes five adjacent bits like any other straight.
  const m = ((mask << 1) | ((mask >>> 12) & 1)) >>> 0;
  const runs = m & (m >>> 1) & (m >>> 2) & (m >>> 3) & (m >>> 4);
  if (runs === 0) return -1;
  // The highest set bit starts the highest run. Its top card is four places
  // above it, less the one place everything was shifted by.
  return 31 - Math.clz32(runs) + 3;
}

/** The `n` highest ranks in `mask`, packed four bits each, highest first. */
function topRanks(mask: number, n: number): number {
  let packed = 0;
  let remaining = mask;
  for (let i = 0; i < n; i++) {
    if (remaining === 0) {
      packed <<= 4;
      continue;
    }
    const rank = 31 - Math.clz32(remaining);
    packed = (packed << 4) | rank;
    remaining &= ~(1 << rank);
  }
  return packed;
}

/** Index of the highest rank in `mask`. Meaningless for an empty mask. */
function highestRank(mask: number): number {
  return 31 - Math.clz32(mask);
}

function popcount(x: number): number {
  let n = x - ((x >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  n = (n + (n >>> 4)) & 0x0f0f0f0f;
  return (n * 0x01010101) >>> 24;
}

/**
 * Score a hand of five, six or seven cards. Larger is better, and equal scores
 * are genuine ties.
 *
 * Cards are the 52-card indices from `core/cards`. Duplicates are not rejected:
 * every caller enumerates from a deck and cannot produce them, and the check
 * would cost more than it is worth in the flop solver's inner loop.
 */
export function evaluate(cards: readonly Card[]): number {
  const n = cards.length;
  if (n < 5 || n > 7) {
    throw new Error(`Cannot evaluate a ${n}-card hand; poker hands here are 5 to 7 cards`);
  }

  // One 13-bit rank mask per suit. Everything below is derived from these four.
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  for (let i = 0; i < n; i++) {
    const card = cards[i]!;
    const bit = 1 << ((card / NUM_SUITS) | 0);
    switch (card % NUM_SUITS) {
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

  // A flush needs five cards of one suit, and seven cards can only manage that
  // in one suit, so the first match is the only match.
  let flushRanks = -1;
  if (popcount(s0) >= 5) flushRanks = s0;
  else if (popcount(s1) >= 5) flushRanks = s1;
  else if (popcount(s2) >= 5) flushRanks = s2;
  else if (popcount(s3) >= 5) flushRanks = s3;

  if (flushRanks >= 0) {
    const high = straightHigh(flushRanks);
    if (high >= 0) return (STRAIGHT_FLUSH << CATEGORY_SHIFT) | (high << 16);
  }

  // How many suits hold each rank, as four bitmasks. This is why the hand never
  // has to be sorted or grouped: "appears at least twice" is the pairwise ANDs
  // of the suit masks, and so on upward.
  const atLeast1 = s0 | s1 | s2 | s3;
  const atLeast2 = (s0 & s1) | (s0 & s2) | (s0 & s3) | (s1 & s2) | (s1 & s3) | (s2 & s3);
  const atLeast3 = (s0 & s1 & s2) | (s0 & s1 & s3) | (s0 & s2 & s3) | (s1 & s2 & s3);
  const atLeast4 = s0 & s1 & s2 & s3;

  const quads = atLeast4;
  const trips = atLeast3 & ~atLeast4;
  const pairs = atLeast2 & ~atLeast3;

  if (quads !== 0) {
    const quadRank = highestRank(quads);
    const kicker = highestRank(atLeast1 & ~(1 << quadRank));
    return (FOUR_OF_A_KIND << CATEGORY_SHIFT) | (quadRank << 16) | (kicker << 12);
  }

  if (trips !== 0) {
    const tripRank = highestRank(trips);
    // Seven cards can hold two sets. The spare set plays as the pair whenever it
    // outranks any actual pair.
    const otherTrips = trips & ~(1 << tripRank);
    const pairCandidates = pairs | otherTrips;
    if (pairCandidates !== 0) {
      const pairRank = highestRank(pairCandidates);
      return (FULL_HOUSE << CATEGORY_SHIFT) | (tripRank << 16) | (pairRank << 12);
    }
  }

  if (flushRanks >= 0) {
    return (FLUSH << CATEGORY_SHIFT) | (topRanks(flushRanks, 5) & 0xfffff);
  }

  const straight = straightHigh(atLeast1);
  if (straight >= 0) return (STRAIGHT << CATEGORY_SHIFT) | (straight << 16);

  if (trips !== 0) {
    const tripRank = highestRank(trips);
    const kickers = topRanks(atLeast1 & ~(1 << tripRank), 2);
    return (THREE_OF_A_KIND << CATEGORY_SHIFT) | (tripRank << 16) | (kickers << 8);
  }

  const pairCount = popcount(pairs);
  if (pairCount >= 2) {
    const high = highestRank(pairs);
    const low = highestRank(pairs & ~(1 << high));
    const kicker = highestRank(atLeast1 & ~(1 << high) & ~(1 << low));
    return (TWO_PAIR << CATEGORY_SHIFT) | (high << 16) | (low << 12) | (kicker << 8);
  }

  if (pairCount === 1) {
    const pairRank = highestRank(pairs);
    const kickers = topRanks(atLeast1 & ~(1 << pairRank), 3);
    return (PAIR << CATEGORY_SHIFT) | (pairRank << 16) | (kickers << 4);
  }

  return (HIGH_CARD << CATEGORY_SHIFT) | (topRanks(atLeast1, 5) & 0xfffff);
}

/** Human-readable category, for feedback text and test failure messages. */
export function describeScore(score: number): string {
  return CATEGORY_NAMES[categoryOf(score)]!;
}
