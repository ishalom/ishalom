/**
 * The chip row has to add up.
 *
 * While the chips were blank, how many were drawn was decoration, and a cap
 * that dropped the last few cost nothing. Once each one is labelled with what
 * it is worth, a player can add the row up — and if it does not equal the
 * figure printed beside it, the rail is quietly lying about their money.
 *
 * So this checks the shipped function, over every balance a session can
 * plausibly reach, in the half-unit steps a surrender produces.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Lift `DENOMINATIONS` and `chipNodes` out of the client script.
 *
 * They live inside the page rather than in a module, because the page has no
 * build step and nothing to import from. Slicing them out tests the code that
 * actually ships instead of a copy that could drift from it.
 */
function loadChipNodes(): (amount: number, cap: number) => Array<{ value: string }> {
  const source = readFileSync(join(HERE, '..', 'public', 'app.js'), 'utf8');
  const from = source.indexOf('const DENOMINATIONS');
  assert.ok(from > 0, 'DENOMINATIONS is gone from app.js');
  const fnAt = source.indexOf('function chipNodes', from);
  assert.ok(fnAt > 0, 'chipNodes is gone from app.js');
  const end = source.indexOf('\n}\n', fnAt);
  assert.ok(end > 0, 'could not find the end of chipNodes');

  const slice = source.slice(from, end + 3);
  const factory = new Function(
    '__document',
    `const document = __document;\n${slice}\nreturn chipNodes;`,
  );
  return factory({
    createElement: () => ({ className: '', textContent: '' }),
  }) as (amount: number, cap: number) => Array<{ value: string }>;
}

const chipNodes = loadChipNodes();

/** What the row is worth, read the way a player would read it. */
function total(chips: Array<{ textContent?: unknown }>): number {
  return chips.reduce((sum, chip) => {
    const face = String((chip as { textContent: unknown }).textContent);
    return sum + (face === '½' ? 0.5 : Number(face));
  }, 0);
}

test('every chip says what it is worth', () => {
  for (const chip of chipNodes(186, 24) as Array<{ textContent?: unknown }>) {
    const face = String(chip.textContent);
    assert.ok(face.length > 0, 'a blank chip');
    assert.ok(face === '½' || Number.isFinite(Number(face)), `unreadable face: ${face}`);
  }
});

test('the row adds up to the balance, for every balance a session can reach', () => {
  // A stack starts at 200 and moves a unit or so at a time; 600 is far beyond
  // any run this app will see, and the half-steps are what surrender leaves.
  let mostChips = 0;
  for (let amount = 0; amount <= 600; amount += 0.5) {
    const chips = chipNodes(amount, 24);
    assert.equal(total(chips), amount, `${amount} does not add up`);
    mostChips = Math.max(mostChips, chips.length);
  }
  // If this ever approaches the cap, the cap is about to start truncating and
  // the assertion above is about to start failing for real money.
  assert.ok(mostChips <= 20, `a balance needed ${mostChips} chips, which is close to the cap`);
});

test('a wager adds up too, including a doubled split and insurance', () => {
  // Four hands, each doubled, plus half a unit of insurance is the most that can
  // ever be on the felt at once.
  for (const wager of [1, 2, 4, 8, 8.5, 0.5]) {
    assert.equal(total(chipNodes(wager, 12)), wager, `wager ${wager} does not add up`);
  }
});

test('nothing on the felt draws no chips', () => {
  assert.equal(chipNodes(0, 24).length, 0);
  // A stack cannot go below zero on screen; the figure beside it still can, and
  // that is where a negative belongs — not as a row of imaginary chips.
  assert.equal(chipNodes(-5, 24).length, 0);
});

test('big denominations come first, so the row reads high to low', () => {
  const faces = (chipNodes(186, 24) as Array<{ textContent?: unknown }>).map((c) =>
    Number(String(c.textContent)),
  );
  const sorted = [...faces].sort((a, b) => b - a);
  assert.deepEqual(faces, sorted, 'the chips are out of order');
  assert.deepEqual(faces, [100, 25, 25, 25, 5, 5, 1]);
});
