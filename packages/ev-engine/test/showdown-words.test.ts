/**
 * The two engine facts the round 5 explanations stand on.
 *
 *  - `bestFive`: the five cards highlighted at showdown must be the five that
 *    were scored. Checked against `evaluate7` itself, on thousands of hands.
 *  - `riverOdds`: the percentages and "the dealer beats you only with" must come
 *    from the same 990 holdings the river grade came from. Checked against
 *    `solveRiver`'s own counts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NUM_CARDS, parseCards } from '../src/core/cards.ts';
import { bestFive, evaluateCards } from '../src/poker/best-five.ts';
import { evaluate7 } from '../src/poker/evaluator.ts';
import { categoryOf, FULL_HOUSE, THREE_OF_A_KIND } from '../src/poker/handValue.ts';
import { DEFAULT_BLIND_PAYTABLE } from '../src/uth/rules.ts';
import { solveRiver } from '../src/uth/river.ts';
import { riverOdds } from '../src/uth/river-odds.ts';

function shuffled(seed: number): number[] {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff);
  const deck = [...Array(NUM_CARDS).keys()];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}

test('the best five cards score exactly what the seven scored, on 5,000 hands', () => {
  for (let t = 0; t < 5000; t++) {
    const seven = shuffled(t + 1).slice(0, 7);
    const best = bestFive(seven);
    assert.equal(best.value, evaluate7(seven));
    assert.equal(best.cards.length, 5);
    assert.equal(new Set(best.cards).size, 5, 'a card was used twice');
    for (const card of best.cards) assert.ok(seven.includes(card), 'a card not in the hand');
    assert.equal(evaluateCards(best.cards), best.value, 'the five do not score the hand');
  }
});

test('the round’s example: a full house of 4s and aces, and the dealer’s trips from the board', () => {
  const board = parseCards('4h 4d 4c As Jc');
  const player = bestFive([...parseCards('Ad 9s'), ...board]);
  assert.equal(categoryOf(player.value), FULL_HOUSE);
  assert.deepEqual(
    player.cards.map((c) => '23456789TJQKA'[c >> 2]).sort().join(''),
    ['4', '4', '4', 'A', 'A'].sort().join(''),
  );
  const dealer = bestFive([...parseCards('7h 2s'), ...board]);
  assert.equal(categoryOf(dealer.value), THREE_OF_A_KIND);
});

test('river odds count the same 990 holdings as the river solver', () => {
  for (let t = 0; t < 200; t++) {
    const deck = shuffled(9000 + t);
    const hole = deck.slice(0, 2);
    const board = deck.slice(2, 7);
    const solved = solveRiver(hole, board, DEFAULT_BLIND_PAYTABLE);
    const odds = riverOdds(hole, board);
    assert.equal(odds.wins, solved.wins);
    assert.equal(odds.ties, solved.ties);
    assert.equal(odds.losses, solved.losses);
    assert.equal(odds.holdings, 990);
  }
});

test('the closest beating hands all beat the player, weakest first, at most three', () => {
  for (let t = 0; t < 200; t++) {
    const deck = shuffled(20000 + t);
    const odds = riverOdds(deck.slice(0, 2), deck.slice(2, 7));
    assert.ok(odds.closest.length <= 3);
    assert.equal(odds.closest.length === 0, odds.losses === 0, 'groups exist exactly when losses do');
    let previous = -1;
    let counted = 0;
    for (const group of odds.closest) {
      assert.ok(group.lowest > odds.playerValue, 'a "threat" that does not beat the player');
      assert.ok(group.lowest >= previous, 'not ordered weakest first');
      previous = group.lowest;
      counted += group.count;
    }
    assert.ok(counted <= odds.losses);
  }
});

test('the first threat is the narrowest win the dealer has', () => {
  // A pair of eights on K-9-5-3-2: a pair of nines is the smallest thing that beats it.
  const odds = riverOdds(parseCards('8s 8d'), parseCards('Kc 5h 2d 9s 3c'));
  const first = odds.closest[0]!;
  assert.equal(categoryOf(first.lowest), 1);
  assert.deepEqual(first.ranks, [7]); // nines
});
