/**
 * What the card draws, and the arithmetic under every figure on it.
 *
 * Lifted out of `TrainerSession` in round 16 so that the hand analyser can ask
 * the same question about cards nobody played. It answers from the scenario,
 * the ranked actions and the rules, and holds no state of its own — which is
 * what lets one implementation serve a live hand and a query, and is why the
 * two can never drift apart and start telling a player different things about
 * the same cards.
 */

import type { BlackjackRules, Scenario } from '@evtrainer/ev-engine';

import { bustOnNextCard, INSURANCE_STAKE, standOutcome } from './explain.ts';
import { equivalentGroups, RETURN_SCALE_MAX, returnFigure, returned, sameFigure } from './returns.ts';
import { ACE, RANK_VALUE } from '@evtrainer/ev-engine';

/** What the spot puts at risk: a unit for a hand, half of one for insurance. */
export const stakeFor = (scenarioKey: string): number =>
  scenarioKey === 'bj:insurance' ? INSURANCE_STAKE : 1;

/**
 * What each kind of worked line adds up to, read off terms rounded to however
 * many decimals they are about to be printed with. The same arithmetic the
 * copy shows the player, in the same order.
 */
const REBUILD: Record<string, (t: (name: string) => number) => number> = {
  stand: (t) => 2 * t('win'),
  standPush: (t) => 2 * t('win') + t('push'),
  hit: (t) => t('survive') * t('surviveValue'),
  hitAlwaysBreaks: () => 0,
  double: (t) => 2 * t('oneCard') - 1,
  split: (t) => 2 * t('perHand') - 1,
  surrender: () => 0.5,
  insurance: (t) => 3 * t('ten'),
  decline: () => 1,
};

/**
 * Everything the card needs to draw the returns, and nothing it has to work out.
 *
 * The page draws bars and prints figures; which stake the spot puts at risk,
 * which actions come to the same figure, and whether this hand can carry the
 * worked example are all decided here, where the scenario and the rules are.
 */
export function returnsBlock(
  scenario: Scenario,
  ranked: Array<{ action: string; ev: number; value: number }>,
  stake: number,
  rules: BlackjackRules,
): unknown {
  return {
    stake,
    scaleMax: RETURN_SCALE_MAX,
    best: ranked[0]?.value ?? 0,
    // Ties are read off the figures a player actually sees, not off the EVs.
    equivalent: equivalentGroups(ranked),
    // One worked line per action, each rebuilding its own figure exactly
    // (round 15). `example` is kept for the stand line the round 13 tests
    // name, and is the same arithmetic.
    worked: ranked.map((row) => workedFor(scenario, row, rules)),
    example: standExample(scenario, ranked, rules),
  };
}

/**
 * How one action's figure is arrived at, in numbers a player can check.
 *
 * Idan rejected the prose this replaces — "hitting has no single sum" — and
 * he was right to: an explanation that asks to be trusted is worth less than
 * one that can be redone on a napkin. So every action gets its terms, its
 * assumption, and an arithmetic that closes.
 *
 * WHY THE SECOND TERM IS DIVIDED OUT OF THE FIGURE RATHER THAN QUOTED. Each
 * line borrows one number that can be computed on its own — the chance of
 * breaking on the next card, the chance the dealer ties — and derives the
 * rest from the figure being explained. The figures come from the chart,
 * which averages over the hands that reach a total; anything computed beside
 * it agrees to about the third decimal and not always beyond. Quoting both
 * halves would print a sum that does not come out, in an explanation whose
 * whole point is that it does. This way the sum is exact by construction and
 * the only borrowed number is one the app already quotes elsewhere.
 */
function workedFor(
  scenario: Scenario,
  row: { action: string; ev: number; value: number },
  rules: BlackjackRules,
): unknown {
  return withDigits(workedTerms(scenario, row, rules));
}

/**
 * How many decimals the printed terms need for the printed sum to come out.
 *
 * The arithmetic closes exactly; the *printing* of it need not. `2 × 26% =
 * +0.526` is what a reader is asked to check, and 2 × 26% is 0.520 — so the
 * explanation would be caught lying by anybody who did the one thing it
 * invites. The terms therefore carry as many decimals as it takes for the
 * rounded sum to land on the figure beside it, starting at three and going
 * up only when three will not do.
 */
function withDigits(work: Record<string, unknown> | null): unknown {
  if (!work) return null;
  const rebuild = REBUILD[work.kind as string];
  if (!rebuild) return work;
  const wanted = returnFigure(work.value as number);
  for (let digits = 3; digits <= 6; digits++) {
    const round = (name: string) => {
      const value = work[name];
      return typeof value === 'number' ? Number(value.toFixed(digits)) : 0;
    };
    if (returnFigure(rebuild(round)) === wanted) return { ...work, digits };
  }
  // Six decimals and still not landing would mean the arithmetic itself is
  // wrong, not the printing; say so rather than print a sum that is out.
  return { ...work, digits: null };
}

function workedTerms(
  scenario: Scenario,
  row: { action: string; ev: number; value: number },
  rules: BlackjackRules,
): Record<string, unknown> | null {
  const value = row.value;
  const total = standingTotal(scenario);

  switch (row.action) {
    case 'surrender':
      // Half the bet, always. Nothing to work out, which is the point of it.
      return { action: row.action, kind: 'surrender', value };
    case 'declineInsurance':
      return { action: row.action, kind: 'decline', value };
    case 'takeInsurance':
      // 2:1 on half a unit: three units back per unit staked, when the hole
      // card is a ten.
      return { action: row.action, kind: 'insurance', value, ten: value / 3 };
    case 'stand': {
      if (total === null || scenario.upcard === undefined) return null;
      // A stiff hand cannot tie: every total the dealer makes beats it.
      const push = total <= 16 ? 0 : standOutcome(total, scenario.upcard, rules).push;
      return { action: row.action, kind: push === 0 ? 'stand' : 'standPush', value, win: (value - push) / 2, push };
    }
    case 'hit': {
      const bust = bustOnNextCard(scenario, rules);
      const survive = 1 - bust;
      if (survive <= 0) return { action: row.action, kind: 'hitAlwaysBreaks', value, bust, survive };
      return { action: row.action, kind: 'hit', value, bust, survive, surviveValue: value / survive };
    }
    // Both put a second unit out, so both are the same shape: what one unit
    // comes back, on two units, less the one that came out of pocket.
    case 'double':
      return { action: row.action, kind: 'double', value, oneCard: (value + 1) / 2 };
    case 'split':
      return { action: row.action, kind: 'split', value, perHand: (value + 1) / 2 };
    default:
      return null;
  }
}

/**
 * The total a hand would stand on, including a pair — which the chart's
 * scenario keys leave implicit, and which round 13's stand example had no way
 * to read, so pair spots carried no arithmetic at all.
 */
function standingTotal(scenario: Scenario): number | null {
  if (scenario.kind === 'insurance') return null;
  if (scenario.total !== undefined) return scenario.total;
  if (scenario.kind === 'pair' && scenario.pairRank !== undefined) {
    // A pair of aces stands on twelve; every other pair is twice its rank.
    return scenario.pairRank === ACE ? 12 : 2 * RANK_VALUE[scenario.pairRank]!;
  }
  return null;
}

/**
 * The hand's own arithmetic, for the explanation behind the `?`.
 *
 * Standing is the one action whose figure a player can rebuild unaided: a win
 * returns two units and a push returns one, so the figure is
 * `2 × P(win) + 1 × P(push)` and nothing else. The odds come from the same
 * chart the decision was graded against — and the identity is *checked* here
 * rather than asserted, so a spot where the two would not agree to the last
 * decimal simply carries no example instead of teaching a sum that does not
 * come out.
 */
function standExample(
  scenario: Scenario,
  ranked: Array<{ action: string; ev: number; value: number }>,
  rules: BlackjackRules,
): unknown {
  const stand = ranked.find((row) => row.action === 'stand');
  if (!stand || scenario.kind === 'insurance') return null;
  if (scenario.total === undefined || scenario.upcard === undefined) return null;

  /*
   * A stiff hand cannot tie: sixteen loses to every total the dealer makes and
   * wins only when he breaks. A pat hand can tie, so it needs the push term
   * as well, and that comes from the dealer's own outcomes.
   */
  const push = scenario.total <= 16 ? 0 : standOutcome(scenario.total, scenario.upcard, rules).push;

  /*
   * The win rate is read back out of the figure rather than quoted from the
   * dealer's outcomes, and deliberately so. The chart cell each figure comes
   * from is an average over the two-card hands that reach this total, and the
   * dealer's outcomes are computed against one composition — so the two agree
   * to about the third decimal and not always beyond it. Quoting both would
   * print a sum that does not come out, in an explanation whose whole purpose
   * is that the player can check it. Written this way the example always
   * rebuilds the figure it explains, exactly, and the only borrowed number is
   * the push, which is zero for every stiff hand and small for the rest.
   */
  const win = (stand.value - push) / 2;
  return { kind: push === 0 ? 'bust' : 'winPush', win, push, value: stand.value };
}
