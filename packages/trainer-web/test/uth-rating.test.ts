/**
 * The Ultimate rating (round 10).
 *
 * What it must be, held here:
 *
 *   - its own ladder: a player who never had an Ultimate decision rated is not
 *     rated, and nothing about it touches the Blackjack rating;
 *   - Blackjack's machinery: the same update, partial credit and K schedule,
 *     starting at 1200 and provisional until 30 rated decisions;
 *   - a measure of decisions that changes none of them: the grades are the
 *     table's, to the digit, with the rating on;
 *   - too obvious to rate means not rated;
 *   - not climbable cheaply: a run of trivially correct decisions cannot lift it
 *     past about 1300;
 *   - named with its game wherever a rating is named, in both languages.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PREFLOP_TABLE } from '@evtrainer/ev-engine/uth';
import { UthTable } from '@evtrainer/game-engine';

import { expectedScore, kFactor, newRating, scoreFor, updateRating } from '../src/difficulty.ts';
import { catalogue } from '../src/i18n.ts';
import { UTH_INFORMATION_REACH, UTH_RATING, uthDifficulty, uthDifficultyFromLeak, updateUthRating } from '../src/uth-rating.ts';
import { UthSession } from '../src/uth-session.ts';
import { loadHosted } from './helpers/hosted-page.ts';

type Action = { action: string };

const HERE = dirname(fileURLToPath(import.meta.url));

/** Play whole hands through a session: check to the river, then raise 1× — every decision point. */
function playSession(session: UthSession, hands: number): void {
  for (let h = 0; h < hands; h++) {
    let view: any = session.deal();
    while (view.legalActions.length > 0) {
      const legal = view.legalActions.map((a: Action) => a.action);
      view = session.act(legal.includes('check') ? 'check' : 'raise1x');
    }
  }
}

// --- The scale ------------------------------------------------------------------------

test('a decision too obvious for the scale is not rated; the hardest are held at 2200', () => {
  // No leak at all: the best action is so far ahead that nobody plausible misses it.
  assert.equal(uthDifficulty({ raise4x: 3.2, raise3x: 2.4, check: 1.6 }), null);
  assert.equal(uthDifficultyFromLeak(0), null);
  // An exact tie costs nothing whichever is chosen: nothing to rate either.
  assert.equal(uthDifficulty({ raise1x: -1.0, fold: -1.0 }), null);
  // Six hundredths apart — where a plausible player really does slip — is on the scale.
  const close = uthDifficulty({ raise1x: -1.0, fold: -1.06 });
  assert.ok(close !== null && close >= 800 && close <= 2200, `a real decision came out ${close}`);
  assert.equal(uthDifficultyFromLeak(10), 2200);
  // Whole fives, like Blackjack's.
  for (const leak of [0.001, 0.004, 0.02, 0.08]) {
    const d = uthDifficultyFromLeak(leak);
    if (d !== null) assert.equal(d % 5, 0);
  }
});

test('the difficulty only rises with the leak', () => {
  let last = -Infinity;
  for (let leak = 0; leak <= 1; leak += 0.0005) {
    const d = uthDifficultyFromLeak(leak) ?? 0;
    assert.ok(d >= last, `difficulty fell at leak ${leak}`);
    last = d;
  }
});

test('the scale cannot drift: the fitted constants, and every snapshotted decision, as they were fitted', () => {
  /*
   * Written once by `scripts/calibrate-uth-rating.ts --snapshot` right after the
   * fit. If this fails, either the constants were retuned without a refit — which
   * would quietly change what every Ultimate rating means — or the difficulty
   * function changed. Neither may happen by accident.
   */
  const snapshot = JSON.parse(readFileSync(join(HERE, 'fixtures', 'uth-difficulty.json'), 'utf8'));
  assert.deepEqual({ ...UTH_RATING }, snapshot.constants);
  assert.equal(UTH_INFORMATION_REACH, snapshot.reach);
  assert.equal(snapshot.cases.length, 169 + 80);

  const drifted = snapshot.cases.filter((c: any) => uthDifficulty(c.evByAction) !== c.difficulty);
  assert.deepEqual(drifted, []);

  // The pre-flop EVs it was taken on are still the solved table's.
  for (const c of snapshot.cases.filter((c: any) => c.from.startsWith('pre-flop '))) {
    const row = PREFLOP_TABLE[c.from.slice('pre-flop '.length)]!;
    assert.deepEqual(c.evByAction, { raise4x: row.ev4x, raise3x: row.ev3x, check: row.evCheck });
  }
  // And it covers the scale: decisions too obvious to rate, and rated ones.
  const rated = snapshot.cases.filter((c: any) => c.difficulty !== null);
  assert.ok(rated.length > 20 && rated.length < snapshot.cases.length, 'the snapshot does not span the scale');
});

// --- The update -------------------------------------------------------------------------

test('Blackjack’s update exactly, wherever the reach limit does not bind', () => {
  const tiers = ['optimal', 'negligible', 'minor', 'significant', 'blunder'] as const;
  for (const start of [900, 1200, 1500, 1900]) {
    for (const difficulty of [1100, 1500, 1800, 2100]) {
      for (const tier of tiers) {
        for (const rated of [0, 29, 30, 149, 150, 599, 600]) {
          const a = { ...newRating('basic'), rating: start, peak: start, ratedDecisions: rated };
          const b = { ...a };
          const plain = updateRating(a, difficulty, tier);
          if (plain > 0 && start + plain > difficulty + UTH_INFORMATION_REACH) continue;
          const uth = updateUthRating(b, difficulty, tier);
          assert.equal(uth, plain);
          assert.deepEqual(b, a);
        }
      }
    }
  }
  // And that update is the one docs/elo-difficulty.md specifies.
  const r = newRating('basic');
  const expected = kFactor(0) * (scoreFor('optimal') - expectedScore(1200, 1500));
  assert.equal(updateUthRating(r, 1500, 'optimal'), expected);
});

test('starts at 1200, provisional until the 30th rated decision', () => {
  const r = newRating('basic');
  assert.deepEqual([r.rating, r.provisional, r.ratedDecisions], [1200, true, 0]);
  for (let i = 0; i < 29; i++) updateUthRating(r, 1500, 'minor');
  assert.equal(r.provisional, true);
  updateUthRating(r, 1500, 'minor');
  assert.equal(r.provisional, false);
});

test('a wrong answer costs what it always did, however easy the decision', () => {
  for (const start of [1300, 1700, 2100]) {
    const a = { ...newRating('basic'), rating: start, peak: start, ratedDecisions: 200 };
    const b = { ...a };
    assert.equal(updateUthRating(b, 850, 'blunder'), updateRating(a, 850, 'blunder'));
  }
});

test('the trivial ladder: a run of easy, correct decisions cannot lift the rating past about 1300', (t) => {
  // The easiest decisions that are rated at all, 800 to 900, every one answered right.
  const easy = [800, 825, 850, 875, 900];
  const run = (reach: number) => {
    const r = newRating('basic');
    for (let i = 0; i < 5000; i++) updateUthRating(r, easy[i % easy.length]!, 'optimal', reach);
    return r.rating;
  };
  const limited = run(UTH_INFORMATION_REACH);
  const plain = run(Infinity);
  t.diagnostic(`after 5000 easy correct decisions: ${limited.toFixed(1)} with the reach limit, ${plain.toFixed(1)} without`);
  assert.ok(limited <= 1300.5, `the ladder reached ${limited}`);
  // Why the limit exists: without it the same run keeps climbing.
  assert.ok(plain > 1450, `the plain update only reached ${plain}`);
});

// --- On the session -------------------------------------------------------------------

test('the rating reads the grades and changes none of them', () => {
  const session = new UthSession(424242);
  const table = new UthTable({ seed: 424242 });
  playSession(session, 60);
  const graded: Array<[number, string]> = [];
  for (let h = 0; h < 60; h++) {
    table.startHand();
    while (table.legalActions().length > 0) {
      const legal = table.legalActions();
      const record = table.act(legal.includes('check') ? 'check' : 'raise1x');
      graded.push([record.evCost, record.severityTier]);
    }
  }
  const saved = [...session.progress.history].reverse().flatMap((hand) => hand.decisions.map((d) => [d.evCost, d.severityTier]));
  assert.deepEqual(saved, graded.slice(-saved.length));
  const view = session.view as any;
  assert.ok(view.rating.ratedDecisions > 0, 'nothing was rated in sixty hands');
  assert.ok(view.rating.ratedDecisions < session.progress.decisions, 'every decision was rated: nothing was too obvious?');
});

test('a player who never opened Ultimate is not rated there', () => {
  const session = new UthSession(1);
  const rating = (session.view as any).rating;
  assert.equal(rating.ratedDecisions, 0);
  assert.equal(rating.lastDelta, null);
  // A saved part from before round 10 has no rating, and opens unrated too.
  const old = { ...session.progress } as any;
  delete old.rating;
  const reopened = new UthSession(2);
  reopened.restore({ ...old, hands: 40, decisions: 80, lifetimeDecisions: 80 });
  assert.equal((reopened.view as any).rating.ratedDecisions, 0);
  assert.equal((reopened.view as any).rating.rating, 1200);
});

test('the rating is saved and comes back; a save taken mid-hand keeps it as it was dealt', () => {
  const session = new UthSession(77);
  playSession(session, 30);
  const settled = (session.view as any).rating;
  const reopened = new UthSession(78);
  reopened.restore(session.progress);
  const back = (reopened.view as any).rating;
  assert.deepEqual([back.rating, back.ratedDecisions, back.peak], [settled.rating, settled.ratedDecisions, settled.peak]);

  // Mid-hand: the save is the rating as the hand was dealt.
  let view: any = session.deal();
  while (view.legalActions.length > 0 && (session.view as any).rating.ratedDecisions === settled.ratedDecisions) {
    const legal = view.legalActions.map((a: Action) => a.action);
    if (!legal.includes('check')) break;
    view = session.act('check');
  }
  assert.equal(session.progress.rating!.ratedDecisions, settled.ratedDecisions);
});

// --- The words ----------------------------------------------------------------------------

test('every rating the player can read is named with its game, in both languages', () => {
  const offenders: string[] = [];
  for (const code of ['en', 'he'] as const) {
    for (const [key, value] of Object.entries(catalogue(code))) {
      const mentions = code === 'en' ? /\brating\b/i.test(value) : /דירוג/.test(value);
      const named = code === 'en' ? /Blackjack|Ultimate/.test(value) : /בלאק ג׳ק|אולטימייט/.test(value);
      if (mentions && !named) offenders.push(`${code} ${key}: ${value}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('on the built page, playing Ultimate leaves the Blackjack rating exactly where it was, and home names both', async () => {
  const page = loadHosted('#home', [
    ['ev:playerName', 'Dana'],
    ['ev:locale', 'en'],
  ]);
  await page.booted;
  for (let i = 0; i < 8; i++) {
    let view = await page.api('/api/deal');
    let guard = 0;
    while (guard++ < 30) {
      if (view.phase === 'insurance') view = await page.api('/api/insurance', { take: false });
      else if (view.phase === 'player') view = await page.api('/api/act', { action: 'stand' });
      else break;
    }
  }
  const before = (page.session().profile as any).rating;
  for (let i = 0; i < 25; i++) {
    let view = await page.api('/api/uth/deal');
    while (view.legalActions.length > 0) {
      const legal = view.legalActions.map((a: Action) => a.action);
      view = await page.api('/api/uth/act', { action: legal.includes('check') ? 'check' : 'raise1x' });
    }
  }
  assert.deepEqual((page.session().profile as any).rating, before, 'Ultimate moved the Blackjack rating');
  assert.ok((page.uthSession().view as any).rating.ratedDecisions > 0, 'nothing in Ultimate was rated');

  page.go('#table');
  page.go('#home');
  const label = page.document.getElementById('uth-rating-label');
  for (let i = 0; i < 100 && !label.textContent; i++) await new Promise((r) => setTimeout(r, 20));
  assert.match(page.document.getElementById('rating-label').textContent, /Blackjack/);
  assert.match(label.textContent, /Ultimate/);
  page.stopWatching();
});
