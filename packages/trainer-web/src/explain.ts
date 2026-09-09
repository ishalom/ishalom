/**
 * Plain-language explanations for the feedback card (spec §7.1 item 5, §3.4).
 *
 * "Wrong, you should have hit" teaches nothing, so §3.4 makes the reasoning the
 * requirement. This builds it as three steps, in the order a competent player
 * actually thinks:
 *
 *   1. Read the dealer — the upcard alone.
 *   2. Read your hand — the cards alone, with no dealer in the picture.
 *   3. Combine them — the verdict, and how big the edge really is.
 *
 * Two rules keep it honest, and both were learned from getting it wrong:
 *
 * **The supporting statistic must speak to the contest actually being graded.**
 * The old version picked its stat from the winning action's archetype, so
 * 15 against a ten was explained with "the dealer makes 17 or better 77% of the
 * time" — the argument against *standing*, which was never in contention at
 * −0.540. The real contest was hit (−0.504) against surrender (−0.500), and 77%
 * says nothing about that margin. So the stat is now chosen from the top two
 * actions by EV, never from the archetype.
 *
 * **The hand is read on its own terms, not by its total.** The old version
 * explained every split with one sentence, so A,A against a six came out as
 * "played as one hand this is a poor total" — which is false. Soft 12 hits for
 * +0.188, a winning hand. Aces split because the second ace is dead weight in one
 * hand, not because twelve is bad. Eights split to escape a sixteen. Deuces split
 * only when doubling after is allowed. Those are three different arguments and
 * they need three different sentences.
 */

import {
  DEALER_BLACKJACK,
  DEALER_BUST,
  DealerSolver,
  RANK_VALUE,
  rankLabel,
  Shoe,
  upcardLabel,
  type BjRank,
  type BlackjackAction,
  type BlackjackRules,
  type DecisionEvaluation,
  type Scenario,
} from '@evtrainer/ev-engine';

const NAMES: Readonly<Record<BlackjackAction, string>> = {
  hit: 'hitting',
  stand: 'standing',
  double: 'doubling',
  split: 'splitting',
  surrender: 'surrendering',
};

/** The imperative, for headlines and for opening a verdict. */
const VERBS: Readonly<Record<BlackjackAction, string>> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  surrender: 'Surrender',
};

export function actionName(action: BlackjackAction): string {
  return NAMES[action];
}

export interface DealerOdds {
  /** Probability the dealer busts, given no natural. */
  bust: number;
  /** Probability the dealer finishes with 17 or better. */
  madeHand: number;
}

const dealerCache = new Map<string, DealerOdds>();

/**
 * How the dealer's upcard actually behaves.
 *
 * Conditioned on the dealer not holding a natural, which is the number the
 * player is actually facing: in a peek game the dealer has already looked when
 * the decision is made. It matters for exactly two upcards — a ten busts 23% of
 * the time rather than 21%, and an ace 17% rather than 11.5%. Quoting the
 * unconditioned figure for an ace would be telling the player the dealer might
 * still have a blackjack that has already been ruled out.
 */
export function dealerOdds(upcard: BjRank, rules: BlackjackRules): DealerOdds {
  const key = `${upcard}|${rules.decks}|${rules.soft17}|${rules.peek}`;
  const cached = dealerCache.get(key);
  if (cached) return cached;

  const shoe = Shoe.fresh(rules.decks);
  shoe.remove(upcard);
  const raw = new DealerSolver(rules).distribution(upcard, shoe);
  const natural = rules.peek ? raw[DEALER_BLACKJACK]! : 0;
  const scale = natural < 1 ? 1 / (1 - natural) : 1;
  const bust = raw[DEALER_BUST]! * scale;

  const odds: DealerOdds = { bust, madeHand: 1 - bust };
  dealerCache.set(key, odds);
  return odds;
}

const percent = (value: number): string => `${Math.round(value * 100)}%`;

export interface StandOutcome {
  win: number;
  push: number;
  lose: number;
}

const standCache = new Map<string, StandOutcome>();

/**
 * What standing on a given total actually does against a given upcard.
 *
 * Needed because "standing only wins when the dealer breaks" is true of a stiff
 * and false of a pat hand — standing on twenty also beats every 17, 18 and 19 the
 * dealer makes, which is most of them. Quoting the bust rate for a twenty would
 * be quoting the wrong number entirely.
 */
export function standOutcome(
  total: number,
  upcard: BjRank,
  rules: BlackjackRules,
): StandOutcome {
  const key = `${total}|${upcard}|${rules.decks}|${rules.soft17}|${rules.peek}`;
  const cached = standCache.get(key);
  if (cached) return cached;

  const shoe = Shoe.fresh(rules.decks);
  shoe.remove(upcard);
  const raw = new DealerSolver(rules).distribution(upcard, shoe);
  const natural = rules.peek ? raw[DEALER_BLACKJACK]! : 0;
  const scale = natural < 1 ? 1 / (1 - natural) : 1;

  let win = raw[DEALER_BUST]! * scale;
  let push = 0;
  let lose = rules.peek ? 0 : raw[DEALER_BLACKJACK]!;
  for (let dealerTotal = 17; dealerTotal <= 21; dealerTotal++) {
    const p = raw[dealerTotal - 16]! * scale;
    if (dealerTotal < total) win += p;
    else if (dealerTotal === total) push += p;
    else lose += p;
  }

  const outcome: StandOutcome = { win, push, lose };
  standCache.set(key, outcome);
  return outcome;
}

/** The upcard as it reads mid-sentence: "an ace", "a ten", "a 6". */
function upcardPhrase(upcard: BjRank): string {
  if (upcard === 0) return 'an ace';
  if (upcard === 9) return 'a ten';
  return `a ${upcardLabel(upcard)}`;
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Chance the next card busts a hard total. A soft hand cannot bust at all. */
export function bustOnNextCard(scenario: Scenario, rules: BlackjackRules): number {
  if (scenario.kind === 'soft' || scenario.total === undefined) return 0;
  const room = 21 - scenario.total;
  const shoe = Shoe.fresh(rules.decks);
  let busting = 0;
  for (let rank = 0; rank < 10; rank++) {
    const low = rank === 0 ? 1 : RANK_VALUE[rank]!; // an ace plays low when it must
    if (low > room) busting += shoe.count(rank);
  }
  return busting / shoe.total;
}

// --- Hand archetypes --------------------------------------------------------

/**
 * What the hand *wants*, independent of the dealer.
 *
 * Split pairs divide into three genuinely different arguments, which is the
 * distinction the previous single template destroyed.
 */
export type Archetype =
  /** A,A and 8,8: splitting is worth it against every upcard. */
  | 'split-always'
  /** Pairs that split only against weak upcards, to attack. */
  | 'split-offensive'
  /** Pairs that split to escape a bad total rather than to attack. */
  | 'split-defensive'
  /** Pairs whose split depends on being allowed to double afterwards. */
  | 'split-das'
  /** A pair the chart never splits. */
  | 'pair-never'
  /** 12–16: cannot win by standing, cannot draw safely. */
  | 'stiff'
  /** 9, 10, 11: the totals that want more money on the table. */
  | 'doubling'
  /** Soft hands below 18: free to draw, nothing to lose. */
  | 'soft-draw'
  /** Soft 18–20: already good, and drawing risks making it worse. */
  | 'soft-made'
  /** 17 and up: finished, for better or worse. */
  | 'pat'
  /** 5–8: too small to stand, too small to double. */
  | 'small'
  | 'insurance';

export function archetype(scenario: Scenario, evaluation: DecisionEvaluation): Archetype {
  if (scenario.kind === 'insurance') return 'insurance';

  if (scenario.kind === 'pair') {
    const rank = scenario.pairRank!;
    if (evaluation.optimalAction !== 'split') return 'pair-never';
    if (rank === 0 || rank === 7) return 'split-always'; // aces and eights
    // A split that needs doubling afterwards to be worth it: the tell is that the
    // resulting hands want to double, which is what DAS pays for.
    if (rank === 1 || rank === 2 || rank === 5) return 'split-das'; // 2,2 3,3 6,6
    if (rank === 3 || rank === 4) return 'split-offensive'; // 4,4 5,5 — attacking
    return 'split-defensive'; // 7,7 9,9 — escaping a poor total
  }

  const total = scenario.total ?? 0;
  if (scenario.kind === 'soft') return total >= 18 ? 'soft-made' : 'soft-draw';
  if (total >= 17) return 'pat';
  if (total >= 12) return 'stiff';
  if (total >= 9) return 'doubling';
  return 'small';
}

// --- Step 1: read the dealer ------------------------------------------------

/** The upcard alone. No mention of the player's cards. */
export function readDealer(upcard: BjRank, rules: BlackjackRules): string {
  const odds = dealerOdds(upcard, rules);
  const up = upcardPhrase(upcard);

  if (upcard >= 1 && upcard <= 5) {
    const worst = upcard === 4 || upcard === 5 ? ', about their worst' : '';
    return (
      `Dealer shows ${up} — a bust card${worst}. They break ${percent(odds.bust)} of the ` +
      `time and have to keep drawing until they do or reach 17.`
    );
  }
  if (upcard === 0) {
    return (
      `Dealer shows ${up}. They have already looked and have no blackjack, and from ` +
      `here they break only ${percent(odds.bust)} of the time — the strongest card on the table.`
    );
  }
  return (
    `Dealer shows ${up}. They break just ${percent(odds.bust)} of the time and finish ` +
    `with 17 or better the other ${percent(odds.madeHand)}. You need a real hand.`
  );
}

// --- Step 2: read your hand -------------------------------------------------

function pairName(rank: BjRank): string {
  const label = rank === 0 ? 'A' : rank === 9 ? '10' : rankLabel(rank);
  return `${label},${label}`;
}

/**
 * The player's cards alone, with the dealer out of the picture.
 *
 * Every line says what the hand wants, and none of them names the verdict —
 * that is step 3's job.
 */
export function readHand(
  scenario: Scenario,
  evaluation: DecisionEvaluation,
  rules: BlackjackRules,
): string {
  const kind = archetype(scenario, evaluation);
  const total = scenario.total ?? 0;

  switch (kind) {
    case 'insurance':
      return (
        'Insurance is a side bet on the hole card being a ten, and barely three cards ' +
        'in thirteen are. Your own hand has nothing to do with it.'
      );

    case 'split-always': {
      const rank = scenario.pairRank!;
      if (rank === 0) {
        const hit = evaluation.evByAction.hit;
        const held = hit === undefined ? '' : ` Held together it draws for ${hit.toFixed(3)} —`;
        return (
          `${pairName(rank)} — the best pair in the deck, and the one that gains most ` +
          `from being taken apart.${held} fine, but the second ace is dead weight. Split, ` +
          `each one starts a hand from the strongest card there is.`
        );
      }
      return (
        `${pairName(rank)} — sixteen, the worst total in blackjack. Split and you are not ` +
        `attacking, you are escaping: two hands starting from eight beat one hand starting ` +
        `from sixteen against anything.`
      );
    }

    case 'split-das':
      return (
        `${pairName(scenario.pairRank!)} — a small pair that is worth taking apart only ` +
        `because of what happens next. Each half wants to draw and then double, so the ` +
        `value of splitting rides on being allowed to double after it.`
      );

    case 'split-offensive':
      return (
        `${pairName(scenario.pairRank!)} — held together this is a decent total on its own. ` +
        `Splitting it is an attack: two live hands into a dealer who is in trouble.`
      );

    case 'split-defensive':
      return (
        `${pairName(scenario.pairRank!)} — as one hand this total wins only when the dealer ` +
        `breaks. Split, each card starts again somewhere better than where it was.`
      );

    case 'pair-never':
      return (
        `${pairName(scenario.pairRank!)} — a pair, but not one to break up. Together they ` +
        `already make a total worth keeping; apart they make two weaker hands.`
      );

    case 'stiff': {
      const bust = bustOnNextCard(scenario, rules);
      return (
        `${total} — a stiff. You cannot win it by standing, and you break ${percent(bust)} ` +
        `of the time if you draw. There is no comfortable answer, only a cheaper one.`
      );
    }

    case 'doubling':
      return (
        `${total} — the range that wants money on the table. Every ten and every face card ` +
        `turns it into a hand the dealer has to beat, and it cannot break on one card.`
      );

    case 'soft-draw':
      return (
        `Soft ${total} — the ace is doing the work. Nothing you draw can break this hand, ` +
        `so drawing costs you nothing except the total you already had.`
      );

    case 'soft-made':
      return (
        `Soft ${total} — already a real hand, and one of the few that can be improved ` +
        `without risk. The question is whether improving it is worth giving up what it is.`
      );

    case 'pat':
      return (
        `${total} — pat. It cannot be improved without breaking, so it wins what it wins. ` +
        `Whether that is enough is the dealer's business, not yours.`
      );

    default:
      return (
        `${total} — too small to stand on and too small to double. Whatever comes next, ` +
        `this hand is not finished.`
      );
  }
}

// --- Step 3: combine them ---------------------------------------------------

export interface Contest {
  best: { action: BlackjackAction; ev: number };
  runnerUp: { action: BlackjackAction; ev: number } | null;
  gap: number;
}

/** The two actions actually in contention — which is what any stat must speak to. */
export function contest(evaluation: DecisionEvaluation): Contest {
  const ranked = evaluation.legalActions
    .map((action) => ({ action, ev: evaluation.evByAction[action]! }))
    .sort((a, b) => b.ev - a.ev);
  const best = ranked[0]!;
  const runnerUp = ranked[1] ?? null;
  return { best, runnerUp, gap: runnerUp ? best.ev - runnerUp.ev : Infinity };
}

/** How decisive the call is, said honestly rather than by vibes. */
export function describeGap(gap: number): string {
  if (gap === Infinity) return 'the only legal play';
  if (gap > 0.2) return 'not close';
  if (gap >= 0.05) return 'the right play, though closer than it looks';
  if (gap >= 0.01) return 'a narrow call';
  return 'a coin-flip — either is defensible, this one edges it';
}

/**
 * The statistic that speaks to why the best action beats the runner-up.
 *
 * Chosen from the contest, never from the archetype. A dealer-outcome figure is
 * only quoted when standing is one of the two actions in contention, because
 * that is the only time it is the argument.
 */
function supportingStat(
  scenario: Scenario,
  { best, runnerUp }: Contest,
  rules: BlackjackRules,
): string {
  if (!runnerUp || scenario.upcard === undefined) return '';
  const pair = new Set([best.action, runnerUp.action]);
  const odds = dealerOdds(scenario.upcard, rules);
  const up = upcardPhrase(scenario.upcard);

  // Drawing a soft hand is free, which is the whole argument and one no
  // dealer-outcome figure expresses.
  if (pair.has('hit') && scenario.kind === 'soft') {
    return (
      `Drawing cannot break a soft hand — the ace simply drops to one — so the draw ` +
      `costs nothing but the total you already had, and ${up} is strong enough that ` +
      `the total you already had is not enough.`
    );
  }

  // Standing is in contention: the dealer's own outcomes are the argument, but
  // which outcome depends entirely on whether the hand is a stiff or a pat one.
  if (pair.has('stand') && scenario.total !== undefined) {
    const outcome = standOutcome(scenario.total, scenario.upcard, rules);
    // Phrase this from the numbers, not the total: seventeen is pat and still
    // loses two hands in three against a ten, so "very little beats it" would be
    // nonsense for exactly the hand players most need talking out of.
    if (outcome.win > outcome.lose) {
      return (
        `Standing on ${scenario.total} wins ${percent(outcome.win)} against ${up} and ` +
        `loses ${percent(outcome.lose)} — there is not much the dealer can make that beats it.`
      );
    }
    if (scenario.total >= 17) {
      return (
        `Standing on ${scenario.total} still loses ${percent(outcome.lose)} of the time ` +
        `against ${up}. It is a bad hand; it is just less bad than the alternatives.`
      );
    }
    return (
      `Standing on ${scenario.total} wins only when the dealer breaks, and ${up} breaks ` +
      `${percent(odds.bust)} of the time.`
    );
  }

  // Hitting against surrender: what the draw actually does to you.
  if (pair.has('hit') && pair.has('surrender')) {
    const bust = bustOnNextCard(scenario, rules);
    return (
      `Drawing breaks this hand ${percent(bust)} of the time on the very next card, and ` +
      `even played out perfectly it only reaches ${
        (pair.has('hit') ? (best.action === 'hit' ? best.ev : runnerUp.ev) : 0).toFixed(3)
      } — against the guaranteed ${(-0.5).toFixed(3)} of giving half of it back.`
    );
  }

  // Doubling against hitting: same card, twice the money, no second draw.
  if (pair.has('double') && pair.has('hit')) {
    return (
      `Doubling takes the same card as hitting, for twice the stake and no second draw. ` +
      `It wins when that one card is usually enough — and against ${up} it usually is.`
    );
  }

  // Splitting against playing it as one hand. Which way round matters: the same
  // sentence cannot serve both "split gains" and "split gives away".
  if (pair.has('split')) {
    const gap = Math.abs(best.ev - runnerUp.ev).toFixed(3);
    if (best.action === 'split') {
      return (
        `Two hands are worth ${gap} more here than one, which is what ` +
        `${NAMES[runnerUp.action]} it as a single total gives away.`
      );
    }
    return (
      `Splitting it costs ${gap} against simply ${NAMES[best.action]} — breaking up this ` +
      `pair turns one good total into two worse ones.`
    );
  }

  if (pair.has('surrender')) {
    return `Giving half of it back is a guaranteed ${(-0.5).toFixed(3)}; this hand is worth less than that played out.`;
  }
  return '';
}

/** Step 3: the verdict, why the two readings point to it, and the size of the edge. */
export function readCombined(
  scenario: Scenario,
  evaluation: DecisionEvaluation,
  rules: BlackjackRules,
): string {
  const c = contest(evaluation);
  const verdict = VERBS[c.best.action];
  const shape = describeGap(c.gap);
  const stat = supportingStat(scenario, c, rules);

  const numbers =
    c.runnerUp === null
      ? `${c.best.ev.toFixed(3)}`
      : `${c.best.ev.toFixed(3)} against ${c.runnerUp.ev.toFixed(3)} for ${NAMES[c.runnerUp.action]}`;

  return `${verdict}, and it is ${shape}: ${numbers}. ${stat}`.trim();
}

// --- The whole reveal -------------------------------------------------------

export interface Explanation {
  /** What was decided, so every step has a referent: "A,A vs 6 → Split". */
  headline: string;
  steps: [string, string, string];
  /** Gap between the top two actions, for the close-call rules elsewhere. */
  gap: number;
}

function handLabel(scenario: Scenario): string {
  if (scenario.kind === 'insurance') return 'Insurance';
  if (scenario.kind === 'pair') return pairName(scenario.pairRank!);
  if (scenario.kind === 'soft') return `A,${(scenario.total ?? 0) - 11}`;
  return String(scenario.total);
}

export function explain(
  scenario: Scenario,
  evaluation: DecisionEvaluation,
  rules: BlackjackRules,
): Explanation {
  const c = contest(evaluation);

  if (scenario.kind === 'insurance' || scenario.upcard === undefined) {
    return {
      headline: `Insurance → ${VERBS[c.best.action] ?? 'Decline'}`,
      steps: [
        'Dealer shows an ace, so insurance is on offer. It is a bet on the hole card and nothing else.',
        readHand(scenario, evaluation, rules),
        readCombined(scenario, evaluation, rules),
      ],
      gap: c.gap,
    };
  }

  return {
    headline: `${handLabel(scenario)} vs ${upcardLabel(scenario.upcard)} → ${VERBS[c.best.action]}`,
    steps: [
      readDealer(scenario.upcard, rules),
      readHand(scenario, evaluation, rules),
      readCombined(scenario, evaluation, rules),
    ],
    gap: c.gap,
  };
}
