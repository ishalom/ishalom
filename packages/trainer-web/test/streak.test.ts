/**
 * The run of correct decisions.
 *
 * The whole rule has to be statable in one sentence a player can check against
 * the hand log: *the accuracy numerator, run consecutively*. A close call
 * neither extends it nor breaks it, exactly as the accuracy denominator already
 * excludes them — watching a thirty-run die on a hand the accuracy panel says
 * does not count would be indefensible, and letting one extend the run would
 * grow it on coin-flips.
 *
 * The other property under test is what the streak deliberately is not: it does
 * not survive the tab closing. A run that persists stops being an observation
 * and becomes a chain not to break, which is the compulsion §16 keeps out.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TrainerSession, advanceStreak, STREAK_MILESTONES } from '../src/session.ts';

/** Play a set number of hands, deterministically. */
function play(session: TrainerSession, hands: number): void {
  for (let i = 0; i < hands; i++) {
    session.deal();
    let view = session.view as any;
    if (view.phase === 'insurance') {
      session.insurance(false);
      view = session.view as any;
    }
    let guard = 0;
    while (view.phase === 'player' && guard++ < 20) {
      const legal = view.legalActions as string[];
      // A mixture, so the run genuinely breaks and rebuilds rather than
      // climbing forever or never starting.
      const action =
        i % 5 === 0 && legal.includes('hit') ? 'hit'
          : legal.includes('double') ? 'double'
          : 'stand';
      session.act(action as never);
      view = session.view as any;
    }
  }
}

test('a close call is invisible to the run, in both directions', () => {
  for (const current of [0, 1, 7, 99]) {
    assert.equal(advanceStreak(current, { correct: true, closeCall: true }), current);
    assert.equal(advanceStreak(current, { correct: false, closeCall: true }), current);
  }
});

test('anything else either extends the run or ends it', () => {
  assert.equal(advanceStreak(0, { correct: true, closeCall: false }), 1);
  assert.equal(advanceStreak(12, { correct: true, closeCall: false }), 13);
  assert.equal(advanceStreak(12, { correct: false, closeCall: false }), 0);
  assert.equal(advanceStreak(0, { correct: false, closeCall: false }), 0);
});

test('the number on screen is what the hand log says it is', () => {
  /*
   * The check a suspicious player would do by hand: read back the decisions in
   * the order they were made and count the trailing run. If the displayed
   * streak ever disagrees with the record it was built from, the number is
   * decoration rather than a measurement.
   */
  const session = new TrainerSession('vegas-strip-6d-s17', 20260914);
  play(session, 90);

  const view = session.view as any;
  const decisions = [...view.history]
    .reverse() // history is newest-first
    .flatMap((hand: any) => hand.decisions);
  assert.ok(decisions.length > 40, `only ${decisions.length} decisions to check`);

  let expected = 0;
  for (const decision of decisions) {
    expected = advanceStreak(expected, decision);
  }
  assert.equal(
    view.feedback.streak.current,
    expected,
    'the streak on screen disagrees with the hands that produced it',
  );
  assert.ok(view.feedback.streak.best >= view.feedback.streak.current);
});

test('the run does not survive the tab closing', () => {
  const played = new TrainerSession('vegas-strip-6d-s17', 20260915);
  play(played, 40);

  const saved = JSON.stringify(played.progress);
  assert.ok(!saved.includes('streak'), 'the streak was persisted, which it must not be');

  const restored = new TrainerSession('vegas-strip-6d-s17', 3);
  restored.restore(played.progress);
  restored.deal();
  const view = restored.view as any;
  // Nothing has been graded yet in the restored session, so there is no
  // feedback to carry a streak — and the first decision starts from zero.
  assert.equal(view.feedback, null);
});

test('a milestone belongs to one decision and is gone by the next hand', () => {
  // Driven directly, because reaching ten in a row from a real shoe is a matter
  // of luck and this is a statement about the counter, not about the cards.
  let streak = 0;
  const reached: number[] = [];
  for (let i = 0; i < 30; i++) {
    const before = streak;
    streak = advanceStreak(streak, { correct: true, closeCall: false });
    if (streak > before && STREAK_MILESTONES.includes(streak)) reached.push(streak);
  }
  assert.deepEqual(reached, [10, 25]);
  // Each fires exactly once on the way up.
  assert.equal(new Set(reached).size, reached.length);
});

test('the milestones are fixed and published, never random', () => {
  // A variable schedule is the slot-machine mechanism; a fixed one a player can
  // see coming is not. This test exists to make that a decision rather than a
  // detail somebody quietly changes.
  assert.deepEqual([...STREAK_MILESTONES], [10, 25, 50, 100]);
});
