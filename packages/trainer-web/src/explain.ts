/**
 * Plain-language explanations for the feedback card (spec §7.1, item 5).
 *
 * "Wrong, you should have hit" teaches nothing. §3.4 makes the reason itself the
 * requirement, so every sentence here carries a number the player can check, and
 * the numbers come from the same dealer distribution the grade came from — not
 * from a table of stock phrases.
 *
 * This is the feedback layer of §12, so it lives above the engines rather than
 * inside them. The engines say what the EVs are; this says why.
 */

import {
  DEALER_BLACKJACK,
  DEALER_BUST,
  DealerSolver,
  rankLabel,
  Shoe,
  upcardLabel,
  type BjRank,
  type BlackjackAction,
  type BlackjackRules,
  type Scenario,
} from '@evtrainer/ev-engine';

const NAMES: Readonly<Record<BlackjackAction, string>> = {
  hit: 'hitting',
  stand: 'standing',
  double: 'doubling',
  split: 'splitting',
  surrender: 'surrendering',
};

export interface DealerOdds {
  /** Probability the dealer busts, given no natural. */
  bust: number;
  /** Probability the dealer finishes with 17 or better. */
  madeHand: number;
}

const dealerCache = new Map<string, DealerOdds>();

/** How the dealer's upcard actually behaves, which is what every sentence rests on. */
export function dealerOdds(upcard: BjRank, rules: BlackjackRules): DealerOdds {
  const key = `${upcard}|${rules.decks}|${rules.soft17}`;
  const cached = dealerCache.get(key);
  if (cached) return cached;

  const shoe = Shoe.fresh(rules.decks);
  shoe.remove(upcard);
  const raw = new DealerSolver(rules).distribution(upcard, shoe);
  const natural = raw[DEALER_BLACKJACK]!;
  const scale = natural < 1 ? 1 / (1 - natural) : 1;
  const bust = raw[DEALER_BUST]! * scale;

  const odds: DealerOdds = { bust, madeHand: 1 - bust };
  dealerCache.set(key, odds);
  return odds;
}

const percent = (value: number): string => `${Math.round(value * 100)}%`;

/** The upcard as it reads in a sentence: "an ace", "a ten", "a 6". */
function upcardPhrase(upcard: BjRank): string {
  if (upcard === 0) return 'an ace';
  if (upcard === 9) return 'a ten';
  return `a ${upcardLabel(upcard)}`;
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function handName(scenario: Scenario): string {
  if (scenario.kind === 'pair') return `a pair of ${rankLabel(scenario.pairRank!)}s`;
  if (scenario.kind === 'soft') return `soft ${scenario.total}`;
  return `${scenario.total}`;
}

/**
 * One sentence saying why the best play is best, with the number it turns on.
 */
export function explain(
  scenario: Scenario,
  optimal: BlackjackAction,
  rules: BlackjackRules,
): string {
  if (scenario.kind === 'insurance') {
    return (
      'Insurance is a bet on the hole card being a ten, and only about three ' +
      'cards in thirteen are. It is a side bet with its own house edge, and the ' +
      'strength of your own hand has nothing to do with it.'
    );
  }

  const upcard = scenario.upcard!;
  const up = upcardPhrase(upcard);
  const odds = dealerOdds(upcard, rules);
  const hand = handName(scenario);
  const total = scenario.total ?? 0;
  const weak = upcard >= 1 && upcard <= 5; // a two through a six

  switch (optimal) {
    case 'stand':
      if (scenario.kind === 'hard' && total < 17) {
        return (
          `${sentenceCase(up)} busts about ${percent(odds.bust)} of the time, so standing on ${hand} ` +
          `lets the dealer beat itself rather than risking a bust of your own.`
        );
      }
      if (scenario.kind === 'hard' && total === 17) {
        return (
          `Seventeen wins nothing on its own, but only four ranks in thirteen improve it ` +
          `and the other nine bust it outright. Standing keeps the ${percent(odds.bust)} ` +
          `chance that ${up} busts; drawing throws it away.`
        );
      }
      if (scenario.kind === 'soft') {
        return (
          `Soft ${total} already beats most of what ${up} makes, and there is no card ` +
          `that improves it often enough to be worth the ones that do not.`
        );
      }
      return (
        `${hand.charAt(0).toUpperCase()}${hand.slice(1)} beats almost everything the dealer ` +
        `can make — ${up} finishes with 17 or better only ${percent(odds.madeHand)} of the ` +
        `time, and most of that still loses to you.`
      );

    case 'hit':
      if (scenario.kind === 'hard' && total >= 12 && !weak) {
        return (
          `${hand} against ${up} is a losing hand either way. The dealer makes 17 or ` +
          `better about ${percent(odds.madeHand)} of the time, so standing hands them the ` +
          `pot; hitting loses less.`
        );
      }
      if (scenario.kind === 'soft') {
        return (
          `Soft ${total} cannot bust on the next card, so drawing is free — there is no ` +
          `total you can reach that is worse than the one you are holding.`
        );
      }
      return `${hand} cannot win by standing, and ${up} only busts ${percent(odds.bust)} of the time.`;

    case 'double':
      return (
        `${sentenceCase(up)} is the dealer's weak spot — it busts about ${percent(odds.bust)} of the ` +
        `time — and ${hand} turns most cards into a good total, so this is the moment to ` +
        `have more money on the table.`
      );

    case 'split':
      return (
        `Played as one hand this is a poor total; split, each card starts a new hand ` +
        `against a dealer who busts ${percent(odds.bust)} of the time with ${up} showing.`
      );

    case 'surrender':
      return (
        `${hand} against ${up} wins so rarely that giving up half the bet beats playing ` +
        `it out — the dealer makes 17 or better about ${percent(odds.madeHand)} of the time.`
      );
  }
}

/** How an action reads on a feedback card. */
export function actionName(action: BlackjackAction): string {
  return NAMES[action];
}
