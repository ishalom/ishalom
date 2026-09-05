/**
 * Blackjack hand valuation.
 *
 * During the EV recursion a hand is fully described by its total and whether an
 * ace is still counted as eleven, so the solver carries those two numbers rather
 * than an array of cards. This module owns the conversion.
 */

import { ACE, RANK_VALUE, TEN, type BjRank } from './shoe.ts';

export interface HandValue {
  /** Best total not exceeding 21, or the busted hard total. */
  total: number;
  /** True when an ace is still being counted as eleven (so the total can drop by 10). */
  soft: boolean;
}

export function handValue(ranks: readonly BjRank[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const r of ranks) {
    total += RANK_VALUE[r]!;
    if (r === ACE) aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

/**
 * Add one card to a (total, soft) pair. Mirrors `handValue` exactly.
 *
 * `soft` means exactly one ace is currently counted as eleven — never more than
 * one, since a second eleven would bust on its own. So a second ace joining a
 * soft hand comes in as a one and leaves the hand soft; only a demotion of the
 * single eleven-ace can turn the hand hard.
 */
export function addCard(total: number, soft: boolean, rank: BjRank): HandValue {
  let t: number;
  let s = soft;
  if (rank === ACE) {
    if (soft) {
      t = total + 1; // the hand already has an eleven-ace; this one counts one
    } else {
      t = total + 11;
      s = true;
    }
  } else {
    t = total + RANK_VALUE[rank]!;
  }
  if (t > 21 && s) {
    t -= 10;
    s = false;
  }
  return { total: t, soft: s };
}

/** A natural: exactly two cards, ace plus ten-value. Split hands are never naturals. */
export function isBlackjack(ranks: readonly BjRank[]): boolean {
  if (ranks.length !== 2) return false;
  const [a, b] = ranks as [BjRank, BjRank];
  return (a === ACE && b === TEN) || (a === TEN && b === ACE);
}

/** A splittable pair, in the bucketed sense the table uses: any two ten-values pair. */
export function isPair(ranks: readonly BjRank[]): boolean {
  return ranks.length === 2 && ranks[0] === ranks[1];
}
