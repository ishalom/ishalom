/**
 * Spec §14.1, third bullet: "Hand evaluator verified against an exhaustive
 * enumeration of all C(52,7) = 133,784,560 seven-card hands, checking rank
 * ordering consistency."
 *
 * The evaluator is checked at four levels, each catching what the one above it
 * cannot:
 *
 *   1. Named hands, written out by hand, for every category and every awkward
 *      edge — the wheel, the steel wheel, a deuce in the last kicker slot.
 *   2. The naive best-of-twenty-one reference (`test/helpers/naive-evaluator`),
 *      on a large seeded sample. That reference is itself pinned exhaustively
 *      against the published five-card frequencies, so it is not merely a second
 *      guess.
 *   3. The full C(52,7) enumeration, under `EV_ENGINE_SLOW_TESTS`: every hand
 *      evaluated, categories tallied, and the tally compared against the
 *      published seven-card frequencies. Those nine numbers sum to exactly
 *      133,784,560, and reproducing all nine from 133 million independent
 *      classifications is a very sharp test of the whole thing.
 *   4. The full C(52,7) enumeration compared value-for-value against the naive
 *      reference, under `EV_ENGINE_EXHAUSTIVE_EVALUATOR`. That one takes over an
 *      hour, so it is not part of any routine run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatCards, parseCards, type Card } from '../src/core/cards.ts';
import { evaluate7, evaluateSuitMasks, internals } from '../src/poker/evaluator.ts';
import {
  categoryOf,
  CATEGORY_NAMES,
  describeHandValue,
  FLUSH,
  FOUR_OF_A_KIND,
  FULL_HOUSE,
  HIGH_CARD,
  makeHandValue,
  MAX_HAND_VALUE,
  PAIR,
  significantRanks,
  STRAIGHT,
  STRAIGHT_FLUSH,
  THREE_OF_A_KIND,
  TWO_PAIR,
} from '../src/poker/handValue.ts';
import { naiveEvaluate5, naiveEvaluate7 } from './helpers/naive-evaluator.ts';
import { makeRng } from './helpers/simulate.ts';

const slow = process.env.EV_ENGINE_SLOW_TESTS ? false : 'set EV_ENGINE_SLOW_TESTS=1';
const exhaustive = process.env.EV_ENGINE_EXHAUSTIVE_EVALUATOR
  ? false
  : 'set EV_ENGINE_EXHAUSTIVE_EVALUATOR=1 (takes over an hour)';

/**
 * Published frequencies of each category among all C(52,7) seven-card hands,
 * classified by the best five-card hand they contain. These nine numbers sum to
 * exactly 133,784,560.
 */
const SEVEN_CARD_FREQUENCIES: readonly number[] = [
  23_294_460, // high card
  58_627_800, // pair
  31_433_400, // two pair
  6_461_620, // three of a kind
  6_180_020, // straight
  4_047_644, // flush
  3_473_184, // full house
  224_848, // four of a kind
  41_584, // straight flush
];

/** The same, for all C(52,5) five-card hands. Sums to exactly 2,598,960. */
const FIVE_CARD_FREQUENCIES: readonly number[] = [
  1_302_540, // high card
  1_098_240, // pair
  123_552, // two pair
  54_912, // three of a kind
  10_200, // straight
  5_108, // flush
  3_744, // full house
  624, // four of a kind
  40, // straight flush
];

const C_52_7 = 133_784_560;
const C_52_5 = 2_598_960;

const ev = (text: string) => evaluate7(parseCards(text));

test('the published frequency tables are internally consistent', () => {
  // If these sums are wrong the tables are wrong, and every test below is
  // measuring against fiction.
  assert.equal(SEVEN_CARD_FREQUENCIES.reduce((a, b) => a + b, 0), C_52_7);
  assert.equal(FIVE_CARD_FREQUENCIES.reduce((a, b) => a + b, 0), C_52_5);
});

test('each category is recognised', () => {
  const cases: Array<[string, number, string]> = [
    ['As Ks Qs Js Ts 2c 3d', STRAIGHT_FLUSH, 'royal'],
    ['5s 4s 3s 2s As Kc Qd', STRAIGHT_FLUSH, 'steel wheel'],
    ['Ac Ad Ah As Kc 2d 3h', FOUR_OF_A_KIND, 'quads'],
    ['Ac Ad Ah Kc Kd 2s 3h', FULL_HOUSE, 'full house'],
    ['As Ks 9s 5s 2s Ad Kd', FLUSH, 'flush beats the two pair alongside it'],
    ['Ah Kd Qc Js Th 2c 3d', STRAIGHT, 'broadway'],
    ['5h 4d 3c 2s Ah Kc Qd', STRAIGHT, 'the wheel'],
    ['7c 7d 7h 2s 3c 4d 9h', THREE_OF_A_KIND, 'trips'],
    ['Ac Ad Kc Kd 2s 3h 7c', TWO_PAIR, 'two pair'],
    ['Ac Ad 2s 3h 4c 7d 9h', PAIR, 'pair'],
    ['Ac Kd 9s 7h 5c 3d 2h', HIGH_CARD, 'high card'],
  ];
  for (const [hand, category, why] of cases) {
    assert.equal(
      categoryOf(ev(hand)),
      category,
      `${hand} (${why}) read as ${CATEGORY_NAMES[categoryOf(ev(hand))]}`,
    );
  }
});

test('exact values for hands written out by hand', () => {
  assert.equal(ev('As Ks Qs Js Ts 2c 3d'), makeHandValue(STRAIGHT_FLUSH, 12));
  assert.equal(ev('5s 4s 3s 2s As Kc Qd'), makeHandValue(STRAIGHT_FLUSH, 3), 'five-high');
  assert.equal(ev('Ac Ad Ah As Kc 2d 3h'), makeHandValue(FOUR_OF_A_KIND, 12, 11));
  assert.equal(ev('Ac Ad Ah Kc Kd 2s 3h'), makeHandValue(FULL_HOUSE, 12, 11));
  assert.equal(ev('As Ks 9s 5s 2s Ad Kd'), makeHandValue(FLUSH, 12, 11, 7, 3, 0));
  assert.equal(ev('Ah Kd Qc Js Th 2c 3d'), makeHandValue(STRAIGHT, 12));
  assert.equal(ev('5h 4d 3c 2s Ah Kc Qd'), makeHandValue(STRAIGHT, 3));
  assert.equal(ev('7c 7d 7h 2s 3c 4d 9h'), makeHandValue(THREE_OF_A_KIND, 5, 7, 2));
  assert.equal(ev('Ac Ad Kc Kd 2s 3h 7c'), makeHandValue(TWO_PAIR, 12, 11, 5));
  assert.equal(ev('Ac Ad 2s 3h 4c 7d 9h'), makeHandValue(PAIR, 12, 7, 5, 2));
  assert.equal(ev('Ac Kd 9s 7h 5c 3d 2h'), makeHandValue(HIGH_CARD, 12, 11, 7, 5, 3));
});

test('a deuce in the last slot is not mistaken for an empty slot', () => {
  // Rank 0 is the deuce, so an unused rank slot and a deuce have the same bits.
  // The decomposition has to know how many slots its category uses.
  const flush = ev('As Ks 9s 5s 2s Ad Kd');
  assert.deepEqual(significantRanks(flush), [12, 11, 7, 3, 0]);
  assert.equal(describeHandValue(flush), 'flush (AK952)');

  const wheelStraight = ev('5h 4d 3c 2s Ah Kc Qd');
  assert.deepEqual(significantRanks(wheelStraight), [3]);

  // And the ordering still works: a flush ending in a deuce beats one ending in
  // nothing higher, and loses to the same flush with a trey.
  assert.ok(ev('As Ks 9s 5s 3s Ad Kd') > flush);
});

test('the wheel is the lowest straight, not the highest', () => {
  assert.ok(ev('5h 4d 3c 2s Ah Kc Qd') < ev('6h 5d 4c 3s 2h Kc Qd'));
  assert.ok(ev('5s 4s 3s 2s As Kc Qd') < ev('6s 5s 4s 3s 2s Kc Qd'));
  // An ace-high straight is the highest, and a wheel does not wrap around it.
  assert.ok(ev('Ah Kd Qc Js Th 2c 3d') > ev('5h 4d 3c 2s Ah Kc Qd'));
});

test('categories rank in the right order', () => {
  const ladder = [
    'Ac Kd 9s 7h 5c 3d 2h', // high card
    'Ac Ad 2s 3h 5c 7d 9h', // pair
    'Ac Ad Kc Kd 2s 3h 7c', // two pair
    '7c 7d 7h 2s 3c 5d 9h', // trips
    '5h 4d 3c 2s 6h Kc Qd', // straight
    'As Ks 9s 5s 2s Ad Kd', // flush
    'Ac Ad Ah Kc Kd 2s 3h', // full house
    'Ac Ad Ah As Kc 2d 3h', // quads
    'As Ks Qs Js Ts 2c 3d', // straight flush
  ];
  for (let i = 1; i < ladder.length; i++) {
    assert.ok(
      ev(ladder[i]!) > ev(ladder[i - 1]!),
      `${ladder[i]} (${describeHandValue(ev(ladder[i]!))}) should beat ` +
        `${ladder[i - 1]} (${describeHandValue(ev(ladder[i - 1]!))})`,
    );
  }
});

test('kickers decide hands inside a category', () => {
  assert.ok(ev('Ac Ad Kc 9h 7s 5d 3h') > ev('Ac Ad Qc 9h 7s 5d 3h'), 'pair, first kicker');
  assert.ok(ev('Ac Ad Kc Qh 7s 5d 3h') > ev('Ac Ad Kc Qh 6s 5d 3h'), 'pair, third kicker');
  assert.ok(ev('Ac Ad Kc Kd Qs 5d 3h') > ev('Ac Ad Kc Kd Js 5d 3h'), 'two pair kicker');
  assert.ok(ev('Ac Ad Kc Kd 2s 3h 4c') > ev('Qc Qd Jc Jd 2s 3h 4c'), 'higher two pair');
  assert.ok(ev('Ac Ad Ah Kc Kd 2s 3h') > ev('Kc Kd Kh Ac Ad 2s 3h'), 'full house: trips first');
  assert.ok(ev('Ac Ad Ah As Kc 2d 3h') > ev('Ac Ad Ah As Qc 2d 3h'), 'quads kicker');
});

test('identical hands in different suits tie exactly', () => {
  assert.equal(ev('Ac Kd 9s 7h 5c 3d 2h'), ev('Ah Ks 9d 7c 5h 3s 2d'));
  assert.equal(ev('As Ks Qs Js Ts 2c 3d'), ev('Ah Kh Qh Jh Th 2c 3d'));
});

test('two pair plus a third pair plays the best two', () => {
  // Seven cards can hold three pairs; the smallest is not part of the hand, and
  // the kicker comes from the whole hand, not just the leftovers.
  const value = ev('Ac Ad Kc Kd 5s 5h 9c');
  assert.equal(value, makeHandValue(TWO_PAIR, 12, 11, 7), 'nine kicks, not the five');
});

test('two sets of trips make a full house', () => {
  const value = ev('Ac Ad Ah Kc Kd Kh 2s');
  assert.equal(value, makeHandValue(FULL_HOUSE, 12, 11), 'aces full of kings');
});

test('a flush uses the best five of six or seven suited cards', () => {
  assert.equal(ev('As Ks Qs Js 9s 8s 2c'), makeHandValue(FLUSH, 12, 11, 10, 9, 7));
  assert.equal(ev('As Ks Qs Js 9s 8s 7s'), makeHandValue(FLUSH, 12, 11, 10, 9, 7));
});

test('a straight flush is found inside six or seven suited cards', () => {
  assert.equal(ev('9s 8s 7s 6s 5s 4s 2c'), makeHandValue(STRAIGHT_FLUSH, 7), 'nine-high');
  assert.equal(ev('As Ks 9s 8s 7s 6s 5s'), makeHandValue(STRAIGHT_FLUSH, 7));
});

test('the lookup tables say what they claim to', () => {
  const { straightHigh, topFive, popcount } = internals;

  assert.equal(straightHigh.length, 8192);
  assert.equal(topFive.length, 8192);

  // Broadway, the wheel, and a mask one card short of each.
  const maskOf = (ranks: number[]) => ranks.reduce((m, r) => m | (1 << r), 0);
  assert.equal(straightHigh[maskOf([12, 11, 10, 9, 8])], 12);
  assert.equal(straightHigh[maskOf([12, 3, 2, 1, 0])], 3, 'the wheel is five-high');
  assert.equal(straightHigh[maskOf([12, 11, 10, 9])], -1);
  assert.equal(straightHigh[maskOf([12, 3, 2, 1])], -1);
  assert.equal(straightHigh[maskOf([12, 11, 10, 9, 8, 7, 6])], 12, 'takes the highest run');

  // Independently recompute both tables the slow, obvious way.
  for (let mask = 0; mask < 8192; mask++) {
    const ranks: number[] = [];
    for (let r = 12; r >= 0; r--) if (mask & (1 << r)) ranks.push(r);

    assert.equal(popcount(mask), ranks.length, `popcount(${mask})`);

    let expectedHigh = -1;
    for (const high of ranks) {
      if (high < 4) break;
      if ([0, 1, 2, 3, 4].every((d) => mask & (1 << (high - d)))) {
        expectedHigh = high;
        break;
      }
    }
    if (expectedHigh === -1 && [12, 3, 2, 1, 0].every((r) => mask & (1 << r))) expectedHigh = 3;
    assert.equal(straightHigh[mask], expectedHigh, `straightHigh(${mask})`);

    let expectedPacked = 0;
    ranks.slice(0, 5).forEach((r, i) => {
      expectedPacked |= r << (16 - 4 * i);
    });
    assert.equal(topFive[mask], expectedPacked, `topFive(${mask})`);
  }
});

test('the array and suit-mask entry points agree', () => {
  const rng = makeRng(0x5eed);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let trial = 0; trial < 20_000; trial++) {
    for (let i = 51; i > 44; i--) {
      const j = Math.floor(rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j]!, deck[i]!];
    }
    const hand = deck.slice(45, 52);
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    for (const card of hand) {
      const bit = 1 << Math.floor(card / 4);
      const suit = card % 4;
      if (suit === 0) s0 |= bit;
      else if (suit === 1) s1 |= bit;
      else if (suit === 2) s2 |= bit;
      else s3 |= bit;
    }
    assert.equal(evaluate7(hand), evaluateSuitMasks(s0, s1, s2, s3), formatCards(hand));
  }
});

test('the naive reference reproduces the published five-card frequencies', () => {
  // Everything below leans on this reference, so it is pinned exhaustively over
  // all 2,598,960 five-card hands before it is trusted to judge anything.
  const counts = new Array<number>(9).fill(0);
  const hand: Card[] = [0, 0, 0, 0, 0];
  let total = 0;
  for (let a = 0; a < 52; a++) {
    hand[0] = a;
    for (let b = a + 1; b < 52; b++) {
      hand[1] = b;
      for (let c = b + 1; c < 52; c++) {
        hand[2] = c;
        for (let d = c + 1; d < 52; d++) {
          hand[3] = d;
          for (let e = d + 1; e < 52; e++) {
            hand[4] = e;
            counts[categoryOf(naiveEvaluate5(hand))]!++;
            total++;
          }
        }
      }
    }
  }
  assert.equal(total, C_52_5);
  assert.deepEqual(counts, [...FIVE_CARD_FREQUENCIES]);
});

test('agrees with the naive reference on a large random sample', () => {
  const rng = makeRng(0xc0ffee);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  const trials = 40_000;

  for (let trial = 0; trial < trials; trial++) {
    for (let i = 51; i > 44; i--) {
      const j = Math.floor(rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j]!, deck[i]!];
    }
    const hand = deck.slice(45, 52);
    const fast = evaluate7(hand);
    const slowValue = naiveEvaluate7(hand);
    assert.equal(
      fast,
      slowValue,
      `${formatCards(hand)}: fast ${describeHandValue(fast)}, naive ${describeHandValue(slowValue)}`,
    );
  }
});

test('every value stays inside the documented layout', () => {
  const rng = makeRng(0xd15ea5e);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let trial = 0; trial < 50_000; trial++) {
    for (let i = 51; i > 44; i--) {
      const j = Math.floor(rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j]!, deck[i]!];
    }
    const value = evaluate7(deck.slice(45, 52));
    assert.ok(value >= 0 && value < MAX_HAND_VALUE, `value ${value} out of range`);
    for (const rank of significantRanks(value)) {
      assert.ok(rank >= 0 && rank <= 12, `rank slot ${rank} out of range`);
    }
  }
});

test(
  'exhaustive C(52,7): every hand classified, against the published frequencies',
  { skip: slow },
  () => {
    const counts = new Array<number>(9).fill(0);
    const hand: Card[] = [0, 0, 0, 0, 0, 0, 0];
    let total = 0;
    let min = Infinity;
    let max = -Infinity;

    for (let a = 0; a < 52; a++) {
      hand[0] = a;
      for (let b = a + 1; b < 52; b++) {
        hand[1] = b;
        for (let c = b + 1; c < 52; c++) {
          hand[2] = c;
          for (let d = c + 1; d < 52; d++) {
            hand[3] = d;
            for (let e = d + 1; e < 52; e++) {
              hand[4] = e;
              for (let f = e + 1; f < 52; f++) {
                hand[5] = f;
                for (let g = f + 1; g < 52; g++) {
                  hand[6] = g;
                  const value = evaluate7(hand);
                  counts[value >>> 20]!++;
                  total++;
                  if (value < min) min = value;
                  if (value > max) max = value;
                }
              }
            }
          }
        }
      }
    }

    assert.equal(total, C_52_7, 'the enumeration itself is wrong');
    assert.deepEqual(
      counts,
      [...SEVEN_CARD_FREQUENCIES],
      counts
        .map((n, i) => `${CATEGORY_NAMES[i]}: ${n} vs ${SEVEN_CARD_FREQUENCIES[i]}`)
        .join('\n'),
    );
    assert.ok(min >= 0 && max < MAX_HAND_VALUE);
    assert.equal(categoryOf(min), HIGH_CARD);
    assert.equal(categoryOf(max), STRAIGHT_FLUSH);
  },
);

test(
  'exhaustive C(52,7): value-for-value against the naive reference',
  { skip: exhaustive },
  () => {
    const hand: Card[] = [0, 0, 0, 0, 0, 0, 0];
    let checked = 0;

    for (let a = 0; a < 52; a++) {
      hand[0] = a;
      for (let b = a + 1; b < 52; b++) {
        hand[1] = b;
        for (let c = b + 1; c < 52; c++) {
          hand[2] = c;
          for (let d = c + 1; d < 52; d++) {
            hand[3] = d;
            for (let e = d + 1; e < 52; e++) {
              hand[4] = e;
              for (let f = e + 1; f < 52; f++) {
                hand[5] = f;
                for (let g = f + 1; g < 52; g++) {
                  hand[6] = g;
                  const fast = evaluate7(hand);
                  const slowValue = naiveEvaluate7(hand);
                  if (fast !== slowValue) {
                    assert.fail(
                      `${formatCards(hand)}: fast ${describeHandValue(fast)} (${fast}), ` +
                        `naive ${describeHandValue(slowValue)} (${slowValue})`,
                    );
                  }
                  checked++;
                }
              }
            }
          }
        }
      }
    }
    assert.equal(checked, C_52_7);
  },
);
