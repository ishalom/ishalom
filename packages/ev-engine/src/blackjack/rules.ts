/**
 * Blackjack rule sets (spec §5.1.1).
 *
 * The rule set is a first-class object: it drives both the game engine and the
 * strategy engine, and it is part of the memoisation key for every EV
 * computation. Two rule sets that differ in any field are different problems.
 */

/** What the dealer does on a soft 17. */
export type SoftSeventeen = 'H17' | 'S17';

/** Which starting totals may be doubled. */
export type DoubleRule = 'any2' | '9-11' | '10-11';

export type SurrenderRule = 'none' | 'late' | 'early';

export type BlackjackPayout = '3:2' | '6:5';

export interface BlackjackRules {
  /** 1, 2, 4, 6 or 8. Drives shoe composition and therefore card-removal effects. */
  decks: number;
  /** Dealer hits or stands on soft 17. */
  soft17: SoftSeventeen;
  double: DoubleRule;
  /** Double after split. */
  das: boolean;
  surrender: SurrenderRule;
  /** Maximum number of hands a player may reach by splitting (2, 3 or 4). */
  maxSplitHands: number;
  /**
   * Whether two ten-valued cards of different rank — a ten and a queen — count
   * as a splittable pair. Most houses say yes; some require identical ranks.
   *
   * This is the one rule the solver cannot see for itself. Everything downstream
   * of the deal works in ten-buckets, where a king and a jack are the same card,
   * so the identity of a particular ten-pair has to be carried in from the table
   * that dealt it. See `HandContext.unlikeTens`.
   */
  splitUnlikeTens: boolean;
  resplitAces: boolean;
  hitSplitAces: boolean;
  blackjackPayout: BlackjackPayout;
  /**
   * Dealer peeks for blackjack before the player acts. `false` is the European
   * no-hole-card game, where the player's doubled and split wagers are also
   * lost to a dealer natural.
   */
  peek: boolean;
}

export const DEFAULT_RULES: BlackjackRules = {
  decks: 6,
  soft17: 'H17',
  double: 'any2',
  das: true,
  surrender: 'late',
  maxSplitHands: 4,
  splitUnlikeTens: true,
  resplitAces: false,
  hitSplitAces: false,
  blackjackPayout: '3:2',
  peek: true,
};

export function makeRules(overrides: Partial<BlackjackRules> = {}): BlackjackRules {
  return validateRules({ ...DEFAULT_RULES, ...overrides });
}

export function validateRules(rules: BlackjackRules): BlackjackRules {
  if (![1, 2, 4, 6, 8].includes(rules.decks)) {
    throw new Error(`Unsupported deck count: ${rules.decks}`);
  }
  if (![2, 3, 4].includes(rules.maxSplitHands)) {
    throw new Error(`Unsupported max split hands: ${rules.maxSplitHands}`);
  }
  if (rules.hitSplitAces && !rules.resplitAces) {
    // Legal, just unusual; not an error. Kept as a note rather than a throw.
  }
  return rules;
}

/** Payout multiple on a winning player natural, over and above the stake. */
export function blackjackPayoutMultiple(rules: BlackjackRules): number {
  return rules.blackjackPayout === '3:2' ? 1.5 : 1.2;
}

/**
 * Real-world preset bundles (spec §5.1.1). `note` is surfaced in-product; the
 * 6:5 warning is a product requirement, not decoration.
 */
export interface RulePreset {
  id: string;
  name: string;
  rules: BlackjackRules;
  note?: string;
}

export const RULE_PRESETS: readonly RulePreset[] = [
  {
    id: 'vegas-strip-6d-s17',
    name: 'Vegas Strip 6-deck S17',
    rules: makeRules({ decks: 6, soft17: 'S17', surrender: 'late', das: true }),
  },
  {
    id: 'downtown-h17',
    name: 'Downtown H17',
    rules: makeRules({ decks: 2, soft17: 'H17', surrender: 'none', das: true }),
  },
  {
    id: 'single-deck-6-5',
    name: 'Single Deck 6:5',
    rules: makeRules({
      decks: 1,
      soft17: 'H17',
      double: '10-11',
      das: false,
      surrender: 'none',
      blackjackPayout: '6:5',
    }),
    note:
      'The 6:5 blackjack payout alone adds roughly 1.4% to the house edge — a rule ' +
      'choice that costs more than every strategy error a typical player makes combined.',
  },
  {
    id: 'european-nhc',
    name: 'European No-Hole-Card',
    rules: makeRules({
      decks: 6,
      soft17: 'S17',
      double: '9-11',
      das: false,
      surrender: 'none',
      peek: false,
    }),
    note:
      'The dealer takes no hole card. A dealer natural collects your doubled and ' +
      'split wagers too, which changes the correct play against an Ace or ten.',
  },
];

export function getPreset(id: string): RulePreset {
  const preset = RULE_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown rule preset: ${id}`);
  return preset;
}

/** Stable key for caching anything derived from a rule set. */
export function rulesKey(rules: BlackjackRules): string {
  return [
    rules.decks,
    rules.soft17,
    rules.double,
    rules.das ? 'das' : 'nodas',
    rules.surrender,
    `sp${rules.maxSplitHands}`,
    rules.splitUnlikeTens ? 'sput' : 'nosput',
    rules.resplitAces ? 'rsa' : 'norsa',
    rules.hitSplitAces ? 'hsa' : 'nohsa',
    rules.blackjackPayout,
    rules.peek ? 'peek' : 'enhc',
  ].join('|');
}
