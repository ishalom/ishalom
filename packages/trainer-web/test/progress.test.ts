/**
 * A rating is only worth something if it survives closing the tab.
 *
 * It is built one decision at a time over hundreds of hands, and for a while it
 * started again from 1200 on every page load — which made it a score for the
 * last twenty minutes rather than a measure of anyone's play, and put a number
 * on the shared table that meant nothing.
 *
 * These tests hold the save/restore round trip to being exact, and hold the two
 * deliberate exclusions to being deliberate.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TrainerSession } from '../src/session.ts';

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
      session.act((legal.includes('double') ? 'double' : 'stand') as never);
      view = session.view as any;
    }
  }
}

test('a saved session comes back exactly as it went in', () => {
  const played = new TrainerSession('vegas-strip-6d-s17', 20260911);
  played.setPlayerName('Dana');
  play(played, 60);

  const before = played.view as any;
  assert.ok(before.stats.decisions > 20, 'the walk did not produce enough decisions');

  const restored = new TrainerSession('vegas-strip-6d-s17', 999);
  restored.restore(played.progress);
  const after = restored.view as any;

  assert.equal(after.stats.hands, before.stats.hands);
  assert.equal(after.stats.decisions, before.stats.decisions);
  assert.equal(after.stats.accuracy, before.stats.accuracy);
  assert.equal(after.stats.evLostPer100, before.stats.evLostPer100);
  assert.equal(after.stats.netUnits, before.stats.netUnits);
  assert.equal(after.stats.closeCallsExcluded, before.stats.closeCallsExcluded);
  assert.equal(after.rating.rating, before.rating.rating);
  assert.equal(after.rating.peak, before.rating.peak);
  assert.equal(after.rating.ratedDecisions, before.rating.ratedDecisions);
  assert.equal(after.history.length, before.history.length);
  assert.equal((restored.profile as any).player.name, 'Dana');

  // The stack is arithmetic over the restored totals, not a stored figure of
  // its own — if it were stored separately the two could drift apart.
  assert.equal(after.stack.balance, after.stack.start + after.stats.netUnits);
});

test('a restored session starts between hands, holding no table', () => {
  // Restoring mid-hand would put half a split into a freshly shuffled shoe: the
  // same cards, a different hand. The boundary is the only unambiguous one.
  const played = new TrainerSession('vegas-strip-6d-s17', 20260912);
  play(played, 12);

  const restored = new TrainerSession('vegas-strip-6d-s17', 4);
  restored.restore(played.progress);
  const view = restored.view as any;

  assert.equal(view.phase, 'idle');
  assert.deepEqual(view.hands, []);
  assert.equal(view.feedback, null);
  assert.deepEqual(view.legalActions, []);

  // And it deals normally from there.
  restored.deal();
  assert.notEqual((restored.view as any).phase, 'idle');
});

test('the weak-spot record survives, because it is the slowest thing to earn', () => {
  const played = new TrainerSession('vegas-strip-6d-s17', 20260913);
  play(played, 80);
  const before = played.weakSpots as any[];

  const restored = new TrainerSession('vegas-strip-6d-s17', 7);
  restored.restore(played.progress);
  assert.deepEqual(restored.weakSpots, before);
});

test('nonsense is ignored rather than thrown at the player', () => {
  // Storage can hold a half-written value, or one from an older version of this
  // shape. Losing the fields that moved is acceptable; refusing to open is not.
  const session = new TrainerSession('vegas-strip-6d-s17', 5);
  const clean = JSON.stringify(session.view);

  for (const junk of [null, undefined, {}, { version: 99 }, { version: 1 }]) {
    session.restore(junk as never);
  }
  assert.equal(JSON.stringify(session.view), clean);

  // A partial record restores what it has and defaults the rest to zero rather
  // than to NaN, which would spread through every derived figure on screen.
  session.restore({ version: 1, name: 'Yossi', decisions: 'lots' } as never);
  const view = session.view as any;
  assert.equal((session.profile as any).player.name, 'Yossi');
  assert.equal(view.stats.decisions, 0);
  assert.ok(Number.isFinite(view.stack.balance));
});
