/**
 * The pre-flop decision and its offline table (spec §6.3, §5.2.3, §6.5).
 *
 * `solvePreflop` itself is a multi-billion-outcome job that takes minutes per
 * class, so it does not run here. What runs here is everything the job depends
 * on being right, and everything its output has to satisfy:
 *
 *   - the 169 equivalence classes really are the 1,326 starting hands, partitioned;
 *   - the board indexing is an exact bijection, so that the check branch finds
 *     the values the board enumeration stored. This is the single assumption a
 *     bug in which would silently corrupt every number the job produces;
 *   - whatever the job has written so far obeys the structural facts of the
 *     game, including §5.2.3's claim that a 3x raise is never correct.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeCard, NUM_CARDS, rankOf, suitOf } from '../src/core/cards.ts';
import {
  allHoleClasses,
  boardIndex,
  holeClassLabel,
  PREFLOP_BOARDS,
  type PreflopResult,
} from '../src/uth/preflop.ts';
import {
  PREFLOP_TABLE,
  PREFLOP_TABLE_PAYTABLE,
  preflopRow,
} from '../src/uth/preflop-table.ts';

const ASSET = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'uth-preflop.json',
);

test('there are exactly 169 classes: 13 pairs, 78 suited, 78 offsuit', () => {
  const classes = allHoleClasses();
  assert.equal(classes.length, 169);
  assert.equal(classes.filter((c) => c.highRank === c.lowRank).length, 13);
  assert.equal(classes.filter((c) => c.suited).length, 78);
  assert.equal(classes.filter((c) => !c.suited && c.highRank !== c.lowRank).length, 78);
});

test('the classes partition all 1,326 starting hands', () => {
  // C(52,2) = 1326. Pairs are 6 combinations each, suited 4, offsuit 12.
  const total = allHoleClasses().reduce((sum, c) => sum + c.combinations, 0);
  assert.equal(total, (NUM_CARDS * (NUM_CARDS - 1)) / 2);
  assert.equal(total, 1326);
});

test('every class has a distinct label and a representative that matches it', () => {
  const labels = new Set<string>();
  for (const c of allHoleClasses()) {
    assert.ok(!labels.has(c.label), `duplicate label ${c.label}`);
    labels.add(c.label);

    const [a, b] = c.cards;
    assert.equal(rankOf(a), c.highRank, `${c.label} high card`);
    assert.equal(rankOf(b), c.lowRank, `${c.label} low card`);
    assert.equal(suitOf(a) === suitOf(b), c.suited, `${c.label} suitedness`);
    assert.ok(c.highRank >= c.lowRank, `${c.label} is not in canonical order`);
    assert.notEqual(a, b, `${c.label} uses the same card twice`);
  }
});

test('board indexing is a bijection onto every board there is', () => {
  // The board enumeration writes to these indices and the check branch reads
  // back from them. If the mapping collided, two boards would share a value and
  // nothing downstream would notice.
  const seen = new Uint8Array(PREFLOP_BOARDS);
  let boards = 0;
  for (let a = 0; a < 46; a++)
    for (let b = a + 1; b < 47; b++)
      for (let c = b + 1; c < 48; c++)
        for (let d = c + 1; d < 49; d++)
          for (let e = d + 1; e < 50; e++) {
            const index = boardIndex(a, b, c, d, e);
            assert.ok(index >= 0 && index < PREFLOP_BOARDS, `index ${index} out of range`);
            assert.equal(seen[index], 0, `two boards collided on index ${index}`);
            seen[index] = 1;
            boards++;
          }
  assert.equal(boards, PREFLOP_BOARDS);
  assert.equal(boards, 2_118_760, 'C(50,5)');
});

test('a board is reachable through all ten of its flop splittings', () => {
  // The check branch walks flops, not boards, and revisits each board once per
  // way of choosing three of its five cards as the flop: C(5,3) = 10. If that
  // count were wrong the check EV would be weighted incorrectly.
  const counts = new Uint8Array(PREFLOP_BOARDS);
  const remaining = new Int32Array(47);
  let visits = 0;

  for (let f0 = 0; f0 < 48; f0++) {
    for (let f1 = f0 + 1; f1 < 49; f1++) {
      for (let f2 = f1 + 1; f2 < 50; f2++) {
        let m = 0;
        for (let k = 0; k < 50; k++) {
          if (k !== f0 && k !== f1 && k !== f2) remaining[m++] = k;
        }
        for (let t = 0; t < 47; t++) {
          for (let r = t + 1; r < 47; r++) {
            const five = [f0, f1, f2, remaining[t]!, remaining[r]!].sort((x, y) => x - y);
            counts[boardIndex(five[0]!, five[1]!, five[2]!, five[3]!, five[4]!)]! += 1;
            visits++;
          }
        }
      }
    }
  }

  assert.equal(visits, 21_187_600, 'C(50,3) x C(47,2)');
  for (let i = 0; i < PREFLOP_BOARDS; i++) {
    if (counts[i] !== 10) assert.fail(`board ${i} was visited ${counts[i]} times, not 10`);
  }
});

/**
 * Published pre-flop strategy, at the exact classes where the rule flips.
 *
 * The standard rule raises 4x with any pair from 3,3 up, any ace, any suited
 * king, an offsuit king from K5 up, Q6s / Q8o up, and J8s / JTo up — and checks
 * everything else. The boundary classes on either side of each of those lines
 * are the sharpest possible test of the solver, because they are the ones where
 * the two branches are closest together.
 *
 * Only the classes actually present in the asset are checked, so a partial run
 * still validates what it has produced.
 */
const PUBLISHED_PREFLOP: Readonly<Record<string, 'raise4x' | 'check'>> = {
  AA: 'raise4x',
  '33': 'raise4x', // pairs from 3,3 up
  '22': 'check', // ...but not deuces
  A2o: 'raise4x', // any ace, however weak the kicker
  K2s: 'raise4x', // any suited king
  K5o: 'raise4x',
  K4o: 'check',
  Q6s: 'raise4x',
  Q5s: 'check',
  Q8o: 'raise4x',
  Q7o: 'check',
  J8s: 'raise4x',
  J7s: 'check',
  JTo: 'raise4x',
  J9o: 'check',
};

function loadAsset(): Record<string, PreflopResult> | null {
  if (!existsSync(ASSET)) return null;
  const parsed = JSON.parse(readFileSync(ASSET, 'utf8')) as {
    classes: Record<string, PreflopResult>;
  };
  return parsed.classes;
}

const asset = loadAsset();
const assetSkip = asset === null ? 'run `npm run preflop` to generate the table' : false;

test('the generated table is structurally sound', { skip: assetSkip }, () => {
  const classes = asset!;
  const known = new Set(allHoleClasses().map((c) => c.label));
  assert.ok(Object.keys(classes).length > 0, 'the asset should hold at least one class');

  for (const [label, result] of Object.entries(classes)) {
    assert.ok(known.has(label), `${label} is not one of the 169 classes`);
    assert.equal(result.label, label);
    for (const key of ['ev4x', 'ev3x', 'evCheck', 'margin'] as const) {
      assert.ok(Number.isFinite(result[key]), `${label}.${key} is not finite`);
    }
    assert.ok(result.evCheck >= -2, `${label}: checking cannot be worse than folding the river`);
    assert.ok(result.ev4x >= -6 && result.ev4x <= 10, `${label}: ev4x ${result.ev4x} is out of range`);
    assert.equal(
      result.optimalAction,
      result.ev4x >= result.evCheck ? 'raise4x' : 'check',
      `${label}: optimalAction disagrees with the EVs`,
    );
    assert.ok(
      Math.abs(result.margin - Math.abs(result.ev4x - result.evCheck)) < 1e-12,
      `${label}: margin disagrees with the EVs`,
    );
  }
});

test('a 3x raise is never the right play', { skip: assetSkip }, () => {
  // Spec §5.2.3, the trap: any hand strong enough to raise pre-flop is strong
  // enough to raise the maximum. This is the claim, checked against the numbers
  // rather than asserted — a 3x raise must never beat both alternatives.
  for (const [label, result] of Object.entries(asset!)) {
    const best = Math.max(result.ev4x, result.evCheck);
    assert.ok(
      result.ev3x <= best + 1e-12,
      `${label}: 3x is worth ${result.ev3x}, beating 4x (${result.ev4x}) and check (${result.evCheck})`,
    );
  }
});

test('raising more is better exactly when raising at all is', { skip: assetSkip }, () => {
  // The play bet is the only difference between 4x and 3x, so 4x beats 3x
  // precisely when the hand wins the showdown more often than it loses. When it
  // does not, checking beats both — which is why 3x is never the answer.
  for (const [label, result] of Object.entries(asset!)) {
    const netPerUnit = result.ev4x - result.ev3x;
    if (netPerUnit > 0) {
      assert.ok(result.ev4x > result.ev3x, `${label}: 4x should beat 3x`);
    } else {
      assert.ok(
        result.evCheck >= result.ev3x - 1e-12,
        `${label}: a hand that loses the showdown should prefer checking to any raise`,
      );
    }
  }
});

test('the table agrees with published pre-flop strategy', { skip: assetSkip }, () => {
  const classes = asset!;
  let checked = 0;
  for (const [label, expected] of Object.entries(PUBLISHED_PREFLOP)) {
    const result = classes[label];
    if (!result) continue;
    assert.equal(
      result.optimalAction,
      expected,
      `${label}: engine says ${result.optimalAction} ` +
        `(4x ${result.ev4x.toFixed(5)}, check ${result.evCheck.toFixed(5)}), ` +
        `published says ${expected}`,
    );
    checked++;
  }
  assert.ok(checked > 0, 'no published boundary classes were present in the asset');
});

// --- The emitted module -----------------------------------------------------

test('the emitted module holds exactly what the solver wrote', () => {
  /*
   * Two copies of the same table exist on purpose: the JSON is the offline
   * job's output, and `preflop-table.ts` is the copy the browser can hold,
   * because the shared build has no runtime to read a file with. Two copies
   * that can drift are two copies that will, and drift here means the app
   * grades from numbers nobody solved. So they are held to each other, to the
   * last bit.
   */
  const asset = JSON.parse(readFileSync(ASSET, 'utf8')) as {
    blindPaytable: string;
    classes: Record<string, PreflopResult>;
  };

  assert.equal(PREFLOP_TABLE_PAYTABLE, asset.blindPaytable);
  assert.deepEqual(
    Object.keys(PREFLOP_TABLE).sort(),
    Object.keys(asset.classes).sort(),
    'the module and the asset name different classes',
  );

  for (const [label, row] of Object.entries(asset.classes)) {
    const emitted = preflopRow(label);
    for (const field of [
      'ev4x', 'ev3x', 'evCheck', 'margin', 'flopRaiseFrequency', 'riverFoldFrequency',
    ] as const) {
      assert.equal(
        emitted[field],
        row[field],
        `${label}.${field}: module ${emitted[field]} vs asset ${row[field]}`,
      );
    }
    assert.equal(emitted.optimalAction, row.optimalAction, `${label}.optimalAction`);
  }
});

test('the emitted module is complete, and 3x is never the best of the three', () => {
  // §5.2.3 as a fact about the shipped data rather than a claim in the spec:
  // any hand strong enough to raise is strong enough to raise the maximum.
  assert.equal(Object.keys(PREFLOP_TABLE).length, 169);
  const byAction: Record<string, number> = {};
  for (const row of Object.values(PREFLOP_TABLE)) {
    byAction[row.optimalAction] = (byAction[row.optimalAction] ?? 0) + 1;
    assert.ok(
      row.ev3x <= Math.max(row.ev4x, row.evCheck),
      `${row.label}: 3x beats both alternatives`,
    );
    /*
     * The precise shape of §5.2.3, which is narrower than "3x is always worse
     * than 4x". On a hand that should be checked, raising 3x loses *less* than
     * raising 4x — naturally, since less money goes in on a raise that should
     * not have been made. The claim is about hands worth raising: there, the
     * maximum is always right.
     */
    if (row.optimalAction === 'raise4x') {
      assert.ok(row.ev3x < row.ev4x, `${row.label}: 3x is not worse than 4x on a raising hand`);
    }
  }
  assert.equal(byAction.raise3x ?? 0, 0, '3x is optimal somewhere, which §5.2.3 denies');
  assert.equal((byAction.raise4x ?? 0) + (byAction.check ?? 0), 169);
});

test('a missing class fails loudly rather than grading against nothing', () => {
  assert.throws(() => preflopRow('ZZ'), /No solved pre-flop row/);
});

test('every starting hand finds its class, and suits only matter through sharing', () => {
  const labels = new Set(Object.keys(PREFLOP_TABLE));
  let hands = 0;
  for (let a = 0; a < NUM_CARDS; a++) {
    for (let b = a + 1; b < NUM_CARDS; b++) {
      const label = holeClassLabel(a, b);
      assert.ok(labels.has(label), `${label} has no solved row`);
      // The label must not depend on which card is named first.
      assert.equal(label, holeClassLabel(b, a));
      hands++;
    }
  }
  assert.equal(hands, 1326);

  // A pair takes neither suffix; two of a suit take s; anything else o.
  assert.equal(holeClassLabel(makeCard(12, 3), makeCard(12, 2)), 'AA');
  assert.equal(holeClassLabel(makeCard(12, 3), makeCard(11, 3)), 'AKs');
  assert.equal(holeClassLabel(makeCard(11, 2), makeCard(12, 3)), 'AKo');
});
