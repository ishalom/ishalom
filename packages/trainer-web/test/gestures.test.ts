/**
 * The gestures (round 20; spec B as approved).
 *
 * Idan asked for something when a player improves, "like giving chips". What he
 * gets is evidence, and the standard for evidence is that it can be checked — so
 * this file checks it:
 *
 *   - the rule each gesture fires on, exhaustively, and the rules it stays quiet
 *     on, which is most of the time;
 *   - the budget: one a hand, two a sitting, and the fiftieth no louder than the
 *     first;
 *   - **that a gesture cannot reach a score**, proved the way the level and the
 *     analyser were proved — by what the file can see, not by assertion;
 *   - the one that fires at settlement never firing on a won hand, over hundreds
 *     of hands;
 *   - the streak's record saved and merged by the larger, and the live run not;
 *   - and §16: nothing in any of it mentions money, and none of it moves.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalogue } from '../src/i18n.ts';
import { TrainerSession } from '../src/session.ts';
import {
  IMPROVED_RUN,
  MASTERY,
  PER_SITTING,
  RECORD_FLOOR,
  gestureForDecision,
  gestureForSettlement,
  mastered,
  masteryState,
  sittingSummary,
} from '../src/gestures.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (...parts: string[]) => readFileSync(join(HERE, '..', ...parts), 'utf8');

const spot = (over: Partial<{ attempts: number; correct: number; consecutiveCorrect: number; confusion: Record<string, number> }> = {}) => ({
  attempts: 8,
  correct: 6,
  consecutiveCorrect: IMPROVED_RUN,
  confusion: { stand: 2 },
  ...over,
});
const quiet = { sitting: 0, thisHand: false };
const noStreak = { current: 3, record: 0, announcedThisRun: false };

// --- "You used to get this wrong" ---------------------------------------------------------

test('it fires on the fifth in a row, with mistakes behind it, and names what he played', () => {
  const gesture = gestureForDecision({ correct: true, stat: spot(), streak: noStreak, shown: quiet });
  assert.deepEqual(gesture, { kind: 'improved', run: 5, wrongs: 2, played: 'stand', playedCount: 2 });
});

test('and stays quiet on the fourth, the sixth, and a spot never got wrong', () => {
  const cases: Array<[string, ReturnType<typeof spot>]> = [
    ['the fourth in a row', spot({ consecutiveCorrect: 4 })],
    ['the sixth, which would be the same sentence twice', spot({ consecutiveCorrect: 6 })],
    ['a spot with one mistake behind it', spot({ attempts: 6, correct: 5, confusion: { hit: 1 } })],
    ['a spot never got wrong', spot({ attempts: 5, correct: 5, confusion: {} })],
  ];
  for (const [what, stat] of cases) {
    assert.equal(
      gestureForDecision({ correct: true, stat, streak: noStreak, shown: quiet }),
      null,
      `it fired on ${what}`,
    );
  }
});

test('a wrong decision earns nothing, whatever else is true', () => {
  assert.equal(gestureForDecision({ correct: false, stat: spot(), streak: noStreak, shown: quiet }), null);
});

test('the mistake it names is the one he made most often', () => {
  const gesture = gestureForDecision({
    correct: true,
    stat: spot({ attempts: 10, correct: 6, confusion: { stand: 1, hit: 3 } }),
    streak: noStreak,
    shown: quiet,
  }) as { played: string; playedCount: number };
  assert.equal(gesture.played, 'hit');
  assert.equal(gesture.playedCount, 3);
});

// --- The record on the streak -------------------------------------------------------------

test('a new best is marked once, and only above the floor', () => {
  const beat = (current: number, record: number, announced = false) =>
    gestureForDecision({
      correct: true,
      stat: spot({ consecutiveCorrect: 2 }),
      streak: { current, record, announcedThisRun: announced },
      shown: quiet,
    });
  assert.deepEqual(beat(9, 8), { kind: 'record', streak: 9, previous: 8 });
  // The same run, already announced: silence.
  assert.equal(beat(10, 8, true), null);
  // A first-ever run of two is not a record worth a sentence.
  assert.equal(beat(2, RECORD_FLOOR - 4), null);
  // And a run that has not passed the record yet is not one either.
  assert.equal(beat(8, 8), null);
});

test('"you used to get this wrong" outranks the record when both are true', () => {
  const gesture = gestureForDecision({
    correct: true,
    stat: spot(),
    streak: { current: 12, record: 11, announcedThisRun: false },
    shown: quiet,
  }) as { kind: string };
  assert.equal(gesture.kind, 'improved');
});

// --- The budget ---------------------------------------------------------------------------

test('one a hand, two a sitting, and then nothing', () => {
  assert.equal(
    gestureForDecision({ correct: true, stat: spot(), streak: noStreak, shown: { sitting: 0, thisHand: true } }),
    null,
    'a second gesture in one hand',
  );
  assert.equal(
    gestureForDecision({ correct: true, stat: spot(), streak: noStreak, shown: { sitting: PER_SITTING, thisHand: false } }),
    null,
    'a third gesture in one sitting',
  );
});

// --- Played right and lost ------------------------------------------------------------------

test('the hand played perfectly and lost, and nothing else', () => {
  const shown = { sitting: 0, thisHand: false, rightAndLostThisSitting: false };
  assert.deepEqual(
    gestureForSettlement({ net: -1, decisions: 2, allOptimal: true, shown }),
    { kind: 'rightAndLost', decisions: 2 },
  );
  // A won hand can never produce it — which is what makes it allowed at all.
  assert.equal(gestureForSettlement({ net: 1.5, decisions: 2, allOptimal: true, shown }), null);
  assert.equal(gestureForSettlement({ net: 0, decisions: 2, allOptimal: true, shown }), null);
  // Nor a hand that lost after a mistake, which is not the lesson.
  assert.equal(gestureForSettlement({ net: -1, decisions: 2, allOptimal: false, shown }), null);
  // Nor a hand with nothing decided in it: a natural teaches nothing here.
  assert.equal(gestureForSettlement({ net: -1, decisions: 0, allOptimal: true, shown }), null);
  // Once a sitting.
  assert.equal(
    gestureForSettlement({ net: -1, decisions: 2, allOptimal: true, shown: { ...shown, rightAndLostThisSitting: true } }),
    null,
  );
});

// --- Mastery ------------------------------------------------------------------------------

test('five played, four right, and the last two right', () => {
  assert.equal(mastered({ attempts: 5, correct: 4, consecutiveCorrect: 2, confusion: {} }), true);
  assert.equal(mastered({ attempts: 4, correct: 4, consecutiveCorrect: 4, confusion: {} }), false, 'four attempts');
  assert.equal(mastered({ attempts: 6, correct: 3, consecutiveCorrect: 3, confusion: {} }), false, 'three right');
  assert.equal(mastered({ attempts: 9, correct: 8, consecutiveCorrect: 1, confusion: {} }), false, 'one in a row');
  assert.equal(mastered(null), false);
  assert.equal(MASTERY.attempts, 5);
  assert.equal(masteryState(null), 'none');
  assert.equal(masteryState({ attempts: 0, correct: 0, consecutiveCorrect: 0, confusion: {} }), 'none');
  assert.equal(masteryState({ attempts: 2, correct: 1, consecutiveCorrect: 1, confusion: {} }), 'met');
  assert.equal(masteryState({ attempts: 5, correct: 5, consecutiveCorrect: 5, confusion: {} }), 'mastered');
});

// --- The sentence that ends a sitting --------------------------------------------------------

test('nothing is said about a sitting too short to have a lesson in it', () => {
  assert.equal(sittingSummary({ decisions: 9, mistakes: 3, spots: [] }), null);
});

test('the leak is the spot that cost the most, and one mistake is not a leak', () => {
  // The spots handed in are the *sitting's*, never the lifetime record: a line
  // that says "3 wrong" and then "5 times" contradicts itself on one screen.
  const summary = sittingSummary({
    decisions: 40,
    mistakes: 5,
    spots: [
      { scenarioKey: 'bj:hard12:vs4', attempts: 6, correct: 3, evCostTotal: 0.4 },
      { scenarioKey: 'bj:hard16:vs10', attempts: 4, correct: 3, evCostTotal: 0.9 }, // one mistake
      { scenarioKey: 'bj:soft18:vs9', attempts: 5, correct: 3, evCostTotal: 0.2 },
    ],
  });
  assert.equal(summary?.leak, 'bj:hard12:vs4');
  assert.equal(summary?.leakCount, 3);
});

// --- What a gesture may not reach -------------------------------------------------------------

test('a gesture cannot touch a grade, an EV or a rating — by what the file can see', () => {
  const code = source('src', 'gestures.ts');
  /*
   * The same proof the level and the analyser carry: not "it does not", but "it
   * could not". `gestures.ts` imports nothing at all, so there is no session, no
   * chart, no rating and no table within its reach, and no amount of editing
   * inside it can change a figure anywhere else.
   */
  assert.equal([...code.matchAll(/^import\b/gm)].length, 0, 'gestures.ts imports something');
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  /*
   * It does take one cost — `evCostTotal`, to rank which spot leaked the most —
   * and that is data handed to it, not machinery it can reach. What it must not
   * name is anything that keeps a score.
   */
  for (const forbidden of ['rating', 'chart', 'netUnits', 'accuracy', 'severity']) {
    assert.ok(!stripped.includes(forbidden), `gestures.ts mentions ${forbidden}`);
  }
  assert.ok(!/evCost/.test(stripped), 'gestures.ts reads a decision’s cost, not a spot’s total');
  /*
   * And the session asks for each of them in a countable number of places.
   *
   * A decision is asked about **twice** since round 27, and the second is the
   * whole of that round's first item: a decision made at a *shared* table can
   * earn the improvement gesture, and it has to be asked the same question with
   * the same rule — round 20's `=== IMPROVED_RUN` is not loosened — so the
   * answer can be owed and paid at a private settlement later. It was one place
   * until there were two tables; a third would want explaining.
   *
   * A settlement is still asked about once. There is only one place a hand
   * settles in this class.
   */
  const session = source('src', 'session.ts');
  assert.equal(
    [...session.matchAll(/gestureForDecision\(/g)].length,
    2,
    'the session asks about a decision somewhere new — one for a private decision, one for an owed shared one',
  );
  assert.equal([...session.matchAll(/gestureForSettlement\(/g)].length, 1);
});

test('§16: the gestures name no money, and none of them moves', () => {
  for (const locale of ['en', 'he'] as const) {
    const messages = catalogue(locale);
    const ours = Object.entries(messages).filter(([key]) =>
      key.startsWith('gest.') || key.startsWith('records.') || key.startsWith('sitting.') || key.startsWith('mastery.'),
    );
    assert.ok(ours.length >= 10, `${locale}: the gesture strings are missing`);
    for (const [key, value] of ours) {
      for (const money of ['chip', 'ציפ', 'unit', 'יחיד', 'stack', 'קופה', '₪', '$']) {
        assert.ok(!value.toLowerCase().includes(money), `${locale} ${key} mentions money: ${value}`);
      }
    }
  }
  const css = source('public', 'styles.css');
  for (const selector of ['.gesture', '.records', '.sitting']) {
    const rule = css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)));
    assert.ok(!/animation|transition|transform/.test(rule), `${selector} moves`);
  }
});

// --- Played for real --------------------------------------------------------------------------

function playOut(session: TrainerSession, hands: number) {
  const seen: Array<{ gesture: any; net: number | null }> = [];
  for (let hand = 0; hand < hands; hand++) {
    session.deal();
    let view = session.view as any;
    if (view.phase === 'insurance') {
      session.insurance(false);
      view = session.view as any;
    }
    let guard = 0;
    while (view.phase === 'player' && guard++ < 10) {
      // Play it properly: the point is the hands that lose anyway.
      const best = (session.view as any).coach?.optimalAction ?? 'stand';
      session.act(best as never);
      view = session.view as any;
      if (view.feedback?.gesture) seen.push({ gesture: view.feedback.gesture, net: null });
    }
    const settled = session.view as any;
    if (settled.settlementGesture) {
      seen.push({ gesture: settled.settlementGesture, net: settled.stack.lastNet });
    }
  }
  return seen;
}

test('over a long sitting: never on a won hand, and never more than the budget', () => {
  const session = new TrainerSession('vegas-strip-6d-s17', 424242);
  const seen = playOut(session, 60);
  for (const { gesture, net } of seen) {
    if (gesture.kind === 'rightAndLost') {
      assert.ok(net !== null && net < 0, `the losing-hand gesture fired on a hand that paid ${net}`);
    }
  }
  assert.ok(seen.length <= PER_SITTING, `${seen.length} gestures in one sitting`);
  assert.ok(
    seen.filter((s) => s.gesture.kind === 'rightAndLost').length <= 1,
    'the losing-hand gesture fired more than once in a sitting',
  );
});

test('the record is kept, merged by the larger, and the run is not', () => {
  const session = new TrainerSession('vegas-strip-6d-s17', 77);
  playOut(session, 30);
  const saved = session.progress as { records?: { streakBest: number } };
  assert.ok((saved.records?.streakBest ?? 0) > 0, 'no record was kept');

  // Another device, further along on the streak and nowhere else.
  const other = new TrainerSession('vegas-strip-6d-s17', 5);
  other.restore(session.progress);
  other.absorbRecords({ streakBest: 999 });
  assert.equal((other.progress as any).records.streakBest, 999);
  // Never downwards: a device with a shorter record takes nothing away.
  other.absorbRecords({ streakBest: 3 });
  assert.equal((other.progress as any).records.streakBest, 999);
  // And the live run starts from nothing whatever the record says.
  other.deal();
  assert.equal((other.view as any).feedback, null);
});

test('the records line counts the chart’s own cells, and starts empty', () => {
  const fresh = new TrainerSession('vegas-strip-6d-s17', 9).view as any;
  assert.equal(fresh.records.streak, 0);
  assert.equal(fresh.records.mastered, 0);
  assert.equal(fresh.records.cells, 311, 'the grid is not the chart plus insurance');
  assert.deepEqual(fresh.mastery, {});
  assert.equal(fresh.sitting, null);

  const played = new TrainerSession('vegas-strip-6d-s17', 31);
  playOut(played, 30);
  const view = played.view as any;
  assert.ok(Object.keys(view.mastery).length > 0, 'nothing was met in thirty hands');
  for (const state of Object.values(view.mastery)) {
    assert.ok(state === 'met' || state === 'mastered', `a cell is "${state}"`);
  }
  assert.equal(view.records.decisions, view.stats.decisions);
  assert.ok(view.sitting === null || view.sitting.decisions >= 10);
});

// --- On the page --------------------------------------------------------------------------

test('the gesture is the last line on the card, after everything the hand had to say', () => {
  const js = source('public', 'app.js');
  const card = js.slice(js.indexOf('function renderQuickCard('), js.indexOf('function gestureLine('));
  const at = (needle: string) => card.indexOf(needle);
  assert.ok(at('window.EVReturns.block(') > 0, 'the card lost its block');
  assert.ok(at('gestureLine(') > at('window.EVReturns.block('), 'the gesture is above the rows');
  /*
   * Round 21: above the two lines that comment on the rows, and still below the
   * rows themselves. Round 17's ordering rule decides what may be cut; within
   * what follows it, the rarest and the most wanted line goes first.
   */
  assert.ok(at('gestureLine(') < at("className = 'did'"), 'the gesture is below the line about the choice');
  assert.ok(at('gestureLine(') < at("className = 'milestone'"), 'the gesture is below the milestone');
  // It is drawn from the graded decision or the settlement, and from nothing else.
  assert.match(card, /gestureLine\(feedback\.gesture \|\| view\.settlementGesture\)/);
});

test('home has a records line and a sitting line, and the chart has two modes', () => {
  const home = source('public', 'home.html');
  assert.ok(home.includes('id="records"'), 'no records line on home');
  assert.ok(home.includes('id="sitting"'), 'no sitting line on home');
  const table = source('public', 'table.html');
  assert.ok(table.includes('id="chart-modes"'), 'the chart has no mode control');
  assert.ok(table.includes('id="mastery-legend"'), 'the grid has no legend');

  const js = source('public', 'home.js');
  const records = js.slice(js.indexOf('function renderRecords('), js.indexOf('function renderSitting('));
  // §16 again, this time in the code: the line is counts, never chips.
  for (const forbidden of ['chips', 'stack', 'netUnits', 'units(view.stats.netUnits']) {
    assert.ok(!records.includes(forbidden), `the records line reads ${forbidden}`);
  }
});

test('the sitting’s leak is counted in the sitting, not in a lifetime', () => {
  const session = new TrainerSession('vegas-strip-6d-s17', 606);
  // A record with plenty of history behind every spot, as a real player has.
  session.restore({
    version: 5,
    name: 'Dana',
    hands: 80,
    decisions: 120,
    correct: 90,
    evLost: 3,
    netUnits: 0,
    closeCalls: 0,
    closeCallsCorrect: 0,
    lifetimeDecisions: 400,
    bySeverity: { optimal: 90, negligible: 5, minor: 15, significant: 7, blunder: 3 },
    mode: 'basic',
    ratings: {
      basic: { mode: 'basic', rating: 1400, peak: 1400, ratedDecisions: 120, provisional: false, sessionDelta: 0 },
      recall: { mode: 'recall', rating: 1200, peak: 1200, ratedDecisions: 0, provisional: true, sessionDelta: 0 },
      value: { mode: 'value', rating: 1200, peak: 1200, ratedDecisions: 0, provisional: true, sessionDelta: 0 },
    },
    scenarioStats: [
      { scenarioKey: 'bj:hard16:vs10', attempts: 40, correct: 10, consecutiveCorrect: 0, evCostTotal: 9, confusion: { stand: 30 }, lastAttemptAt: 1 },
    ],
    history: [],
    chips: { stack: 200, bet: 1, lastBet: 1, limits: { min: 1, max: 100 } },
  } as never);
  playOut(session, 30);
  const sitting = (session.view as any).sitting;
  if (!sitting || !sitting.leak) return; // a clean sitting has no leak to name
  assert.ok(
    sitting.leakCount <= sitting.mistakes,
    `the leak was played wrong ${sitting.leakCount} times in a sitting with ${sitting.mistakes} mistakes in it`,
  );
});
