/**
 * Fit the Ultimate rating's two constants, once (round 10).
 *
 * Blackjack's difficulty scale (docs/elo-difficulty.md) maps a decision's
 * expected leak L onto 800–2200 with two constants, fitted so the chart's cells
 * spread sensibly. Ultimate has no chart — every flop and river is a fresh
 * board — so its constants cannot be fitted the same way, and measurement
 * showed they must not be fitted by forcing a median: most Ultimate decisions
 * are obvious (L ≈ 0), and a median pinned to 1500 would rate an obvious call
 * as a median-hard one.
 *
 * So the fit asks the question the number has to answer instead: **a player who
 * is equally good at both games should get about the same number in both.**
 * "Equally good" is defined without reference to either game: the expected-leak
 * model's own player, who picks each action with probability ∝ exp(EV / τ).
 * Small τ is a sharp player; large τ a loose one. For each τ on a grid:
 *
 *   1. that player plays Blackjack (the app's default rules, natural deal) and
 *      Ultimate (an honest deck), and every graded decision is recorded — its
 *      EVs and the severity the engine gave the choice;
 *   2. the Blackjack rating is replayed exactly as the app computes it;
 *   3. the Ultimate rating is replayed under candidate constants;
 *
 * and the constants that bring the two ratings closest across the grid win.
 * The decisions do not depend on the rating, so each stream is dealt once and
 * replayed under every candidate.
 *
 * The same streams then answer the questions the brief asks of the result:
 * whether a stream of trivially correct decisions can lift a rating, whether a
 * deliberately bad strategy can out-rate good play, and how far the rating sits
 * from the Blackjack figure for each player.
 *
 *   node scripts/calibrate-uth-rating.ts [--hands N] [--seed N] [--cache file.json] [--snapshot test/fixtures/uth-difficulty.json]
 *
 * `--snapshot` writes the golden file `test/uth-rating.test.ts` holds the scale to:
 * the difficulty the constants in use give each of the 169 pre-flop hands and 80
 * flop and river decisions from a fixed deal, with the EVs they were given.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getPreset, type SeverityTier } from '@evtrainer/ev-engine';
import { BlackjackTable, UthTable } from '@evtrainer/game-engine';
import { PREFLOP_TABLE } from '@evtrainer/ev-engine/uth';

import { difficultyTable, newRating, updateRatingWithReach } from '../src/difficulty.ts';
import { chartFor } from '../src/sensitivity.ts';
import { UTH_INFORMATION_REACH, UTH_RATING, uthDifficulty, uthDifficultyFromLeak, updateUthRating } from '../src/uth-rating.ts';
import { expectedLeak } from '../src/difficulty.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const HANDS = Number(flag('--hands') ?? 4000);
const SEED = Number(flag('--seed') ?? 20260915);
const CACHE = flag('--cache');
const TAUS = [0.01, 0.03, 0.06, 0.12, 0.25, 0.5];
const PRESET = 'vegas-strip-6d-s17';

function generator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function choose(evs: Record<string, number>, legal: readonly string[], tau: number, random: () => number): string {
  const top = Math.max(...legal.map((a) => evs[a]!));
  const weights = legal.map((a) => Math.exp((evs[a]! - top) / tau));
  const total = weights.reduce((x, y) => x + y, 0);
  let r = random() * total;
  for (let i = 0; i < legal.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return legal[i]!;
  }
  return legal[legal.length - 1]!;
}

interface BjDecision { d: number; s: SeverityTier }
interface UthDecision { leak: number; s: SeverityTier; phase: string }
type Strategy = { name: string; pick: (phase: string, evs: Record<string, number>, legal: string[], random: () => number) => string };

function bjStream(tau: number, hands: number, seed: number): BjDecision[] {
  const rules = getPreset(PRESET).rules;
  const table = new BlackjackTable({ rules, seed });
  const cells = difficultyTable(rules, chartFor(rules));
  const random = generator(seed ^ 0x9e3779b9);
  const out: BjDecision[] = [];
  for (let h = 0; h < hands; h++) {
    table.startHand(1);
    for (;;) {
      const phase = table.view.phase;
      let record;
      if (phase === 'insurance') {
        const ev = table.insuranceEvaluation();
        record = table.takeInsurance(choose({ take: ev, decline: 0 }, ['take', 'decline'], tau, random) === 'take');
      } else if (phase === 'player') {
        const e = table.currentEvaluation();
        record = table.act(choose(e.evByAction as Record<string, number>, e.legalActions, tau, random) as never);
      } else break;
      const cell = cells.get(record.scenarioKey);
      if (cell) out.push({ d: cell.basic, s: record.severityTier });
    }
  }
  return out;
}

function uthStream(strategy: Strategy, hands: number, seed: number): UthDecision[] {
  const table = new UthTable({ seed });
  const random = generator(seed ^ 0x85ebca6b);
  const out: UthDecision[] = [];
  for (let h = 0; h < hands; h++) {
    table.startHand();
    while (table.legalActions().length > 0) {
      const legal = table.legalActions();
      const e = table.evaluate();
      const evs = Object.fromEntries(legal.map((a) => [a, e.evByAction[a]!]));
      const record = table.act(strategy.pick(e.phase, evs, legal, random) as never);
      out.push({ leak: expectedLeak(evs), s: record.severityTier, phase: e.phase });
    }
  }
  return out;
}

const tauPlayer = (tau: number): Strategy => ({ name: `τ=${tau}`, pick: (_p, evs, legal, r) => choose(evs, legal, tau, r) });
const best = (evs: Record<string, number>, legal: string[]) => legal.reduce((a, b) => (evs[b]! > evs[a]! ? b : a));
/** Deliberately bad ways to play, each looking for a cheaper climb than playing well. */
const STRATEGIES: Strategy[] = [
  { name: 'perfect', pick: (_p, evs, legal) => best(evs, legal) },
  // More decisions per hand: never raise before the river, then play it right.
  { name: 'check to the river, then right', pick: (p, evs, legal) => (p === 'river' ? best(evs, legal) : 'check') },
  // One easy decision per hand: always raise the maximum at once.
  { name: 'always raise 4× pre-flop', pick: () => 'raise4x' },
  // Right pre-flop, then check the flop always, to reach the river.
  { name: 'right pre-flop, always check the flop', pick: (p, evs, legal) => (p === 'flop' ? 'check' : best(evs, legal)) },
  // Never fold.
  { name: 'right, but never fold the river', pick: (p, evs, legal) => (p === 'river' ? 'raise1x' : best(evs, legal)) },
];

/**
 * The rating a stream settles at: the average over its second half, so K's
 * jitter at the end does not decide it.
 */
function settledBj(stream: BjDecision[], reach = Infinity): number {
  const rating = newRating('basic');
  let sum = 0;
  let n = 0;
  const half = Math.floor(stream.length / 2);
  stream.forEach((x, i) => {
    updateRatingWithReach(rating, x.d, x.s, reach);
    if (i >= half) { sum += rating.rating; n++; }
  });
  return sum / Math.max(1, n);
}

/** Blackjack's rating after each of `marks` decisions, to see how fast a player climbs. */
function climbBj(stream: BjDecision[], marks: number[], reach = Infinity): number[] {
  const rating = newRating('basic');
  const out: number[] = [];
  stream.forEach((x, i) => {
    updateRatingWithReach(rating, x.d, x.s, reach);
    if (marks.includes(i + 1)) out.push(Math.round(rating.rating));
  });
  return out;
}

function settledUth(stream: UthDecision[], constants: { slope: number; centre: number }, reach = Infinity): number {
  const rating = newRating('basic');
  const rated: number[] = [];
  for (const x of stream) {
    const d = uthDifficultyFromLeak(x.leak, constants);
    if (d === null) continue;
    updateUthRating(rating, d, x.s, reach);
    rated.push(rating.rating);
  }
  const tail = rated.slice(Math.floor(rated.length / 2));
  return tail.reduce((a, b) => a + b, 0) / Math.max(1, tail.length);
}

// --- Deal the streams, once ------------------------------------------------------------

let streams: { bj: Record<string, BjDecision[]>; uth: Record<string, UthDecision[]>; strategies: Record<string, UthDecision[]> };
if (CACHE && existsSync(CACHE)) {
  streams = JSON.parse(readFileSync(CACHE, 'utf8'));
  console.log(`streams read from ${CACHE}`);
} else {
  streams = { bj: {}, uth: {}, strategies: {} };
  const started = Date.now();
  for (const tau of TAUS) {
    streams.bj[tau] = bjStream(tau, HANDS * 3, SEED + Math.round(tau * 1000));
    streams.uth[tau] = uthStream(tauPlayer(tau), HANDS, SEED + Math.round(tau * 1000));
    console.log(`τ=${tau}: ${streams.bj[tau]!.length} rated Blackjack decisions, ${streams.uth[tau]!.length} Ultimate decisions (${Math.round((Date.now() - started) / 1000)}s)`);
  }
  for (const strategy of STRATEGIES) {
    streams.strategies[strategy.name] = uthStream(strategy, HANDS, SEED + 7);
    console.log(`${strategy.name}: ${streams.strategies[strategy.name]!.length} decisions`);
  }
  if (CACHE) writeFileSync(CACHE, JSON.stringify(streams));
}

// --- Fit ---------------------------------------------------------------------------------

const REACH = 400;
const bjRating = Object.fromEntries(TAUS.map((tau) => [tau, settledBj(streams.bj[tau]!)]));
const lossOf = (constants: { slope: number; centre: number }) =>
  TAUS.reduce((loss, tau) => loss + (settledUth(streams.uth[tau]!, constants, REACH) - bjRating[tau]!) ** 2, 0);
/*
 * One constraint, Blackjack's off-grid rule: a decision with no leak at all must
 * fall below the scale and never be rated. Without it the best fit is free to
 * rate an obvious call well above 800, and the reach limit would then let a run
 * of obvious calls climb 400 above that — the cheap ladder again.
 */
const obviousIsOffTheScale = (c: { slope: number; centre: number }) => uthDifficultyFromLeak(0, c) === null;
function search(allowed: (c: { slope: number; centre: number }) => boolean) {
  let best = { slope: 0, centre: 0, loss: Infinity };
  for (let slope = 300; slope <= 1200; slope += 50) {
    for (let centre = -3.4; centre <= -1.0; centre += 0.05) {
      if (!allowed({ slope, centre })) continue;
      const loss = lossOf({ slope, centre });
      if (loss < best.loss) best = { slope, centre, loss };
    }
  }
  const coarse = { ...best };
  for (let slope = coarse.slope - 50; slope <= coarse.slope + 50; slope += 10) {
    for (let centre = coarse.centre - 0.05; centre <= coarse.centre + 0.05; centre += 0.01) {
      if (!allowed({ slope, centre })) continue;
      const loss = lossOf({ slope, centre });
      if (loss < best.loss) best = { slope, centre, loss };
    }
  }
  return { slope: best.slope, centre: +best.centre.toFixed(2) };
}
const rms = (c: { slope: number; centre: number }) => Math.sqrt(lossOf(c) / TAUS.length).toFixed(1);
const free = search(() => true);
const fit = search(obviousIsOffTheScale);
console.log(`\nunconstrained best: slope ${free.slope}, centre ${free.centre} (RMS gap ${rms(free)}); a no-leak decision would be rated ${uthDifficultyFromLeak(0, free) ?? 'off the scale'}${obviousIsOffTheScale(free) ? '' : ' — rejected'}`);
console.log(`Blackjack's own:    slope 700, centre -2.2 (RMS gap ${rms({ slope: 700, centre: -2.2 })})`);
console.log(`fitted:             slope ${fit.slope}, centre ${fit.centre} (RMS gap ${rms(fit)} rating points across the ${TAUS.length} players)`);
const FITTED = { slope: fit.slope, centre: fit.centre };
const same = UTH_RATING.slope === fit.slope && UTH_RATING.centre === fit.centre;
console.log(`in use:             slope ${UTH_RATING.slope}, centre ${UTH_RATING.centre}${same ? ' — the same' : ' — DIFFERENT: paste the fitted values into src/uth-rating.ts and refresh the snapshot'}`);

console.log('\nthe same player in both games (settled rating, second half of each stream), Ultimate with the reach limit and without:');
for (const tau of TAUS) {
  const stream = streams.uth[tau]!;
  const offGrid = stream.filter((x) => uthDifficultyFromLeak(x.leak, FITTED) === null).length / stream.length;
  console.log(
    `  τ=${String(tau).padEnd(5)} Blackjack ${bjRating[tau]!.toFixed(0).padStart(5)}   Ultimate ${settledUth(stream, FITTED, REACH).toFixed(0).padStart(5)}` +
      `   (no limit ${settledUth(stream, FITTED).toFixed(0).padStart(5)})   ${(100 * offGrid).toFixed(0)}% of its decisions off the scale`,
  );
}

const allUth = Object.values(streams.uth).flat();
const ratedAll = allUth.map((x) => uthDifficultyFromLeak(x.leak, FITTED)).filter((d): d is number => d !== null).sort((a, b) => a - b);
const pct = (q: number) => ratedAll[Math.min(ratedAll.length - 1, Math.floor(q * ratedAll.length))];
console.log(`\nrated Ultimate decisions: ${ratedAll.length} of ${allUth.length}; difficulty p10 ${pct(0.1)}, p25 ${pct(0.25)}, median ${pct(0.5)}, p75 ${pct(0.75)}, p90 ${pct(0.9)}`);

console.log('\nthe trivial ladder: only the easiest rated decisions, every one correct (rating after N):');
const easiest = allUth.map((x) => uthDifficultyFromLeak(x.leak, FITTED)).filter((d): d is number => d !== null && d <= 900);
const ladder = (reach: number) => {
  const rating = newRating('basic');
  const at: Record<number, number> = {};
  for (let i = 0; i < 5000; i++) {
    updateUthRating(rating, easiest[i % easiest.length]!, 'optimal', reach);
    if ([30, 150, 600, 2000, 5000].includes(i + 1)) at[i + 1] = Math.round(rating.rating);
  }
  return at;
};
if (easiest.length === 0) {
  console.log('  no rated decision in the sample is as easy as 900');
} else {
  console.log(`  ${easiest.length} such decisions in the sample; their difficulty ${Math.min(...easiest)}–900`);
  console.log(`  plain update:      ${JSON.stringify(ladder(Infinity))}`);
  console.log(`  with reach ${REACH}:   ${JSON.stringify(ladder(REACH))}`);
}

console.log('\ndeliberate strategies in Ultimate, against playing it right (reach limit on):');
for (const [name, stream] of Object.entries(streams.strategies)) {
  const rated = stream.filter((x) => uthDifficultyFromLeak(x.leak, FITTED) !== null).length;
  console.log(`  ${name.padEnd(40)} rating ${settledUth(stream, FITTED, REACH).toFixed(0).padStart(5)}   ${stream.length} decisions, ${rated} rated`);
}

// --- The golden file -----------------------------------------------------------------------

const SNAPSHOT = flag('--snapshot');
if (SNAPSHOT) {
  const cases: Array<{ from: string; evByAction: Record<string, number>; difficulty: number | null }> = [];
  for (const row of Object.values(PREFLOP_TABLE)) {
    const evByAction = { raise4x: row.ev4x, raise3x: row.ev3x, check: row.evCheck };
    cases.push({ from: `pre-flop ${row.label}`, evByAction, difficulty: uthDifficulty(evByAction) });
  }
  const table = new UthTable({ seed: 20260914 });
  for (let hand = 0; cases.length < 169 + 80; hand++) {
    table.startHand();
    while (table.legalActions().length > 0 && cases.length < 169 + 80) {
      const legal = table.legalActions();
      const e = table.evaluate();
      const evByAction = Object.fromEntries(legal.map((a) => [a, e.evByAction[a]!]));
      if (e.phase !== 'preflop') cases.push({ from: `${e.phase}, hand ${hand + 1}`, evByAction, difficulty: uthDifficulty(evByAction) });
      table.act((legal.includes('check') ? 'check' : 'raise1x') as never);
    }
  }
  writeFileSync(SNAPSHOT, `${JSON.stringify({ constants: UTH_RATING, reach: UTH_INFORMATION_REACH, cases }, null, 1)}
`);
  console.log(`
snapshot of ${cases.length} decisions written to ${SNAPSHOT}`);
}

// --- Blackjack under the same limit (round 11) ------------------------------------------

if (flag('--blackjack-limit') !== undefined || args.includes('--blackjack-limit')) {
  console.log('\nround 11 — Blackjack with the reach limit, and what it costs:');
  console.log('  the same player (settled rating): Blackjack before → after the limit, and Ultimate (already limited)');
  let before = 0;
  let after = 0;
  for (const tau of TAUS) {
    const plain = settledBj(streams.bj[tau]!);
    const limited = settledBj(streams.bj[tau]!, REACH);
    const uth = settledUth(streams.uth[tau]!, UTH_RATING, REACH);
    before += (uth - plain) ** 2;
    after += (uth - limited) ** 2;
    console.log(`  τ=${String(tau).padEnd(5)} Blackjack ${plain.toFixed(0).padStart(5)} → ${limited.toFixed(0).padStart(5)} (${(limited - plain).toFixed(0).padStart(4)})   Ultimate ${uth.toFixed(0).padStart(5)}`);
  }
  console.log(`  gap between the games (RMS): ${Math.sqrt(before / TAUS.length).toFixed(1)} before, ${Math.sqrt(after / TAUS.length).toFixed(1)} after`);

  const marks = [30, 100, 300, 1000, 3000];
  console.log(`\n  how fast a Blackjack player climbs: rating after ${marks.join(' / ')} rated decisions, before → after`);
  for (const tau of TAUS) {
    const a = climbBj(streams.bj[tau]!, marks);
    const b = climbBj(streams.bj[tau]!, marks, REACH);
    console.log(`  τ=${String(tau).padEnd(5)} ${a.join(' / ')}   →   ${b.join(' / ')}   (largest difference ${Math.max(...a.map((v, i) => Math.abs(v - b[i]!)))})`);
  }

  const easyBj = Object.values(streams.bj).flat().map((x) => x.d).filter((d) => d <= 900);
  const ladderBj = (reach: number) => {
    const rating = newRating('basic');
    const at: Record<number, number> = {};
    for (let i = 0; i < 5000; i++) {
      updateRatingWithReach(rating, easyBj[i % easyBj.length]!, 'optimal', reach);
      if ([30, 150, 600, 2000, 5000].includes(i + 1)) at[i + 1] = Math.round(rating.rating * 10) / 10;
    }
    return at;
  };
  console.log(`\n  the Blackjack trivial ladder: ${easyBj.length} dealt decisions at difficulty ≤ 900, every one right`);
  console.log(`  plain update:    ${JSON.stringify(ladderBj(Infinity))}`);
  console.log(`  with the limit:  ${JSON.stringify(ladderBj(REACH))}`);
}
