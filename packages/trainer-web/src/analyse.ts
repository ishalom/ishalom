/**
 * The hand analyser (round 16).
 *
 * A player names cards — his own and the dealer's upcard — and asks what they
 * are worth, without playing a hand. It is the first thing in the app worth
 * opening without playing, and it answers with exactly what the table answers
 * with: the same evaluation, the same ranked actions, the same figures and the
 * same worked lines.
 *
 * FIVE THINGS IDAN SETTLED, AND HOW EACH IS HELD TO HERE.
 *
 * 1. CARDS GO IN, NOT A TOTAL. Sixteen is not sixteen: 10-6 may be surrendered,
 *    8-8 may also be split, and 5-6-5 may be neither. The input is a list of
 *    ranks and the analysis is of those cards.
 * 2. RANKS ONLY. Blackjack ignores suits, so nothing here asks for one. A ten
 *    covers the jack, the queen and the king, which is what they are.
 * 3. LEGAL ACTIONS ARE DERIVED, NEVER ASSUMED. The hand is played out on a real
 *    table with a stacked shoe, and the table says what is legal — so surrender
 *    on the first two cards only, doubling by the rules in force, splitting only
 *    on a pair, all come from the one implementation the game already has.
 * 4. IT COUNTS TOWARDS NOTHING. This module cannot reach a score, because it
 *    holds none: no `TrainerSession`, no rating, no accuracy, no EV-lost, no
 *    streak, no day count, no storage. Like the level in round 14, that is
 *    structural and can be checked by reading the imports.
 * 5. THE RULE SET IS PART OF THE INPUT. Which is where it stops being a lookup:
 *    the same hand under four rule sets, sometimes with the answer reversed
 *    (§3.3).
 *
 * An impossible hand is refused rather than answered, and a hand with no
 * decision left in it says so.
 */

import {
  bjRankOfCard,
  getPreset,
  makeCard,
  parseScenarioKey,
  RULE_PRESETS,
  scenarioKeyForHand,
  type BlackjackRules,
} from '@evtrainer/ev-engine';
import { BlackjackTable } from '@evtrainer/game-engine';

import { dealerOutcomes, explain } from './explain.ts';
import { t, type Locale } from './i18n.ts';
import { returnsBlock } from './returns-block.ts';
import { applyRestrictions } from './restrictions.ts';
import { ruleSensitivity } from './sensitivity.ts';

/** What a player can tap. A ten stands for every ten-valued card. */
export const ANALYSER_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'] as const;
export type AnalyserRank = (typeof ANALYSER_RANKS)[number];

/** The most cards a hand can be analysed with: two dealt and two drawn. */
export const ANALYSER_MAX_CARDS = 4;

export interface AnalysisRequest {
  /** The player's cards, by rank, in the order they arrived. */
  player: readonly string[];
  /** The dealer's one visible card. */
  dealer: string;
  presetId?: string;
  restrictions?: { noSurrender: boolean; likeRanksOnly: boolean };
  locale?: Locale;
}

/** Which concrete cards stand for a named rank, in the order they are used. */
const CARDS_FOR: Record<string, number[]> = {
  // Aces and numbers: the four suits of that rank.
  A: [0, 1, 2, 3].map((suit) => makeCard(12, suit as 0)),
  // A ten is any ten-valued card, so there are sixteen of them in a deck: tens,
  // jacks, queens and kings, spread so that four tens in one hand is possible.
  '10': [8, 9, 10, 11].flatMap((rank) => [0, 1, 2, 3].map((suit) => makeCard(rank as 0, suit as 0))),
};
for (let value = 2; value <= 9; value++) {
  CARDS_FOR[String(value)] = [0, 1, 2, 3].map((suit) => makeCard((value - 2) as 0, suit as 0));
}

/** How many of a named rank a shoe of this many decks holds. */
const HELD = (rank: string, decks: number) => (rank === '10' ? 16 : 4) * decks;

/** What a rank is worth, with an ace at eleven. */
const VALUE_OF: Record<string, number> = { A: 11, '10': 10 };
for (let value = 2; value <= 9; value++) VALUE_OF[String(value)] = value;

/** The best total of a set of named ranks, and whether an ace is still soft. */
export function handValueOf(ranks: readonly string[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const rank of ranks) {
    total += VALUE_OF[rank] ?? 0;
    if (rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

const refuse = (problem: string, says: string) => ({ ok: false, problem, says });

/**
 * Cards for the shoe, chosen so that a legal request always finds them.
 *
 * Suits are irrelevant to blackjack and to the analysis, so they are handed out
 * in order and the only thing that matters is that no card is asked for twice.
 */
function pickCards(ranks: readonly string[], used: Map<string, number>): number[] | null {
  const out: number[] = [];
  for (const rank of ranks) {
    const taken = used.get(rank) ?? 0;
    const available = CARDS_FOR[rank];
    if (!available) return null;
    used.set(rank, taken + 1);
    // A six-deck shoe holds six of every card, so the same code comes round
    // again rather than running out; how many a shoe really holds was checked
    // before this point.
    out.push(available[taken % available.length]!);
  }
  return out;
}

/**
 * A hole card that cannot end the hand before it is asked about.
 *
 * The hole card is never turned face up here, so it is not part of what the
 * evaluation sees — but a dealer natural would end the hand and leave nothing
 * to analyse, so it is chosen not to make one.
 */
function pickHole(upcard: string, used: Map<string, number>): number | null {
  const banned = upcard === 'A' ? '10' : upcard === '10' ? 'A' : '';
  for (const rank of ['7', '8', '9', '6', '5', '4', '3', '2', '10', 'A']) {
    if (rank === banned) continue;
    const card = pickCards([rank], used);
    if (card) return card[0]!;
  }
  return null;
}

/**
 * Analyse a hand that nobody played.
 *
 * Everything it answers with comes from the same places the table's own card
 * comes from: the table for what is legal and what each action is worth, the
 * explanation for the words, and the returns block for the figures and their
 * working.
 */
export function analyse(request: AnalysisRequest): unknown {
  const locale = request.locale ?? 'en';
  const say = (key: string, params?: Record<string, string | number>) => t(locale, key, params ?? {});
  const player = [...request.player];
  const dealer = request.dealer;

  // --- What the request has to be before it can be answered ---------------------
  const known = (rank: string) => (ANALYSER_RANKS as readonly string[]).includes(rank);
  if (player.length < 2 || !dealer) return refuse('needCards', say('an.needCards'));
  if (player.length > ANALYSER_MAX_CARDS) {
    return refuse('tooManyCards', say('an.tooManyCards', { max: ANALYSER_MAX_CARDS }));
  }
  if (!player.every(known) || !known(dealer)) return refuse('badRank', say('an.badRank'));

  const presetId = request.presetId ?? RULE_PRESETS[0]!.id;
  const preset = RULE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return refuse('badRules', say('an.badRules'));
  const rules: BlackjackRules = applyRestrictions(
    getPreset(presetId).rules,
    request.restrictions ?? { noSurrender: false, likeRanksOnly: false },
  );

  // A shoe holds what it holds: four of a rank per deck, sixteen ten-cards.
  const wanted = new Map<string, number>();
  for (const rank of [...player, dealer]) wanted.set(rank, (wanted.get(rank) ?? 0) + 1);
  for (const [rank, count] of wanted) {
    if (count > HELD(rank, rules.decks)) {
      return refuse(
        'impossible',
        say('an.impossible', {
          count,
          rank: say(`an.rank.${rank}`),
          held: HELD(rank, rules.decks),
          // "1 decks" reads like a bug in both languages.
          decks: rules.decks === 1 ? say('an.oneDeck') : say('an.decks', { n: rules.decks }),
        }),
      );
    }
  }

  // --- Hands with nothing left to decide ----------------------------------------
  const { total, soft } = handValueOf(player);
  if (total > 21) return refuse('bust', say('an.bust', { total }));
  if (player.length === 2 && total === 21) return refuse('blackjack', say('an.blackjack'));

  // --- The hand, on a table of its own ------------------------------------------
  const used = new Map<string, number>();
  const opening = pickCards([player[0]!, dealer, player[1]!], used);
  const extras = pickCards(player.slice(2), used);
  const hole = pickHole(dealer, used);
  if (!opening || !extras || hole === null) return refuse('impossible', say('an.impossibleShort'));

  const table = new BlackjackTable({ rules, seed: 1, grading: 'chart' });
  table.shoe.stack([opening[0]!, opening[1]!, opening[2]!, hole, ...extras]);
  table.startHand(1);
  // An ace showing offers insurance before the hand can be played. It is a
  // different question from the one being asked, and declining is what gets to
  // the hand itself; the hole card was chosen so that declining cannot lose.
  if ((table.view as { phase: string }).phase === 'insurance') table.takeInsurance(false);
  for (let i = 0; i < extras.length; i++) {
    if ((table.view as { phase: string }).phase !== 'player') break;
    table.act('hit');
  }
  if ((table.view as { phase: string }).phase !== 'player') {
    // Three cards to twenty-one stands itself, and a hand that broke on the way
    // is over. Either way there is no decision left to analyse.
    return refuse('noDecision', say(total === 21 ? 'an.twentyOne' : 'an.bust', { total }));
  }

  const legalActions = table.legalActions();
  const evaluation = table.currentEvaluation();
  const cards = [opening[0]!, opening[2]!, ...extras];
  const ranks = cards.map(bjRankOfCard);
  const upcard = bjRankOfCard(opening[1]!);
  const scenarioKey = scenarioKeyForHand(ranks, upcard, legalActions.includes('split'));
  const scenario = parseScenarioKey(scenarioKey);
  const explanation = explain(scenario, evaluation, rules, locale);

  const ranked = legalActions
    .map((action) => ({
      action,
      label: t(locale, `action.${action}`),
      ev: evaluation.evByAction[action] ?? 0,
      value: 1 + (evaluation.evByAction[action] ?? 0),
    }))
    .sort((a, b) => b.ev - a.ev);

  return {
    ok: true,
    ruleSet: { id: preset.id, name: preset.name, note: preset.note ?? null, decks: rules.decks },
    hand: { cards: player, total, soft, dealer },
    scenarioKey,
    headline: explanation.headline,
    steps: explanation.steps,
    best: { action: evaluation.optimalAction, label: t(locale, `action.${evaluation.optimalAction}`) },
    ranked,
    returns: returnsBlock(scenario, ranked, 1, rules),
    // §3.3, which a player has never been able to see until now: what another
    // rule set would answer for these same cards.
    sensitivity: ruleSensitivity(scenarioKey, rules, evaluation.optimalAction),
    breakdown: scenario.upcard === undefined ? null : { dealer: dealerOutcomes(scenario.upcard, rules) },
  };
}
