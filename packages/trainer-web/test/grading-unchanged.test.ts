/**
 * Nothing about grading moved (round 13).
 *
 * The round changes what a figure on screen *means*. The promise that came with
 * it is that it changes nothing else — so before a line of it was written, sixty
 * blackjack hands and forty Ultimate hands were played out with a fixed shoe and
 * a fixed, deliberately mixed set of decisions, and everything the change must
 * leave alone was recorded: the grade, what each mistake cost, the rating
 * movement, the stored EVs, the track and the hand log.
 *
 * `test/fixtures/grading-golden.json` is that recording, taken from the build
 * that was live. This replays the same hands against the build that is here now
 * and holds it to every one of those numbers.
 *
 * The one thing deliberately left out of the comparison is the walkthrough's
 * prose, because the figures inside it are exactly what the round changed. It is
 * kept in the fixture all the same, and the last test below checks that every
 * figure now quoted in it is a return of one of the EVs beside it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { returned } from '../src/returns.ts';
import { gradedRun, gradedUthRun } from './helpers/grading-run.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(HERE, 'fixtures', 'grading-golden.json'), 'utf8')) as {
  bj: ReturnType<typeof gradedRun>;
  uth: ReturnType<typeof gradedUthRun>;
};

/** Everything about a decision except the words it was explained in. */
const withoutProse = (row: Record<string, unknown>) => {
  const { steps, ...rest } = row;
  return rest;
};

test('the same hands are graded exactly as they were: sixty hands, decision by decision', () => {
  const now = gradedRun();
  assert.equal(now.decisions.length, golden.bj.decisions.length, 'a different number of decisions');
  now.decisions.forEach((row, index) => {
    assert.deepEqual(
      withoutProse(row),
      withoutProse(golden.bj.decisions[index]!),
      `decision ${index + 1} (${row.headline}) is graded differently`,
    );
  });
});

test('and the totals they add up to: the rating, the track, the log, what was lost', () => {
  const now = gradedRun();
  assert.deepEqual(now.rating, golden.bj.rating, 'the rating moved');
  assert.deepEqual(now.stats, golden.bj.stats, 'the session totals moved');
  assert.deepEqual(now.track, golden.bj.track, 'the track moved');
  assert.deepEqual(now.log, golden.bj.log, 'the hand log moved');
  // The stored EVs are still net of the stake. Only the reading changed.
  const stored = now.decisions.flatMap((row) => (row.ranked as Array<[string, number]>).map(([, ev]) => ev));
  assert.ok(stored.some((ev) => ev < 0), 'no stored EV is negative any more, which means one was converted');
});

test('Ultimate too: forty hands, the same grades, costs, EVs and rating', () => {
  const now = gradedUthRun();
  assert.equal(now.decisions.length, golden.uth.decisions.length);
  now.decisions.forEach((row, index) => {
    assert.deepEqual(row, golden.uth.decisions[index]!, `Ultimate decision ${index + 1} is graded differently`);
  });
  assert.deepEqual(now.rating, golden.uth.rating, 'the Ultimate rating moved');
  assert.deepEqual(now.stats, golden.uth.stats, 'the Ultimate totals moved');
  assert.deepEqual(now.log, golden.uth.log, 'the Ultimate hand log moved');
});

test('every figure the walkthrough now quotes is a return of an EV beside it', () => {
  const run = gradedRun();
  let quoted = 0;
  for (const row of run.decisions) {
    const evs = (row.ranked as Array<[string, number]>).map(([, ev]) => ev);
    // Insurance stakes half a unit, so its figures are per unit of that.
    const stake = String(row.headline).toLowerCase().includes('insurance') ? 0.5 : 1;
    const wanted = new Set(evs.map((ev) => returned(ev, stake).toFixed(3)));
    // Gaps are quoted too, and they are differences rather than values.
    const gaps = new Set<string>();
    for (const a of evs) for (const b of evs) gaps.add(Math.abs(a - b).toFixed(3));
    for (const step of row.steps as string[]) {
      for (const match of step.matchAll(/[+−](\d\.\d{3})\b/g)) {
        const figure = match[1]!;
        quoted++;
        assert.ok(
          wanted.has(figure) || gaps.has(figure),
          `${String(row.headline)}: the walkthrough quotes ${String(figure)}, which is neither a return nor a gap here`,
        );
      }
    }
  }
  assert.ok(quoted > 60, `only ${quoted} figures were checked`);
});
