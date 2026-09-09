/**
 * The Trips side bet (spec §5.2.4, §6.3).
 *
 * Trips depends only on the player's own seven cards. The dealer is irrelevant,
 * the board is shared, and the bet is placed before anything is dealt — so its
 * EV is a single number per paytable, obtained by weighting each payout by how
 * often a random seven-card hand reaches it.
 *
 * That distribution is the same exhaustive C(52,7) enumeration §14.1 already
 * demands of the evaluator, so this module needs no table of its own beyond ten
 * integers. Spec §6.5 budgeted under 5 KB per paytable for precomputed Trips
 * tables; the real cost is one shared frequency vector.
 *
 * Spec §6.3 is pointed about what to do with the answer: "For most common
 * paytables this bet is negative-EV, and the app should say so rather than
 * presenting 'make the Trips bet' as a live strategic choice with a defensible
 * upside." `describeTrips` exists so the product can do exactly that.
 */

import {
  FLUSH,
  FOUR_OF_A_KIND,
  FULL_HOUSE,
  STRAIGHT,
  STRAIGHT_FLUSH,
  THREE_OF_A_KIND,
} from '../poker/handValue.ts';
import type { TripsPaytable } from './rules.ts';

/** Every seven-card hand there is. */
export const TOTAL_SEVEN_CARD_HANDS = 133_784_560;

/**
 * How many of those 133,784,560 hands land on each payable category.
 *
 * Produced by the exhaustive enumeration in `test/poker-evaluator.test.ts`,
 * which regenerates and re-checks these counts, so they cannot drift away from
 * the evaluator unnoticed. The royal flush is split out of the straight-flush
 * category because it pays differently; the two sum to the published 41,584.
 */
export const SEVEN_CARD_FREQUENCIES = {
  royalFlush: 4_324,
  straightFlush: 37_260,
  fourOfAKind: 224_848,
  fullHouse: 3_473_184,
  flush: 4_047_644,
  straight: 6_180_020,
  threeOfAKind: 6_461_620,
  /** Everything below trips, which loses the bet. */
  losing: 23_294_460 + 58_627_800 + 31_433_400,
} as const;

export interface TripsAnalysis {
  paytable: TripsPaytable;
  /** EV in units of the Trips bet. Negative means the bet loses money. */
  ev: number;
  /** House edge as a positive percentage, which is how casinos quote it. */
  houseEdgePercent: number;
  /** Probability of any payout at all. */
  winProbability: number;
}

/**
 * Exact EV of one unit on Trips. A win pays the multiple and returns the stake;
 * a loss forfeits it, which is the -1 below.
 */
export function tripsEv(paytable: TripsPaytable): number {
  const f = SEVEN_CARD_FREQUENCIES;
  const paid =
    f.royalFlush * paytable.royalFlush +
    f.straightFlush * paytable.straightFlush +
    f.fourOfAKind * paytable.fourOfAKind +
    f.fullHouse * paytable.fullHouse +
    f.flush * paytable.flush +
    f.straight * paytable.straight +
    f.threeOfAKind * paytable.threeOfAKind;
  return (paid - f.losing) / TOTAL_SEVEN_CARD_HANDS;
}

export function analyseTrips(paytable: TripsPaytable): TripsAnalysis {
  const f = SEVEN_CARD_FREQUENCIES;
  const winning = TOTAL_SEVEN_CARD_HANDS - f.losing;
  const ev = tripsEv(paytable);
  return {
    paytable,
    ev,
    houseEdgePercent: -ev * 100,
    winProbability: winning / TOTAL_SEVEN_CARD_HANDS,
  };
}

/**
 * Plain-language verdict for the feedback layer, phrased the way §16 requires:
 * honest about the number, and not dressed up as a live strategic choice when it
 * is not one.
 */
export function describeTrips(paytable: TripsPaytable): string {
  const { ev, houseEdgePercent } = analyseTrips(paytable);
  if (ev < 0) {
    return (
      `On ${paytable.name}, Trips costs ${houseEdgePercent.toFixed(2)}% of the bet. ` +
      'It pays often enough to feel live, but it loses money every time you make it.'
    );
  }
  return (
    `On ${paytable.name}, Trips returns ${(ev * 100).toFixed(2)}% of the bet. ` +
    'This paytable is unusually generous; check it against the table felt before trusting it.'
  );
}

/** Category constants, re-exported so callers can map a score to a Trips payout. */
export const TRIPS_PAYING_CATEGORIES: readonly number[] = [
  THREE_OF_A_KIND,
  STRAIGHT,
  FLUSH,
  FULL_HOUSE,
  FOUR_OF_A_KIND,
  STRAIGHT_FLUSH,
];
