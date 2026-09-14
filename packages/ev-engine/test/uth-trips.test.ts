/**
 * The Trips side bet (spec §5.2.4, §6.3, and §17's second open question).
 *
 * Trips is the one bet in the game whose EV is a single number: it depends only
 * on the player's own seven cards, so weighting each payout by how often a
 * random seven-card hand reaches it is the whole calculation. That makes it
 * exactly checkable, and it makes the product question sharp — if the answer is
 * always "don't", grading it as a decision wastes the user's attention.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TRIPS_PAYTABLES, getTripsPaytable } from '../src/uth/rules.ts';
import {
  analyseTrips,
  describeTrips,
  SEVEN_CARD_FREQUENCIES,
  TOTAL_SEVEN_CARD_HANDS,
  tripsEv,
} from '../src/uth/trips.ts';

test('the embedded frequencies account for every seven-card hand', () => {
  const f = SEVEN_CARD_FREQUENCIES;
  const sum =
    f.royalFlush +
    f.straightFlush +
    f.fourOfAKind +
    f.fullHouse +
    f.flush +
    f.straight +
    f.threeOfAKind +
    f.losing;
  assert.equal(sum, TOTAL_SEVEN_CARD_HANDS);
  assert.equal(TOTAL_SEVEN_CARD_HANDS, 133_784_560);
});

test('the royal and non-royal straight flushes sum to the published total', () => {
  // The evaluator test asserts 41,584 straight flushes among all C(52,7). Trips
  // pays the royal differently, so the split has to add back up.
  assert.equal(
    SEVEN_CARD_FREQUENCIES.royalFlush + SEVEN_CARD_FREQUENCIES.straightFlush,
    41_584,
  );
  assert.equal(SEVEN_CARD_FREQUENCIES.royalFlush, 4_324);
});

test('the bet pays about 15% of the time on every paytable', () => {
  // Trips or better in seven cards. The paytables differ in what they pay, never
  // in what they pay for, so this is a property of the deck rather than the felt.
  for (const paytable of TRIPS_PAYTABLES) {
    const { winProbability } = analyseTrips(paytable);
    assert.ok(
      Math.abs(winProbability - 0.1527) < 0.0005,
      `${paytable.id}: win probability was ${winProbability}`,
    );
  }
});

test('every shipped paytable loses money, and the house edges match published figures', () => {
  // These three are the common real-world tables. Their edges are widely
  // published, and reproducing them from the hand frequencies is the check.
  const expected: Record<string, number> = {
    'trips-a': 3.5, // full house 8, flush 7, straight 4
    'trips-b': 0.9, // full house 9, flush 7 — the generous one
    'trips-c': 6.18, // full house 7, flush 6, straight 5
  };
  for (const [id, edge] of Object.entries(expected)) {
    const analysis = analyseTrips(getTripsPaytable(id));
    assert.ok(analysis.ev < 0, `${id} should be a losing bet`);
    assert.ok(
      Math.abs(analysis.houseEdgePercent - edge) < 0.05,
      `${id}: house edge ${analysis.houseEdgePercent.toFixed(3)}%, published about ${edge}%`,
    );
  }
});

test('a more generous paytable is worth more, one payout at a time', () => {
  const base = getTripsPaytable('trips-a');
  const better = { ...base, fullHouse: base.fullHouse + 1 };
  assert.ok(tripsEv(better) > tripsEv(base));

  const worse = { ...base, flush: base.flush - 1 };
  assert.ok(tripsEv(worse) < tripsEv(base));
});

test('a paytable can in principle be beatable, and the wording follows the maths', () => {
  // Nothing shipped is positive-EV, but the description must not hardcode the
  // verdict — §16 requires the app to state the real number, not a slogan.
  const absurd = { ...getTripsPaytable('trips-a'), threeOfAKind: 20 };
  assert.ok(tripsEv(absurd) > 0);
  assert.match(describeTrips(absurd), /returns/);

  for (const paytable of TRIPS_PAYTABLES) {
    assert.match(describeTrips(paytable), /costs/);
  }
});

test('the verdict quotes the real number rather than a slogan', () => {
  // Spec §16: the app never implies a path to profitability, and states the cost
  // in plain numbers.
  const text = describeTrips(getTripsPaytable('trips-a'));
  assert.match(text, /3\.50%/);
  assert.ok(!/never|always/i.test(text), 'the wording should be quantitative, not absolute');
});
