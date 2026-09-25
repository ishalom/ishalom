/**
 * How many graded decisions a hand holds, in each game — measured, not argued
 * (round 10).
 *
 * The Ultimate rating was specified on a claim about decisions per hand, and the
 * claim was disputed. This deals real hands through the two game engines the app
 * plays on, grades every decision exactly as the sessions do, and counts. It also
 * records what the rating would be fitted on: the expected leak of every
 * Ultimate decision, and the Basic difficulty of every rated Blackjack decision.
 *
 * Two players are measured in each game, because how many decisions a hand holds
 * depends on how it is played: an Ultimate hand checked pre-flop goes on to the
 * flop, one raised does not.
 *
 *   - perfect: always the engine's best action;
 *   - noisy:   the expected-leak model's player (docs/elo-difficulty.md) —
 *              actions chosen with probability ∝ exp(EV / 0.05), so near-ties
 *              are coin-flips and blunders are rare, like a person who knows
 *              the game roughly.
 *
 *   node scripts/measure-decisions.ts [--bj N] [--uth N] [--seed N] [--out file.json]
 */

import { writeFileSync } from 'node:fs';
import { getPreset } from '@evtrainer/ev-engine';
import { BlackjackTable, UthTable } from '@evtrainer/game-engine';

import { difficultyTable, expectedLeak } from '../src/difficulty.ts';
import { chartFor } from '../src/sensitivity.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const BJ_HANDS = Number(flag('--bj') ?? 200_000);
const UTH_HANDS = Number(flag('--uth') ?? 20_000);
const SEED = Number(flag('--seed') ?? 20260914);
const OUT = flag('--out');

/** The hosted app's default rules: the sitting most players are at. */
const PRESET = 'vegas-strip-6d-s17';
const TAU = 0.05;

/** A small seeded generator for the noisy player's choices, independent of the deal. */
function generator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Policy = 'perfect' | 'noisy';

function choose(evByAction: Record<string, number>, legal: readonly string[], policy: Policy, random: () => number): string {
  let best = legal[0]!;
  for (const a of legal) if (evByAction[a]! > evByAction[best]!) best = a;
  if (policy === 'perfect') return best;
  const top = evByAction[best]!;
  const weights = legal.map((a) => Math.exp((evByAction[a]! - top) / TAU));
  const total = weights.reduce((x, y) => x + y, 0);
  let r = random() * total;
  for (let i = 0; i < legal.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return legal[i]!;
  }
  return legal[legal.length - 1]!;
}

const percentile = (sorted: number[], p: number) =>
  sorted.length === 0 ? NaN : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
const describe = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, p10: percentile(s, 0.1), p25: percentile(s, 0.25), p50: percentile(s, 0.5), p75: percentile(s, 0.75), p90: percentile(s, 0.9) };
};
const spread = (counts: number[]) => {
  const total = counts.reduce((a, b) => a + b, 0);
  return counts.map((c, k) => `${k}: ${((100 * c) / total).toFixed(1)}%`).join(', ');
};

// --- Blackjack ---------------------------------------------------------------------

function measureBlackjack(policy: Policy) {
  const rules = getPreset(PRESET).rules;
  const table = new BlackjackTable({ rules, seed: SEED });
  const cells = difficultyTable(rules, chartFor(rules));
  const random = generator(SEED + 1);
  let decisions = 0;
  let rated = 0;
  const perHand: number[] = [];
  const difficulty: number[] = [];

  for (let h = 0; h < BJ_HANDS; h++) {
    table.startHand(1);
    let inHand = 0;
    for (;;) {
      const phase = table.view.phase;
      let record;
      if (phase === 'insurance') {
        const ev = table.insuranceEvaluation();
        const take = choose({ take: ev, decline: 0 }, ['take', 'decline'], policy, random) === 'take';
        record = table.takeInsurance(take);
      } else if (phase === 'player') {
        const evaluation = table.currentEvaluation();
        const action = choose(evaluation.evByAction as Record<string, number>, evaluation.legalActions, policy, random);
        record = table.act(action as never);
      } else break;
      inHand++;
      const cell = cells.get(record.scenarioKey);
      if (cell) {
        rated++;
        difficulty.push(cell.basic);
      }
    }
    decisions += inHand;
    perHand[inHand] = (perHand[inHand] ?? 0) + 1;
  }
  return {
    policy,
    hands: BJ_HANDS,
    decisionsPerHand: decisions / BJ_HANDS,
    ratedPerHand: rated / BJ_HANDS,
    handsBy: spread(Array.from(perHand, (c) => c ?? 0)),
    dealtBasicDifficulty: describe(difficulty),
    cellBasicDifficulty: describe([...cells.values()].map((c) => c.basic)),
  };
}

// --- Ultimate ----------------------------------------------------------------------

function measureUltimate(policy: Policy) {
  const table = new UthTable({ seed: SEED });
  const random = generator(SEED + 2);
  let decisions = 0;
  let solveMs = 0;
  const perHand: number[] = [];
  const byPhase: Record<string, number> = { preflop: 0, flop: 0, river: 0 };
  const samples: Array<{ phase: string; leak: number; evByAction: Record<string, number>; legal: string[] }> = [];
  const started = Date.now();

  for (let h = 0; h < UTH_HANDS; h++) {
    table.startHand();
    let inHand = 0;
    while (table.legalActions().length > 0) {
      const legal = table.legalActions();
      const evaluation = table.evaluate();
      solveMs += evaluation.solveMs;
      const evs = Object.fromEntries(legal.map((a) => [a, evaluation.evByAction[a]!]));
      samples.push({ phase: evaluation.phase, leak: expectedLeak(evs), evByAction: evs, legal: [...legal] });
      byPhase[evaluation.phase]!++;
      table.act(choose(evs, legal, policy, random) as never);
      inHand++;
    }
    decisions += inHand;
    perHand[inHand] = (perHand[inHand] ?? 0) + 1;
  }
  const x = samples.map((s) => Math.log10(s.leak + 3e-4));
  return {
    summary: {
      policy,
      hands: UTH_HANDS,
      decisionsPerHand: decisions / UTH_HANDS,
      handsBy: spread(Array.from(perHand, (c) => c ?? 0)),
      byPhase: Object.fromEntries(Object.entries(byPhase).map(([k, v]) => [k, +(v / UTH_HANDS).toFixed(4)])),
      leakX: describe(x),
      solveSeconds: +(solveMs / 1000).toFixed(1),
      wallSeconds: Math.round((Date.now() - started) / 1000),
    },
    samples,
  };
}

const result: Record<string, unknown> = { preset: PRESET, seed: SEED };
for (const policy of ['perfect', 'noisy'] as const) {
  const bj = measureBlackjack(policy);
  console.log(`Blackjack, ${policy}:`, JSON.stringify(bj));
  result[`blackjack_${policy}`] = bj;
}
for (const policy of ['perfect', 'noisy'] as const) {
  const uth = measureUltimate(policy);
  console.log(`Ultimate, ${policy}:`, JSON.stringify(uth.summary));
  result[`ultimate_${policy}`] = uth.summary;
  if (OUT) result[`ultimate_${policy}_samples`] = uth.samples;
}
if (OUT) {
  writeFileSync(OUT, JSON.stringify(result));
  console.log(`samples written to ${OUT}`);
}
