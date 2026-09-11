/**
 * Why a rating goes back to 1200.
 *
 * Idan reported that his rating restarts whenever he opens the app somewhere
 * new. Three separate mechanisms were proposed for that; each is reproduced
 * here before anything is changed, because a fix aimed at the wrong one leaves
 * the bug in place and adds a second thing to maintain.
 *
 * The rating is the only number in the product that is earned slowly, so
 * anything that silently resets it is worth this much care.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TrainerSession, type SessionProgress } from '../src/session.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Play enough hands that the rating has genuinely moved off its start. */
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

const ratingOf = (session: TrainerSession) => (session.view as any).rating;

test('H2 — a rating survives a trip through another mode', () => {
  /*
   * Each mode is its own ladder, which is right: a number earned against the
   * costly hands means something different from one earned against the rare
   * ones. But "its own ladder" has to mean the session keeps one rating per
   * mode, not that it throws the old one away on the way past.
   *
   * `docs/elo-difficulty.md` already specifies ratings keyed by
   * (playerId, mode). This is the code catching up with the design.
   */
  const session = new TrainerSession('vegas-strip-6d-s17', 20260918);
  play(session, 60);

  const basic = ratingOf(session);
  assert.equal(basic.mode, 'basic');
  assert.ok(basic.ratedDecisions > 0, 'no rated decisions, so nothing is being tested');
  assert.notEqual(Math.round(basic.rating), 1200, 'the rating never moved off its start');

  session.setMode('recall');
  session.setMode('basic');

  const back = ratingOf(session);
  assert.equal(back.mode, 'basic');
  assert.equal(
    Math.round(back.rating),
    Math.round(basic.rating),
    'going Basic → Recall → Basic lost the Basic rating',
  );
  assert.equal(back.ratedDecisions, basic.ratedDecisions);
  assert.equal(Math.round(back.peak), Math.round(basic.peak));
});

test('H2 — the other mode starts fresh, and stays separate', () => {
  const session = new TrainerSession('vegas-strip-6d-s17', 20260919);
  play(session, 60);
  const basic = ratingOf(session).rating;

  session.setMode('recall');
  assert.equal(Math.round(ratingOf(session).rating), 1200, 'a new ladder should start at 1200');

  play(session, 40);
  const recall = ratingOf(session).rating;

  session.setMode('basic');
  assert.equal(Math.round(ratingOf(session).rating), Math.round(basic), 'basic drifted');
  session.setMode('recall');
  assert.equal(Math.round(ratingOf(session).rating), Math.round(recall), 'recall drifted');
});

test('H3 — a rule change must not make a session look newer than it is', () => {
  /*
   * `restoreMine()` decides between the browser's copy and the stored one by
   * comparing `decisions`. That counter is zeroed by `playerOnly()` on every
   * rule change, while the rating is deliberately kept — so a copy can carry a
   * *newer* rating and a *smaller* count, and lose the comparison to a stale
   * one. The tie-break has to be a number that only ever rises.
   */
  const session = new TrainerSession('vegas-strip-6d-s17', 20260920);
  play(session, 50);

  const before = session.progress;
  assert.ok(before.decisions > 0);

  // What a rule change does: keep the player, drop the session's totals.
  const carried: SessionProgress = {
    ...before,
    hands: 0,
    decisions: 0,
    correct: 0,
    evLost: 0,
    netUnits: 0,
    closeCalls: 0,
    closeCallsCorrect: 0,
    bySeverity: { optimal: 0, negligible: 0, minor: 0, significant: 0, blunder: 0 },
    scenarioStats: [],
    history: [],
  };

  const after = new TrainerSession('vegas-strip-6d-s17', 5);
  after.restore(carried);
  play(after, 10);
  const newer = after.progress;

  // The newer record is unambiguously further along in the only sense that
  // matters — more decisions have been graded in total — but its `decisions`
  // field is smaller, because the rule change reset it.
  assert.ok(
    newer.decisions < before.decisions,
    'the rule change did not reset the counter, so this hypothesis does not apply',
  );
  assert.ok(
    newer.lifetimeDecisions > before.lifetimeDecisions,
    'the lifetime counter did not rise, so the comparison is still unsafe',
  );
});

test('H1 — the record written to the table can be claimed on another device', () => {
  /*
   * CONFIRMED, and fixed elsewhere: identity was a random id in one browser's
   * storage, so the same person on a second device was a second player.
   *
   * The credential itself belongs to the shared record rather than to the saved
   * session — a code proves who you are to the *table*, and the session has no
   * one to prove anything to. `test/identity.test.ts` covers every branch of the
   * decision. What is checked here is the seam: that the record the app writes
   * carries the two fields a returning player is found and recognised by.
   */
  const shell = readFileSync(join(HERE, '..', 'artifact', 'shell.js'), 'utf8');
  const from = shell.indexOf('async function writeRecord');
  assert.ok(from > 0, 'writeRecord is gone from shell.js');
  const body = shell.slice(from, shell.indexOf('\n}\n', from));

  assert.match(body, /nameKey:/, 'the record carries no name to be found by');
  assert.match(body, /pinHash:/, 'the record carries nothing a returning player could prove');
  // And the code itself must never travel or be stored.
  assert.ok(!/code\s*:/.test(body), 'the record appears to carry the code itself');
});

test('a version 1 save restores with its rating in the mode it was earned in', () => {
  /*
   * Version 1 blobs are out there — in browsers and in the shared table — and
   * they hold a single rating plus the mode it belongs to. Losing that on the
   * upgrade would take away the one number in the product that is earned
   * slowly, which is exactly the complaint this round exists to answer.
   *
   * The fixture is a real v1 shape, not one built by the current code, so this
   * keeps working even after `progress` has moved on again.
   */
  const v1 = JSON.parse(
    readFileSync(join(HERE, 'fixtures', 'progress-v1.json'), 'utf8'),
  ) as SessionProgress;

  const session = new TrainerSession('vegas-strip-6d-s17', 11);
  session.restore(v1);

  const view = session.view as any;
  assert.equal(view.rating.mode, 'recall', 'the rating landed on the wrong ladder');
  assert.equal(Math.round(view.rating.rating), 1642);
  assert.equal(Math.round(view.rating.peak), 1655);
  assert.equal(view.rating.ratedDecisions, 341);
  assert.equal(view.rating.provisional, false);

  // The session's own totals come across too.
  assert.equal(view.stats.hands, 412);
  assert.equal(view.stats.decisions, 398);
  assert.equal((session.profile as any).player.name, 'Idan');

  // The other two ladders start clean rather than inheriting a number that was
  // never earned on them.
  session.setMode('basic');
  assert.equal(Math.round((session.view as any).rating.rating), 1200);
  session.setMode('recall');
  assert.equal(Math.round((session.view as any).rating.rating), 1642, 'recall was disturbed');

  // And the lifetime counter is seeded, since v1 had none.
  assert.equal(session.progress.lifetimeDecisions, 398);
});

test('a saved record round-trips all three ladders', () => {
  const session = new TrainerSession('vegas-strip-6d-s17', 20260922);
  play(session, 40);
  session.setMode('value');
  play(session, 40);

  const saved = session.progress;
  // Version 3 since round 4b: version 2's Blackjack fields plus a UTH part,
  // so the ladders round-trip exactly as they did.
  assert.equal(saved.version, 3);
  assert.ok(saved.lifetimeDecisions > 0);

  const restored = new TrainerSession('vegas-strip-6d-s17', 12);
  restored.restore(saved);
  assert.deepEqual(restored.progress.ratings, saved.ratings);
  assert.equal(restored.progress.mode, saved.mode);
  assert.equal(restored.progress.lifetimeDecisions, saved.lifetimeDecisions);
});

test('the lifetime counter never goes backwards, whatever is reset', () => {
  // This is the property the two-copy comparison depends on. `decisions` is
  // zeroed by a rule change; this must not be.
  const session = new TrainerSession('vegas-strip-6d-s17', 20260923);
  play(session, 30);
  const first = session.progress.lifetimeDecisions;
  assert.ok(first > 0);

  session.setMode('recall');
  play(session, 20);
  assert.ok(session.progress.lifetimeDecisions > first, 'a mode change lost the count');

  const carried = session.progress;
  const after = new TrainerSession('vegas-strip-6d-s17', 13);
  after.restore(carried);
  assert.equal(after.progress.lifetimeDecisions, carried.lifetimeDecisions);
  play(after, 5);
  assert.ok(after.progress.lifetimeDecisions > carried.lifetimeDecisions);
});
