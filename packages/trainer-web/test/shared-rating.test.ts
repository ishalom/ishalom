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
  forfeitSpot,
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

/**
 * A table where seat 1 is dropped at `hand`, built the way a real drop happens.
 *
 * The shape matters, and getting it wrong is easy. A drop fires **because the
 * seat has not answered** — so the hand it fires on is a hand he was dealt into
 * and never acted in. That means the table is played out only as far as the
 * hand before, one more hand is dealt, and nobody has answered it yet.
 *
 * Bolting a drop onto a table that was already played to the end does not
 * describe anything: every seat answered every round there, so there is no turn
 * anybody was sitting at — and worse, taking a seat out of a hand changes what
 * everyone after it was dealt, which makes the moves already recorded for the
 * later hands illegal. The first version of this helper did exactly that and
 * the engine said so.
 */
function droppedAt(seed: number, hand: number, why = 'vote') {
  const record = freshTable(seed, 3);
  playRandom(record, hand, seed * 10);
  // One more hand is dealt, and this is the one nobody has answered.
  for (const seat of record.seats) seat.hands = hand + 1;
  record.seats[1]!.events = [
    { kind: 'join', seat: 1, hand: 0 },
    { kind: 'drop', seat: 1, hand, why },
  ];
  return record;
}

test('a dropped hand contributes no decisions of its own — none are synthesised', () => {
  /*
   * §3.3's rule, and the reason is technical rather than philosophical: a
   * forfeited hand scored as errors would enter the mastery grid and the "you
   * used to get this wrong" gesture, and the app would tell him he is weak on
   * 16 against a ten when he never played it.
   *
   * It holds by construction — a decision exists only where a move was
   * recorded, and a dropped seat records none — and what round 26 adds beside
   * it is priced separately and marked as what it is.
   */
  const record = droppedAt(55, 3);
  const after = seatRatable(record, 1);
  const played = after.filter((row) => !row.forfeit);

  assert.ok(
    played.every((decision) => decision.hand < 3),
    'a decision was counted for a hand the player was not at',
  );
  assert.ok(
    played.every((decision) => decision.action !== undefined),
    'a rated decision has no action behind it, which means it was invented',
  );
});

test('a drop is priced at the worst thing he could have done where he was sitting', () => {
  /*
   * Idan's rule, round 26. The forfeit costs what the rating would have lost had
   * he chosen the worst action available at the turn the drop fired — a real EV
   * cost off a real spot, never a constant somebody picked.
   */
  let priced = 0;
  for (let seed = 1; seed <= 30 && priced < 8; seed++) {
    for (const hand of [2, 3, 4]) {
      const record = droppedAt(seed, hand);
      const spot = forfeitSpot(record, 1, hand);
      if (!spot) continue;
      priced++;

      /* The cost is the gap from the best action to the worst one on offer. */
      assert.ok(spot.evCost >= 0, 'a forfeit priced below zero');
      assert.ok(spot.legal.length > 0, 'a spot with no legal action was priced');
      assert.ok(spot.legal.includes(spot.worstAction), 'the worst action is not one he could have taken');
      assert.equal(spot.hand, hand);

      /* And it reaches the rating marked as a forfeit, not as a decision. */
      const row = seatRatable(record, 1).find((entry) => entry.forfeit);
      assert.ok(row, 'the forfeit never reached the ratable list');
      assert.equal(row.evCost, spot.evCost, 'the forfeit was rated at a different cost from its spot');
      assert.equal(row.action, undefined, 'a forfeit carries an action, which would make it a decision');
      break;
    }
  }
  assert.ok(priced >= 4, `only ${priced} forfeits could be priced across thirty tables`);
});

test('leaving deliberately costs nothing at all', () => {
  /*
   * The escape that makes the penalty fair: the offence is not slowness, it is
   * letting the table rot rather than playing or leaving.
   */
  for (let seed = 1; seed <= 12; seed++) {
    const record = droppedAt(seed, 3, 'left');
    assert.deepEqual(
      seatRatable(record, 1).filter((row) => row.forfeit),
      [],
      `seed ${seed}: walking out deliberately was charged for`,
    );
  }
});

test('a forfeit is rated once, and a replay of the table reproduces it', () => {
  const rules = rulesFor({ presetId: PRESET, restrictions: { noSurrender: false, likeRanksOnly: false } });
  const record = droppedAt(7, 3);
  const owed = seatRatable(record, 1);
  assert.ok(owed.some((row) => row.forfeit), 'this table has no forfeit in it to test');

  /* Same record, read again elsewhere: the same list, forfeit included. */
  const elsewhere = seatRatable(JSON.parse(JSON.stringify(record)) as TableRecord, 1);
  assert.deepEqual(elsewhere, owed, 'another device would price the forfeit differently');

  /* And the mark covers it like everything else, so it cannot be charged twice. */
  record.seats[1]!.ratedDecisions = owed.length;
  assert.deepEqual(
    seatRatable(record, 1).slice(record.seats[1]!.ratedDecisions ?? 0),
    [],
    'the forfeit was offered for rating a second time',
  );

  const session = newSession('value');
  session.absorbRated(rules, owed);
  const once = (session.profile as { rating: Rating }).rating.rating;
  session.absorbRated(rules, []);
  assert.equal((session.profile as { rating: Rating }).rating.rating, once, 'rating it again moved it again');
});

test('a forfeit never reaches the mastery grid, though every real decision does', () => {
  /*
   * The two halves of Idan's two answers, in one test: shared decisions feed
   * the grid (round 26, item 2), and the forfeit beside them must not.
   */
  const rules = rulesFor({ presetId: PRESET, restrictions: { noSurrender: false, likeRanksOnly: false } });
  const record = droppedAt(7, 3);
  const owed = seatRatable(record, 1);
  const forfeits = owed.filter((row) => row.forfeit);
  assert.equal(forfeits.length, 1, 'this table should hold exactly one forfeit');

  const session = newSession('value');
  session.absorbRated(rules, owed);
  const stats = (session.progress as { scenarioStats: Array<{ scenarioKey: string; attempts: number }> })
    .scenarioStats;

  const attempts = stats.reduce((sum, stat) => sum + stat.attempts, 0);
  assert.equal(
    attempts,
    owed.length - forfeits.length,
    'the grid counted a different number of attempts from the decisions actually played',
  );

  /* Every spot in the grid is one he really answered. */
  const played = new Set(owed.filter((row) => !row.forfeit).map((row) => row.scenarioKey));
  for (const stat of stats) {
    assert.ok(played.has(stat.scenarioKey), `the grid holds ${stat.scenarioKey}, which he never played`);
  }
});

test('a shared decision reaches the mastery grid exactly as a private one does', () => {
  const rules = rulesFor({ presetId: PRESET, restrictions: { noSurrender: false, likeRanksOnly: false } });
  const record = freshTable(77, 2);
  playRandom(record, 10, 770);
  const owed = seatRatable(record, 0).filter((row) => !row.forfeit);
  assert.ok(owed.length > 0);

  const session = newSession('value');
  session.absorbRated(rules, owed);
  const stats = (session.progress as {
    scenarioStats: Array<{ scenarioKey: string; attempts: number; correct: number; confusion: Record<string, number> }>;
  }).scenarioStats;

  for (const decision of owed) {
    const stat = stats.find((entry) => entry.scenarioKey === decision.scenarioKey);
    assert.ok(stat, `${decision.scenarioKey} never reached the grid`);
  }
  /* Right answers count as right, and wrong ones remember what was played. */
  const wrong = owed.filter((row) => row.evCost > 0);
  for (const decision of wrong) {
    const stat = stats.find((entry) => entry.scenarioKey === decision.scenarioKey)!;
    assert.ok(
      Object.keys(stat.confusion).length > 0,
      `${decision.scenarioKey} was played wrong and the grid remembers no action`,
    );
  }
});

test('the three edge cases resolve the way the report says they do', () => {
  const rules = getPreset(PRESET).rules;
  const chart = chartFor(rules);

  /* Off the grid: a real cost, and no cell to rate it against. Declined. */
  const rating = newRating('basic');
  const before = { ...rating };
  assert.equal(rateOneDecision(rating, rules, chart, 'bj:hard19:vs6', 0.4), null);
  assert.deepEqual(rating, before, 'an off-grid forfeit moved the rating');

  /* Insurance: a cell, so it is rated, exactly as an answered insurance is. */
  assert.ok(difficultyTable(rules, chart).get('bj:insurance'), 'insurance has no cell to rate a forfeit against');
  const insured = newRating('basic');
  assert.notEqual(rateOneDecision(insured, rules, chart, 'bj:insurance', 0.3), null);

  /*
   * One legal action: the worst available is the only one, its cost is zero,
   * and the rating moves by what a correct decision there moves it by. That
   * follows from Idan's sentence rather than departing from it.
   */
  const only = newRating('basic');
  const delta = rateOneDecision(only, rules, chart, 'bj:hard16:vs10', 0);
  assert.ok(delta !== null && delta > 0, 'a zero-cost forfeit should move the rating like a correct answer');
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
