/**
 * The dealing shoe.
 *
 * Two things here are load-bearing beyond "deal the next card": the cut card,
 * which must never fall inside a hand, and `unseenComposition`, which is what
 * the EV engine is handed when grading against live composition. If that
 * composition were wrong — the hole card missing, a dealt card still counted —
 * the grades would be subtly wrong in a way nothing else would catch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bjRankOfCard, formatCard, parseCards } from '@evtrainer/ev-engine';
import { makeRng } from '../src/rng.ts';
import { DealingShoe } from '../src/shoe.ts';

const shoeOf = (decks: number, seed = 1, penetration = 0.75) =>
  new DealingShoe(decks, makeRng(seed), penetration);

test('a fresh shoe holds the right cards', () => {
  for (const decks of [1, 2, 4, 6, 8]) {
    const shoe = shoeOf(decks);
    assert.equal(shoe.cardsRemaining, decks * 52);
    assert.equal(shoe.cardsDealt, 0);

    const counts = new Map<number, number>();
    while (shoe.cardsRemaining > 0) {
      const card = shoe.deal();
      counts.set(card, (counts.get(card) ?? 0) + 1);
    }
    assert.equal(counts.size, 52, 'every card should appear');
    for (const [card, count] of counts) {
      assert.equal(count, decks, `${formatCard(card)} appeared ${count} times in ${decks} decks`);
    }
  }
});

test('the cut card comes out at the configured penetration', () => {
  const shoe = shoeOf(6, 1, 0.75);
  assert.equal(shoe.needsShuffle, false);
  while (!shoe.needsShuffle) shoe.deal();
  assert.equal(shoe.cardsDealt, Math.ceil(312 * 0.75));
});

test('shuffling restores the whole shoe', () => {
  const shoe = shoeOf(2);
  for (let i = 0; i < 50; i++) shoe.deal();
  shoe.shuffle();
  assert.equal(shoe.cardsRemaining, 104);
  assert.equal(shoe.cardsDealt, 0);
});

test('running the shoe dry throws rather than dealing nothing', () => {
  const shoe = shoeOf(1);
  for (let i = 0; i < 52; i++) shoe.deal();
  assert.throws(() => shoe.deal(), /exhausted/);
});

test('unseen composition covers the undealt cards plus anything face down', () => {
  const shoe = shoeOf(6);
  const dealt = [shoe.deal(), shoe.deal(), shoe.deal(), shoe.deal()];
  const hole = dealt[3]!;

  // With the hole card still face down, the player cannot see it, so it belongs
  // to the unseen composition even though it is out of the shoe.
  const unseen = shoe.unseenComposition([hole]);
  assert.equal(unseen.total, 312 - 3, 'three cards are visible, the hole card is not');

  const revealed = shoe.unseenComposition([]);
  assert.equal(revealed.total, 312 - 4);
  assert.equal(
    unseen.count(bjRankOfCard(hole)) - revealed.count(bjRankOfCard(hole)),
    1,
    'turning the hole card over moves exactly one card out of the unseen set',
  );
});

test('unseen composition matches the cards actually left', () => {
  const shoe = shoeOf(2, 7);
  const seen: number[] = [];
  for (let i = 0; i < 40; i++) seen.push(shoe.deal());

  const composition = shoe.unseenComposition();
  const expected = new Array<number>(10).fill(0);
  for (let rank = 0; rank < 10; rank++) expected[rank] = rank === 9 ? 2 * 16 : 2 * 4;
  for (const card of seen) expected[bjRankOfCard(card)]! -= 1;

  for (let rank = 0; rank < 10; rank++) {
    assert.equal(composition.count(rank), expected[rank], `rank ${rank}`);
  }
});

test('stacking puts the named cards next without inventing any', () => {
  // Spec §8: Drill mode has to be able to deal a chosen scenario on demand.
  const shoe = shoeOf(6, 3);
  const wanted = parseCards('8s 6d 8h');
  shoe.stack(wanted);
  assert.deepEqual([shoe.deal(), shoe.deal(), shoe.deal()], wanted);
});

test('stacking preserves the rest of the shoe', () => {
  const shoe = shoeOf(1, 5);
  const before = shoe.cardsRemaining;
  shoe.stack(parseCards('As Kd'));
  assert.equal(shoe.cardsRemaining, before, 'stacking moves cards, it does not add them');

  const dealt = new Set<number>();
  while (shoe.cardsRemaining > 0) dealt.add(shoe.deal());
  assert.equal(dealt.size, 52, 'the whole deck is still there');
});

test('stacking a card the shoe no longer holds is an error', () => {
  const shoe = shoeOf(1, 11);
  const all = parseCards('As Ks Qs Js Ts 9s 8s 7s 6s 5s 4s 3s 2s');
  shoe.stack(all);
  for (let i = 0; i < 13; i++) shoe.deal();
  assert.throws(() => shoe.stack(parseCards('As')), /no longer in the shoe/);
});

test('bad configuration is rejected up front', () => {
  assert.throws(() => shoeOf(3), /deck count/);
  assert.throws(() => new DealingShoe(6, makeRng(1), 0), /Penetration/);
  assert.throws(() => new DealingShoe(6, makeRng(1), 1), /Penetration/);
});
