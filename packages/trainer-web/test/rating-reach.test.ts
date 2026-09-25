/**
 * One rule for both ratings (round 11).
 *
 * Blackjack's rating takes the reach limit Ultimate's has had since round 10: a
 * correct answer lifts a rating no higher than 400 above the decision's
 * difficulty; a wrong answer costs what it always did. Held here:
 *
 *   - nobody's stored rating changed when the limit was added — the limit shapes
 *     a movement, and a stored number is never passed through it;
 *   - Blackjack's session moves exactly as the shared rule says, hand by hand;
 *   - the Blackjack trivial ladder stops at about 1300.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INFORMATION_REACH,
  difficultyTable,
  newRating,
  updateRating,
  updateRatingWithReach,
} from '../src/difficulty.ts';
import { chartFor } from '../src/sensitivity.ts';
import { TrainerSession } from '../src/session.ts';
import { loadHosted } from './helpers/hosted-page.ts';

function play(session: TrainerSession, hands: number): void {
  for (let i = 0; i < hands; i++) {
    session.deal();
    let guard = 0;
    while (guard++ < 30) {
      const phase = (session.view as any).phase;
      if (phase === 'insurance') session.insurance(false);
      else if (phase === 'player') session.act(guard === 1 && i % 4 === 0 ? 'hit' : 'stand');
      else break;
    }
  }
}

test('a stored rating reads back to the digit, whatever it is — the limit never touches one on the way in', () => {
  const played = new TrainerSession('vegas-strip-6d-s17', 11);
  play(played, 12);
  const progress = structuredClone(played.progress) as any;
  // Ratings no player could reach under the limit from here, and odd fractions.
  progress.ratings.basic = { ...progress.ratings.basic, rating: 2187.3456, peak: 2199.1, ratedDecisions: 5000 };
  progress.ratings.recall = { ...progress.ratings.recall, rating: 1733.03, peak: 1790, ratedDecisions: 812 };
  progress.ratings.value = { ...progress.ratings.value, rating: 812.5, peak: 1300, ratedDecisions: 64 };

  const reopened = new TrainerSession('vegas-strip-6d-s17', 12);
  reopened.restore(progress);
  const saved = reopened.progress.ratings as any;
  for (const mode of ['basic', 'recall', 'value'] as const) {
    assert.equal(saved[mode].rating, progress.ratings[mode].rating, `${mode} changed on the way in`);
    assert.equal(saved[mode].peak, progress.ratings[mode].peak);
    assert.equal(saved[mode].ratedDecisions, progress.ratings[mode].ratedDecisions);
  }
  assert.equal((reopened.profile as any).rating.rating, 2187.3456);
});

test('on the built page, a saved Blackjack rating opens exactly as it was saved', async () => {
  const played = new TrainerSession('vegas-strip-6d-s17', 13);
  play(played, 8);
  const progress = structuredClone(played.progress) as any;
  progress.ratings.basic = { ...progress.ratings.basic, rating: 2141.25, peak: 2160, ratedDecisions: 3100, provisional: false };
  const page = loadHosted('#home', [
    ['ev:playerName', 'Dana'],
    ['ev:progress', JSON.stringify(progress)],
  ]);
  await page.booted;
  assert.equal((page.session().profile as any).rating.rating, 2141.25);
  page.stopWatching();
});

test('Blackjack moves by the shared rule, decision by decision', () => {
  const rules = (new TrainerSession('vegas-strip-6d-s17', 1) as any).rules;
  const cells = difficultyTable(rules, chartFor(rules));
  const session = new TrainerSession('vegas-strip-6d-s17', 20260915);
  // Start high, where the limit binds on easy decisions.
  const progress = structuredClone(session.progress) as any;
  progress.ratings.basic = { ...newRating('basic'), rating: 1950, peak: 1950, ratedDecisions: 700, provisional: false };
  session.restore(progress);

  const shadow = { ...(session.profile as any).rating };
  delete shadow.lastDelta;
  let bound = 0;
  for (let hand = 0; hand < 150; hand++) {
    session.deal();
    let guard = 0;
    while (guard++ < 30) {
      const view = session.view as any;
      if (view.phase === 'insurance') session.insurance(false);
      else if (view.phase === 'player') session.act('stand');
      else break;
      const record = (session as any).lastRecord;
      const cell = record && cells.get(record.scenarioKey);
      const reported = (session.profile as any).rating.lastDelta;
      if (!record || !cell || reported === null) continue;
      if ((session as any).countedCheck === record) continue;
      (session as any).countedCheck = record;
      const plain = { ...shadow };
      const plainDelta = updateRating(plain, cell.basic, record.severityTier);
      const limitedDelta = updateRatingWithReach(shadow, cell.basic, record.severityTier);
      if (plainDelta !== limitedDelta) bound++;
      assert.equal(reported, limitedDelta);
      assert.equal((session.profile as any).rating.rating, shadow.rating);
    }
  }
  assert.ok(bound > 0, 'the limit never bound in 150 hands from 1950 — the test proves nothing');
});

test('the Blackjack trivial ladder: easy, correct decisions cannot lift the rating past about 1300', (t) => {
  const rules = (new TrainerSession('vegas-strip-6d-s17', 1) as any).rules;
  const easy = [...difficultyTable(rules, chartFor(rules)).values()].map((c) => c.basic).filter((d) => d <= 900);
  assert.ok(easy.length > 10, 'no easy Blackjack cells to climb on');
  const run = (reach: number) => {
    const r = newRating('basic');
    for (let i = 0; i < 5000; i++) updateRatingWithReach(r, easy[i % easy.length]!, 'optimal', reach);
    return r.rating;
  };
  const limited = run(INFORMATION_REACH);
  const plain = run(Infinity);
  t.diagnostic(`after 5000 easy correct Blackjack decisions: ${limited.toFixed(1)} with the limit, ${plain.toFixed(1)} without`);
  assert.ok(limited <= 1300.5, `the Blackjack ladder reached ${limited}`);
  assert.ok(plain > 1450, `the plain update only reached ${plain}`);
});
