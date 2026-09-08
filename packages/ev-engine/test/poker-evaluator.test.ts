/**
 * Spec §14.1, third bullet: the hand evaluator, verified against an exhaustive
 * enumeration of all C(52,7) = 133,784,560 seven-card hands, checking rank
 * ordering consistency.
 *
 * The evaluator is checked in three layers, each pinning down something the
 * others cannot:
 *
 *   1. Every one of the 133,784,560 seven-card hands is categorised and the nine
 *      totals are compared against the published frequencies. An off-by-one at
 *      any category boundary moves at least two of those counts, so this is a
 *      sharp test despite being only nine numbers. It runs in the default suite.
 *   2. Every one of the 2,598,960 five-card hands is scored by both the fast
 *      evaluator and a naive independent one, and the two orderings are checked
 *      to be isomorphic: same ties, same comparisons, no exceptions. This is
 *      what validates the kickers, which a category tally cannot see.
 *   3. Every seven-card hand is checked to score as the best of its 21 five-card
 *      subsets. Layer 2 proves the five-card scores right, so this transitively
 *      proves the seven-card path across the whole space.
 *
 * Layers 2 and 3 need EV_ENGINE_SLOW_TESTS=1 (npm run test:slow); layer 3 is the
 * long one at a few minutes. A deterministic sample of both runs by default, so
 * an ordinary npm test still exercises those paths.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCards, type Card } from '../src/core/cards.ts';
import {
  CATEGORY_NAMES,
  categoryOf,
  evaluate,
  FLUSH,
  FOUR_OF_A_KIND,
  FULL_HOUSE,
  HIGH_CARD,
  PAIR,
  STRAIGHT,
  STRAIGHT_FLUSH,
  THREE_OF_A_KIND,
  TWO_PAIR,
} from '../src/poker/evaluator.ts';
import {
  compareReference,
  referenceEvaluate5,
  referenceEvaluate7,
} from './helpers/poker-reference.ts';
import { SEVEN_CARD_FREQUENCIES } from '../src/uth/trips.ts';

const slow = process.env.EV_ENGINE_SLOW_TESTS ? false : 'set EV_ENGINE_SLOW_TESTS=1';

const score = (text: string) => evaluate(parseCards(text));
const category = (text: string) => categoryOf(score(text));

/**
 * Published frequencies of each category among all C(52,7) seven-card hands.
 * They sum to exactly 133,784,560, which is itself a check on the transcription.
 */
const PUBLISHED_SEVEN_CARD_FREQUENCIES: Readonly<Record<number, number>> = {
  [HIGH_CARD]: 23_294_460,
  [PAIR]: 58_627_800,
  [TWO_PAIR]: 31_433_400,
  [THREE_OF_A_KIND]: 6_461_620,
  [STRAIGHT]: 6_180_020,
  [FLUSH]: 4_047_644,
  [FULL_HOUSE]: 3_473_184,
  [FOUR_OF_A_KIND]: 224_848,
  [STRAIGHT_FLUSH]: 41_584,
};

const TOTAL_SEVEN_CARD_HANDS = 133_784_560;

/** Distinct five-card hand values, a long-published property of the game. */
const DISTINCT_FIVE_CARD_VALUES = 7462;

test('the published frequencies used below sum to the size of the space', () => {
  const sum = Object.values(PUBLISHED_SEVEN_CARD_FREQUENCIES).reduce((a, b) => a + b, 0);
  assert.equal(sum, TOTAL_SEVEN_CARD_HANDS);
});

test('each category is recognised', () => {
  assert.equal(category('As Ks Qs Js Ts 2c 3d'), STRAIGHT_FLUSH);
  assert.equal(category('Ac Ad Ah As Kc 2d 3h'), FOUR_OF_A_KIND);
  assert.equal(category('Ac Ad Ah Kc Kd 2s 3h'), FULL_HOUSE);
  assert.equal(category('As Ks Qs 9s 2s 3h 4d'), FLUSH);
  assert.equal(category('Ac Kd Qh Js Tc 2d 3h'), STRAIGHT);
  assert.equal(category('Ac Ad Ah Kc Qd 2s 3h'), THREE_OF_A_KIND);
  assert.equal(category('Ac Ad Kh Ks Jc 9d 8h'), TWO_PAIR);
  assert.equal(category('Ac Ad Kh Qs Jc 9d 8h'), PAIR);
  assert.equal(category('Ac Kd Qh 9s 7c 5d 3h'), HIGH_CARD);
});

test('the categories are ordered the way poker orders them', () => {
  const ascending = [
    'Ac Kd Qh 9s 7c 5d 3h',
    'Ac Ad Kh Qs Jc 9d 8h',
    'Ac Ad Kh Ks Jc 9d 8h',
    'Ac Ad Ah Kc Qd 2s 3h',
    'Ac Kd Qh Js Tc 2d 3h',
    'As Ks Qs 9s 2s 3h 4d',
    'Ac Ad Ah Kc Kd 2s 3h',
    'Ac Ad Ah As Kc 2d 3h',
    'As Ks Qs Js Ts 2c 3d',
  ].map(score);

  for (let i = 1; i < ascending.length; i++) {
    const better = CATEGORY_NAMES[categoryOf(ascending[i]!)];
    const worse = CATEGORY_NAMES[categoryOf(ascending[i - 1]!)];
    assert.ok(ascending[i]! > ascending[i - 1]!, `${better} did not beat ${worse}`);
  }
});

test('the wheel is the lowest straight, and its ace does not play high', () => {
  const wheel = score('5c 4d 3h 2s Ac 9d 8h');
  const sixHigh = score('6c 5d 4h 3s 2c 9d 8h');
  const broadway = score('Ac Kd Qh Js Tc 2d 3h');

  assert.equal(categoryOf(wheel), STRAIGHT);
  assert.ok(wheel < sixHigh, 'a five-high straight is the weakest straight there is');
  assert.ok(wheel < broadway);

  const steelWheel = score('5s 4s 3s 2s As 9h 9d');
  assert.equal(categoryOf(steelWheel), STRAIGHT_FLUSH);
  assert.ok(steelWheel < score('6s 5s 4s 3s 2s 9h 9d'));
});

test('an ace-high gap is not a straight', () => {
  // A,K,Q,J,9 is the classic false positive for a careless straight check.
  assert.equal(category('Ac Kd Qh Js 9c 4d 3h'), HIGH_CARD);
  // Nor does the ace bridge the two ends of the rank order.
  assert.equal(category('Ac Kd Qh 3s 2c 9d 7h'), HIGH_CARD);
});

test('seven cards can make a full house out of two sets', () => {
  const twoSets = score('Ac Ad Ah Kc Kd Ks 2h');
  assert.equal(categoryOf(twoSets), FULL_HOUSE);
  // Aces full of kings, identical to the hand that gets there the ordinary way.
  assert.equal(twoSets, score('Ac Ad Ah Kc Kd 2s 3h'));
});

test('three pairs play as the best two, with the right kicker', () => {
  const threePair = score('Ac Ad Kh Ks 7c 7d 9h');
  assert.equal(categoryOf(threePair), TWO_PAIR);
  // Aces and kings with a nine: the spare sevens do not become the kicker.
  assert.equal(threePair, score('Ac Ad Kh Ks 9h 4c 3d'));
});

test('a six-card flush keeps its five best cards', () => {
  // The deuce of hearts must not displace the seven of hearts.
  const sixHearts = score('Ah Kh Qh 7h 5h 2h 3c');
  assert.equal(categoryOf(sixHearts), FLUSH);
  assert.equal(sixHearts, score('Ah Kh Qh 7h 5h 2c 3c'));
});

test('kickers decide within a category', () => {
  assert.ok(score('Ac Ad Kh Qs Jc 2d 3h') > score('Ac Ad Qh Js 9c 2d 3h'), 'pair kickers');
  assert.ok(score('Ac Ad Kh Ks Qc 2d 3h') > score('Ac Ad Kh Ks Jc 2d 3h'), 'two-pair kicker');
  assert.ok(score('Ac Ad Ah As Kc 2d 3h') > score('Ac Ad Ah As Qc 2d 3h'), 'quads kicker');
  assert.ok(score('Ac Ad Ah Kc Kd 2s 3h') > score('Kc Kd Kh Ac Ad 2s 3h'), 'aces full beats kings full');
});

test('suits never break a tie', () => {
  // Poker has no suit ranking. Hands identical up to suit must score equal.
  assert.equal(score('Ac Kc Qc Jc 9c 2d 3h'), score('Ah Kh Qh Jh 9h 2d 3s'));
  assert.equal(score('Ac Ad Kh Qs Jc 9d 8h'), score('Ah As Kc Qd Jh 9s 8c'));
});

test('hands outside five to seven cards are rejected', () => {
  assert.throws(() => evaluate(parseCards('Ac Kd Qh Js')), /5 to 7/);
  assert.throws(() => evaluate(parseCards('Ac Kd Qh Js Tc 9d 8h 7s')), /5 to 7/);
});

test('five- and six-card hands evaluate too', () => {
  assert.equal(category('As Ks Qs Js Ts'), STRAIGHT_FLUSH);
  assert.equal(category('As Ks Qs Js Ts 2c'), STRAIGHT_FLUSH);
  assert.equal(score('As Ks Qs Js Ts 2c'), score('As Ks Qs Js Ts'));
});

/**
 * A deterministic pseudo-random deal, so the sampled tests cover a wide spread
 * of hands while failing identically on every machine and every run.
 */
function sampleHands(count: number, cardsPerHand: number, seed: number): Card[][] {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
  const deck: Card[] = Array.from({ length: 52 }, (_, i) => i);
  const out: Card[][] = [];
  for (let i = 0; i < count; i++) {
    for (let j = 51; j > 0; j--) {
      const k = next() % (j + 1);
      const t = deck[j]!;
      deck[j] = deck[k]!;
      deck[k] = t;
    }
    out.push(deck.slice(0, cardsPerHand));
  }
  return out;
}

test('sampled seven-card hands order the same way as the naive reference', () => {
  // The exhaustive version of this is below, behind the slow flag. This keeps
  // the path covered on an ordinary test run.
  const hands = sampleHands(20_000, 7, 0x5eed1234);
  for (let i = 1; i < hands.length; i++) {
    const a = hands[i - 1]!;
    const b = hands[i]!;
    const fast = Math.sign(evaluate(a) - evaluate(b));
    const reference = compareReference(referenceEvaluate7(a), referenceEvaluate7(b));
    assert.equal(fast, reference, `disagreed comparing [${a}] and [${b}]`);
  }
});

test('every seven-card hand is categorised, and the totals match the published frequencies', () => {
  // The full C(52,7) enumeration from §14.1. Around eight seconds.
  const counts = new Float64Array(9);
  const hand: Card[] = new Array<Card>(7);
  let total = 0;
  let royals = 0;

  for (let a = 0; a < 46; a++) {
    hand[0] = a;
    for (let b = a + 1; b < 47; b++) {
      hand[1] = b;
      for (let c = b + 1; c < 48; c++) {
        hand[2] = c;
        for (let d = c + 1; d < 49; d++) {
          hand[3] = d;
          for (let e = d + 1; e < 50; e++) {
            hand[4] = e;
            for (let f = e + 1; f < 51; f++) {
              hand[5] = f;
              for (let g = f + 1; g < 52; g++) {
                hand[6] = g;
                const value = evaluate(hand);
                const cat = categoryOf(value);
                counts[cat]! += 1;
                // A royal flush is a straight flush to the ace. The Trips bet
                // pays the two differently, so the split is counted here too and
                // checked against the frequencies that module embeds.
                if (cat === STRAIGHT_FLUSH && ((value >>> 16) & 0xf) === 12) royals++;
                total++;
              }
            }
          }
        }
      }
    }
  }

  assert.equal(total, TOTAL_SEVEN_CARD_HANDS);
  for (const [key, expected] of Object.entries(PUBLISHED_SEVEN_CARD_FREQUENCIES)) {
    const index = Number(key);
    assert.equal(
      counts[index],
      expected,
      `${CATEGORY_NAMES[index]}: got ${counts[index]}, published ${expected}`,
    );
  }

  // The Trips module embeds this same distribution, with the royal split out.
  // Checking it here is what stops the two drifting apart silently.
  assert.equal(royals, SEVEN_CARD_FREQUENCIES.royalFlush, 'royal flushes');
  assert.equal(
    counts[STRAIGHT_FLUSH]! - royals,
    SEVEN_CARD_FREQUENCIES.straightFlush,
    'straight flushes below a royal',
  );
  assert.equal(counts[FOUR_OF_A_KIND], SEVEN_CARD_FREQUENCIES.fourOfAKind);
  assert.equal(counts[FULL_HOUSE], SEVEN_CARD_FREQUENCIES.fullHouse);
  assert.equal(counts[FLUSH], SEVEN_CARD_FREQUENCIES.flush);
  assert.equal(counts[STRAIGHT], SEVEN_CARD_FREQUENCIES.straight);
  assert.equal(counts[THREE_OF_A_KIND], SEVEN_CARD_FREQUENCIES.threeOfAKind);
  assert.equal(
    counts[HIGH_CARD]! + counts[PAIR]! + counts[TWO_PAIR]!,
    SEVEN_CARD_FREQUENCIES.losing,
    'hands below trips, which lose the Trips bet',
  );
});

test(
  'the fast and naive evaluators order all 2,598,960 five-card hands identically',
  { skip: slow },
  () => {
    // A category tally cannot see kickers. This can: it checks the two
    // evaluators induce the same order and the same ties, with no exceptions.
    const representative = new Map<number, number[]>();
    const hand: Card[] = new Array<Card>(5);
    let total = 0;

    for (let a = 0; a < 48; a++) {
      hand[0] = a;
      for (let b = a + 1; b < 49; b++) {
        hand[1] = b;
        for (let c = b + 1; c < 50; c++) {
          hand[2] = c;
          for (let d = c + 1; d < 51; d++) {
            hand[3] = d;
            for (let e = d + 1; e < 52; e++) {
              hand[4] = e;
              const fast = evaluate(hand);
              const reference = referenceEvaluate5(hand);
              const seen = representative.get(fast);
              if (seen === undefined) representative.set(fast, reference);
              else {
                assert.equal(
                  compareReference(seen, reference),
                  0,
                  `two different hand values both scored ${fast}`,
                );
              }
              total++;
            }
          }
        }
      }
    }

    assert.equal(total, 2_598_960);
    assert.equal(
      representative.size,
      DISTINCT_FIVE_CARD_VALUES,
      'five-card poker has exactly 7,462 distinct hand values',
    );

    // Sorting by the fast score must sort by real hand value too, strictly.
    const entries = [...representative.entries()].sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < entries.length; i++) {
      assert.ok(
        compareReference(entries[i - 1]![1], entries[i]![1]) < 0,
        `score order disagrees with hand value near ${entries[i]![0]}`,
      );
    }
  },
);

test(
  'every seven-card hand scores as the best of its 21 five-card subsets',
  { skip: slow },
  () => {
    // The five-card scores are proven correct by the test above, so this pins
    // the seven-card path to them across the entire space. A few minutes.
    const subsets: number[][] = [];
    for (let a = 0; a < 3; a++)
      for (let b = a + 1; b < 4; b++)
        for (let c = b + 1; c < 5; c++)
          for (let d = c + 1; d < 6; d++)
            for (let e = d + 1; e < 7; e++) subsets.push([a, b, c, d, e]);
    assert.equal(subsets.length, 21);

    const hand: Card[] = new Array<Card>(7);
    const five: Card[] = new Array<Card>(5);
    let total = 0;
    let disagreements = 0;
    let firstDisagreement = '';

    for (let a = 0; a < 46; a++) {
      hand[0] = a;
      for (let b = a + 1; b < 47; b++) {
        hand[1] = b;
        for (let c = b + 1; c < 48; c++) {
          hand[2] = c;
          for (let d = c + 1; d < 49; d++) {
            hand[3] = d;
            for (let e = d + 1; e < 50; e++) {
              hand[4] = e;
              for (let f = e + 1; f < 51; f++) {
                hand[5] = f;
                for (let g = f + 1; g < 52; g++) {
                  hand[6] = g;
                  const got = evaluate(hand);
                  let best = -1;
                  for (let i = 0; i < 21; i++) {
                    const s = subsets[i]!;
                    five[0] = hand[s[0]!]!;
                    five[1] = hand[s[1]!]!;
                    five[2] = hand[s[2]!]!;
                    five[3] = hand[s[3]!]!;
                    five[4] = hand[s[4]!]!;
                    const v = evaluate(five);
                    if (v > best) best = v;
                  }
                  if (got !== best) {
                    disagreements++;
                    if (firstDisagreement === '') {
                      firstDisagreement = `[${hand.join(',')}] scored ${got}, best subset ${best}`;
                    }
                  }
                  total++;
                }
              }
            }
          }
        }
      }
    }

    assert.equal(total, TOTAL_SEVEN_CARD_HANDS);
    assert.equal(disagreements, 0, firstDisagreement);
  },
);
