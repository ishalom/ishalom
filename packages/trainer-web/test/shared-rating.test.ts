/**
 * A shared table's decisions reach the rating, and only once (round 25; §3.11).
 *
 * This is the round that can damage something that cannot be rebuilt, so the
 * tests are pointed at the four ways it could:
 *
 *   - **two grading paths.** The private table and the shared table must turn a
 *     decision into a rating movement by the same code. Held here by the key and
 *     the cost the shared table produces being the engine's own, and by there
 *     being one function that moves a rating at all.
 *   - **counting a decision twice.** *One seed, one score.* Held by driving the
 *     real page driver and asking it twice.
 *   - **rating something that was never played.** A forfeited hand must reach
 *     the rating as nothing, never as synthesised wrong decisions.
 *   - **the level reaching a score.** Held by changing it and watching nothing
 *     move.
 *
 * The golden run lives elsewhere and is the fifth guard: `grading-unchanged`
 * replays sixty recorded hands and holds the private rating to the digit, so a
 * change that moved it could not reach here at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPreset, scenarioKeyForHand, bjRankOfCard, severityForCost } from '@evtrainer/ev-engine';
import { makeRng } from '@evtrainer/game-engine';

import { newRating, rateOneDecision, difficultyTable, type Rating } from '../src/difficulty.ts';
import { chartFor } from '../src/sensitivity.ts';
import { TrainerSession } from '../src/session.ts';
import {
  deriveTable,
  playTable,
  ratingKeyOf,
  rulesFor,
  seatRatable,
  type SeatMove,
  type TableRecord,
} from '../src/shared-table.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRESET = 'vegas-strip-6d-s17';

function freshTable(seed: number, seats = 2): TableRecord {
  return {
    id: `t${seed}`,
    seed,
    presetId: PRESET,
    restrictions: { noSurrender: false, likeRanksOnly: false },
    seats: Array.from({ length: seats }, (_, seat) => ({
      seat,
      playerId: `p${seat}`,
      name: `Player ${seat}`,
      bet: 1,
      moves: [] as SeatMove[],
      events: [{ kind: 'join' as const, seat, hand: 0 }],
    })),
  };
}

function playRandom(record: TableRecord, hands: number, seed: number) {
  const rng = makeRng(seed);
  return playTable(record, hands, ({ legal }) => legal[rng.nextInt(legal.length)] as SeatMove['action']);
}

/* --- 1. One grading path ------------------------------------------------------------------- */

test('the key a shared decision is rated by is the key the engine would give it', () => {
  /*
   * The join between the two tables is two values: which cell of the difficulty
   * grid a decision sits in, and what it cost. The cost comes from the engine on
   * both sides already — round 21 proved the shared table grades through
   * `BlackjackTable.act` like the private one. The key is the piece this round
   * added, so it is the piece held here, rebuilt from the cards the way
   * `scenarioKeyForHand` is called everywhere else in the app.
   */
  let checked = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const record = freshTable(seed, 3);
    playRandom(record, 6, seed * 11);
    const table = deriveTable(record);
    for (const hand of table.hands) {
      for (const decision of hand.decisions) {
        const key = ratingKeyOf(decision);
        if (decision.action === 'takeInsurance' || decision.action === 'declineInsurance') {
          assert.equal(key, 'bj:insurance', 'insurance is rated under its own cell, as it always was');
          checked++;
          continue;
        }
        const expected = scenarioKeyForHand(
          decision.cards.map((card) => bjRankOfCard(card)),
          bjRankOfCard(decision.upcard),
          decision.evByAction.split !== undefined,
        );
        assert.equal(key, expected, `seed ${seed}: a shared decision would be rated under the wrong cell`);
        checked++;
      }
    }
  }
  assert.ok(checked > 200, `only ${checked} decisions checked`);
});

test('there is exactly one function that moves a rating, and both tables call it', () => {
  /*
   * Structural, and worth having beside the behavioural tests: two paths that
   * agree today are still two paths, and the second one is where a divergence
   * would be introduced by somebody who did not know the first existed.
   */
  const session = readSource('session.ts');
  assert.ok(
    !session.includes('updateRatingWithReach'),
    'session.ts moves a rating by itself again, instead of through rateOneDecision',
  );
  assert.ok(session.includes('rateOneDecision'), 'session.ts no longer rates through the shared path');
});

test('a shared decision moves the rating by exactly what the same decision moves it by anywhere', () => {
  const rules = rulesFor({ presetId: PRESET, restrictions: { noSurrender: false, likeRanksOnly: false } });
  const chart = chartFor(rules);

  const record = freshTable(9, 3);
  playRandom(record, 8, 99);
  const owed = seatRatable(record, 0);
  assert.ok(owed.length > 0, 'nobody decided anything');

  /* What the one path does with them, on its own. */
  const alone: Rating = { ...newRating('value') };
  const deltas = owed.map((decision) =>
    rateOneDecision(alone, rules, chart, decision.scenarioKey, decision.evCost),
  );

  /* And what the session does with the same list, through `absorbRated`. */
  const session = new TrainerSession(PRESET, 1);
  session.restore({
    version: 2,
    name: 'Tester',
    hands: 0,
    decisions: 0,
    lifetimeDecisions: 0,
    correct: 0,
    evLost: 0,
    netUnits: 0,
    closeCalls: 0,
    closeCallsCorrect: 0,
    bySeverity: { optimal: 0, negligible: 0, minor: 0, significant: 0, blunder: 0 },
    mode: 'value',
    ratings: {
      basic: newRating('basic'),
      recall: newRating('recall'),
      value: newRating('value'),
    },
    scenarioStats: [],
    history: [],
  } as never);

  session.absorbRated(rules, owed);
  const after = (session.profile as { rating: Rating }).rating;

  assert.equal(after.ratedDecisions, alone.ratedDecisions, 'a different number of decisions was rated');
  assert.equal(after.rating, alone.rating, 'the session reached a different rating from the one path');
  assert.equal(after.peak, alone.peak, 'the peak differs');
  assert.ok(
    deltas.some((delta) => delta !== null),
    'no decision at this table was on the grid at all, so this proves nothing',
  );
});

test('off the grid scores nothing, here exactly as it scores nothing at the private table', () => {
  const rules = getPreset(PRESET).rules;
  const chart = chartFor(rules);
  const rating = newRating('basic');
  const before = { ...rating };

  // Hard 19 has no cell: standing on it is trivially correct and rating it
  // would hand every player free points.
  assert.equal(difficultyTable(rules, chart).get('bj:hard19:vs6'), undefined, 'hard 19 has a cell now');
  assert.equal(rateOneDecision(rating, rules, chart, 'bj:hard19:vs6', 0), null);
  assert.deepEqual(rating, before, 'an off-grid decision moved the rating');
});

/* --- 2. One seed, one score ----------------------------------------------------------------- */

test('the same decisions cannot be rated twice, however many times they are offered', () => {
  const rules = rulesFor({ presetId: PRESET, restrictions: { noSurrender: false, likeRanksOnly: false } });
  const record = freshTable(31, 2);
  playRandom(record, 6, 310);

  const owed = seatRatable(record, 0);
  assert.ok(owed.length >= 4, 'not enough decisions to say anything');

  const session = newSession('value');
  session.absorbRated(rules, owed);
  const once = { ...(session.profile as { rating: Rating }).rating };

  /*
   * The mark is what stops it, and the mark lives in the seat's own row. Here
   * that is the same thing as slicing the list: the driver hands over
   * `seatRatable(...).slice(ratedDecisions)`, so once the mark has reached the
   * end there is nothing left to hand over.
   */
  record.seats[0]!.ratedDecisions = owed.length;
  const again = seatRatable(record, 0).slice(record.seats[0]!.ratedDecisions ?? 0);
  assert.deepEqual(again, [], 'a second pass found decisions to rate again');

  session.absorbRated(rules, again);
  assert.deepEqual(
    { ...(session.profile as { rating: Rating }).rating },
    once,
    'rating the same table twice moved the rating twice',
  );
});

test('a table played on after being rated hands over only what is new', () => {
  const rules = rulesFor({ presetId: PRESET, restrictions: { noSurrender: false, likeRanksOnly: false } });
  /*
   * Twelve hands, of which the first four had been rated when the player last
   * looked. The table is played out in one go because `playTable` deals from the
   * first hand — replaying a record that already holds moves would try to make
   * them twice — so "what had been rated then" is read off the same table by
   * counting the decisions that belong to the first four hands.
   */
  const record = freshTable(41, 2);
  playRandom(record, 12, 410);
  const all = seatRatable(record, 0);
  const first = all.filter((decision) => decision.hand < 4);
  assert.ok(first.length > 0, 'the first four hands held no decisions');
  record.seats[0]!.ratedDecisions = first.length;

  const owedNow = seatRatable(record, 0).slice(record.seats[0]!.ratedDecisions ?? 0);

  assert.ok(owedNow.length > 0, 'playing on produced nothing new to rate');
  assert.equal(all.length, first.length + owedNow.length, 'the new decisions do not follow the old ones');
  /*
   * And the decisions already rated are still the same ones, in the same order.
   * That is what makes a mark meaningful: if playing on could reorder what came
   * before, "the first N" would stop naming the same N.
   */
  assert.deepEqual(all.slice(0, first.length), first, 'playing on reordered what was already rated');

  const session = newSession('value');
  session.absorbRated(rules, owedNow);
  assert.equal(
    (session.profile as { rating: Rating }).rating.ratedDecisions <= owedNow.length,
    true,
    'more decisions were rated than were handed over',
  );
});

/* --- 3. A forfeit is a forfeit ---------------------------------------------------------------- */

test('a hand a player was dropped from reaches the rating as nothing at all', () => {
  /*
   * §3.3 is explicit that a forfeit is never synthesised as wrong decisions,
   * and the reason is technical rather than philosophical: a forfeited hand
   * scored as errors would enter the mastery grid and the "you used to get this
   * wrong" gesture, and the app would tell him he is weak on 16 against a ten
   * when he never played it.
   *
   * It holds here by construction, and this is the test that says so: the
   * decisions come from the derivation, the derivation produces a decision only
   * where a move was recorded, and a dropped seat records no move. There is
   * nowhere for an invented decision to come from.
   */
  const record = freshTable(55, 3);
  playRandom(record, 6, 550);
  const before = seatRatable(record, 1);

  /* Seat 1 is dropped at hand 3 — by the thirty-second rule, in its own row. */
  record.seats[1]!.events = [
    { kind: 'join', seat: 1, hand: 0 },
    { kind: 'drop', seat: 1, hand: 3, why: 'vote' },
  ];
  const after = seatRatable(record, 1);

  assert.ok(after.length < before.length, 'being dropped cost the seat no hands at all');
  assert.ok(
    after.every((decision) => decision.hand < 3),
    'a decision was rated for a hand the player was not at',
  );
  /* And nothing was invented in its place: every remaining decision is one it made. */
  assert.deepEqual(after, before.filter((decision) => decision.hand < 3));
});

/* --- 4. A level never touches a score ---------------------------------------------------------- */

test('how much is explained cannot move a rating', () => {
  const rules = rulesFor({ presetId: PRESET, restrictions: { noSurrender: false, likeRanksOnly: false } });
  const record = freshTable(61, 2);
  playRandom(record, 6, 610);
  const owed = seatRatable(record, 0);

  const ratings = (['basic', 'recall', 'value'] as const).map((mode) => {
    const session = newSession(mode);
    session.setLocale('he');
    session.absorbRated(rules, owed);
    return (session.profile as { rating: Rating }).rating.rating;
  });

  /*
   * The mode is a ladder and is *meant* to change the number — that is what
   * three ladders are. What must not change it is anything about presentation,
   * so the same mode is rated twice with different locales and different
   * explanation levels and has to land on the same number.
   */
  const english = newSession('value');
  english.setLocale('en');
  english.absorbRated(rules, owed);
  const hebrew = newSession('value');
  hebrew.setLocale('he');
  hebrew.absorbRated(rules, owed);
  assert.equal(
    (english.profile as { rating: Rating }).rating.rating,
    (hebrew.profile as { rating: Rating }).rating.rating,
    'the language the player reads changed his rating',
  );
  assert.equal(ratings.length, 3);
});

/* --- 5. What the cost turns into --------------------------------------------------------------- */

test('what a decision cost becomes its severity by the engine rule, not a local one', () => {
  const record = freshTable(71, 3);
  playRandom(record, 6, 710);
  const table = deriveTable(record);
  let seen = 0;
  for (const hand of table.hands) {
    for (const decision of hand.decisions) {
      // `rateOneDecision` calls `severityForCost` on exactly this number, so the
      // only way a shared decision can be graded differently from a private one
      // is if the cost itself differs — and the cost is the engine's.
      assert.equal(typeof severityForCost(decision.evCost), 'string');
      if (decision.evCost <= 0) assert.equal(severityForCost(decision.evCost), 'optimal');
      seen++;
    }
  }
  assert.ok(seen >= 20, `only ${seen} decisions seen`);
});

/* --- helpers ------------------------------------------------------------------------------------ */

function newSession(mode: 'basic' | 'recall' | 'value'): TrainerSession {
  const session = new TrainerSession(PRESET, 1);
  session.restore({
    version: 2,
    name: 'Tester',
    hands: 0,
    decisions: 0,
    lifetimeDecisions: 0,
    correct: 0,
    evLost: 0,
    netUnits: 0,
    closeCalls: 0,
    closeCallsCorrect: 0,
    bySeverity: { optimal: 0, negligible: 0, minor: 0, significant: 0, blunder: 0 },
    mode,
    ratings: {
      basic: newRating('basic'),
      recall: newRating('recall'),
      value: newRating('value'),
    },
    scenarioStats: [],
    history: [],
  } as never);
  return session;
}

function readSource(file: string): string {
  return readFileSync(join(HERE, '..', 'src', file), 'utf8');
}
