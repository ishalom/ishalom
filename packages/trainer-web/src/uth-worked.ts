/**
 * Ultimate's worked lines and its money lines (round 19).
 *
 * Blackjack has had both halves of this since round 15: every action on the
 * card carries the arithmetic behind its figure, and the *printed* arithmetic
 * comes out on the *printed* figure. Ultimate had neither. It had one sentence,
 * which Idan rejected, and two paragraphs of prose standing in for the working.
 *
 * Two things are built here.
 *
 * **The worked line**, where the solve counted something. The river enumerates
 * all 990 hands the dealer can hold and the flop all 1,070,190 ways the turn,
 * the river and the dealer's two cards can fall — so both can be said forward,
 * in counts a player could in principle check, rather than backwards from the
 * answer. Every term is taken during the solve the grade already ran; nothing
 * here computes a second, similar number that might not agree with the first.
 * Before the flop there is nothing to say this way: the EVs are a lookup into a
 * table solved offline, and the table stores no counts. Deriving one would print
 * an approximation, which is exactly what round 15 removed.
 *
 * **The money line**, for every action at every decision point. What Ultimate
 * hides is not the probability, it is how much is on the table: raising 4x means
 * an Ante of one, a Blind of one and a Play bet of four — six units at risk —
 * while checking risks two. No player feels that from a return figure. So each
 * action states what it puts out now, what is then at risk altogether, and what
 * comes back on average, all in the chips this hand is being played for.
 */

import { returnFigure, returned } from './returns.ts';

/** The Ante and the Blind, which are what an Ultimate figure is per unit of. */
export const UTH_STAKE = 2;

/** The Play bet each action makes, as a multiple of the Ante. */
export const PLAY_MULTIPLE: Record<string, number> = {
  raise4x: 4,
  raise3x: 3,
  raise2x: 2,
  raise1x: 1,
  check: 0,
  fold: 0,
};

/** The counts a solve took while it ran; see `UthEvaluation.counts`. */
export interface UthCounts {
  wins: number;
  ties: number;
  losses: number;
  winUnits: number;
  lossUnits: number;
  outcomes: number;
  boards?: number;
  checkPlayBoards?: number;
  checkPlayTotal?: number;
}

/**
 * What each kind of Ultimate worked line adds up to, read off terms rounded to
 * however many decimals they are about to be printed with — the same arithmetic
 * the copy shows the player, in the same order, ending on the figure beside it.
 *
 * Each returns the *return* figure, not the EV, because that is what is printed
 * on the bar: one unit of the Ante and the Blind, and what comes back of it.
 */
const UTH_REBUILD: Record<string, (t: (name: string) => number) => number> = {
  // The river and the flop raise are the same shape: what you win across the
  // outcomes you win, less what you lose across the ones you lose, averaged.
  uthRiverPlay: (t) => 1 + (t('wins') * t('winPay') - t('losses') * t('losePay')) / t('outcomes') / UTH_STAKE,
  uthFlopPlay: (t) => 1 + (t('wins') * t('winPay') - t('losses') * t('losePay')) / t('outcomes') / UTH_STAKE,
  // Checking the flop is not a showdown: it is the river, played right, on every
  // board it can reach — betting on most of them and folding for -2 on the rest.
  uthFlopCheck: (t) =>
    1 + (t('playBoards') * t('playValue') + t('foldBoards') * -2) / t('boards') / UTH_STAKE,
  // Folding forfeits both units. Nothing comes back, and nothing is worked out.
  uthFold: () => 0,
};

export interface UthWork {
  action: string;
  kind: string;
  value: number;
  digits: number | null;
  [term: string]: unknown;
}

/**
 * How many decimals the printed terms need for the printed sum to come out.
 *
 * Blackjack's rule, applied to Ultimate's kinds: start at three, go up only
 * when three will not do, and if six will not do either say so with a null
 * rather than print a sum that is out by one in the last place. Counts are
 * whole numbers and rounding leaves them alone, so only the money terms move.
 */
function uthWithDigits(work: Record<string, unknown> | null): UthWork | null {
  if (!work) return null;
  const rebuild = UTH_REBUILD[work.kind as string];
  if (!rebuild) return null;
  const wanted = returnFigure(work.value as number);
  for (let digits = 3; digits <= 6; digits++) {
    const round = (name: string): number => {
      const value = work[name];
      return typeof value === 'number' ? Number(value.toFixed(digits)) : 0;
    };
    if (returnFigure(rebuild(round)) === wanted) return { ...work, digits } as UthWork;
  }
  return { ...work, digits: null } as UthWork;
}

/**
 * One action's working, or null where the solve counted nothing.
 *
 * @param action  the action this line explains
 * @param value   its figure on the card's scale, which the sum must reach
 * @param phase   which decision point it is
 * @param counts  what the solve counted, absent before the flop
 */
export function uthWorkedFor(
  action: string,
  value: number,
  phase: 'preflop' | 'flop' | 'river',
  counts: UthCounts | undefined,
): UthWork | null {
  if (action === 'fold') return uthWithDigits({ action, kind: 'uthFold', value });
  if (!counts) return null;

  if (phase === 'river' && action === 'raise1x') {
    return uthWithDigits({
      action,
      kind: 'uthRiverPlay',
      value,
      wins: counts.wins,
      ties: counts.ties,
      losses: counts.losses,
      outcomes: counts.outcomes,
      // What a win pays and what a loss costs, on average, counting all three
      // bets. Taken from the solve's own sums, so they cannot disagree with it.
      winPay: counts.wins > 0 ? counts.winUnits / counts.wins : 0,
      losePay: counts.losses > 0 ? -counts.lossUnits / counts.losses : 0,
    });
  }

  if (phase === 'flop' && action === 'raise2x') {
    return uthWithDigits({
      action,
      kind: 'uthFlopPlay',
      value,
      wins: counts.wins,
      ties: counts.ties,
      losses: counts.losses,
      outcomes: counts.outcomes,
      winPay: counts.wins > 0 ? counts.winUnits / counts.wins : 0,
      losePay: counts.losses > 0 ? -counts.lossUnits / counts.losses : 0,
    });
  }

  if (phase === 'flop' && action === 'check' && counts.boards !== undefined) {
    const boards = counts.boards;
    const playBoards = counts.checkPlayBoards ?? 0;
    return uthWithDigits({
      action,
      kind: 'uthFlopCheck',
      value,
      boards,
      playBoards,
      foldBoards: boards - playBoards,
      playValue: playBoards > 0 ? (counts.checkPlayTotal ?? 0) / playBoards : 0,
    });
  }

  return null;
}

/**
 * What an action puts out, what it leaves at risk, and what comes back — in
 * chips, at the Ante this hand is being played for.
 *
 * `back` is the honest one and the reason the three are shown together: it is
 * what is at risk plus what the decision is worth, so folding at the river
 * reads two chips at risk and nothing coming back, which is what folding is.
 */
export function uthMoneyFor(
  action: string,
  ev: number,
  bet: number,
): { puts: number; risk: number; back: number } {
  const multiple = action === 'fold' ? 0 : (PLAY_MULTIPLE[action] ?? 0);
  const risk = (UTH_STAKE + multiple) * bet;
  return {
    puts: multiple * bet,
    risk,
    back: risk + ev * bet,
  };
}

/** The scale behind the pre-flop figure: every board, every dealer holding. */
export const PREFLOP_OUTCOMES = 2_097_572_400;

/** Break-even on the card's scale, for anything that needs to name it. */
export const UTH_EVEN = returned(0, UTH_STAKE);
