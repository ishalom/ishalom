/**
 * Settling an Ultimate Texas Hold'em hand (spec §5.2.1).
 *
 * The three bets resolve by different rules, and the couplings are easy to get
 * backwards in a way that produces plausible-looking, wrong EVs:
 *
 *   - the Ante pushes when the dealer does not qualify, on losing hands as well
 *     as winning ones;
 *   - the Play bet ignores qualification entirely;
 *   - the Blind ignores qualification too, pays only on a win with a straight or
 *     better, and is lost outright on a loss.
 *
 * Each of those is asserted on its own here rather than being left to emerge
 * from the solvers, where a sign error would just look like a slightly different
 * house edge.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCards } from '../src/core/cards.ts';
import { evaluate, categoryOf, PAIR } from '../src/poker/evaluator.ts';
import {
  blindPayout,
  DEFAULT_BLIND_PAYTABLE,
  FOLD_RESULT,
  getTripsPaytable,
  TRIPS_PAYTABLES,
} from '../src/uth/rules.ts';
import { dealerQualifies, settle, settleHands, tripsResult } from '../src/uth/showdown.ts';

const paytable = DEFAULT_BLIND_PAYTABLE;
const score = (text: string) => evaluate(parseCards(text));

test('folding costs the ante and the blind, and nothing else', () => {
  assert.equal(FOLD_RESULT, -2);
});

test('a tie pushes every bet, whatever the dealer holds', () => {
  const board = 'Ac Kd Qh Js Tc';
  // Both players play the board: an identical broadway straight.
  const result = settleHands(parseCards('2h 3d'), parseCards('4s 5c'), parseCards(board), 4, paytable);
  assert.equal(result, 0);
});

test('the ante pushes when the dealer does not qualify — including on a loss', () => {
  // A dealer holding only ace-high has not qualified. Whether the player wins or
  // loses, the ante is returned.
  const playerHigh = score('Ac Kd 9h 7s 5c');
  const dealerHigh = score('Ah Qd 9c 7d 5h');
  assert.ok(categoryOf(dealerHigh) < PAIR, 'this dealer must not qualify for the test to mean anything');

  // Player wins: play bet only, no ante, no blind (high card is under a straight).
  assert.equal(settle(playerHigh, dealerHigh, 2, paytable), 2);

  // Player loses to a non-qualifying dealer: play and blind go, the ante stays.
  assert.equal(settle(dealerHigh, playerHigh, 2, paytable), -3);
});

test('a qualifying dealer puts the ante back in play', () => {
  const playerTwoPair = score('Ac Ad Kh Ks 9c');
  const dealerPair = score('Qc Qd 8h 6s 4c');
  assert.ok(dealerQualifies(dealerPair));

  // Win: play 2 + ante 1, blind pushes because two pair is under a straight.
  assert.equal(settle(playerTwoPair, dealerPair, 2, paytable), 3);
  // Lose: play 2 + ante 1 + blind 1.
  assert.equal(settle(dealerPair, playerTwoPair, 2, paytable), -4);
});

test('the blind pays only on a win, and only from a straight up', () => {
  const dealerPair = score('Qc Qd 8h 6s 4c');
  const straight = score('9c 8d 7h 6s 5c');
  const twoPair = score('Ac Ad Kh Ks 9c');

  // Straight: play 1 + ante 1 + blind 1.
  assert.equal(settle(straight, dealerPair, 1, paytable), 3);
  // Two pair beats the dealer but the blind merely pushes.
  assert.equal(settle(twoPair, dealerPair, 1, paytable), 2);
  // Losing with a straight still loses the blind — it is not a consolation bet.
  const biggerStraight = score('Kc Qd Jh Ts 9c');
  assert.equal(settle(straight, biggerStraight, 1, paytable), -3);
});

test('the blind paytable pays what §5.2.2 says', () => {
  assert.equal(blindPayout(score('As Ks Qs Js Ts'), paytable), 500, 'royal flush');
  assert.equal(blindPayout(score('9s 8s 7s 6s 5s'), paytable), 50, 'straight flush');
  assert.equal(blindPayout(score('Ac Ad Ah As Kc'), paytable), 10, 'four of a kind');
  assert.equal(blindPayout(score('Ac Ad Ah Kc Kd'), paytable), 3, 'full house');
  assert.equal(blindPayout(score('As Ks Qs 9s 2s'), paytable), 1.5, 'flush');
  assert.equal(blindPayout(score('9c 8d 7h 6s 5c'), paytable), 1, 'straight');
  assert.equal(blindPayout(score('Ac Ad Ah Kc Qd'), paytable), 0, 'trips is under a straight');
  assert.equal(blindPayout(score('Ac Kd Qh 9s 7c'), paytable), 0, 'high card');
});

test('a royal flush is told apart from any other straight flush', () => {
  // Both are the same category; only the straight high card separates them, and
  // the gap is 500 to 50.
  assert.equal(blindPayout(score('As Ks Qs Js Ts'), paytable), 500);
  assert.equal(blindPayout(score('Ks Qs Js Ts 9s'), paytable), 50);
  assert.equal(blindPayout(score('5s 4s 3s 2s As'), paytable), 50, 'the steel wheel is not a royal');
});

test('the play bet scales with the raise the player made', () => {
  const winner = score('Ac Ad Kh Ks 9c');
  const loser = score('Qc Qd 8h 6s 4c');
  // Ante adds 1 to each; the rest is the play bet.
  assert.equal(settle(winner, loser, 4, paytable), 5);
  assert.equal(settle(winner, loser, 3, paytable), 4);
  assert.equal(settle(winner, loser, 2, paytable), 3);
  assert.equal(settle(winner, loser, 1, paytable), 2);
});

test('trips ignores the dealer entirely', () => {
  const trips = getTripsPaytable('trips-a');
  assert.equal(tripsResult(score('As Ks Qs Js Ts'), trips), trips.royalFlush);
  assert.equal(tripsResult(score('9s 8s 7s 6s 5s'), trips), trips.straightFlush);
  assert.equal(tripsResult(score('Ac Ad Ah As Kc'), trips), trips.fourOfAKind);
  assert.equal(tripsResult(score('Ac Ad Ah Kc Kd'), trips), trips.fullHouse);
  assert.equal(tripsResult(score('As Ks Qs 9s 2s'), trips), trips.flush);
  assert.equal(tripsResult(score('9c 8d 7h 6s 5c'), trips), trips.straight);
  assert.equal(tripsResult(score('Ac Ad Ah Kc Qd'), trips), trips.threeOfAKind);
  // Anything under trips loses the side bet outright.
  assert.equal(tripsResult(score('Ac Ad Kh Ks 9c'), trips), -1, 'two pair loses trips');
  assert.equal(tripsResult(score('Ac Kd Qh 9s 7c'), trips), -1, 'high card loses trips');
});

test('every shipped trips paytable is complete and plausible', () => {
  const ids = new Set<string>();
  for (const table of TRIPS_PAYTABLES) {
    assert.ok(!ids.has(table.id), `duplicate trips paytable id ${table.id}`);
    ids.add(table.id);
    // Payouts must be ordered by hand strength, or the bet would reward the
    // wrong hands.
    assert.ok(table.royalFlush >= table.straightFlush);
    assert.ok(table.straightFlush >= table.fourOfAKind);
    assert.ok(table.fourOfAKind >= table.fullHouse);
    assert.ok(table.fullHouse >= table.threeOfAKind);
    assert.ok(table.threeOfAKind > 0);
  }
  assert.throws(() => getTripsPaytable('no-such-table'));
});

test('the dealer qualifies with a pair, using the board if it has to', () => {
  assert.equal(dealerQualifies(score('2c 2d 8h 6s 4c')), true, 'a pair of deuces qualifies');
  assert.equal(dealerQualifies(score('Ac Kd Qh 9s 7c')), false, 'ace high does not');
  assert.equal(dealerQualifies(score('Ac Ad Ah Kc Kd')), true);
});
