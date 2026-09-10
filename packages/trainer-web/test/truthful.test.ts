/**
 * The app has to tell the truth, in both languages.
 *
 * Three separate failures brought this file into being, and all three were the
 * same failure wearing different clothes: a sentence on screen that disagreed
 * with the number beside it.
 *
 * 1. Declining insurance was graded a mistake, and cost rating, whenever the
 *    shoe had drifted ten-rich — punishing the player for the strategy the app
 *    itself teaches (§3.1).
 * 2. Step 3 of the insurance explanation rendered the literal key
 *    `לverbTo.declineInsurance`, and step 2 claimed three ten-value ranks
 *    where there are four.
 * 3. The missed-double sentence argued for doubling even on hands where the
 *    verdict two clauses earlier was "hit".
 *
 * So the tests here are about agreement: between the grade and the strategy,
 * between the steps and the verdict, and between what is written and what is
 * true.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HARD_TOTALS,
  SOFT_TOTALS,
  makeRules,
  parseCards,
  parseScenarioKey,
  scenarioKey,
  type BjRank,
  type Scenario,
} from '@evtrainer/ev-engine';
import { BlackjackTable } from '@evtrainer/game-engine';

import { explain, insuranceOdds } from '../src/explain.ts';
import { catalogue, t, type Locale } from '../src/i18n.ts';
import { TrainerSession } from '../src/session.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES: Locale[] = ['en', 'he'];

/** Forty low cards, so the shoe left behind is markedly ten-rich. */
const FORTY_LOW = [2, 3, 4, 5, 6]
  .flatMap((rank) => ['s', 'h', 'd', 'c'].map((suit) => `${rank}${suit}`))
  .concat([2, 3, 4, 5, 6].flatMap((rank) => ['s', 'h', 'd', 'c'].map((suit) => `${rank}${suit}`)))
  .join(' ');

/** A session whose next hand is exactly the cards named, on a ten-rich shoe. */
function tensRichSession(hand: string, locale: Locale = 'en'): TrainerSession {
  const session = new TrainerSession('vegas-strip-6d-s17', 1);
  session.setLocale(locale);
  const table = (session as unknown as { table: BlackjackTable }).table;
  table.shoe.stack(parseCards(`${FORTY_LOW} ${hand}`));
  for (let i = 0; i < 40; i++) table.shoe.deal();
  return session;
}

// --- Insurance is graded on the strategy, not on the count -------------------

test('declining insurance in a ten-rich shoe costs no rating and no accuracy', () => {
  const session = tensRichSession('9s Ad 7h 2c');
  session.deal();

  const before = Math.round((session.view as { rating: { rating: number } }).rating.rating);
  const feedback = session.insurance(false) as {
    correct: boolean;
    evCost: number;
    ratingDelta: number | null;
    severity: string;
  };
  const after = Math.round((session.view as { rating: { rating: number } }).rating.rating);

  assert.equal(feedback.correct, true, 'basic strategy never insures; declining is correct');
  assert.equal(feedback.evCost, 0);
  assert.equal(feedback.severity, 'optimal');
  // The failure this exists for: Idan lost 8 to 10 points three times in one
  // evening for exactly this play. A correct decision may gain; it may not cost.
  assert.ok(
    (feedback.ratingDelta ?? 0) >= 0,
    `declining insurance moved the rating by ${feedback.ratingDelta}`,
  );
  assert.ok(after >= before, `the rating fell from ${before} to ${after} on a correct play`);
  assert.equal(session.stats.accuracy, 1);
});

test('the shoe that favoured insurance is still mentioned, without changing anything', () => {
  const rich = tensRichSession('9s Ad 7h 2c');
  rich.deal();
  const noted = rich.insurance(false) as { counterNote: string | null; evCost: number };
  assert.ok(noted.counterNote, 'a counter would have insured here and the card said nothing');
  assert.equal(noted.evCost, 0, 'the remark must not become a cost');

  // A fresh shoe is not ten-rich, so there is nothing to remark on.
  const plain = new TrainerSession('vegas-strip-6d-s17', 1);
  const table = (plain as unknown as { table: BlackjackTable }).table;
  table.shoe.stack(parseCards('9s Ad 7h 2c'));
  plain.deal();
  const quiet = plain.insurance(false) as { counterNote: string | null };
  assert.equal(quiet.counterNote, null);
});

// --- The explanation agrees with itself, and with the arithmetic -------------

test('the insurance explanation counts four ten-value ranks, from the engine', () => {
  const odds = insuranceOdds(makeRules());
  // Four of thirteen ranks are worth ten; the old copy said three.
  assert.ok(
    odds.tens > 0.3 && odds.tens < 0.32,
    `a six-deck shoe minus the ace is ${odds.tens} tens, which is not four ranks in thirteen`,
  );
  assert.ok(odds.tens < odds.breakEven, 'insurance would be a winning bet, which it is not');

  for (const locale of LOCALES) {
    const step = t(locale, 'hand.insurance', {
      tens: `${Math.round(odds.tens * 100)}%`,
      breakEven: `${Math.round(odds.breakEven * 100)}%`,
    });
    assert.match(step, /31%/, `${locale} does not quote the engine's figure`);
    assert.match(step, /33%/, `${locale} does not quote the break-even figure`);
    assert.doesNotMatch(
      step,
      /three cards|שלושה קלפים/,
      `${locale} still says three cards in thirteen`,
    );
  }
});

test('no step of the insurance explanation argues against the verdict', () => {
  for (const locale of LOCALES) {
    for (const took of [true, false]) {
      const session = tensRichSession('9s Ad 7h 2c', locale);
      session.deal();
      const feedback = session.insurance(took) as { steps: string[]; optimal: string };
      const whole = feedback.steps.join(' ');

      // The verdict is to decline. Nothing anywhere on the card may name the
      // percentage insurance would need as though the shoe supplied it.
      assert.match(whole, /31%/);
      assert.match(whole, /33%/);
      assert.ok(
        whole.indexOf('31%') < whole.indexOf('33%'),
        'the odds are quoted the wrong way round: what you have, then what you need',
      );
      assert.equal(
        feedback.optimal,
        'declineInsurance',
        'the verdict itself changed, which the steps were written against',
      );
    }
  }
});

// --- No raw key reaches the screen ------------------------------------------

/** Every scenario the chart names, plus insurance. */
function allScenarios(): Scenario[] {
  const upcards: BjRank[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const out: Scenario[] = [{ kind: 'insurance' }];
  for (const upcard of upcards) {
    for (const total of HARD_TOTALS) out.push({ kind: 'hard', total, upcard });
    for (const total of SOFT_TOTALS) out.push({ kind: 'soft', total, upcard });
    for (const pairRank of upcards) out.push({ kind: 'pair', pairRank, upcard });
  }
  return out;
}

test('no i18n key can reach the screen untranslated, in either language', () => {
  /*
   * `t()` falls back to the key when a key is missing, so a composed key family
   * with a gap in it renders as code on screen and compiles perfectly. Idan
   * read "לverbTo.declineInsurance" off the live page. This walks every
   * scenario, every action a player could have chosen, and both languages.
   */
  const prefixes = [...new Set(Object.keys(catalogue('en')).map((key) => key.split('.')[0]!))];
  const rawKey = new RegExp(`\\b(?:${prefixes.join('|')})\\.[A-Za-z0-9]`);

  const rules = makeRules();
  const seen: string[] = [];
  for (const scenario of allScenarios()) {
    const key = scenarioKey(scenario);
    const actions =
      scenario.kind === 'insurance'
        ? (['takeInsurance', 'declineInsurance'] as const)
        : (['stand', 'hit', 'double', 'split', 'surrender'] as const);
    for (const chosen of actions) {
      const evaluation = {
        legalActions: [...actions] as never,
        evByAction: Object.fromEntries(actions.map((a, i) => [a, -0.1 * i])) as never,
        optimalAction: actions[0] as never,
        optimalEv: 0,
      };
      for (const locale of LOCALES) {
        const parsed = scenario.kind === 'insurance' ? scenario : parseScenarioKey(key);
        const shown = explain(parsed, evaluation, rules, locale, chosen);
        for (const line of [shown.headline, ...shown.steps]) {
          if (rawKey.test(line)) seen.push(`${locale} ${key} ${chosen}: ${line}`);
          assert.doesNotMatch(line, /\{\w+\}/, `${locale} ${key}: an unfilled parameter`);
        }
      }
    }
  }
  assert.deepEqual(seen.slice(0, 5), [], 'raw keys reached the screen');
});

// --- The missed-double sentence fires on the right side ----------------------

test('6♠ 2♣ against a 7, doubled: the card argues for hitting, not for doubling', () => {
  /*
   * The engine's numbers for this spot: hit +0.084, double −0.178. One sentence
   * used to serve both directions — "one card is usually enough here" — so on
   * this hand the explanation recommended the very play it had just graded a
   * blunder.
   */
  for (const locale of LOCALES) {
    const session = new TrainerSession('vegas-strip-6d-s17', 1);
    session.setLocale(locale);
    const table = (session as unknown as { table: BlackjackTable }).table;
    table.shoe.stack(parseCards('6s 7d 2c 9h'));
    session.deal();
    const feedback = session.act('double') as {
      steps: string[];
      correct: boolean;
      optimal: string;
    };
    const combined = feedback.steps[2]!;

    assert.equal(feedback.correct, false);
    assert.equal(feedback.optimal, 'hit');
    assert.match(
      combined,
      locale === 'en' ? /one card and no more/ : /קלף אחד וזהו/,
      `the card does not explain why one card is not enough: ${combined}`,
    );
    assert.doesNotMatch(
      combined,
      locale === 'en' ? /one card is usually enough/ : /קלף אחד בדרך כלל מספיק/,
      'the card is arguing for the play it just called wrong',
    );
    // The figure has to be the engine's, not a number someone typed.
    assert.match(combined, /\d+%/);
  }
});

test('the same spot doubled correctly still says one card is enough', () => {
  // 11 against a 7 — the other side of the same sentence.
  const session = new TrainerSession('vegas-strip-6d-s17', 1);
  const table = (session as unknown as { table: BlackjackTable }).table;
  table.shoe.stack(parseCards('6s 7d 5c 9h'));
  session.deal();
  const feedback = session.act('double') as { steps: string[]; correct: boolean };
  assert.equal(feedback.correct, true);
  assert.match(feedback.steps[2]!, /one card is usually enough/);
});

// --- The Hebrew hand log is Hebrew ------------------------------------------

test('the hand log has no English left in it', () => {
  const source = readFileSync(join(HERE, '..', 'public', 'home.js'), 'utf8');
  const from = source.indexOf('function renderHands');
  assert.ok(from > 0, 'renderHands is gone from home.js');
  const body = source.slice(from, source.indexOf('\nfunction ', from + 10));

  /*
   * Three sentences used to sit in this function as English literals — "played
   * it right", "you played …", "a natural — nothing to decide" — plus a bare
   * "vs". A Hebrew player saw all four. Anything quoted here that reads like a
   * sentence has to be an i18n key instead.
   */
  const literals = [...body.matchAll(/'([^'\n]{2,})'|"([^"\n]{2,})"/g)].map(
    (m) => (m[1] ?? m[2])!,
  );
  // Prose is a quoted literal holding two runs of letters. Class names, i18n
  // keys, separators and interpolated attributes are none of them sentences.
  const prose = literals.filter(
    (text) => !text.includes('${') && /[A-Za-z]{2,} [A-Za-z]{2,}/.test(text),
  );
  assert.deepEqual(prose, [], 'English prose is still hardcoded in the hand log');

  for (const key of ['log.vs', 'log.right', 'log.played', 'log.dealerNatural']) {
    const hebrew = catalogue('he')[key];
    assert.ok(hebrew, `he has no ${key}`);
    assert.doesNotMatch(
      hebrew.replace(/\{\w+\}/g, ''),
      /[A-Za-z]/,
      `${key} still contains Latin letters in Hebrew`,
    );
  }
});

// --- The stat strip says whose edge it is -----------------------------------

test('the third stat names the house, and every tooltip says which way is good', () => {
  assert.equal(catalogue('en')['ui.yourEdge'], 'house edge you face');
  assert.equal(catalogue('he')['ui.yourEdge'], 'יתרון הקזינו מולך');
  assert.equal(catalogue('he')['info.edge.title'], 'יתרון הקזינו מולך');

  const direction: Record<string, [RegExp, RegExp]> = {
    accuracy: [/Higher is better/, /כמה שיותר גבוה/],
    evLost: [/Lower is better\. 0 is perfect/, /כמה שיותר נמוך\. 0 זה מושלם/],
    edge: [/Lower is better/, /כמה שיותר נמוך/],
    units: [/does not measure how you played/, /לא מודד איך ששיחקת/],
  };
  for (const [stat, [en, he]] of Object.entries(direction)) {
    assert.match(catalogue('en')[`info.${stat}.body`]!, en, `en ${stat} has no direction line`);
    assert.match(catalogue('he')[`info.${stat}.body`]!, he, `he ${stat} has no direction line`);
  }

  // The rules' own edge is quoted, and it is a parameter rather than a literal.
  for (const locale of LOCALES) {
    const body = catalogue(locale)['info.edge.body']!;
    assert.match(body, /\{rulesEdge\}/, `${locale} hardcodes the rules edge`);
    assert.doesNotMatch(body.replace(/\{rulesEdge\}/g, ''), /0\.\d+%/);
  }
});

test('the effective edge really is the rules plus the mistakes', () => {
  // The tooltip now states this as a fact, so it had better be one.
  const session = new TrainerSession('vegas-strip-6d-s17', 7);
  for (let i = 0; i < 40; i++) {
    session.deal();
    const view = session.view as { phase: string; legalActions: string[] };
    if (view.phase === 'insurance') session.insurance(false);
    let guard = 0;
    while ((session.view as { phase: string }).phase === 'player' && guard++ < 12) {
      const legal = (session.view as { legalActions: string[] }).legalActions;
      session.act((legal.includes('double') ? 'double' : 'stand') as never);
    }
  }
  const stats = session.stats;
  const ruleSet = (session.view as { ruleSet: { edgePercent: number } }).ruleSet;
  assert.ok(
    Math.abs(stats.effectiveHouseEdgePercent - (ruleSet.edgePercent + stats.evLostPer100)) < 1e-9,
    `${stats.effectiveHouseEdgePercent} is not ${ruleSet.edgePercent} + ${stats.evLostPer100}`,
  );
});
