/**
 * Seven-card poker hand evaluator (spec §6.4).
 *
 * Both UTH modules lean on this. The flop decision alone enumerates
 * C(45,2) × C(43,2) ≈ 894,000 outcomes, two showdowns each, inside a 200 ms
 * budget — so this runs a couple of million times per decision and its cost
 * dominates everything above it.
 *
 * Scheme
 * ------
 * The spec calls for "a standard perfect-hash or lookup-table evaluator" and
 * §6.5 budgets 10–130 MB for its tables, which §17 leaves open pending a
 * benchmark. What is implemented here needs neither: the hand is decomposed with
 * bit arithmetic over four 13-bit suit masks, and the only tables are two of 8192
 * entries each (64 KB total, computed at load in about a millisecond). No asset
 * to ship, no first-run wait, and the §13 app-size budget stays free for
 * everything else. `test/poker-evaluator.bench.ts` reports the throughput this
 * buys.
 *
 * The trick that makes it work is computing rank multiplicities without ever
 * touching a counter array: a rank appears at least twice exactly when two suit
 * masks share its bit, at least three times when three do, and so on. Six ANDs
 * and a few ORs replace a thirteen-element histogram, and the function stays
 * pure — no scratch buffer, no module state, nothing to reset between calls.
 *
 * Two facts about seven-card hands keep the branching short, and both are
 * asserted in the test suite rather than merely believed:
 *
 *   - A flush and a full house cannot coexist. A flush uses five cards of one
 *     suit with five distinct ranks; trips would need both remaining cards to
 *     match one of them, and then nothing is left to make the pair.
 *   - A flush and four of a kind cannot coexist either: quads take one card of
 *     each suit, leaving at most four cards in any single suit.
 *
 * So once a flush is found, the answer is a straight flush or that flush, and
 * the rank-based path never has to run.
 */

import type { Card } from '../core/cards.ts';
import {
  CATEGORY_SHIFT,
  FLUSH,
  FOUR_OF_A_KIND,
  FULL_HOUSE,
  HIGH_CARD,
  PAIR,
  STRAIGHT,
  STRAIGHT_FLUSH,
  THREE_OF_A_KIND,
  TWO_PAIR,
} from './handValue.ts';

const MASK_COUNT = 1 << 13;

/**
 * For each 13-bit rank mask, the rank of the highest straight's top card, or -1.
 *
 * The wheel is the awkward case: A-2-3-4-5 is a straight whose top card is the
 * five, so it maps to rank 3 and sorts below every other straight, which is
 * exactly right.
 */
const straightHigh = new Int8Array(MASK_COUNT).fill(-1);

/**
 * For each 13-bit rank mask, its top five ranks packed into the significant-rank
 * slots of a hand value: `r1<<16 | r2<<12 | r3<<8 | r4<<4 | r5`. Masks with fewer
 * than five bits pack what they have and leave the rest zero.
 *
 * Packing them in place means kickers can be taken by shifting: the top three
 * ranks of a mask, positioned for a pair's kicker slots, are one shift and one
 * mask away.
 */
const topFive = new Int32Array(MASK_COUNT);

(function buildTables(): void {
  const WHEEL = (1 << 12) | (1 << 3) | (1 << 2) | (1 << 1) | 1; // A,5,4,3,2

  for (let mask = 0; mask < MASK_COUNT; mask++) {
    for (let high = 12; high >= 4; high--) {
      const run = 0b11111 << (high - 4);
      if ((mask & run) === run) {
        straightHigh[mask] = high;
        break;
      }
    }
    if (straightHigh[mask] === -1 && (mask & WHEEL) === WHEEL) {
      straightHigh[mask] = 3; // five-high
    }

    let packed = 0;
    let taken = 0;
    for (let rank = 12; rank >= 0 && taken < 5; rank--) {
      if (mask & (1 << rank)) {
        packed |= rank << (16 - 4 * taken);
        taken++;
      }
    }
    topFive[mask] = packed;
  }
})();

function highestRank(mask: number): number {
  return 31 - Math.clz32(mask);
}

/** Top three ranks of `mask`, positioned as a pair's three kickers. */
function threeKickers(mask: number): number {
  return (topFive[mask]! >>> 4) & 0x0fff0;
}

/** Top two ranks of `mask`, positioned as a trips hand's two kickers. */
function twoKickers(mask: number): number {
  return (topFive[mask]! >>> 4) & 0x0ff00;
}

/** Top rank of `mask`, positioned as a quads hand's single kicker. */
function oneKicker(mask: number): number {
  return (topFive[mask]! >>> 4) & 0x0f000;
}

/** Top rank of `mask`, positioned as a two-pair hand's single kicker. */
function twoPairKicker(mask: number): number {
  return (topFive[mask]! >>> 8) & 0x00f00;
}

/**
 * Evaluate seven cards into a comparable integer (see `handValue.ts`).
 *
 * `cards` must hold at least seven cards starting at `offset`. Callers in a hot
 * loop are expected to reuse one array rather than allocate per showdown; this
 * function neither reads nor writes anything outside its arguments.
 */
export function evaluate7(cards: readonly Card[], offset = 0): number {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;

  for (let i = 0; i < 7; i++) {
    const card = cards[offset + i]!;
    const bit = 1 << (card >> 2); // rankOf, inlined
    const suit = card & 3; // suitOf, inlined

    // Deal each card's bit into its suit's mask without branching.
    //
    // `(x - 1) >> 31` is −1 when x is zero and 0 otherwise — the borrow out of
    // the subtraction, smeared across all 32 bits by the arithmetic shift. Xor
    // the suit against each candidate first and the expression becomes an
    // all-ones mask exactly for the matching suit, so the bit ORs into that
    // accumulator and vanishes from the other three.
    //
    // This is three times faster than the equivalent switch, and mask building
    // is most of what this function costs — §6.4 warns that the evaluator
    // dominates runtime, and it is not wrong.
    s0 |= bit & ((suit - 1) >> 31);
    s1 |= bit & (((suit ^ 1) - 1) >> 31);
    s2 |= bit & (((suit ^ 2) - 1) >> 31);
    s3 |= bit & (((suit ^ 3) - 1) >> 31);
  }

  return evaluateSuitMasks(s0, s1, s2, s3);
}

/**
 * The evaluator proper, over four 13-bit rank masks — one per suit.
 *
 * Exposed because the UTH solvers build these masks incrementally as they walk
 * boards, which saves re-reading seven cards for every dealer holding.
 */
export function evaluateSuitMasks(s0: number, s1: number, s2: number, s3: number): number {
  // --- Flush, and with it straight flush -----------------------------------
  // Only one suit can hold five of seven cards, so at most one of these fires.
  let flushMask = 0;
  if (popcount(s0) >= 5) flushMask = s0;
  else if (popcount(s1) >= 5) flushMask = s1;
  else if (popcount(s2) >= 5) flushMask = s2;
  else if (popcount(s3) >= 5) flushMask = s3;

  if (flushMask !== 0) {
    const high = straightHigh[flushMask]!;
    if (high >= 0) return (STRAIGHT_FLUSH << CATEGORY_SHIFT) | (high << 16);
    // Neither a full house nor quads can share seven cards with a flush, so this
    // flush is the whole answer.
    return (FLUSH << CATEGORY_SHIFT) | topFive[flushMask]!;
  }

  // --- Rank multiplicities, without a histogram -----------------------------
  const atLeast1 = s0 | s1 | s2 | s3;
  const atLeast2 =
    (s0 & s1) | (s0 & s2) | (s0 & s3) | (s1 & s2) | (s1 & s3) | (s2 & s3);
  const atLeast3 =
    (s0 & s1 & s2) | (s0 & s1 & s3) | (s0 & s2 & s3) | (s1 & s2 & s3);
  const quads = s0 & s1 & s2 & s3;

  if (quads !== 0) {
    const q = highestRank(quads);
    return (
      (FOUR_OF_A_KIND << CATEGORY_SHIFT) |
      (q << 16) |
      oneKicker(atLeast1 & ~(1 << q))
    );
  }

  const trips = atLeast3;
  const pairs = atLeast2 & ~atLeast3;

  if (trips !== 0) {
    const t = highestRank(trips);
    // The pair of a full house may be a second set of trips, played as a pair.
    const paired = (trips & ~(1 << t)) | pairs;
    if (paired !== 0) {
      return (FULL_HOUSE << CATEGORY_SHIFT) | (t << 16) | (highestRank(paired) << 12);
    }
  }

  const straight = straightHigh[atLeast1]!;
  if (straight >= 0) return (STRAIGHT << CATEGORY_SHIFT) | (straight << 16);

  if (trips !== 0) {
    const t = highestRank(trips);
    return (
      (THREE_OF_A_KIND << CATEGORY_SHIFT) |
      (t << 16) |
      twoKickers(atLeast1 & ~(1 << t))
    );
  }

  if (pairs !== 0) {
    const high = highestRank(pairs);
    const rest = pairs & ~(1 << high);
    if (rest !== 0) {
      const low = highestRank(rest);
      return (
        (TWO_PAIR << CATEGORY_SHIFT) |
        (high << 16) |
        (low << 12) |
        twoPairKicker(atLeast1 & ~(1 << high) & ~(1 << low))
      );
    }
    return (PAIR << CATEGORY_SHIFT) | (high << 16) | threeKickers(atLeast1 & ~(1 << high));
  }

  return (HIGH_CARD << CATEGORY_SHIFT) | topFive[atLeast1]!;
}

/** Population count for a 13-bit mask. */
function popcount(x: number): number {
  let n = x - ((x >> 1) & 0x5555);
  n = (n & 0x3333) + ((n >> 2) & 0x3333);
  n = (n + (n >> 4)) & 0x0f0f;
  return (n + (n >> 8)) & 0x1f;
}

/** Exposed for the table-integrity tests; not part of the hot path. */
export const internals = { straightHigh, topFive, popcount };
