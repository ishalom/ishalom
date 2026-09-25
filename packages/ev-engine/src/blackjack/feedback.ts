/**
 * Decision grading (spec §7.2).
 *
 * Only the part of the feedback system that is a pure function of the EV vector
 * lives here: the cost of the error and its severity tier. Wording, colour and
 * layout belong to the feedback layer above the engine (spec §12), and the
 * rule-sensitivity flag needs charts for other rule sets, so it belongs to the
 * app that holds them.
 *
 * Severity is graded by cost, never binary, because standing on 16 against a ten
 * and standing on 12 against a ten are not the same mistake (spec §3.2).
 */

import type { BlackjackAction } from './actions.ts';
import type { DecisionEvaluation } from './ev.ts';

export type SeverityTier = 'optimal' | 'negligible' | 'minor' | 'significant' | 'blunder';

/** Upper bound of each tier's EV cost, in units. Spec §7.2. */
export const SEVERITY_THRESHOLDS: ReadonlyArray<{ tier: SeverityTier; maxCost: number }> = [
  { tier: 'optimal', maxCost: 0 },
  { tier: 'negligible', maxCost: 0.005 },
  { tier: 'minor', maxCost: 0.03 },
  { tier: 'significant', maxCost: 0.1 },
  { tier: 'blunder', maxCost: Infinity },
];

export function severityForCost(evCost: number): SeverityTier {
  if (evCost <= 0) return 'optimal';
  for (const { tier, maxCost } of SEVERITY_THRESHOLDS) {
    if (evCost <= maxCost) return tier;
  }
  return 'blunder';
}

/** Tiers that earn a place in the drill queue (spec §7.2). */
export function feedsDrillQueue(tier: SeverityTier): boolean {
  return tier === 'significant' || tier === 'blunder';
}

export interface Grade {
  chosenAction: BlackjackAction;
  optimalAction: BlackjackAction;
  correct: boolean;
  /** EV given up by the choice, in units. Never negative. */
  evCost: number;
  severity: SeverityTier;
  /** Every legal action with its EV, best first — the vector §7.1 item 3 shows. */
  ranked: Array<{ action: BlackjackAction; ev: number }>;
}

export function gradeDecision(
  evaluation: DecisionEvaluation,
  chosenAction: BlackjackAction,
): Grade {
  const chosenEv = evaluation.evByAction[chosenAction];
  if (chosenEv === undefined) {
    throw new Error(`${chosenAction} is not legal in this spot`);
  }
  // Floating-point noise must not turn an optimal play into a "negligible error";
  // the argmax is the reference, and anything within rounding of it is correct.
  const rawCost = evaluation.optimalEv - chosenEv;
  const evCost = rawCost < 1e-12 ? 0 : rawCost;

  return {
    chosenAction,
    optimalAction: evaluation.optimalAction,
    correct: evCost === 0,
    evCost,
    severity: severityForCost(evCost),
    ranked: evaluation.legalActions
      .map((action) => ({ action, ev: evaluation.evByAction[action]! }))
      .sort((a, b) => b.ev - a.ev),
  };
}
