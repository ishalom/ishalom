/**
 * Simulation validation (spec §14.3), in miniature.
 *
 * "Run 10^8 simulated hands playing the engine's recommended action. The
 * realized house edge must converge to the analytically expected value for that
 * rule set within confidence bounds. This catches state-machine bugs that unit
 * tests miss."
 *
 * The full run lives in `scripts/simulate.ts`. What runs here is the same check
 * at a size a test suite can afford, plus the invariants that hold at any size —
 * a hand never settles at an impossible amount, the bet the player put up is the
 * bet that gets resolved, and every decision the engine recommends is one it
 * considers legal.
 *
 * The two sides are genuinely independent: the analytic figure comes from the EV
 * engine enumerating every opening deal, the realized figure from the game
 * engine shuffling, dealing, acting, playing the dealer out and paying. A state
 * machine that mis-pays a natural or mis-orders split hands shows up here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getPreset,
  houseEdge,
  makeRules,
  RULE_PRESETS,
  type BlackjackRules,
} from '@evtrainer/ev-engine';
import { BlackjackTable } from '../src/table.ts';

const slow = process.env.EV_ENGINE_SLOW_TESTS ? false : 'set EV_ENGINE_SLOW_TESTS=1';

interface Run {
  hands: number;
  net: number;
  meanEv: number;
  standardError: number;
  decisions: number;
}

/** Play `hands` hands, always taking the engine's own recommendation. */
function play(rules: BlackjackRules, hands: number, seed: number): Run {
  const table = new BlackjackTable({ rules, seed });
  let net = 0;
  let sumSquares = 0;
  let decisions = 0;

  for (let i = 0; i < hands; i++) {
    table.startHand(1);
    for (;;) {
      const phase = table.view.phase;
      if (phase === 'insurance') {
        table.takeInsurance(table.insuranceEvaluation() > 0);
        decisions++;
        continue;
      }
      if (phase !== 'player') break;

      const evaluation = table.currentEvaluation();
      const legal = table.legalActions();
      assert.ok(
        legal.includes(evaluation.optimalAction),
        `the engine recommended ${evaluation.optimalAction}, which it does not consider legal`,
      );
      table.act(evaluation.optimalAction);
      decisions++;
    }

    const result = table.handRecord.netUnits;
    // The most a single hand can win is four split hands doubled, and the most
    // it can lose is the same. Anything outside that is a settlement bug.
    assert.ok(result >= -8 && result <= 8, `a hand settled at ${result} units`);
    net += result;
    sumSquares += result * result;
  }

  const meanEv = net / hands;
  const variance = sumSquares / hands - meanEv * meanEv;
  return { hands, net, meanEv, standardError: Math.sqrt(variance / hands), decisions };
}

test('perfect play realises the analytic house edge', () => {
  // 200,000 hands puts the standard error near 0.0026, so this catches a
  // settlement or state-machine error worth about a hundredth of a unit. The
  // full 10^8-hand version narrows that by a factor of twenty.
  const rules = makeRules();
  const analytic = houseEdge(rules);
  const run = play(rules, 200_000, 20260909);

  const sigmas = Math.abs(run.meanEv - analytic.expectedValue) / run.standardError;
  assert.ok(
    sigmas < 4,
    `realized EV ${run.meanEv.toFixed(6)} vs analytic ${analytic.expectedValue.toFixed(6)}: ` +
      `${sigmas.toFixed(2)} standard errors apart`,
  );
  assert.ok(run.decisions > run.hands, 'every hand should produce at least one decision');
});

test('every shipped preset loses money, as §1 promises it must', () => {
  // Spec §1's explicit non-goal: the app does not make either game profitable.
  // The presets are the games people actually sit down at.
  for (const preset of RULE_PRESETS) {
    const edge = houseEdge(preset.rules);
    assert.ok(edge.expectedValue < 0, `${preset.id} came out non-negative`);
    assert.ok(edge.percent < 3, `${preset.id} edge of ${edge.percent.toFixed(3)}% looks wrong`);
  }
});

test('a liberal single deck favours the player, which is why nobody deals one', () => {
  // Not a bug, and worth pinning: one deck with DAS, doubling on any two and the
  // dealer standing on soft 17 is a positive-expectation game, by about a sixth
  // of a per cent. Casinos close the gap by paying 6:5 and restricting doubling,
  // and the shipped single-deck preset does exactly that — so this pair of
  // assertions is the engine rediscovering, from EV alone, why that rule exists.
  const liberal = houseEdge(makeRules({ decks: 1, soft17: 'S17', das: true, double: 'any2' }));
  assert.ok(
    liberal.expectedValue > 0,
    `a liberal single deck should favour the player, got ${liberal.percent.toFixed(4)}%`,
  );
  assert.ok(liberal.percent > -0.5, 'but only barely');

  const asDealt = houseEdge(getPreset('single-deck-6-5').rules);
  assert.ok(
    asDealt.percent > 1.5,
    `the 6:5 single-deck game should be far worse, got ${asDealt.percent.toFixed(4)}%`,
  );
});

test('more decks cost the player, all else equal', () => {
  let previous = -Infinity;
  for (const decks of [1, 2, 4, 6, 8]) {
    const edge = houseEdge(makeRules({ decks, soft17: 'S17', surrender: 'none' }));
    assert.ok(
      edge.percent > previous,
      `${decks} decks (${edge.percent.toFixed(4)}%) should not beat the smaller shoe`,
    );
    previous = edge.percent;
  }
});

test('6:5 costs about the 1.4% the spec claims it does', () => {
  // Spec §5.1.1 puts a number in front of the user: "this rule alone adds roughly
  // 1.4% to the house edge". The engine should be able to back its own copy.
  const base = houseEdge(makeRules({ blackjackPayout: '3:2' }));
  const short = houseEdge(makeRules({ blackjackPayout: '6:5' }));
  const added = short.percent - base.percent;
  assert.ok(added > 1.3 && added < 1.5, `6:5 added ${added.toFixed(3)}%`);
});

test(
  'the edge holds up over two million hands',
  { skip: slow },
  () => {
    const rules = makeRules({ soft17: 'S17', surrender: 'late' });
    const analytic = houseEdge(rules);
    const run = play(rules, 2_000_000, 8675309);
    const sigmas = Math.abs(run.meanEv - analytic.expectedValue) / run.standardError;
    assert.ok(
      sigmas < 4,
      `realized ${run.meanEv.toFixed(6)} vs analytic ${analytic.expectedValue.toFixed(6)}: ` +
        `${sigmas.toFixed(2)} standard errors`,
    );
  },
);
