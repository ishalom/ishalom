/**
 * Rule-sensitivity flags for the feedback card (spec §7.1 item 6, §3.3).
 *
 * "The right play changes with the rule set. Doubling 11 against a dealer Ace is
 * correct when the dealer hits soft 17 and wrong when the dealer stands. A
 * trainer that teaches one chart as universal truth teaches a bug."
 *
 * So whenever the answer in front of the player would flip under a rule set they
 * are likely to sit down at, the card says so. The comparison is done by
 * deriving the other chart and reading the cell, not by keeping a list of famous
 * exceptions — the same reason the engine derives charts at all.
 */

import {
  ACTION_LETTERS,
  deriveChart,
  isHandAction,
  makeRules,
  rulesKey,
  type BlackjackAction,
  type BlackjackRules,
  type GradedAction,
  type StrategyChart,
} from '@evtrainer/ev-engine';

const charts = new Map<string, StrategyChart>();

export function chartFor(rules: BlackjackRules): StrategyChart {
  const key = rulesKey(rules);
  let chart = charts.get(key);
  if (!chart) {
    chart = deriveChart(rules, { cardRemoval: 'static-dealer' });
    charts.set(key, chart);
  }
  return chart;
}

/** The rule changes worth checking against: the ones players actually meet. */
const VARIANTS: ReadonlyArray<{ label: string; apply: (rules: BlackjackRules) => BlackjackRules }> = [
  {
    label: 'if the dealer stood on soft 17',
    apply: (rules) => makeRules({ ...rules, soft17: 'S17' }),
  },
  {
    label: 'if the dealer hit soft 17',
    apply: (rules) => makeRules({ ...rules, soft17: 'H17' }),
  },
  {
    label: 'without late surrender',
    apply: (rules) => makeRules({ ...rules, surrender: 'none' }),
  },
  {
    label: 'with late surrender available',
    apply: (rules) => makeRules({ ...rules, surrender: 'late' }),
  },
  {
    label: 'without double after split',
    apply: (rules) => makeRules({ ...rules, das: false }),
  },
  {
    label: 'in a no-hole-card game',
    apply: (rules) => makeRules({ ...rules, peek: false }),
  },
];

export interface SensitivityNote {
  label: string;
  action: BlackjackAction;
  letter: string;
}

/**
 * Rule sets under which this same spot has a different answer.
 *
 * Only genuinely different rule sets are compared — asking what H17 says when
 * H17 is already in play would flag every cell in the chart.
 */
export function ruleSensitivity(
  scenarioKey: string,
  rules: BlackjackRules,
  optimal: GradedAction,
): SensitivityNote[] {
  // Insurance is the same side bet under every rule set in the list below, so
  // there is nothing to compare. The caller already skips it; this makes the
  // answer true rather than merely unreached.
  if (!isHandAction(optimal)) return [];
  const activeKey = rulesKey(rules);
  const notes: SensitivityNote[] = [];
  const seen = new Set<string>();

  for (const variant of VARIANTS) {
    const other = variant.apply(rules);
    const key = rulesKey(other);
    if (key === activeKey || seen.has(key)) continue;
    seen.add(key);

    const cell = chartFor(other).cells.get(scenarioKey);
    if (!cell || cell.optimalAction === optimal) continue;
    if (!isHandAction(cell.optimalAction)) continue;
    notes.push({
      label: variant.label,
      action: cell.optimalAction,
      letter: ACTION_LETTERS[cell.optimalAction],
    });
  }
  return notes;
}
