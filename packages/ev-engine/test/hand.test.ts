import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addCard, handValue, isBlackjack, isPair } from '../src/blackjack/hand.ts';
import { parseRanks } from '../src/blackjack/shoe.ts';

const value = (text: string) => handValue(parseRanks(text));

test('hard totals', () => {
  assert.deepEqual(value('T 6'), { total: 16, soft: false });
  assert.deepEqual(value('5 6'), { total: 11, soft: false });
  assert.deepEqual(value('T 6 9'), { total: 25, soft: false });
});

test('soft totals demote an ace only once busted', () => {
  assert.deepEqual(value('A 7'), { total: 18, soft: true });
  assert.deepEqual(value('A 7 5'), { total: 13, soft: false });
  assert.deepEqual(value('A T'), { total: 21, soft: true });
});

test('a hand with several aces keeps exactly one of them high', () => {
  // This is where a real bug lived: a second ace joining a soft hand must come
  // in as a one and leave the hand soft, not silently harden it.
  assert.deepEqual(value('A A'), { total: 12, soft: true });
  assert.deepEqual(value('A A A'), { total: 13, soft: true });
  assert.deepEqual(value('A A 9'), { total: 21, soft: true });
  assert.deepEqual(value('A 6 A'), { total: 18, soft: true });
  assert.deepEqual(value('A T A'), { total: 12, soft: false });
  assert.deepEqual(value('A A A A A A A A A A A'), { total: 21, soft: true });
});

test('addCard agrees with handValue on every reachable hand up to five cards', () => {
  // Exhaustive over ordered draws, because the two functions are used
  // interchangeably by the solver and any divergence is a silent EV error.
  const walk = (cards: number[]) => {
    if (cards.length >= 5) return;
    for (let r = 0; r < 10; r++) {
      const next = [...cards, r];
      const expected = handValue(next);
      const start = handValue(cards);
      const got = addCard(start.total, start.soft, r);
      assert.deepEqual(
        got,
        expected,
        `addCard disagreed on [${next.join(',')}]: ${JSON.stringify(got)} vs ${JSON.stringify(expected)}`,
      );
      if (expected.total <= 21) walk(next);
    }
  };
  walk([]);
});

test('naturals and pairs', () => {
  assert.equal(isBlackjack(parseRanks('A K')), true);
  assert.equal(isBlackjack(parseRanks('A T')), true);
  assert.equal(isBlackjack(parseRanks('A 9 A')), false, 'three cards is never a natural');
  assert.equal(isBlackjack(parseRanks('T T')), false);

  assert.equal(isPair(parseRanks('8 8')), true);
  assert.equal(isPair(parseRanks('K Q')), true, 'ten-values pair for splitting purposes');
  assert.equal(isPair(parseRanks('8 8 8')), false);
});
