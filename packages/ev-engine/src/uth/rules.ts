/**
 * Ultimate Texas Hold'em rules and paytables (spec §5.2).
 *
 * Three bets are always live. The Ante and Blind are equal and mandatory, and
 * the Play bet is made once, at whichever decision point the player chooses:
 * 4x the ante before the flop, 2x after the flop, 1x after the river. Checking
 * costs nothing but shrinks the raise the player will be allowed later, which is
 * the whole strategic shape of the game.
 *
 * All EVs in this module are in units of the ante, so an unraised hand still has
 * two units at risk and folding is exactly -2.
 */

import {
  categoryOf,
  FLUSH,
  FOUR_OF_A_KIND,
  FULL_HOUSE,
  STRAIGHT,
  STRAIGHT_FLUSH,
} from '../poker/evaluator.ts';

/** The Play bet multiple available at each decision point. */
export const PREFLOP_RAISE = 4;
export const FLOP_RAISE = 2;
export const RIVER_RAISE = 1;

/**
 * The 3x pre-flop raise, where a casino offers one alongside 4x.
 *
 * Spec §5.2.3: raising 3x is never correct, because any hand strong enough to
 * raise pre-flop is strong enough to raise the maximum. It is modelled so the
 * trainer can grade someone who takes it and show them what it cost, not because
 * it is ever the answer.
 */
export const PREFLOP_RAISE_SMALL = 3;

/** Folding forfeits the Ante and the Blind. */
export const FOLD_RESULT = -2;

/**
 * Blind paytable: what a winning hand of each strength pays, on top of the bet.
 * Anything below a straight pushes, which is a zero here rather than a loss.
 *
 * The royal flush is a straight flush to the ace; the evaluator keeps the
 * straight's high card in the score, so the two are told apart without a
 * separate category.
 */
export interface BlindPaytable {
  name: string;
  royalFlush: number;
  straightFlush: number;
  fourOfAKind: number;
  fullHouse: number;
  flush: number;
  straight: number;
}

/** The default paytable from spec §5.2.2. */
export const DEFAULT_BLIND_PAYTABLE: BlindPaytable = {
  name: 'standard',
  royalFlush: 500,
  straightFlush: 50,
  fourOfAKind: 10,
  fullHouse: 3,
  flush: 1.5,
  straight: 1,
};

const ACE_RANK = 12;

/** Blind payout multiple for a winning hand. Zero means the Blind pushes. */
export function blindPayout(score: number, paytable: BlindPaytable): number {
  switch (categoryOf(score)) {
    case STRAIGHT_FLUSH: {
      const high = (score >>> 16) & 0xf;
      return high === ACE_RANK ? paytable.royalFlush : paytable.straightFlush;
    }
    case FOUR_OF_A_KIND:
      return paytable.fourOfAKind;
    case FULL_HOUSE:
      return paytable.fullHouse;
    case FLUSH:
      return paytable.flush;
    case STRAIGHT:
      return paytable.straight;
    default:
      return 0;
  }
}

/**
 * Trips paytables (spec §5.2.2). These vary by casino, and whether the bet is
 * worth making at all depends entirely on which one is in play, so several ship
 * as selectable options rather than one being baked in.
 */
export interface TripsPaytable {
  id: string;
  name: string;
  royalFlush: number;
  straightFlush: number;
  fourOfAKind: number;
  fullHouse: number;
  flush: number;
  straight: number;
  threeOfAKind: number;
}

export const TRIPS_PAYTABLES: readonly TripsPaytable[] = [
  {
    id: 'trips-a',
    name: 'Trips pay table I',
    royalFlush: 50,
    straightFlush: 40,
    fourOfAKind: 30,
    fullHouse: 8,
    flush: 7,
    straight: 4,
    threeOfAKind: 3,
  },
  {
    id: 'trips-b',
    name: 'Trips pay table II',
    royalFlush: 50,
    straightFlush: 40,
    fourOfAKind: 30,
    fullHouse: 9,
    flush: 7,
    straight: 4,
    threeOfAKind: 3,
  },
  {
    id: 'trips-c',
    name: 'Trips pay table III',
    royalFlush: 50,
    straightFlush: 40,
    fourOfAKind: 20,
    fullHouse: 7,
    flush: 6,
    straight: 5,
    threeOfAKind: 3,
  },
];

export function getTripsPaytable(id: string): TripsPaytable {
  const found = TRIPS_PAYTABLES.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown Trips paytable: ${id}`);
  return found;
}

export interface UthRules {
  blind: BlindPaytable;
  /** Null when the table does not offer the side bet. */
  trips: TripsPaytable | null;
  /** Whether a 3x pre-flop raise is offered alongside the 4x (spec §5.2.3). */
  offersThreeTimesRaise: boolean;
}

export const DEFAULT_UTH_RULES: UthRules = {
  blind: DEFAULT_BLIND_PAYTABLE,
  trips: TRIPS_PAYTABLES[0]!,
  offersThreeTimesRaise: false,
};

export function makeUthRules(overrides: Partial<UthRules> = {}): UthRules {
  return { ...DEFAULT_UTH_RULES, ...overrides };
}
