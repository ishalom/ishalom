import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bjRankOfCard, parseRank, parseRanks, Shoe, TEN, ACE } from '../src/blackjack/shoe.ts';
import { parseCard } from '../src/core/cards.ts';

test('a fresh shoe has the right composition', () => {
  for (const decks of [1, 2, 4, 6, 8]) {
    const shoe = Shoe.fresh(decks);
    assert.equal(shoe.total, decks * 52);
    assert.equal(shoe.count(ACE), decks * 4);
    assert.equal(shoe.count(TEN), decks * 16, 'T, J, Q and K share one bucket');
    assert.equal(shoe.count(4), decks * 4);
  }
});

test('rank parsing collapses the ten-values', () => {
  for (const t of ['T', 'J', 'Q', 'K', '10']) assert.equal(parseRank(t), TEN);
  assert.equal(parseRank('A'), ACE);
  assert.equal(parseRank('2'), 1);
  assert.equal(parseRank('9'), 8);
  assert.throws(() => parseRank('1'));
  assert.throws(() => parseRank('Z'));
  assert.deepEqual(parseRanks('A, T 7'), [ACE, TEN, 6]);
});

test('full-deck cards map into the right buckets', () => {
  assert.equal(bjRankOfCard(parseCard('As')), ACE);
  assert.equal(bjRankOfCard(parseCard('Kh')), TEN);
  assert.equal(bjRankOfCard(parseCard('Td')), TEN);
  assert.equal(bjRankOfCard(parseCard('2c')), 1);
  assert.equal(bjRankOfCard(parseCard('9s')), 8);
});

test('remove and restore round-trip, including the signature', () => {
  const shoe = Shoe.fresh(6);
  const before = { sig: shoe.sig, total: shoe.total, key: shoe.key() };
  const cards = parseRanks('A T 5 5 5 K');
  shoe.removeAll(cards);
  assert.equal(shoe.total, before.total - cards.length);
  assert.notEqual(shoe.sig, before.sig);
  shoe.restoreAll(cards);
  assert.equal(shoe.sig, before.sig);
  assert.equal(shoe.total, before.total);
  assert.equal(shoe.key(), before.key);
});

test('the signature distinguishes every composition it is asked to', () => {
  // Two shoes with the same card count but different composition must not
  // collide, or the solver's memo tables would return another hand's answer.
  const seen = new Map<number, string>();
  const shoe = Shoe.fresh(6);
  const walk = (depth: number, from: number) => {
    if (depth === 0) {
      const key = shoe.key();
      const prior = seen.get(shoe.sig);
      if (prior !== undefined) assert.equal(prior, key, `signature collision at ${shoe.sig}`);
      else seen.set(shoe.sig, key);
      return;
    }
    for (let r = from; r < 10; r++) {
      shoe.remove(r);
      walk(depth - 1, r);
      shoe.restore(r);
    }
  };
  for (let d = 1; d <= 4; d++) walk(d, 0);
  assert.ok(seen.size > 700, `expected many distinct compositions, saw ${seen.size}`);
});

test('removing a rank that is gone throws rather than going negative', () => {
  const shoe = Shoe.fromCounts([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  shoe.remove(ACE);
  assert.throws(() => shoe.remove(ACE), /none left/);
  assert.equal(shoe.probability(ACE), 0);
});

test('clone is independent of its source', () => {
  const shoe = Shoe.fresh(2);
  const copy = shoe.clone();
  copy.remove(TEN);
  assert.equal(shoe.count(TEN), 32);
  assert.equal(copy.count(TEN), 31);
  assert.notEqual(shoe.sig, copy.sig);
});
