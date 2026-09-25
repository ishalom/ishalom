/**
 * Kept solves (round 35): a reload is fast, and never different.
 *
 * The phone keeps the flop solves it has made, so a reload in the middle of a
 * long Ultimate evening does not freeze for seconds re-solving them. The one
 * rule: a kept answer must be identical to a fresh solve, and anything kept
 * that is not exactly a flop solve under its own key is thrown away and solved
 * again. Slow is allowed; wrong is not.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeRng, UthTable, type UthAction } from '@evtrainer/game-engine';

import { deriveTable, forgetLastDerivation, type SeatMove, type TableRecord } from '../src/shared-table.ts';
import {
  exportUthSolves,
  forgetUthSolves,
  importUthSolves,
  playUthTable,
  UTH_PRESET_ID,
} from '../src/shared-uth.ts';

function played(seed: number, hands: number): TableRecord {
  const record: TableRecord = {
    id: `k${seed}`,
    seed,
    presetId: UTH_PRESET_ID,
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
  const rng = makeRng(seed);
  // Checking before the flop most of the time, so the table meets many flops.
  playUthTable(record, hands, ({ legal }) =>
    (legal.includes('check') && rng.nextInt(4) > 0 ? 'check' : legal[rng.nextInt(legal.length)]) as SeatMove['action'],
  );
  return record;
}

/** The table derived afresh — never the last derivation kept by `deriveTable`. */
const shape = (record: TableRecord) => {
  forgetLastDerivation();
  return JSON.stringify(deriveTable(JSON.parse(JSON.stringify(record))).hands, (key, v) =>
    key === 'solveMs' ? undefined : v instanceof Map ? [...v] : v,
  );
};

test('solves kept and taken back derive exactly what fresh solves derive', () => {
  forgetUthSolves();
  const record = played(3, 10);
  const fresh = shape(record);
  const kept = JSON.parse(JSON.stringify(exportUthSolves()));
  assert.ok(kept.length >= 5, `only ${kept.length} flops were kept`);

  // A reload: the page starts with nothing, and takes the kept solves back.
  forgetUthSolves();
  assert.equal(importUthSolves(kept), kept.length, 'a kept solve was refused');
  assert.equal(shape(record), fresh, 'a table derived from kept solves differs from a fresh one');

  // And each kept answer is, figure for figure, what a fresh solve of that spot says.
  for (const [key, evaluation] of kept) {
    const [, , hole, board] = key.split('|');
    const cards = [...hole.split(',').map(Number), 0, 0, ...board.split(',').map(Number)];
    const others = Array.from({ length: 52 }, (_, c) => c).filter((c) => !cards.slice(0, 2).includes(c) && !cards.slice(4).includes(c));
    cards[2] = others[0]!;
    cards[3] = others[1]!;
    const table = new UthTable({ seed: 1 });
    table.stackNextHand([...cards, others[2]!, others[3]!]);
    table.startHand();
    table.act('check' as UthAction);
    const { solveMs: _a, ...solved } = table.evaluate();
    const { solveMs: _b, ...stored } = evaluation;
    assert.deepEqual(stored, solved, `the kept answer for ${hole} on ${board} is not a fresh solve's`);
  }
});

test('anything kept that is not exactly a flop solve under its key is thrown away, and solved again', () => {
  forgetUthSolves();
  const record = played(5, 6);
  const fresh = shape(record);
  const [key, good] = exportUthSolves()[0]!;
  const bad: unknown[] = [
    'not an array',
    [key],
    [42, good],
    ['{"x":1}|river|1,2|3,4,5,6,7', good],
    [key.replace('|flop|', '|preflop|'), good],
    [key, { ...good, phase: 'river' }],
    [key, { ...good, evByAction: { raise2x: Number.NaN, check: 0 } }],
    [key, { ...good, optimalAction: good.optimalAction === 'check' ? 'raise2x' : 'check' }],
    [key, { ...good, counts: { wins: 'many' } }],
    [key, null],
  ];
  forgetUthSolves();
  assert.equal(importUthSolves(bad), 0, 'a malformed solve was taken');
  assert.equal(importUthSolves('garbage'), 0);
  assert.equal(importUthSolves(null), 0);
  assert.equal(shape(record), fresh, 'the table derived differently after a bad store');
});
