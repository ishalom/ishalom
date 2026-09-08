/**
 * The river decision (spec §6.3, "River decision").
 *
 * The spec calls this one "trivially exact": 45 unseen cards, C(45,2) = 990
 * dealer holdings, enumerate all of them. Trivial to state is not the same as
 * trivial to get right, so the solver is checked against a second enumeration
 * written here from the naive evaluator and its own settlement logic, sharing
 * nothing with `src/uth` but the rules of the game.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NUM_CARDS, parseCards, type Card } from '../src/core/cards.ts';
import { DEFAULT_BLIND_PAYTABLE } from '../src/uth/rules.ts';
import { solveRiver } from '../src/uth/river.ts';
import { compareReference, referenceEvaluate7 } from './helpers/poker-reference.ts';

const paytable = DEFAULT_BLIND_PAYTABLE;

/** Categories in the reference score, matching the evaluator's numbering. */
const REF_STRAIGHT = 4;
const REF_STRAIGHT_FLUSH = 8;
const REF_FOUR = 7;
const REF_FULL_HOUSE = 6;
const REF_FLUSH = 5;
const REF_PAIR = 1;

/** Blind payout, re-derived from the reference score rather than from src. */
function referenceBlindPayout(score: number[]): number {
  const category = score[0]!;
  if (category === REF_STRAIGHT_FLUSH) return score[1] === 12 ? 500 : 50;
  if (category === REF_FOUR) return 10;
  if (category === REF_FULL_HOUSE) return 3;
  if (category === REF_FLUSH) return 1.5;
  if (category === REF_STRAIGHT) return 1;
  return 0;
}

/**
 * An independent river enumeration: naive evaluator, settlement written out
 * again from §5.2.1, no shared code with the solver under test.
 */
function referenceSolveRiver(playerHole: readonly Card[], board: readonly Card[]): number {
  const used = new Set<Card>([...playerHole, ...board]);
  const unseen: Card[] = [];
  for (let c = 0; c < NUM_CARDS; c++) if (!used.has(c)) unseen.push(c);

  const playerScore = referenceEvaluate7([...playerHole, ...board]);
  const blind = referenceBlindPayout(playerScore);

  let total = 0;
  let count = 0;
  for (let i = 0; i < unseen.length; i++) {
    for (let j = i + 1; j < unseen.length; j++) {
      const dealerScore = referenceEvaluate7([unseen[i]!, unseen[j]!, ...board]);
      const cmp = compareReference(playerScore, dealerScore);
      const qualified = dealerScore[0]! >= REF_PAIR;
      if (cmp > 0) total += 1 + (qualified ? 1 : 0) + blind;
      else if (cmp < 0) total += -1 - (qualified ? 1 : 0) - 1;
      count++;
    }
  }
  return total / count;
}

const HANDS: Array<[string, string, string]> = [
  ['Ah Ad', 'Ac 7s 2d 9h Jc', 'trip aces'],
  ['2h 3d', 'Ac Ks Qd 9h Jc', 'total air, the board plays'],
  ['Kd Qh', 'Ac Ks Qs 9h Jc', 'two pair, kings and queens'],
  ['Ah Kh', 'Qh Jh Th 2d 3c', 'a royal flush'],
  ['5h 5d', 'Ac Ks Qd 9h Jc', 'a small pair under four overcards'],
  ['Ah 2c', 'Ad 7s 9h Jc 4d', 'top pair, worst kicker'],
  ['7c 6c', '5c 4c 3h 2d Ks', 'a straight flush'],
  ['Ts 9h', '8s 7d 2c 3h 4c', 'ten high, nothing at all'],
];

test('the solver enumerates exactly the 990 possible dealer holdings', () => {
  for (const [hole, board, label] of HANDS) {
    const result = solveRiver(parseCards(hole), parseCards(board), paytable);
    assert.equal(
      result.wins + result.ties + result.losses,
      990,
      `${label}: C(45,2) is 990 holdings`,
    );
  }
});

test('every hand matches an independently written enumeration', () => {
  for (const [hole, board, label] of HANDS) {
    const mine = solveRiver(parseCards(hole), parseCards(board), paytable).evPlay;
    const theirs = referenceSolveRiver(parseCards(hole), parseCards(board));
    assert.ok(
      Math.abs(mine - theirs) < 1e-9,
      `${label} (${hole} | ${board}): solver ${mine}, reference ${theirs}`,
    );
  }
});

test('folding is always exactly -2, and is the fallback the play bet is judged against', () => {
  const result = solveRiver(parseCards('2h 3d'), parseCards('Ac Ks Qd 9h Jc'), paytable);
  assert.equal(result.evFold, -2);
  assert.equal(result.optimalAction, 'fold');
  assert.ok(result.evPlay < -2, 'this hand cannot beat the board, so betting loses more than folding');
});

test('a royal flush pays the blind and nothing can beat it', () => {
  const result = solveRiver(parseCards('Ah Kh'), parseCards('Qh Jh Th 2d 3c'), paytable);
  assert.equal(result.losses, 0);
  assert.equal(result.ties, 0);
  assert.equal(result.wins, 990);
  assert.equal(result.optimalAction, 'play');
  // Play 1 + blind 500 are certain; the ante rides on the dealer qualifying.
  assert.ok(result.evPlay > 501 && result.evPlay < 502, `evPlay was ${result.evPlay}`);
});

test('a stronger hand on the same board is always worth at least as much', () => {
  const board = 'Ac Ks Qd 9h 4c';
  const ascending = ['7h 5d', '9s 8d', 'Kh 4d', 'Ah 4d', 'Ad Ah'];
  let previous = -Infinity;
  for (const hole of ascending) {
    const ev = solveRiver(parseCards(hole), parseCards(board), paytable).evPlay;
    assert.ok(ev > previous, `${hole} on ${board} should beat the hand below it (${ev} vs ${previous})`);
    previous = ev;
  }
});

test('folding is rare — it takes a hand that cannot win at all', () => {
  // Spec §5.2: at the river the player is already in for two units, so the bar
  // for putting in a third is low. A pair, even a weak one, clears it.
  const board = 'Ac Ks Qd 9h 4c';
  assert.equal(solveRiver(parseCards('7h 7d'), parseCards(board), paytable).optimalAction, 'play');
  assert.equal(solveRiver(parseCards('4h 3d'), parseCards(board), paytable).optimalAction, 'play');
  assert.equal(solveRiver(parseCards('7h 5d'), parseCards(board), paytable).optimalAction, 'fold');
});

test('malformed deals are rejected rather than silently mis-solved', () => {
  assert.throws(() => solveRiver(parseCards('Ah'), parseCards('Ac Ks Qd 9h 4c'), paytable), /two cards/);
  assert.throws(() => solveRiver(parseCards('Ah Kh'), parseCards('Ac Ks Qd 9h'), paytable), /five community/);
  assert.throws(
    () => solveRiver(parseCards('Ah Kh'), parseCards('Ah Ks Qd 9h 4c'), paytable),
    /Duplicate/,
    'a card cannot be in two places at once',
  );
});

test('the river decision is well inside the latency budget', () => {
  // Spec §13 allows 100 ms typical. This should be three orders of magnitude
  // under that, and if it ever is not, something has stopped being O(990).
  const hole = parseCards('Ah Kh');
  const board = parseCards('Qh Jh 2d 3c 7s');
  solveRiver(hole, board, paytable); // warm up
  const started = performance.now();
  for (let i = 0; i < 20; i++) solveRiver(hole, board, paytable);
  const perCall = (performance.now() - started) / 20;
  assert.ok(perCall < 20, `river solve took ${perCall.toFixed(2)}ms per call`);
});
