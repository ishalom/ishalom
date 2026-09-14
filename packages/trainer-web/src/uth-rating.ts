/**
 * The Ultimate rating (round 10; spec B as approved).
 *
 * The same machinery as Blackjack's (docs/elo-difficulty.md, difficulty.ts), fed
 * differently, because Ultimate has no chart: every flop and river is a fresh
 * board. So a decision's difficulty is worked out at the moment it is graded,
 * from the EVs the grade already has — the 169-hand table before the flop, the
 * exact solve on the flop and river. Nothing is solved to rate a decision.
 *
 * What is Blackjack's, unchanged: the expected-leak measure and its floor, the
 * 800–2200 scale, the expected score, partial credit by severity, the K schedule,
 * the start at 1200, provisional until 30 rated decisions. One mode only, Basic.
 *
 * What is Ultimate's own, and why:
 *
 *   - **Two constants**, fitted once by `scripts/calibrate-uth-rating.ts` so a
 *     player who is equally sharp at both games lands on about the same number
 *     in both, then hard-coded here. Never recomputed live: 1700 must not quietly
 *     change meaning. `test/uth-rating.test.ts` holds them to a golden snapshot.
 *   - **Off the scale means off the grid.** A decision so obvious that its
 *     difficulty falls below 800 is not rated — Blackjack's rule for hard 18–21,
 *     where standing is trivially right. Most Ultimate decisions are like that.
 *   - **An easy decision can only lift a rating so far above itself.** Found by
 *     the trivial-ladder test: under the plain update, a long enough run of easy,
 *     correct decisions climbs without limit, because a perfect record on easy
 *     questions has no finite best estimate. A correct answer now lifts a rating
 *     no higher than 400 above the decision's difficulty — the point at which the
 *     model already expects it right ten times in eleven, so getting it right says
 *     almost nothing more. A wrong answer costs exactly what it always did.
 */

import type { SeverityTier } from '@evtrainer/ev-engine';

import { expectedLeak, updateRating, type Rating } from './difficulty.ts';

/** Fitted by scripts/calibrate-uth-rating.ts on 2026-09-14. Do not retune without refitting and a new snapshot. */
export const UTH_RATING: Readonly<{ slope: number; centre: number }> = { slope: 660, centre: -2.25 };

/** Blackjack's leak floor: below it the leak stops meaning anything. */
const LEAK_FLOOR = 3e-4;

/** How far above a decision's difficulty a correct answer can still lift a rating. */
export const UTH_INFORMATION_REACH = 400;

/** Difficulty from a leak already worked out, or null when it is below the scale. */
export function uthDifficultyFromLeak(
  leak: number,
  constants: { slope: number; centre: number } = UTH_RATING,
): number | null {
  const raw = 1500 + constants.slope * (Math.log10(leak + LEAK_FLOOR) - constants.centre);
  if (!(raw >= 800)) return null;
  return Math.min(2200, Math.round(raw / 5) * 5);
}

/**
 * A graded Ultimate decision's difficulty on the 800–2200 scale, from its legal
 * actions' EVs — or null when it is too obvious to rate.
 */
export function uthDifficulty(
  evByAction: Partial<Record<string, number>>,
  constants: { slope: number; centre: number } = UTH_RATING,
): number | null {
  return uthDifficultyFromLeak(expectedLeak(evByAction), constants);
}

/**
 * One rated decision: Blackjack's update, then the reach limit on a gain.
 * Returns the change, for the card.
 */
export function updateUthRating(
  rating: Rating,
  difficulty: number,
  severity: SeverityTier,
  reach: number = UTH_INFORMATION_REACH,
): number {
  const before = rating.rating;
  const peakBefore = rating.peak;
  const delta = updateRating(rating, difficulty, severity);
  if (delta > 0) {
    const ceiling = Math.max(before, difficulty + reach);
    if (rating.rating > ceiling) {
      rating.sessionDelta -= rating.rating - ceiling;
      rating.rating = ceiling;
      rating.peak = Math.max(peakBefore, ceiling);
      return ceiling - before;
    }
  }
  // Unlimited, it is Blackjack's change to the last digit.
  return delta;
}
