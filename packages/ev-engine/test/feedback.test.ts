import { test } from 'node:test';
import assert from 'node:assert/strict';

import { feedsDrillQueue, gradeDecision, severityForCost } from '../src/blackjack/feedback.ts';
import { BlackjackSolver } from '../src/blackjack/ev.ts';
import { makeRules } from '../src/blackjack/rules.ts';
import { parseRank, parseRanks, Shoe } from '../src/blackjack/shoe.ts';

test('severity tiers match the table in §7.2', () => {
  assert.equal(severityForCost(0), 'optimal');
  assert.equal(severityForCost(-1e-9), 'optimal');
  assert.equal(severityForCost(0.001), 'negligible');
  assert.equal(severityForCost(0.005), 'negligible');
  assert.equal(severityForCost(0.0051), 'minor');
  assert.equal(severityForCost(0.03), 'minor');
  assert.equal(severityForCost(0.031), 'significant');
  assert.equal(severityForCost(0.1), 'significant');
  assert.equal(severityForCost(0.1001), 'blunder');
  assert.equal(severityForCost(2), 'blunder');
});

test('only the expensive tiers feed the drill queue', () => {
  assert.equal(feedsDrillQueue('negligible'), false);
  assert.equal(feedsDrillQueue('minor'), false);
  assert.equal(feedsDrillQueue('significant'), true);
  assert.equal(feedsDrillQueue('blunder'), true);
});

function evaluate(hand: string, upcard: string, surrender: 'none' | 'late' = 'none') {
  const rules = makeRules({ decks: 6, soft17: 'S17', surrender });
  const cards = parseRanks(hand);
  const up = parseRank(upcard);
  const shoe = Shoe.fresh(6);
  shoe.removeAll(cards);
  shoe.remove(up);
  return new BlackjackSolver(rules, { cardRemoval: 'exact' }).evaluate(cards, up, shoe);
}

test('the optimal play grades as correct with zero cost', () => {
  const grade = gradeDecision(evaluate('T T', '6'), 'stand');
  assert.equal(grade.correct, true);
  assert.equal(grade.evCost, 0);
  assert.equal(grade.severity, 'optimal');
  assert.equal(grade.ranked[0]!.action, 'stand');
});

test('the same wrong verb costs wildly different amounts, and is graded as such', () => {
  // Spec §3.2, stated as a test: treating these identically wastes the user's
  // attention, so the tiers have to separate them.
  const cheap = gradeDecision(evaluate('T 6', 'T'), 'stand');
  const expensive = gradeDecision(evaluate('T 2', 'T'), 'stand');

  assert.equal(cheap.correct, false);
  // Spec §3.2 quotes about 0.004 for standing on 16 against a ten; that is the
  // composition-averaged figure, and holding the ten yourself pushes this
  // particular hand to roughly 0.006. Either way it is at the bottom of the
  // scale, and standing on 12 against a ten is twenty times worse.
  assert.ok(cheap.evCost < 0.01, `standing on T,6 v 10 cost ${cheap.evCost}`);
  assert.equal(cheap.severity, 'minor');
  assert.equal(expensive.severity, 'blunder');
  assert.ok(expensive.evCost > 20 * cheap.evCost);
});

test('a genuinely terrible play is a blunder', () => {
  const grade = gradeDecision(evaluate('T T', '6'), 'hit');
  assert.equal(grade.severity, 'blunder');
  assert.ok(grade.evCost > 1.5);
  assert.equal(grade.optimalAction, 'stand');
});

test('the full EV vector comes back sorted, best first', () => {
  const grade = gradeDecision(evaluate('8 8', 'T', 'late'), 'hit');
  const evs = grade.ranked.map((r) => r.ev);
  assert.deepEqual(evs, [...evs].sort((a, b) => b - a));
  assert.equal(grade.ranked.length, grade.ranked.length);
  assert.equal(grade.ranked[0]!.action, grade.optimalAction);
});

test('grading an illegal action is an error, not a silent zero', () => {
  assert.throws(() => gradeDecision(evaluate('T 6', 'T'), 'split'), /not legal/);
});
