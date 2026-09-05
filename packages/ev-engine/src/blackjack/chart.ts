/**
 * Strategy charts derived from the solver (spec §6.1, §6.5).
 *
 * The app does not hardcode a chart copied from a website. It computes EV from
 * first principles and derives the chart from the computation; published charts
 * are only ever a cross-check (spec §14.2). That is what lets it answer for rule
 * combinations nobody happened to publish.
 *
 * Total-dependent, not composition-dependent
 * ------------------------------------------
 * A published basic-strategy chart has one cell per (total, upcard), so its
 * recommendation is the action that wins *on average across the compositions
 * that reach that total*, weighted by how often each occurs. Hard 16 against a
 * ten is the standard example: 10+6 and 9+7 can disagree with each other, and
 * the chart cell is the frequency-weighted verdict.
 *
 * So each cell here averages the EV of every legal action over all two-card
 * compositions of that total, weighting each composition by its probability from
 * a fresh shoe with the upcard removed. Pair compositions are excluded from the
 * hard and soft rows because they have their own row.
 *
 * Live grading does not have to use the chart: the solver can grade the exact
 * cards in front of the player. The chart is what the Reference screen shows,
 * what §14.2 diffs against published sources, and what §14.4 snapshots.
 */

import type { BlackjackAction } from './actions.ts';
import { BlackjackSolver, insuranceEv, type CardRemovalMode } from './ev.ts';
import { handValue } from './hand.ts';
import { rulesKey, type BlackjackRules } from './rules.ts';
import {
  INSURANCE_SCENARIO_KEY,
  scenarioKey,
  upcardLabel,
  type Scenario,
} from './scenario.ts';
import { ACE, NUM_BJ_RANKS, RANK_VALUE, Shoe, TEN, type BjRank } from './shoe.ts';

export interface ChartCell {
  scenarioKey: string;
  scenario: Scenario;
  /** Frequency-weighted EV of each legal action, in units of the wager. */
  evByAction: Partial<Record<BlackjackAction, number>>;
  optimalAction: BlackjackAction;
  optimalEv: number;
  /**
   * Gap between the best and second-best action. Cells with a tiny margin are
   * the ones published sources disagree about, and the ones §14.2 documents as
   * known-marginal rather than silently overriding.
   */
  margin: number;
}

export interface StrategyChart {
  rulesKey: string;
  rules: BlackjackRules;
  cardRemoval: CardRemovalMode;
  cells: Map<string, ChartCell>;
}

export const HARD_TOTALS: readonly number[] = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
/** A2 through A9, i.e. soft 13 through soft 20. */
export const SOFT_TOTALS: readonly number[] = [13, 14, 15, 16, 17, 18, 19, 20];
export const PAIR_RANKS: readonly BjRank[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
export const UPCARDS: readonly BjRank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]; // 2..9, T, A

interface WeightedHand {
  cards: [BjRank, BjRank];
  weight: number;
}

/**
 * Two-card compositions of a hard total, excluding pairs (they get their own
 * row), weighted by how often they come off a fresh shoe with the upcard gone.
 */
function hardCompositions(total: number, shoe: Shoe): WeightedHand[] {
  const out: WeightedHand[] = [];
  for (let a = 1; a < NUM_BJ_RANKS; a++) {
    for (let b = a + 1; b < NUM_BJ_RANKS; b++) {
      // No ace: any two-card hand containing one is soft.
      if (RANK_VALUE[a]! + RANK_VALUE[b]! !== total) continue;
      const weight = shoe.count(a) * shoe.count(b);
      if (weight > 0) out.push({ cards: [a, b], weight });
    }
  }
  return out;
}

function softCompositions(total: number, shoe: Shoe): WeightedHand[] {
  // Soft 13 is A,2. The kicker's *rank index* is one below its value, since
  // index 1 is the deuce; A,10 is a natural and is never a chart cell.
  const kickerValue = total - 11;
  if (kickerValue < 2 || kickerValue > 9) return [];
  const kicker = kickerValue - 1;
  const weight = shoe.count(ACE) * shoe.count(kicker);
  return weight > 0 ? [{ cards: [ACE, kicker], weight }] : [];
}

function pairCompositions(rank: BjRank, shoe: Shoe): WeightedHand[] {
  const n = shoe.count(rank);
  return n >= 2 ? [{ cards: [rank, rank], weight: n * (n - 1) }] : [];
}

function compositionsFor(scenario: Scenario, shoe: Shoe): WeightedHand[] {
  switch (scenario.kind) {
    case 'hard':
      return hardCompositions(scenario.total!, shoe);
    case 'soft':
      return softCompositions(scenario.total!, shoe);
    case 'pair':
      return pairCompositions(scenario.pairRank!, shoe);
    case 'insurance':
      return [];
  }
}

export interface DeriveChartOptions {
  /**
   * Defaults to `'exact'`: a chart is generated once and then cached or shipped,
   * so it should be the ground truth rather than the interactive compromise.
   */
  cardRemoval?: CardRemovalMode;
  /** Called after each cell, for progress reporting on the offline job. */
  onCell?: (cell: ChartCell, done: number, total: number) => void;
}

/** Every scenario in the mastery grid, in a stable order (spec §5.1.4). */
export function allScenarios(): Scenario[] {
  const out: Scenario[] = [];
  for (const upcard of UPCARDS) {
    for (const total of HARD_TOTALS) out.push({ kind: 'hard', total, upcard });
    for (const total of SOFT_TOTALS) out.push({ kind: 'soft', total, upcard });
    for (const pairRank of PAIR_RANKS) out.push({ kind: 'pair', pairRank, upcard });
  }
  out.push({ kind: 'insurance' });
  return out;
}

export function deriveChart(
  rules: BlackjackRules,
  options: DeriveChartOptions = {},
): StrategyChart {
  const cardRemoval = options.cardRemoval ?? 'exact';
  const solver = new BlackjackSolver(rules, { cardRemoval });
  const scenarios = allScenarios();
  const cells = new Map<string, ChartCell>();

  let done = 0;
  for (const scenario of scenarios) {
    const cell =
      scenario.kind === 'insurance'
        ? insuranceCell(rules)
        : deriveCell(scenario, solver, rules);
    if (cell !== null) {
      cells.set(cell.scenarioKey, cell);
      options.onCell?.(cell, ++done, scenarios.length);
    }
  }

  return { rulesKey: rulesKey(rules), rules, cardRemoval, cells };
}

/** One cell, averaged over the compositions that reach it. */
export function deriveCell(
  scenario: Scenario,
  solver: BlackjackSolver,
  rules: BlackjackRules,
): ChartCell | null {
  const upcard = scenario.upcard!;
  const base = Shoe.fresh(rules.decks);
  base.remove(upcard);

  const comps = compositionsFor(scenario, base);
  if (comps.length === 0) return null;

  const totals = new Map<BlackjackAction, number>();
  let weightSum = 0;

  for (const { cards, weight } of comps) {
    const shoe = base.clone();
    shoe.removeAll(cards);
    const evaluation = solver.evaluate(cards, upcard, shoe);
    weightSum += weight;
    for (const action of evaluation.legalActions) {
      const ev = evaluation.evByAction[action]!;
      totals.set(action, (totals.get(action) ?? 0) + weight * ev);
    }
  }

  const evByAction: Partial<Record<BlackjackAction, number>> = {};
  for (const [action, sum] of totals) evByAction[action] = sum / weightSum;

  const ranked = [...totals.keys()].sort(
    (a, b) => evByAction[b]! - evByAction[a]!,
  );
  const optimalAction = ranked[0]!;
  const optimalEv = evByAction[optimalAction]!;
  const runnerUp = ranked[1];

  return {
    scenarioKey: scenarioKey(scenario),
    scenario,
    evByAction,
    optimalAction,
    optimalEv,
    margin: runnerUp === undefined ? Infinity : optimalEv - evByAction[runnerUp]!,
  };
}

/**
 * Insurance is a bet on the hole card alone, so from a fresh shoe it is one
 * number and it is negative under every standard shoe. The player's own hand
 * never enters it, which is the whole lesson.
 */
function insuranceCell(rules: BlackjackRules): ChartCell {
  const shoe = Shoe.fresh(rules.decks);
  shoe.remove(ACE); // the dealer's ace is showing
  const take = insuranceEv(shoe);
  return {
    scenarioKey: INSURANCE_SCENARIO_KEY,
    scenario: { kind: 'insurance' },
    evByAction: { stand: 0, hit: take },
    optimalAction: take > 0 ? 'hit' : 'stand',
    optimalEv: Math.max(0, take),
    margin: Math.abs(take),
  };
}

/** Compact chart letters, the notation published charts use. */
export const ACTION_LETTERS: Readonly<Record<BlackjackAction, string>> = {
  hit: 'H',
  stand: 'S',
  double: 'D',
  split: 'P',
  surrender: 'R',
};

/**
 * Render the chart as fixed-width text, one grid per section. This is the form
 * §14.4 snapshots and §14.2 diffs, so its layout is part of the contract: a
 * change to it should show up in review as a change to the golden files.
 */
export function formatChart(chart: StrategyChart): string {
  const lines: string[] = [];
  lines.push(`# ${chart.rulesKey}`);
  lines.push(`# card removal: ${chart.cardRemoval}`);

  const header = '     ' + UPCARDS.map((u) => upcardLabel(u).padStart(3)).join('');

  const section = (title: string, rows: Array<{ label: string; scenario: (u: BjRank) => Scenario }>) => {
    lines.push('');
    lines.push(title);
    lines.push(header);
    for (const row of rows) {
      const cells = UPCARDS.map((u) => {
        const cell = chart.cells.get(scenarioKey(row.scenario(u)));
        return (cell ? ACTION_LETTERS[cell.optimalAction] : '.').padStart(3);
      });
      lines.push(row.label.padEnd(5) + cells.join(''));
    }
  };

  section(
    'hard',
    HARD_TOTALS.map((total) => ({
      label: String(total),
      scenario: (upcard: BjRank) => ({ kind: 'hard' as const, total, upcard }),
    })),
  );
  section(
    'soft',
    SOFT_TOTALS.map((total) => ({
      label: `A${total - 11}`,
      scenario: (upcard: BjRank) => ({ kind: 'soft' as const, total, upcard }),
    })),
  );
  section(
    'pairs',
    PAIR_RANKS.map((pairRank) => ({
      label: pairRank === ACE ? 'A,A' : pairRank === TEN ? 'T,T' : `${pairRank + 1},${pairRank + 1}`,
      scenario: (upcard: BjRank) => ({ kind: 'pair' as const, pairRank, upcard }),
    })),
  );

  const ins = chart.cells.get(INSURANCE_SCENARIO_KEY);
  lines.push('');
  lines.push(`insurance  ${ins ? (ins.optimalAction === 'hit' ? 'take' : 'decline') : '.'}`);
  return lines.join('\n') + '\n';
}
