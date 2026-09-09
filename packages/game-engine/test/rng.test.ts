/**
 * The seeded generator (spec §11's `dealSeed`, §8's Replay mode).
 *
 * The game engine's only impurity is the shuffle, and seeding it is what buys
 * back everything purity would have given: a hand can be replayed exactly, and a
 * simulation that disagrees with the analytic answer can be re-run to find out
 * why.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeRng, shuffleInPlace } from '../src/rng.ts';

test('the same seed produces the same stream', () => {
  const a = makeRng(4242);
  const b = makeRng(4242);
  for (let i = 0; i < 10_000; i++) assert.equal(a.next(), b.next());
});

test('neighbouring seeds do not produce neighbouring streams', () => {
  // Seeds come from hand ids and session counters, so 1 and 2 are common. A
  // generator seeded naively would start them off nearly in step.
  const a = makeRng(1);
  const b = makeRng(2);
  let agreements = 0;
  for (let i = 0; i < 1000; i++) {
    if (Math.abs(a.next() - b.next()) < 1e-6) agreements++;
  }
  assert.ok(agreements < 5, `streams from adjacent seeds agreed ${agreements} times`);
});

test('every value lands in [0, 1)', () => {
  const rng = makeRng(99);
  for (let i = 0; i < 100_000; i++) {
    const value = rng.next();
    assert.ok(value >= 0 && value < 1, `produced ${value}`);
  }
});

test('nextInt is uniform across a deck-sized bound', () => {
  // Modulus without rejection would favour the low indices, which over millions
  // of shuffles biases which cards reach the front of the shoe.
  const rng = makeRng(0xc0ffee);
  const bound = 52;
  const draws = 5_200_000;
  const counts = new Int32Array(bound);
  for (let i = 0; i < draws; i++) counts[rng.nextInt(bound)]! += 1;

  const expected = draws / bound;
  // Four standard deviations of a binomial, which no honest generator exceeds.
  const tolerance = 4 * Math.sqrt(expected * (1 - 1 / bound));
  for (let i = 0; i < bound; i++) {
    assert.ok(
      Math.abs(counts[i]! - expected) < tolerance,
      `bucket ${i} got ${counts[i]}, expected about ${expected}`,
    );
  }
});

test('nextInt rejects a bound it cannot honour', () => {
  const rng = makeRng(1);
  for (const bound of [0, -1, 1.5, NaN]) {
    assert.throws(() => rng.nextInt(bound), /positive integer/);
  }
  assert.equal(rng.nextInt(1), 0);
});

test('a zero seed still produces a live generator', () => {
  // An all-zero state is a fixed point of xoshiro: it would emit zero forever.
  const rng = makeRng(0);
  const values = new Set<number>();
  for (let i = 0; i < 100; i++) values.add(rng.next());
  assert.ok(values.size > 90, 'a zero seed collapsed the generator');
});

test('the shuffle is a permutation, and it moves things', () => {
  const rng = makeRng(2024);
  for (let round = 0; round < 50; round++) {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    shuffleInPlace(deck, rng);
    assert.equal(new Set(deck).size, 52, 'a card went missing or was duplicated');
    const fixed = deck.filter((card, i) => card === i).length;
    assert.ok(fixed < 12, `${fixed} cards stayed where they started`);
  }
});

test('every position can receive every card', () => {
  // A Fisher-Yates written with the wrong bound leaves the first or last card
  // pinned. Only the first position is sampled here, which is enough to catch it.
  const rng = makeRng(31337);
  const seenFirst = new Set<number>();
  for (let i = 0; i < 5000; i++) {
    const deck = Array.from({ length: 52 }, (_, n) => n);
    shuffleInPlace(deck, rng);
    seenFirst.add(deck[0]!);
  }
  assert.equal(seenFirst.size, 52, 'some card can never be dealt first');
});
