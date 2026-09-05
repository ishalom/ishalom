import { test } from 'node:test';
import assert from 'node:assert/strict';

import { legalActions, type HandContext } from '../src/blackjack/actions.ts';
import { handValue } from '../src/blackjack/hand.ts';
import { makeRules } from '../src/blackjack/rules.ts';
import { parseRanks, type BjRank } from '../src/blackjack/shoe.ts';

function ctx(hand: string, extra: Partial<HandContext> = {}): HandContext {
  const cards: BjRank[] = parseRanks(hand);
  const { total, soft } = handValue(cards);
  return { cards, total, soft, fromSplit: false, handCount: 1, ...extra };
}

test('a fresh two-card hand can do everything the rules allow', () => {
  const rules = makeRules({ double: 'any2', surrender: 'late', das: true });
  assert.deepEqual(legalActions(ctx('8 8'), rules).sort(), [
    'double',
    'hit',
    'split',
    'stand',
    'surrender',
  ]);
});

test('doubling is restricted by starting total, not by hand shape', () => {
  const nineToEleven = makeRules({ double: '9-11' });
  assert.ok(legalActions(ctx('5 6'), nineToEleven).includes('double'));
  assert.ok(legalActions(ctx('4 5'), nineToEleven).includes('double'));
  assert.ok(!legalActions(ctx('5 3'), nineToEleven).includes('double'), 'hard 8 is out of range');
  assert.ok(!legalActions(ctx('A 7'), nineToEleven).includes('double'), 'soft 18 is out of range');

  const tenToEleven = makeRules({ double: '10-11' });
  assert.ok(!legalActions(ctx('4 5'), tenToEleven).includes('double'));
  assert.ok(legalActions(ctx('5 5'), tenToEleven).includes('double'));
});

test('doubling and surrender need an untouched two-card hand', () => {
  const rules = makeRules({ double: 'any2', surrender: 'late' });
  const drawn = legalActions(ctx('5 3 3'), rules);
  assert.ok(!drawn.includes('double'));
  assert.ok(!drawn.includes('surrender'));
});

test('DAS gates doubling after a split, and surrender is gone entirely', () => {
  const withDas = makeRules({ das: true, surrender: 'late' });
  const split = legalActions(ctx('8 3', { fromSplit: true, handCount: 2 }), withDas);
  assert.ok(split.includes('double'));
  assert.ok(!split.includes('surrender'), 'you cannot surrender a hand you have already split');

  const noDas = makeRules({ das: false, surrender: 'late' });
  assert.ok(!legalActions(ctx('8 3', { fromSplit: true, handCount: 2 }), noDas).includes('double'));
});

test('the split limit counts hands, not splits', () => {
  const rules = makeRules({ maxSplitHands: 4 });
  for (const handCount of [1, 2, 3]) {
    assert.ok(legalActions(ctx('8 8', { handCount, fromSplit: handCount > 1 }), rules).includes('split'));
  }
  assert.ok(!legalActions(ctx('8 8', { handCount: 4, fromSplit: true }), rules).includes('split'));

  const twoHands = makeRules({ maxSplitHands: 2 });
  assert.ok(legalActions(ctx('8 8'), twoHands).includes('split'));
  assert.ok(!legalActions(ctx('8 8', { handCount: 2, fromSplit: true }), twoHands).includes('split'));
});

test('split aces get one card and stop', () => {
  const rules = makeRules({ hitSplitAces: false, resplitAces: false, das: true });
  const hand = legalActions(ctx('A 7', { fromSplit: true, handCount: 2 }), rules);
  assert.deepEqual(hand, ['stand'], 'no hit, no double on a split ace');

  const permissive = makeRules({ hitSplitAces: true, das: true });
  const loose = legalActions(ctx('A 7', { fromSplit: true, handCount: 2 }), permissive);
  assert.ok(loose.includes('hit'));
});

test('resplitting aces is its own permission', () => {
  const noRsa = makeRules({ resplitAces: false, maxSplitHands: 4 });
  assert.ok(!legalActions(ctx('A A', { fromSplit: true, handCount: 2 }), noRsa).includes('split'));

  const rsa = makeRules({ resplitAces: true, maxSplitHands: 4 });
  assert.ok(legalActions(ctx('A A', { fromSplit: true, handCount: 2 }), rsa).includes('split'));

  // The first split of a pair of aces is always allowed; only re-splitting them is gated.
  assert.ok(legalActions(ctx('A A'), noRsa).includes('split'));
});

test('ten-values pair for splitting even when the ranks differ', () => {
  assert.ok(legalActions(ctx('K Q'), makeRules()).includes('split'));
});

test('a hand of 21 can only stand', () => {
  assert.deepEqual(legalActions(ctx('7 7 7'), makeRules({ surrender: 'late' })), ['stand']);
});

test('surrender disappears when the house does not offer it', () => {
  assert.ok(!legalActions(ctx('T 6'), makeRules({ surrender: 'none' })).includes('surrender'));
  assert.ok(legalActions(ctx('T 6'), makeRules({ surrender: 'early' })).includes('surrender'));
});
