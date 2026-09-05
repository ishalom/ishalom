/**
 * Canonical scenario keys (spec §11).
 *
 * `scenarioKey` is the join between play and progress tracking, so it has to be
 * stable and canonical: the same spot must produce the same string forever, or
 * the mastery grid silently loses history. The format is the one the spec gives,
 * e.g. `bj:hard16:vs10`, `bj:pairA:vs6`.
 *
 * The key deliberately does *not* encode the rule set. Most cells are identical
 * between S17 and H17, and per-rule-set keys would make users re-earn mastery
 * they already have (spec §17, open question 3). Progress storage pairs the key
 * with a rule-set id where a cell actually differs; deciding which cells those
 * are is `chart.ts`'s job, not this module's.
 */

import { handValue, isPair } from './hand.ts';
import { ACE, rankLabel, TEN, type BjRank } from './shoe.ts';

export const INSURANCE_SCENARIO_KEY = 'bj:insurance';

export type ScenarioKind = 'hard' | 'soft' | 'pair' | 'insurance';

export interface Scenario {
  kind: ScenarioKind;
  /** Hand total for `hard`/`soft`; undefined for `pair` and `insurance`. */
  total?: number;
  /** The paired rank for `pair`; undefined otherwise. */
  pairRank?: BjRank;
  /** Dealer upcard; undefined for `insurance`, which is always against an ace. */
  upcard?: BjRank;
}

/** Chart-facing upcard label: `A`, `2`..`9`, `10`. */
export function upcardLabel(upcard: BjRank): string {
  if (upcard === ACE) return 'A';
  if (upcard === TEN) return '10';
  return rankLabel(upcard);
}

export function parseUpcardLabel(label: string): BjRank {
  if (label === 'A') return ACE;
  if (label === '10') return TEN;
  const n = Number(label);
  if (!Number.isInteger(n) || n < 2 || n > 9) throw new Error(`Bad upcard label: ${label}`);
  return n - 1;
}

export function scenarioKey(scenario: Scenario): string {
  if (scenario.kind === 'insurance') return INSURANCE_SCENARIO_KEY;
  const upcard = scenario.upcard;
  if (upcard === undefined) throw new Error('Non-insurance scenarios need an upcard');
  const vs = `vs${upcardLabel(upcard)}`;
  switch (scenario.kind) {
    case 'hard':
      return `bj:hard${scenario.total}:${vs}`;
    case 'soft':
      return `bj:soft${scenario.total}:${vs}`;
    case 'pair': {
      const rank = scenario.pairRank;
      if (rank === undefined) throw new Error('Pair scenarios need a pair rank');
      return `bj:pair${rankLabel(rank)}:${vs}`;
    }
  }
}

/**
 * The scenario a live hand belongs to.
 *
 * A pair maps to its pair row only while splitting is actually available —
 * otherwise the player is facing a plain hard or soft total and should be graded
 * and drilled as such.
 */
export function scenarioForHand(
  cards: readonly BjRank[],
  upcard: BjRank,
  splitAvailable: boolean,
): Scenario {
  if (splitAvailable && isPair(cards)) {
    return { kind: 'pair', pairRank: cards[0]!, upcard };
  }
  const { total, soft } = handValue(cards);
  return { kind: soft ? 'soft' : 'hard', total, upcard };
}

export function scenarioKeyForHand(
  cards: readonly BjRank[],
  upcard: BjRank,
  splitAvailable: boolean,
): string {
  return scenarioKey(scenarioForHand(cards, upcard, splitAvailable));
}

const KEY_PATTERN = /^bj:(hard|soft|pair)([A-Z0-9]+):vs(10|[2-9]|A)$/;

export function parseScenarioKey(key: string): Scenario {
  if (key === INSURANCE_SCENARIO_KEY) return { kind: 'insurance' };
  const m = KEY_PATTERN.exec(key);
  if (!m) throw new Error(`Not a scenario key: ${key}`);
  const [, kind, value, up] = m as unknown as [string, ScenarioKind, string, string];
  const upcard = parseUpcardLabel(up);
  if (kind === 'pair') {
    const rank = value === 'A' ? ACE : value === 'T' ? TEN : Number(value) - 1;
    if (!Number.isInteger(rank) || rank < 0 || rank > 9) {
      throw new Error(`Not a scenario key: ${key}`);
    }
    return { kind, pairRank: rank, upcard };
  }
  const total = Number(value);
  if (!Number.isInteger(total)) throw new Error(`Not a scenario key: ${key}`);
  return { kind, total, upcard };
}
