/**
 * What comes back to you (round 13).
 *
 * Every figure a player reads about an *action* is now what one unit already at
 * risk comes back, on average, if the spot were played over and over. Surrender
 * reads +0.500, because half the bet comes back and always does; folding in
 * Ultimate reads 0.000, because nothing does; 1.000 is break-even everywhere.
 *
 * Idan's reason, from play: the reader is a casino player, and casino players
 * think in payouts. The arithmetic also collapses to something doable at the
 * table — standing is 0.23 × 2 = 0.46 rather than 0.23 × (+1) + 0.77 × (−1).
 *
 * WHAT THIS IS NOT. It is a display and explanation change. The stored figure,
 * the grade, what an error cost, the rating, the leaderboard and every chip
 * total stay exactly as they were, in units net of the stake. Nothing here is
 * ever written back into a record.
 *
 * WHY IT CANNOT CHANGE A RANKING. Within one spot the transform is
 * `1 + ev / stake` with the same stake for every option, which is affine and
 * increasing: it moves every option by the same constant and scales them all by
 * the same positive factor. Order is preserved, and so is the sign of every
 * gap. The stake is what the spot itself has at risk — one unit for a blackjack
 * hand, half a unit for insurance, the Ante and the Blind for Ultimate — which
 * is what makes "per unit staked" true rather than a figure of speech.
 */

/** The fixed scale the bars are drawn on. Never scaled to the hand. */
export const RETURN_SCALE_MAX = 2;

/** Break-even: the whole stake comes back and no more. */
export const RETURN_EVEN = 1;

/** What one unit staked comes back, from an EV net of that stake. */
export function returned(ev: number, stake = 1): number {
  return 1 + ev / stake;
}

/** How many decimals a return is written to. Three, always — see `sameFigure`. */
export const RETURN_DECIMALS = 3;

/**
 * Whether two returns print the same figure.
 *
 * They can: on 16 against a ten, hitting and standing differ in the fourth
 * decimal. Both used to be given a fourth decimal so that no two chips looked
 * equal, which solved the wrong problem — the two plays really are worth the
 * same, and a player who reads a fourth decimal to tell them apart learns
 * something false. Now the figures stay at three decimals and the screen says,
 * in words, that the plays are equivalent.
 */
export function sameFigure(a: number, b: number): boolean {
  return a.toFixed(RETURN_DECIMALS) === b.toFixed(RETURN_DECIMALS);
}

/**
 * Groups of actions whose figures print the same, in the order given.
 *
 * Returns one group per set of tied actions, each with two or more members;
 * spots where every figure differs return nothing at all.
 */
export function equivalentGroups<T extends { action: string; value: number }>(
  rows: readonly T[],
): string[][] {
  const groups: string[][] = [];
  let current: T[] = [];
  for (const row of rows) {
    if (current.length > 0 && sameFigure(current[0]!.value, row.value)) current.push(row);
    else {
      if (current.length > 1) groups.push(current.map((r) => r.action));
      current = [row];
    }
  }
  if (current.length > 1) groups.push(current.map((r) => r.action));
  return groups;
}

/**
 * A return as a player reads it: three decimals, a real minus sign, and a plus
 * wherever the figure is positive — the same shape as the rest of the app's
 * signed figures, and the reason 0.000 and −0.710 cannot be mistaken for each
 * other at a glance.
 *
 * `public/figure.js` carries the identical rule for the pages, and a test holds
 * the two to the same output.
 */
export function returnFigure(value: number): string {
  const text = Math.abs(value).toFixed(RETURN_DECIMALS);
  // −0.000 is not a figure anybody writes.
  if (Number(text) === 0) return `0.${'0'.repeat(RETURN_DECIMALS)}`;
  return `${value < 0 ? '−' : '+'}${text}`;
}

/** Where a bar of this value ends, as a share of the fixed scale: 0 to 1. */
export function barShare(value: number): number {
  return Math.max(0, Math.min(1, value / RETURN_SCALE_MAX));
}
