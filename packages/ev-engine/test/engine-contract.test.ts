/**
 * The architectural promises the spec makes about this module (§12).
 *
 * "The EV engine is pure and deterministic — same inputs, same outputs, no I/O.
 * This makes it exhaustively testable." That claim is load-bearing for
 * everything above it, so it is tested rather than trusted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { allScenarios, deriveChart } from '../src/blackjack/chart.ts';
import { BlackjackSolver } from '../src/blackjack/ev.ts';
import { makeRules, RULE_PRESETS, rulesKey, getPreset } from '../src/blackjack/rules.ts';
import { Shoe } from '../src/blackjack/shoe.ts';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith('.ts')) out.push(path);
  }
  return out;
}

test('the engine imports nothing outside itself', () => {
  // Dependency-free is a shipping requirement, not a preference: this module has
  // to build as a standalone library on any platform (spec §12, §6.5).
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)[^\n]*?from\s+'([^']+)'/g)) {
      const specifier = m[1]!;
      if (!specifier.startsWith('.')) {
        offenders.push(`${relative(SRC, file)} imports ${specifier}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'the EV engine must have no external imports');
});

test('the engine performs no I/O and reaches for no globals', () => {
  const offenders: string[] = [];
  const forbidden = [
    /\bnode:/,
    /\brequire\s*\(/,
    /\bprocess\./,
    /\bfetch\s*\(/,
    /\bMath\.random\b/,
    /\bDate\.now\b/,
    /\bnew Date\b/,
  ];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      if (pattern.test(text)) offenders.push(`${relative(SRC, file)} matches ${pattern}`);
    }
  }
  assert.deepEqual(offenders, [], 'the EV engine must be pure: no I/O, no clock, no randomness');
});

/** A concrete two-card hand for a scenario, as the chart builder would pick one. */
function handFor(scenario: { kind: string; total?: number; pairRank?: number }): number[] | null {
  if (scenario.kind === 'pair') return [scenario.pairRank!, scenario.pairRank!];
  if (scenario.kind === 'soft') return [0, scenario.total! - 12]; // A,2 is soft 13
  for (let a = 1; a < 10; a++) {
    for (let b = a + 1; b < 10; b++) {
      if (a + 1 + b + 1 === scenario.total!) return [a, b];
    }
  }
  return null;
}

test('the same inputs give the same outputs, cold or warm', () => {
  const rules = makeRules();
  const scenarios = allScenarios().filter((s) => s.kind !== 'insurance');

  const shared = new BlackjackSolver(rules);
  let checked = 0;
  for (const scenario of scenarios) {
    const cards = handFor(scenario);
    if (cards === null) continue;

    const build = () => {
      const shoe = Shoe.fresh(rules.decks);
      shoe.removeAll(cards);
      shoe.remove(scenario.upcard!);
      return shoe;
    };

    const cold = new BlackjackSolver(rules).evaluate(cards, scenario.upcard!, build());
    const warmOnce = shared.evaluate(cards, scenario.upcard!, build());
    const warmTwice = shared.evaluate(cards, scenario.upcard!, build());

    assert.deepEqual(warmOnce, cold, `a warm cache changed ${scenario.kind} ${cards} vs ${scenario.upcard}`);
    assert.deepEqual(warmTwice, cold, 'a second evaluation changed the answer');
    checked++;
  }
  assert.ok(checked > 250, `expected to cover the grid, only checked ${checked}`);
});

test('a rank outside the shoe is rejected, not absorbed', () => {
  const shoe = Shoe.fresh(6);
  for (const bad of [-1, 10, 1.5, NaN]) {
    assert.throws(() => shoe.remove(bad), /Not a blackjack rank/, `remove(${bad})`);
    assert.throws(() => shoe.restore(bad), /Not a blackjack rank/, `restore(${bad})`);
  }
  assert.equal(shoe.total, 312);
  assert.equal(shoe.sig, 0);
});

test('evaluation leaves the shoe untouched', () => {
  const rules = makeRules({ surrender: 'late' });
  const solver = new BlackjackSolver(rules);
  const shoe = Shoe.fresh(rules.decks);
  const cards = [7, 7]; // a pair of eights, the most recursive hand there is
  shoe.removeAll(cards);
  shoe.remove(9);

  const before = { key: shoe.key(), sig: shoe.sig, total: shoe.total };
  solver.evaluate(cards, 9, shoe);
  assert.deepEqual({ key: shoe.key(), sig: shoe.sig, total: shoe.total }, before);
});

test('clearing the cache does not change any answer', () => {
  const solver = new BlackjackSolver(makeRules(), { cardRemoval: 'static-dealer' });
  const shoe = () => {
    const s = Shoe.fresh(6);
    s.removeAll([7, 7]);
    s.remove(9);
    return s;
  };
  const first = solver.evaluate([7, 7], 9, shoe());
  assert.ok(solver.cacheSize > 0, 'the solver should be caching something');
  solver.clearCache();
  assert.equal(solver.cacheSize, 0);
  assert.deepEqual(solver.evaluate([7, 7], 9, shoe()), first);
});

test('rule presets are internally consistent', () => {
  const ids = new Set<string>();
  for (const preset of RULE_PRESETS) {
    assert.ok(!ids.has(preset.id), `duplicate preset id ${preset.id}`);
    ids.add(preset.id);
    assert.equal(getPreset(preset.id), preset);
    assert.ok(preset.name.length > 0);
    assert.ok([1, 2, 4, 6, 8].includes(preset.rules.decks));
  }
  assert.throws(() => getPreset('no-such-preset'));

  // The 6:5 preset carries its warning: the spec makes that a product
  // requirement, not a nicety (§5.1.1).
  const sixFive = RULE_PRESETS.find((p) => p.rules.blackjackPayout === '6:5')!;
  assert.match(sixFive.note ?? '', /6:5|house edge/i);
});

test('rule keys separate rule sets that really differ', () => {
  const base = makeRules();
  const keys = new Set([rulesKey(base)]);
  const variants = [
    { decks: 8 },
    { soft17: 'S17' as const },
    { double: '9-11' as const },
    { das: false },
    { surrender: 'none' as const },
    { maxSplitHands: 2 },
    { resplitAces: true },
    { hitSplitAces: true },
    { blackjackPayout: '6:5' as const },
    { peek: false },
  ];
  for (const v of variants) {
    const key = rulesKey(makeRules(v));
    assert.ok(!keys.has(key), `rulesKey collides for ${JSON.stringify(v)}`);
    keys.add(key);
  }
});

test('a chart carries the rule set it was derived under', () => {
  const rules = makeRules({ decks: 2, soft17: 'S17' });
  const chart = deriveChart(rules, { cardRemoval: 'static-dealer' });
  assert.equal(chart.rulesKey, rulesKey(rules));
  assert.equal(chart.rules, rules);
  assert.equal(chart.cardRemoval, 'static-dealer');
});
