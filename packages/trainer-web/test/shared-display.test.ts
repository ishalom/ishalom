/**
 * What round 34 puts on the felt, and when (items 1, 2, 4, 5 and 9).
 *
 * All display: nothing here changes how a hand is dealt, graded or rated. What
 * these hold is what each seat's screen may show and when — above all that no
 * grade of a neighbour's reaches my screen while it could still tell me
 * something about a decision I have yet to make.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeRng } from '@evtrainer/game-engine';

import { sharedScreen } from '../src/shared-screen.ts';
import { deriveTable, playTable, seatView, type SeatMove, type TableRecord } from '../src/shared-table.ts';
import { UTH_PRESET_ID } from '../src/shared-uth.ts';

function uthTable(seed: number, seats = 2): TableRecord {
  return {
    id: `d${seed}`,
    seed,
    presetId: UTH_PRESET_ID,
    restrictions: { noSurrender: false, likeRanksOnly: false },
    seats: Array.from({ length: seats }, (_, seat) => ({
      seat,
      playerId: `p${seat}`,
      name: `P${seat}`,
      bet: 1,
      moves: [] as SeatMove[],
      events: [{ kind: 'join' as const, seat, hand: 0 }],
      hands: 1,
    })),
  };
}

const move = (record: TableRecord, seat: number, round: number, action: string) =>
  record.seats[seat]!.moves.push({ hand: 0, round, action: action as SeatMove['action'] });

test('a neighbour\'s tag is coloured, and his figures shown, only once they can tell me nothing I have yet to decide', () => {
  const record = uthTable(7);
  // He checks before the flop; I have not decided.
  move(record, 1, 0, 'check');
  let his = sharedScreen(record, 0).seats[1]!;
  assert.deepEqual(his.grades, [], 'his action is shown before I have played');
  assert.equal(his.figures, null, 'his figures are shown before I have played');
  assert.equal(sharedScreen(record, 0).seats[1]!.decisions, 0, 'the bar moved before I played');

  // I check too: the pre-flop is answered on both sides, and his pre-flop grade may be shown.
  move(record, 0, 0, 'check');
  his = sharedScreen(record, 0).seats[1]!;
  assert.equal(his.grades.length, 1);
  assert.ok(his.grades[0] === 'right' || his.grades[0] === 'wrong');
  assert.ok(his.figures, 'his pre-flop figures are not shown once I have played the pre-flop');
  assert.equal(his.figures!.chosen, 'check');

  // He decides the flop first. I still owe the flop: that grade stays hidden, and the bar does not move.
  move(record, 1, 1, 'check');
  const before = sharedScreen(record, 0).seats[1]!;
  assert.deepEqual(before.grades, [before.grades[0], null], 'his flop grade shows while I am still deciding my flop');
  assert.equal(before.figures!.rows.some((row) => row.action === 'raise2x'), false, 'his flop figures show while I decide mine');
  assert.equal(before.decisions, 1, 'the bar counted his flop before I played mine');

  // I decide the flop: now it may be shown.
  move(record, 0, 1, 'check');
  const after = sharedScreen(record, 0).seats[1]!;
  assert.ok(after.grades[1] === 'right' || after.grades[1] === 'wrong');
  assert.ok(after.figures!.rows.some((row) => row.action === 'raise2x'));
});

test('my own tags and figures are mine to see at once, and match the analysis card', () => {
  const record = uthTable(11);
  move(record, 0, 0, 'raise3x');
  const screen = sharedScreen(record, 0, 'he');
  const me = screen.seats[0]!;
  assert.deepEqual(me.actions, ['raise3x']);
  assert.equal(me.grades[0], 'wrong', '3× is the best play on none of the 169 starting hands');
  const card = screen.analysis[screen.analysis.length - 1]!;
  const figures = me.figures!.rows.map((row) => [row.action, row.value.toFixed(3)]);
  const ranked = card.ranked.map((row) => [row.action, row.value.toFixed(3)]);
  assert.deepEqual(figures, ranked, 'the figures beside my cards are not the analysis card\'s');
});

test('every seat shows its chips at this table, and the table sums them', () => {
  const rng = makeRng(3);
  const bj: TableRecord = {
    id: 'c',
    seed: 19,
    presetId: 'vegas-strip-6d-s17',
    restrictions: { noSurrender: false, likeRanksOnly: false },
    seats: [0, 1, 2].map((seat) => ({
      seat,
      playerId: `p${seat}`,
      name: `P${seat}`,
      bet: 1 + seat,
      moves: [] as SeatMove[],
      events: [{ kind: 'join' as const, seat, hand: 0 }],
    })),
  };
  const derived = playTable(bj, 10, ({ legal }) => legal[rng.nextInt(legal.length)] as SeatMove['action']);
  const screen = sharedScreen(bj, 0);
  for (const seat of screen.seats) {
    const sum = derived.hands.reduce(
      (total, hand) => total + (hand.seats.find((s) => s.seat === seat.seat)?.net ?? 0),
      0,
    );
    assert.ok(Math.abs(seat.stack - sum) < 1e-9, `seat ${seat.seat} shows ${seat.stack} chips, played ${sum}`);
  }
  assert.ok(Math.abs(screen.table.stack - screen.seats.reduce((t, s) => t + s.stack, 0)) < 1e-9);
});

test('the history is the last finished hands, newest first, every action graded; the priciest spot is the costliest met twice', () => {
  const rng = makeRng(21);
  const bj: TableRecord = {
    id: 'h',
    seed: 77,
    presetId: 'vegas-strip-6d-s17',
    restrictions: { noSurrender: false, likeRanksOnly: false },
    seats: [0, 1].map((seat) => ({
      seat,
      playerId: `p${seat}`,
      name: `P${seat}`,
      bet: 1,
      moves: [] as SeatMove[],
      events: [{ kind: 'join' as const, seat, hand: 0 }],
    })),
  };
  const table = playTable(bj, 40, ({ legal }) => legal[rng.nextInt(legal.length)] as SeatMove['action']);
  const screen = sharedScreen(bj, 0, 'en');
  const finished = table.hands.filter((hand) => !hand.incomplete);
  assert.equal(screen.handsFinished, finished.length);
  assert.deepEqual(
    screen.history.map((hand) => hand.hand),
    finished.slice(-6).reverse().map((hand) => hand.hand),
  );
  for (const hand of screen.history) {
    const source = finished.find((h) => h.hand === hand.hand)!;
    for (const seat of hand.seats) {
      const mine = source.decisions.filter((d) => d.seat === seat.seat && d.round >= 0);
      assert.deepEqual(
        seat.actions,
        mine.map((d) => ({ action: String(d.action), grade: d.evCost <= 0 ? 'right' : 'wrong' })),
      );
    }
  }
  // Priciest: met at least twice, the largest total cost, and never zero.
  assert.ok(screen.priciest, 'forty random hands met no spot twice with a mistake in it');
  assert.ok(screen.priciest!.times >= 2 && screen.priciest!.cost > 0 && screen.priciest!.wrong >= 1);
  assert.ok(screen.priciest!.label.length > 0);
});

test('a watcher with no seat sees no grade from a hand still being played', () => {
  const record = uthTable(29);
  move(record, 1, 0, 'raise4x');
  const view = seatView(record, null);
  assert.deepEqual(view.seats[1]!.shown, []);
  assert.ok(deriveTable(record).hands[0]!.decisions.length === 1);
});

test('a seat that changed hands shows its present player\'s figures, and each hand keeps its own player\'s name (round 35)', async () => {
  const { occupantAt, tenureStart } = await import('../src/shared-table.ts');
  const rng = makeRng(41);
  const record: TableRecord = {
    id: 'swap',
    seed: 404,
    presetId: 'vegas-strip-6d-s17',
    restrictions: { noSurrender: false, likeRanksOnly: false },
    seats: [
      { seat: 0, playerId: 'idan', name: 'Idan', bet: 1, moves: [] as SeatMove[], events: [{ kind: 'join' as const, seat: 0, hand: 0, playerId: 'idan', name: 'Idan' }] },
      {
        seat: 1,
        playerId: 'dana',
        name: 'Dana',
        bet: 1,
        moves: [] as SeatMove[],
        // נירו sat here from hand 0 and left for good at hand 4; Dana sat down from hand 6.
        events: [
          { kind: 'join' as const, seat: 1, hand: 0, playerId: 'niro', name: 'נירו' },
          { kind: 'drop' as const, seat: 1, hand: 4, why: 'left' },
          { kind: 'join' as const, seat: 1, hand: 6, playerId: 'dana', name: 'Dana' },
        ],
      },
    ],
  };
  const table = playTable(record, 10, ({ legal }) => legal[rng.nextInt(legal.length)] as SeatMove['action']);
  assert.equal(tenureStart(record.seats[1]!), 6);
  assert.equal(occupantAt(record.seats[1]!, 2).name, 'נירו');
  assert.equal(occupantAt(record.seats[1]!, 7).name, 'Dana');

  const screen = sharedScreen(record, 0, 'en');
  const dana = screen.seats.find((seat) => seat.seat === 1)!;
  const hers = table.hands.filter((hand) => hand.hand >= 6);
  const decisions = hers.flatMap((hand) => hand.decisions.filter((d) => d.seat === 1 && d.round >= 0));
  assert.equal(dana.decisions, decisions.length, 'the seat counts decisions made before she sat down');
  const chips = hers.reduce((sum, hand) => sum + (hand.seats.find((s) => s.seat === 1)?.net ?? 0), 0);
  assert.ok(Math.abs(dana.stack - chips) < 1e-9, 'the seat shows chips won before she sat down');
  assert.equal(dana.handsPlayed, hers.filter((hand) => hand.seats.some((s) => s.seat === 1)).length);

  // The history and the ticker say who was sitting there at the time.
  for (const hand of screen.history) {
    const seat1 = hand.seats.find((s) => s.seat === 1);
    if (seat1) assert.equal(seat1.name, hand.hand >= 6 ? 'Dana' : 'נירו', `hand ${hand.hand} is under the wrong name`);
  }
  const left = screen.ticker.find((item) => item.kind === 'left' && item.seat === 1)!;
  assert.equal(left.name, 'נירו', 'the ticker says the wrong player left');
  assert.ok(screen.ticker.some((item) => item.kind === 'arrived' && item.seat === 1 && item.name === 'Dana'));
});

test('a row\'s own events keep their order at the same hand, and a kept vote drop reads as the vote did (round 35)', async () => {
  const { isLive, tableEvents } = await import('../src/shared-table.ts');
  // Idan's seat on his Ultimate evening: joined, left and came back, all at hand 0.
  const record: TableRecord = {
    id: 'order',
    seed: 1,
    presetId: UTH_PRESET_ID,
    restrictions: { noSurrender: false, likeRanksOnly: false },
    seats: [
      {
        seat: 0,
        playerId: 'idan',
        name: 'Idan',
        bet: 1,
        moves: [] as SeatMove[],
        events: [
          { kind: 'join' as const, seat: 0, hand: 0 },
          { kind: 'drop' as const, seat: 0, hand: 0, why: 'left' },
          { kind: 'return' as const, seat: 0, hand: 0 },
        ],
      },
      {
        seat: 1,
        playerId: 'niro',
        name: 'נירו',
        bet: 1,
        moves: [] as SeatMove[],
        // A drop kept from seat 0's vote, sitting in seat 0's row before seat 1's own join.
        events: [{ kind: 'join' as const, seat: 1, hand: 0 }],
      },
    ],
  };
  assert.equal(isLive(record, 0, 0), true, 'join, leave and return at one hand no longer reads as back');
  record.seats[0]!.events!.push({ kind: 'drop', seat: 1, hand: 0, why: 'vote' });
  record.seats[0]!.vote = { hand: 0, against: 1, at: 0, needs: 1 };
  assert.equal(isLive(record, 1, 0), false, 'a kept vote drop was read before the join it followed');
  assert.equal(
    tableEvents(record).filter((event) => event.kind === 'drop' && event.seat === 1).length,
    1,
    'the same drop, kept and derived, counted twice',
  );
});
