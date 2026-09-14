/**
 * The class a pair of hole cards belongs to: AA, AKs, AKo.
 *
 * A module of its own so the browser can have it without the offline pre-flop
 * solver it used to share a file with. The app needs this one function to look a
 * hand up in the solved table; it never runs `solvePreflop`, and shipping it
 * anyway was most of the page weight Ultimate added.
 *
 * It is the key into that table, and a label built by one rule and looked up in
 * a table built by another is a grading bug that shows up as a missing row
 * rather than a wrong answer — the good case only by luck.
 */

import { RANK_CHARS, rankOf, suitOf, type Card } from '../core/cards.ts';

export function holeClassLabel(a: Card, b: Card): string {
  const high = Math.max(rankOf(a), rankOf(b));
  const low = Math.min(rankOf(a), rankOf(b));
  const label = `${RANK_CHARS[high]}${RANK_CHARS[low]}`;
  if (high === low) return label;
  return label + (suitOf(a) === suitOf(b) ? 's' : 'o');
}
