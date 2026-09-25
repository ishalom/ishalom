/**
 * The latency budget from spec §13: decision-to-feedback under 100 ms typical.
 *
 * Timing tests are noisy, so these are deliberately loose — they exist to catch
 * an algorithmic regression (a memo key that stops matching, a recursion that
 * stops terminating early), not to police milliseconds. The thresholds sit well
 * above the measured numbers on ordinary hardware, and they are skipped when
 * `CI_SLOW_MACHINE` says the box cannot be trusted to time anything.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveChart } from '../src/blackjack/chart.ts';
import { BlackjackSolver } from '../src/blackjack/ev.ts';
import { makeRules } from '../src/blackjack/rules.ts';
import { Shoe } from '../src/blackjack/shoe.ts';

const skip = process.env.CI_SLOW_MACHINE ? 'CI_SLOW_MACHINE is set' : false;

/** Hands chosen for cost, not for realism: low resplittable pairs are the worst case. */
const WORST_CASE: Array<[number[], number]> = [
  [[1, 1], 1], // 2,2 vs 2 — resplits into the deepest recursion in the game
  [[2, 2], 1], // 3,3 vs 2
  [[5, 5], 9], // 7,7 vs 10
  [[7, 7], 0], // 8,8 vs A
  [[0, 0], 5], // A,A vs 6
];

function timeEvaluation(solver: BlackjackSolver, cards: number[], upcard: number): number {
  const shoe = Shoe.fresh(solver.rules.decks);
  shoe.removeAll(cards);
  shoe.remove(upcard);
  const started = performance.now();
  solver.evaluate(cards, upcard, shoe);
  return performance.now() - started;
}

test('the worst decisions in the game stay inside the interactive budget', { skip }, () => {
  const solver = new BlackjackSolver(makeRules({ surrender: 'late' }));
  // One warm-up pass: the first call also builds the dealer distribution cache,
  // which a real session pays once at startup rather than per decision.
  for (const [cards, upcard] of WORST_CASE) timeEvaluation(solver, cards, upcard);

  for (const [cards, upcard] of WORST_CASE) {
    const ms = timeEvaluation(solver, cards, upcard);
    assert.ok(ms < 100, `${cards} vs ${upcard} took ${ms.toFixed(1)}ms, over the §13 budget`);
  }
});

test('a cold solver answers its first decision without a stall', { skip }, () => {
  // Cold start matters too: §13 puts the whole app under two seconds.
  const started = performance.now();
  const solver = new BlackjackSolver(makeRules({ surrender: 'late' }));
  timeEvaluation(solver, [7, 7], 9);
  const ms = performance.now() - started;
  assert.ok(ms < 500, `cold first decision took ${ms.toFixed(1)}ms`);
});

test('a whole chart derives fast enough to cache on demand', { skip }, () => {
  // Spec §6.5 budgets a derived chart per rule set. Deriving one in the fast mode
  // has to be quick enough to do when the user switches rules, not a build step.
  const started = performance.now();
  const chart = deriveChart(makeRules({ surrender: 'late' }), { cardRemoval: 'static-dealer' });
  const ms = performance.now() - started;
  assert.equal(chart.cells.size, 311);
  assert.ok(ms < 5000, `chart derivation took ${(ms / 1000).toFixed(1)}s`);
});

test('a repeated decision is served entirely from cache', () => {
  // Measured as cache behaviour rather than as elapsed time: at these sizes the
  // wall clock is noise, but "the second evaluation solved no new dealer states"
  // is exact, and it is the property the latency budget actually rests on.
  const solver = new BlackjackSolver(makeRules());
  timeEvaluation(solver, [7, 7], 9);
  const afterFirst = solver.cacheSize;
  assert.ok(afterFirst > 0, 'the first evaluation should have populated the cache');

  timeEvaluation(solver, [7, 7], 9);
  assert.equal(solver.cacheSize, afterFirst, 'the repeat evaluation solved new states');

  // A different upcard is genuinely new work and should grow the cache.
  timeEvaluation(solver, [7, 7], 5);
  assert.ok(solver.cacheSize > afterFirst);
});
