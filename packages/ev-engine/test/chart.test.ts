/**
 * Cross-validation of derived charts against published strategy (spec §14.2),
 * plus the golden-file regression the spec asks for in §14.4.
 *
 * This is the sharpest test in the suite. A basic-strategy grid is 310 discrete
 * verdicts, many of them decided by a hundredth of a unit, and it is downstream
 * of every part of the engine — dealer distribution, hit recursion, doubling,
 * splitting, surrender, the peek rule. A dealer-probability error large enough
 * to matter shows up here as a flipped cell.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACTION_LETTERS,
  deriveChart,
  formatChart,
  HARD_TOTALS,
  SOFT_TOTALS,
  type StrategyChart,
} from '../src/blackjack/chart.ts';
import { getPreset, makeRules, RULE_PRESETS } from '../src/blackjack/rules.ts';
import { scenarioKey } from '../src/blackjack/scenario.ts';
import { ACE, TEN, type BjRank } from '../src/blackjack/shoe.ts';
import {
  KNOWN_MARGINAL,
  NAMED_DEVIATIONS,
  SIX_DECK_H17_DAS_LS,
  SIX_DECK_S17_DAS_LS,
  UPCARD_ORDER,
  type PublishedChart,
} from './fixtures/published-strategy.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, 'golden');

/** Upcards in the published column order: 2..9, 10, A. */
const UPCARDS: BjRank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

const pairLabel = (rank: BjRank) =>
  rank === ACE ? 'A,A' : rank === TEN ? 'T,T' : `${rank + 1},${rank + 1}`;

function diffAgainstPublished(chart: StrategyChart, published: PublishedChart): string[] {
  const problems: string[] = [];

  const check = (key: string, expected: string, where: string) => {
    const cell = chart.cells.get(key);
    assert.ok(cell, `chart is missing ${key}`);
    const got = ACTION_LETTERS[cell.optimalAction];
    if (got === expected) return;
    if (KNOWN_MARGINAL.has(key)) return;
    problems.push(
      `${where}: engine says ${got} (${cell.optimalAction}, margin ${cell.margin.toFixed(4)}), ` +
        `published says ${expected}`,
    );
  };

  for (const total of HARD_TOTALS) {
    const row = published.hard[total];
    assert.ok(row, `published chart has no hard ${total}`);
    UPCARDS.forEach((upcard, i) => {
      check(scenarioKey({ kind: 'hard', total, upcard }), row[i]!, `hard ${total} vs ${UPCARD_ORDER[i]}`);
    });
  }
  for (const total of SOFT_TOTALS) {
    const row = published.soft[total];
    assert.ok(row, `published chart has no soft ${total}`);
    UPCARDS.forEach((upcard, i) => {
      check(scenarioKey({ kind: 'soft', total, upcard }), row[i]!, `A${total - 11} vs ${UPCARD_ORDER[i]}`);
    });
  }
  for (let rank = 0; rank < 10; rank++) {
    const row = published.pairs[pairLabel(rank)];
    assert.ok(row, `published chart has no ${pairLabel(rank)}`);
    UPCARDS.forEach((upcard, i) => {
      check(
        scenarioKey({ kind: 'pair', pairRank: rank, upcard }),
        row[i]!,
        `${pairLabel(rank)} vs ${UPCARD_ORDER[i]}`,
      );
    });
  }

  return problems;
}

for (const [published, overrides] of [
  [SIX_DECK_H17_DAS_LS, { decks: 6, soft17: 'H17' as const, das: true, surrender: 'late' as const }],
  [SIX_DECK_S17_DAS_LS, { decks: 6, soft17: 'S17' as const, das: true, surrender: 'late' as const }],
] as const) {
  test(`derived chart matches published strategy: ${published.name}`, () => {
    const chart = deriveChart(makeRules(overrides), { cardRemoval: 'static-dealer' });
    const problems = diffAgainstPublished(chart, published);
    assert.equal(
      problems.length,
      0,
      `${problems.length} cell(s) disagree with published strategy:\n  ${problems.join('\n  ')}`,
    );
  });
}

test('rule changes produce the deviations they are famous for', () => {
  // Each of these is a discrete, well-attested consequence of one rule changing.
  // Reproducing them is evidence the engine computes from the rule set rather
  // than reciting a memorised chart (spec §6.1, §3.3).
  const charts = new Map<string, StrategyChart>();
  for (const { preset } of NAMED_DEVIATIONS) {
    if (!charts.has(preset)) {
      charts.set(preset, deriveChart(getPreset(preset).rules, { cardRemoval: 'static-dealer' }));
    }
  }
  for (const { preset, scenarioKey: key, expect, why } of NAMED_DEVIATIONS) {
    const cell = charts.get(preset)!.cells.get(key);
    assert.ok(cell, `${preset} has no cell ${key}`);
    assert.equal(cell.optimalAction, expect, `${preset} ${key}: ${why}`);
  }
});

test('H17 flips exactly the cells it is supposed to, and no others', () => {
  // Spec §3.3: correctness is rule-dependent, and the app has to know precisely
  // which cells are rule-sensitive so the feedback card can flag them.
  const s17 = deriveChart(
    makeRules({ decks: 6, soft17: 'S17', das: true, surrender: 'late' }),
    { cardRemoval: 'static-dealer' },
  );
  const h17 = deriveChart(
    makeRules({ decks: 6, soft17: 'H17', das: true, surrender: 'late' }),
    { cardRemoval: 'static-dealer' },
  );

  const flipped = new Set<string>();
  for (const [key, cell] of s17.cells) {
    const other = h17.cells.get(key);
    if (other && other.optimalAction !== cell.optimalAction) flipped.add(key);
  }

  assert.deepEqual(
    [...flipped].sort(),
    [
      'bj:hard11:vsA',
      'bj:hard15:vsA',
      'bj:hard17:vsA',
      'bj:pair8:vsA',
      'bj:soft18:vs2',
      'bj:soft19:vs6',
    ].sort(),
  );
});

test('every scenario in the mastery grid has a cell', () => {
  // Spec §5.1.4: 130 hard + 80 soft + 100 pair + insurance.
  const chart = deriveChart(makeRules(), { cardRemoval: 'static-dealer' });
  assert.equal(chart.cells.size, 130 + 80 + 100 + 1);
  for (const cell of chart.cells.values()) {
    assert.ok(cell.evByAction[cell.optimalAction] !== undefined);
    assert.ok(Number.isFinite(cell.optimalEv));
    assert.ok(cell.margin >= 0, `${cell.scenarioKey} has a negative margin`);
  }
});

test('marginal cells are marked, not hidden', () => {
  // Spec §14.2: cells where two actions are within a rounding error are the ones
  // published sources disagree about. The engine has to be able to name them.
  const chart = deriveChart(makeRules(), { cardRemoval: 'static-dealer' });
  const marginal = [...chart.cells.values()]
    .filter((c) => c.margin < 0.005 && c.scenario.kind !== 'insurance')
    .map((c) => c.scenarioKey);
  assert.ok(marginal.length > 0, 'a real chart has close cells; finding none means the margins are wrong');
  assert.ok(marginal.length < 40, `${marginal.length} cells within 0.005 looks like a bug, not a chart`);
  // Soft 18 against a deuce under H17 is the textbook contested cell: published
  // sources split on double versus stand because the two are within three
  // thousandths of a unit. It should surface as marginal, not as a confident
  // verdict the feedback card would present without a caveat.
  assert.ok(
    marginal.includes('bj:soft18:vs2'),
    `expected A,7 vs 2 among the close cells; got ${marginal.join(', ')}`,
  );

  // And the canonical near-tie should be close without being inside that band,
  // which is why standing on 16 against a ten grades as negligible rather than
  // as no error at all (spec §3.2, §7.2).
  const sixteenVsTen = deriveChart(makeRules({ surrender: 'none' }), {
    cardRemoval: 'static-dealer',
  }).cells.get('bj:hard16:vs10')!;
  assert.equal(sixteenVsTen.optimalAction, 'hit');
  assert.ok(
    sixteenVsTen.margin > 0.005 && sixteenVsTen.margin < 0.03,
    `16 v 10 margin was ${sixteenVsTen.margin}`,
  );
});

/**
 * Spec §14.4: the complete generated chart for every preset is snapshotted, and
 * a change to these files in a diff requires explicit sign-off. Regenerate with
 * `npm run charts:golden` and read the diff before committing it.
 */
test('golden charts are unchanged', () => {
  const update = process.env.UPDATE_GOLDEN === '1';
  if (update) mkdirSync(GOLDEN_DIR, { recursive: true });

  for (const preset of RULE_PRESETS) {
    const chart = deriveChart(preset.rules, { cardRemoval: 'static-dealer' });
    const rendered = formatChart(chart);
    const path = join(GOLDEN_DIR, `${preset.id}.txt`);

    if (update) {
      writeFileSync(path, rendered);
      continue;
    }
    assert.ok(existsSync(path), `missing golden file ${path}; run UPDATE_GOLDEN=1 npm test`);
    assert.equal(
      readFileSync(path, 'utf8'),
      rendered,
      `${preset.id} chart changed. This needs explicit sign-off (spec §14.4).`,
    );
  }
});
