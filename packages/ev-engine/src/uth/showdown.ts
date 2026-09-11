/**
 * Settling one Ultimate Texas Hold'em hand (spec §5.2.1).
 *
 * Three bets resolve independently and by different rules, which is where the
 * game hides its complexity:
 *
 *   Ante   pushes whenever the dealer fails to qualify — on a losing hand as
 *          well as a winning one. It only wins or loses when the dealer has a
 *          pair or better.
 *   Play   ignores qualification entirely. It wins, loses or pushes purely on
 *          who has the better hand.
 *   Blind  pays a premium on a player win with a straight or better, pushes on a
 *          player win with less, and is lost outright when the player loses.
 *          Qualification never touches it.
 *
 * Getting any of those three couplings backwards produces EVs that look
 * plausible and are wrong, so `settle` is written as one small function with the
 * three rules side by side rather than spread across the solvers.
 */

import { evaluate7 } from '../poker/evaluator.ts';
import { PAIR, categoryOf } from '../poker/handValue.ts';
import type { Card } from '../core/cards.ts';
import { blindPayout, FOLD_RESULT, type BlindPaytable, type TripsPaytable } from './rules.ts';
import {
  FLUSH,
  FOUR_OF_A_KIND,
  FULL_HOUSE,
  STRAIGHT,
  STRAIGHT_FLUSH,
  THREE_OF_A_KIND,
} from '../poker/handValue.ts';

/** The dealer qualifies with a pair or better, board cards included. */
export function dealerQualifies(dealerScore: number): boolean {
  return categoryOf(dealerScore) >= PAIR;
}

/**
 * Net units won or lost on the Ante, Blind and Play bets together, in units of
 * the ante. The Trips side bet is settled separately: it does not depend on the
 * dealer at all.
 *
 * @param playBet 4, 3, 2 or 1 — whichever raise the player made.
 */
export function settle(
  playerScore: number,
  dealerScore: number,
  playBet: number,
  paytable: BlindPaytable,
): number {
  if (playerScore === dealerScore) return 0; // every bet pushes on a tie

  const qualified = dealerQualifies(dealerScore);

  if (playerScore > dealerScore) {
    const play = playBet;
    const ante = qualified ? 1 : 0;
    const blind = blindPayout(playerScore, paytable);
    return play + ante + blind;
  }

  const play = -playBet;
  const ante = qualified ? -1 : 0;
  const blind = -1;
  return play + ante + blind;
}

/** Folding forfeits the Ante and the Blind and is always exactly -2. */
export const foldResult = FOLD_RESULT;

/**
 * The Trips side bet, which depends only on the player's seven cards and the
 * active paytable — the dealer is irrelevant, and so is whether the player
 * folded.
 */
export function tripsResult(playerScore: number, paytable: TripsPaytable): number {
  switch (categoryOf(playerScore)) {
    case STRAIGHT_FLUSH: {
      const high = (playerScore >>> 16) & 0xf;
      return high === 12 ? paytable.royalFlush : paytable.straightFlush;
    }
    case FOUR_OF_A_KIND:
      return paytable.fourOfAKind;
    case FULL_HOUSE:
      return paytable.fullHouse;
    case FLUSH:
      return paytable.flush;
    case STRAIGHT:
      return paytable.straight;
    case THREE_OF_A_KIND:
      return paytable.threeOfAKind;
    default:
      return -1;
  }
}

/** Convenience wrapper that scores both hands from cards before settling. */
export function settleHands(
  playerHole: readonly Card[],
  dealerHole: readonly Card[],
  board: readonly Card[],
  playBet: number,
  paytable: BlindPaytable,
): number {
  return settle(
    evaluate7([...playerHole, ...board]),
    evaluate7([...dealerHole, ...board]),
    playBet,
    paytable,
  );
}
