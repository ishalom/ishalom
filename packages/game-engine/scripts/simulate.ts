/**
 * Simulation validation (spec §14.3).
 *
 * "Run 10^8 simulated hands playing the engine's recommended action. The
 * realized house edge must converge to the analytically expected value for that
 * rule set within confidence bounds. This catches state-machine bugs that unit
 * tests miss."
 *
 * That is exactly what this does, and it is a genuinely independent check: the
 * analytic figure comes from the EV engine enumerating every opening deal, while
 * the realized figure comes from the game engine dealing a shuffled shoe, taking
 * actions, playing the dealer out and settling the money. The two share no code
 * path. A state machine that pays a natural wrongly, mis-orders split hands, or
 * lets the dealer stand on the wrong total shows up here and nowhere else.
 *
 *   node scripts/simulate.ts [--hands N] [--seed N] [--rules preset-id]
 */

import { houseEdge, getPreset, makeRules, type BlackjackRules } from '@evtrainer/ev-engine';
import { BlackjackTable } from '../src/table.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const hands = Number(flag('--hands') ?? 1_000_000);
const seed = Number(flag('--seed') ?? 1);
const presetId = flag('--rules');
const rules: BlackjackRules = presetId ? getPreset(presetId).rules : makeRules();

process.stdout.write(`Rules: ${JSON.stringify(rules)}\n`);
process.stdout.write('Computing the analytic expectation...\n');
const analytic = houseEdge(rules);
process.stdout.write(`Analytic house edge: ${analytic.percent.toFixed(4)}%\n\n`);

const table = new BlackjackTable({ rules, seed });
let wagered = 0;
let net = 0;
let sumSquares = 0;
const started = Date.now();

for (let i = 0; i < hands; i++) {
  table.startHand(1);
  for (;;) {
    const phase = table.view.phase;
    if (phase === 'insurance') {
      table.takeInsurance(table.insuranceEvaluation() > 0);
      continue;
    }
    if (phase !== 'player') break;
    table.act(table.currentEvaluation().optimalAction);
  }
  const result = table.handRecord.netUnits;
  wagered += 1; // house edge is quoted per unit of the original wager
  net += result;
  sumSquares += result * result;

  if ((i + 1) % 500_000 === 0) {
    const soFar = (-net / wagered) * 100;
    process.stdout.write(
      `${(i + 1).toLocaleString()} hands: realized ${soFar.toFixed(4)}% ` +
        `(analytic ${analytic.percent.toFixed(4)}%)\n`,
    );
  }
}

const realizedEv = net / wagered;
const variance = sumSquares / wagered - realizedEv * realizedEv;
const standardError = Math.sqrt(variance / wagered);
const difference = realizedEv - analytic.expectedValue;
const sigmas = Math.abs(difference) / standardError;
const seconds = (Date.now() - started) / 1000;

process.stdout.write(
  `\n${hands.toLocaleString()} hands in ${seconds.toFixed(0)}s ` +
    `(${Math.round(hands / seconds).toLocaleString()} hands/s)\n` +
    `realized  EV ${realizedEv.toFixed(6)}  (house edge ${(-realizedEv * 100).toFixed(4)}%)\n` +
    `analytic  EV ${analytic.expectedValue.toFixed(6)}  (house edge ${analytic.percent.toFixed(4)}%)\n` +
    `difference   ${difference.toFixed(6)}  = ${sigmas.toFixed(2)} standard errors\n` +
    `${sigmas < 3 ? 'CONVERGED' : 'DIVERGED — the game engine and the EV engine disagree'}\n`,
);
process.exit(sigmas < 3 ? 0 : 1);
