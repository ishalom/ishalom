import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatCard,
  formatCards,
  fullDeck,
  makeCard,
  NUM_CARDS,
  parseCard,
  parseCards,
  rankOf,
  suitOf,
} from '../src/core/cards.ts';

test('a card round-trips through its text form', () => {
  for (let card = 0; card < NUM_CARDS; card++) {
    assert.equal(parseCard(formatCard(card)), card);
  }
});

test('rank and suit decompose the index', () => {
  for (let card = 0; card < NUM_CARDS; card++) {
    assert.equal(makeCard(rankOf(card), suitOf(card)), card);
  }
  assert.equal(formatCard(makeCard(12, 3)), 'As');
  assert.equal(formatCard(makeCard(0, 0)), '2c');
});

test('parsing is forgiving about rank case but not about nonsense', () => {
  assert.equal(parseCard('as'), parseCard('As'));
  assert.equal(parseCard('tH'), parseCard('Th'));
  for (const bad of ['', 'A', 'Axs', '1s', 'Az', '10s']) {
    assert.throws(() => parseCard(bad), `${JSON.stringify(bad)} should not parse`);
  }
});

test('card lists parse from either separator', () => {
  assert.equal(formatCards(parseCards('As Kd 7c')), 'As Kd 7c');
  assert.deepEqual(parseCards('As,Kd, 7c'), parseCards('As Kd 7c'));
  assert.deepEqual(parseCards('   '), []);
});

test('a full deck is 52 distinct cards', () => {
  const deck = fullDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck).size, 52);
});
