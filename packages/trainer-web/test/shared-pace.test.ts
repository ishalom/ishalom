/**
 * Pace (round 35): each phone times its own player, and nothing else moves.
 *
 * The round's condition is the whole test: the cards, the grades and the
 * ratings must be identical whether the times are there or not — proved, not
 * believed. So every table here is derived twice, once as played and once with
 * a time on every move, and everything the derivation produces is compared:
 * every card, every board, every net, every graded figure, every checksum, and
 * every decision the rating would be handed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeRng } from '@evtrainer/game-engine';

import { sharedScreen } from '../src/shared-screen.ts';
import {
  deriveTable,
  playTable,
  seatCardsHash,
  seatRatable,
  type SeatMove,
  type TableRecord,
} from '../src/shared-table.ts';
import { playUthTable, UTH_PRESET_ID } from '../src/shared-uth.ts';

function table(seed: number, size: number, presetId: string): TableRecord {
  return {
    id: `pace${seed}`,
    seed,
    presetId,
    restrictions: { noSurrender: false, likeRanksOnly: false },
    seats: Array.from({ length: size }, (_, seat) => ({
      seat,
      playerId: `p${seat}`,
      name: `P${seat}`,
      bet: 1 + seat,
      moves: [] as SeatMove[],
      events: [{ kind: 'join' as const, seat, hand: 0 }],
    })),
  };
}

/** The same record with a time on every move — as if every phone had timed every decision. */
function timed(record: TableRecord, seed: number): TableRecord {
  const rng = makeRng(seed);
  const copy = JSON.parse(JSON.stringify(record)) as TableRecord;
  for (const seat of copy.seats) for (const move of seat.moves) move.ms = 300 + rng.nextInt(20000);
  return copy;
}

function everything(record: TableRecord) {
  const derived = deriveTable(record);
  return {
    hands: JSON.parse(JSON.stringify(derived.hands, (_, v) => (v instanceof Map ? [...v] : v))),
    hashes: record.seats.map((seat) => seatCardsHash(derived, seat.seat)),
    rated: record.seats.map((seat) => seatRatable(record, seat.seat)),
  };
}

test('the times change nothing the derivation produces, in either game, at any size', () => {
  const cases: Array<[string, TableRecord]> = [];
  for (const size of [2, 4, 6]) {
    const bj = table(size * 7, size, 'vegas-strip-6d-s17');
    const rng = makeRng(size);
    playTable(bj, 10, ({ legal }) => legal[rng.nextInt(legal.length)] as SeatMove['action']);
    cases.push([`Blackjack at ${size}`, bj]);
    const uth = table(size * 11, size, UTH_PRESET_ID);
    const rng2 = makeRng(size + 50);
    playUthTable(uth, 8, ({ legal }) =>
      (legal.includes('raise4x') && rng2.nextInt(3) > 0 ? 'raise4x' : legal[rng2.nextInt(legal.length)]) as SeatMove['action'],
    );
    cases.push([`Ultimate at ${size}`, uth]);
  }
  for (const [name, record] of cases) {
    const plain = everything(record);
    const withTimes = timed(record, 99);
    assert.ok(withTimes.seats.every((seat) => seat.moves.every((move) => typeof move.ms === 'number')));
    assert.deepEqual(everything(withTimes), plain, `${name}: a time changed what was derived`);
  }
});

test('on the screen, the times change only the pace figure', () => {
  const record = table(5, 3, UTH_PRESET_ID);
  const rng = makeRng(8);
  playUthTable(record, 6, ({ legal }) => legal[rng.nextInt(legal.length)] as SeatMove['action']);
  const withTimes = timed(record, 3);
  const strip = (screen: ReturnType<typeof sharedScreen>) =>
    JSON.parse(JSON.stringify({ ...screen, seats: screen.seats.map((s) => ({ ...s, pace: null })), me: null }));
  assert.deepEqual(strip(sharedScreen(withTimes, 0, 'he')), strip(sharedScreen(record, 0, 'he')));
  // And the pace is each seat's own average over its own timed moves.
  const screen = sharedScreen(withTimes, 0, 'he');
  for (const seat of screen.seats) {
    const moves = withTimes.seats.find((row) => row.seat === seat.seat)!.moves;
    const average = moves.reduce((sum, move) => sum + move.ms!, 0) / moves.length;
    assert.ok(seat.pace && Math.abs(seat.pace.ms - average) < 1e-9 && seat.pace.n === moves.length);
  }
  assert.equal(sharedScreen(record, 0).seats[0]!.pace, null, 'a seat with no timed move shows a pace');
});

test('a decision with no time is left out of the average, not counted as zero', () => {
  const record = table(9, 2, UTH_PRESET_ID);
  record.seats.forEach((seat) => (seat.hands = 3));
  const rows = record.seats[0]!.moves;
  rows.push({ hand: 0, round: 0, action: 'raise4x' }); // the first hand: no time
  rows.push({ hand: 1, round: 0, action: 'raise4x', ms: 4000 });
  rows.push({ hand: 2, round: 0, action: 'raise4x', ms: 2000 });
  record.seats[1]!.moves.push(
    { hand: 0, round: 0, action: 'raise4x' },
    { hand: 1, round: 0, action: 'raise4x' },
    { hand: 2, round: 0, action: 'raise4x' },
  );
  const pace = sharedScreen(record, 0).seats[0]!.pace!;
  assert.equal(pace.ms, 3000);
  assert.equal(pace.n, 2);
});
