/**
 * Scenario difficulty and the player's rating (docs/elo-difficulty.md).
 *
 * The first working slice of the design: the difficulty functions and the Elo
 * update. The adaptive *selector* is deliberately absent — that needs the
 * shipped frequency asset and a drill dealer, and it must live somewhere the
 * §14.3 simulation cannot reach.
 *
 * Two rules from the design are load-bearing and implemented here:
 *
 *   - **Off-grid decisions never score.** Hard 18 through 21 have no chart cell
 *     (`HARD_TOTALS` stops at 17) yet `scenarioKeyForHand` produces those keys
 *     constantly — around 15% of real decisions. Standing on 19 is trivially
 *     correct, so rating them would hand every player a stream of free points.
 *   - **Partial credit scales S, never K.** Putting severity in the K-factor
 *     would make the equilibrium rating depend on the K schedule, so the number
 *     would change meaning whenever K was retuned.
 */

import {
  deriveChart,
  RANK_VALUE,
  Shoe,
  scenarioForHand,
  scenarioKey,
  type BlackjackRules,
  type SeverityTier,
  type StrategyChart,
} from '@evtrainer/ev-engine';

export type DifficultyMode = 'basic' | 'recall' | 'value';

/** Player noise temperature for the expected-leak model. */
const TAU = 0.05;

/** Fitted on three rule sets; they varied under 5%, so they are constants. */
const MODES: Readonly<Record<DifficultyMode, { slope: number; centre: number }>> = {
  basic: { slope: 700, centre: -2.2 },
  recall: { slope: 660, centre: 0.64 },
  value: { slope: 450, centre: -2.05 },
};

/** Natural frequency of each opening scenario, per 1000 hands. */
function naturalFrequency(rules: BlackjackRules): Map<string, number> {
  const counts = Array.from({ length: 10 }, (_, r) =>
    r === 9 ? rules.decks * 16 : rules.decks * 4,
  );
  const n = rules.decks * 52;
  const out = new Map<string, number>();
  for (let a = 0; a < 10; a++) {
    for (let b = a; b < 10; b++) {
      for (let u = 0; u < 10; u++) {
        const na = counts[a]!;
        const nb = a === b ? counts[b]! - 1 : counts[b]!;
        const nu = counts[u]! - (u === a ? 1 : 0) - (u === b ? 1 : 0);
        if (nb <= 0 || nu <= 0) continue;
        const ways = (a === b ? na * nb : 2 * na * nb) * nu;
        const key = scenarioKey(scenarioForHand([a, b], u, a === b));
        const per1000 = (ways / (n * (n - 1) * (n - 2))) * 1000;
        out.set(key, (out.get(key) ?? 0) + per1000);
      }
    }
  }
  // Insurance is not an opening two-card scenario, so the loop above never
  // produces its key. It is offered whenever the dealer shows an ace, which is
  // one hand in thirteen.
  out.set('bj:insurance', (counts[0]! / n) * 1000);
  return out;
}

/**
 * Expected units given up by a noisy player, per encounter.
 *
 * Neither margin nor evCost answers "what does not knowing this cell cost":
 * margin is the cost of the least-bad error, which rates hard 17 against a six
 * as catastrophic when nobody hits a 17 against a six. This weights each action
 * by how plausibly it gets chosen.
 *
 * It is humped in margin, peaking near 0.06 — razor-thin cells cost nothing to
 * miss, obvious ones are never missed, and the money is in the middle.
 */
export function expectedLeak(evByAction: Partial<Record<string, number>>): number {
  const evs = Object.values(evByAction).filter((v): v is number => v !== undefined);
  if (evs.length === 0) return 0;
  const best = Math.max(...evs);
  const weights = evs.map((ev) => Math.exp((ev - best) / TAU));
  const total = weights.reduce((a, b) => a + b, 0);
  return evs.reduce((acc, ev, i) => acc + (weights[i]! / total) * (best - ev), 0);
}

export interface ScenarioDifficulty {
  scenarioKey: string;
  margin: number;
  leak: number;
  perThousand: number;
  basic: number;
  recall: number;
  value: number;
}

const cache = new Map<string, Map<string, ScenarioDifficulty>>();

const clamp = (x: number) => Math.max(800, Math.min(2200, Math.round(x / 5) * 5));

/** Difficulty for every chart cell, in all three modes. Memoised per rule set. */
export function difficultyTable(
  rules: BlackjackRules,
  chart: StrategyChart,
): Map<string, ScenarioDifficulty> {
  const cached = cache.get(chart.rulesKey);
  if (cached) return cached;

  const frequency = naturalFrequency(rules);
  const table = new Map<string, ScenarioDifficulty>();

  for (const [key, cell] of chart.cells) {
    const leak = expectedLeak(cell.evByAction);
    const perThousand = frequency.get(key) ?? 0.15;
    const m = cell.margin;

    const basicX = Math.log10(leak + 3e-4);
    const recallX = -Math.log10(m + 0.004) - 0.5 * Math.log10(perThousand + 0.15);
    const valueX = Math.log10((leak + 3e-4) * (perThousand + 0.15));

    table.set(key, {
      scenarioKey: key,
      margin: m,
      leak,
      perThousand,
      basic: clamp(1500 + MODES.basic.slope * (basicX - MODES.basic.centre)),
      recall: clamp(1500 + MODES.recall.slope * (recallX - MODES.recall.centre)),
      value: clamp(1500 + MODES.value.slope * (valueX - MODES.value.centre)),
    });
  }

  cache.set(chart.rulesKey, table);
  return table;
}

/** Partial credit by severity. Errors are graded by cost, never binary (§3.2). */
export function scoreFor(severity: SeverityTier): number {
  switch (severity) {
    case 'optimal':
      return 1;
    case 'negligible':
      return 0.5;
    case 'minor':
      return 0.25;
    default:
      return 0;
  }
}

export function kFactor(ratedDecisions: number): number {
  if (ratedDecisions < 30) return 40;
  if (ratedDecisions < 150) return 24;
  if (ratedDecisions < 600) return 16;
  return 10; // never lower: a rating that only climbs is the ratchet §16 forbids
}

export function expectedScore(playerRating: number, handRating: number): number {
  return 1 / (1 + 10 ** ((handRating - playerRating) / 400));
}

export interface Rating {
  mode: DifficultyMode;
  rating: number;
  peak: number;
  ratedDecisions: number;
  provisional: boolean;
  sessionDelta: number;
}

export function newRating(mode: DifficultyMode = 'basic'): Rating {
  return { mode, rating: 1200, peak: 1200, ratedDecisions: 0, provisional: true, sessionDelta: 0 };
}

/** One decision's worth of movement. Returns the change, for display. */
export function updateRating(
  rating: Rating,
  handRating: number,
  severity: SeverityTier,
): number {
  const expected = expectedScore(rating.rating, handRating);
  const k = kFactor(rating.ratedDecisions);
  const delta = k * (scoreFor(severity) - expected);

  rating.rating = Math.max(800, Math.min(2200, rating.rating + delta));
  rating.ratedDecisions++;
  rating.provisional = rating.ratedDecisions < 30;
  rating.peak = Math.max(rating.peak, rating.rating);
  rating.sessionDelta += delta;
  return delta;
}
