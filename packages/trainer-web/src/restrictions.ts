/**
 * House restrictions layered over a rule preset.
 *
 * Its own module since round 16, so that the hand analyser can apply the same
 * two switches without importing the file that holds the ratings. What the
 * analyser may not touch is easier to believe when it cannot reach it at all.
 */

import type { BlackjackRules } from '@evtrainer/ev-engine';

export interface Restrictions {
  /** The table does not offer late surrender. */
  noSurrender: boolean;
  /** A jack beside a queen is a hard twenty, not a splittable pair. */
  likeRanksOnly: boolean;
}

export function applyRestrictions(
  rules: BlackjackRules,
  restrictions: Restrictions,
): BlackjackRules {
  return {
    ...rules,
    surrender: restrictions.noSurrender ? 'none' : rules.surrender,
    splitUnlikeTens: !restrictions.likeRanksOnly,
  };
}
