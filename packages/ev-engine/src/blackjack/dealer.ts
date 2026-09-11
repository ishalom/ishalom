/**
 * Exact dealer final-total distribution (spec §6.2, step 1).
 *
 * Given an upcard and the exact composition of the remaining shoe, recursively
 * compute the probability of every dealer outcome, following the configured
 * soft-17 rule. Nothing here is simulated or approximated: the recursion
 * enumerates every draw sequence, weighting each by its exact probability in the
 * depleted shoe.
 *
 * The blackjack outcome is kept as its own bucket rather than folded into 21,
 * because a natural pays differently (it beats a drawn 21 and pushes a player
 * natural) and because the no-hole-card game needs the unconditioned mass.
 */

import { addCard } from './hand.ts';
import type { BlackjackRules } from './rules.ts';
import { ACE, NUM_BJ_RANKS, RANK_VALUE, TEN, type BjRank } from './shoe.ts';
import type { Shoe } from './shoe.ts';

/** Index into a dealer distribution vector. */
export const DEALER_BUST = 0;
export const DEALER_17 = 1;
export const DEALER_18 = 2;
export const DEALER_19 = 3;
export const DEALER_20 = 4;
export const DEALER_21 = 5;
export const DEALER_BLACKJACK = 6;
export const DEALER_OUTCOMES = 7;

/**
 * Probabilities indexed by the constants above. Always sums to 1 (within float
 * error) unless it has been conditioned, in which case it is renormalised and
 * still sums to 1.
 */
export type DealerDistribution = Float64Array;

/** Index of a non-bust drawn total, 17..21. */
function indexOfTotal(total: number): number {
  return total - 16; // 17 -> 1 ... 21 -> 5
}

function isNatural(upcard: BjRank, hole: BjRank): boolean {
  return (upcard === ACE && hole === TEN) || (upcard === TEN && hole === ACE);
}

/**
 * Caches dealer distributions across the many shoe states a single player
 * decision walks through. The cache is keyed on the dealer's current
 * (total, soft) state plus the exact shoe composition, so it is sound to share
 * across upcards and across player hands for one rule set.
 */
export class DealerSolver {
  readonly rules: BlackjackRules;
  private readonly memo = new Map<string, DealerDistribution>();
  private readonly topMemo = new Map<string, DealerDistribution>();

  /**
   * Cap on cached states.
   *
   * A cache keyed on shoe composition is unbounded by nature: every hand dealt
   * from a shoe leaves a composition nobody has seen before, so a long-running
   * session accumulates entries forever. A short run never notices; ten million
   * simulated hands exhausted the heap outright.
   *
   * Dropping the whole cache when it gets too big is crude but exactly right
   * here. The entries that matter are the ones from the shoe in play, they cost
   * microseconds to rebuild, and the alternative — tracking recency per entry —
   * would cost more on every lookup than it saves on the rare eviction.
   */
  private readonly cacheLimit: number;
  /** Number of distinct states solved; useful for tests and profiling. */
  states = 0;

  constructor(rules: BlackjackRules, cacheLimit = 400_000) {
    this.rules = rules;
    this.cacheLimit = cacheLimit;
  }

  clearCache(): void {
    this.memo.clear();
    this.topMemo.clear();
  }

  get cacheSize(): number {
    return this.memo.size + this.topMemo.size;
  }

  /**
   * Full distribution for a dealer showing `upcard`, drawing from `shoe`.
   *
   * `shoe` must already have the upcard and every player card removed. It is
   * mutated during the walk and restored before returning.
   */
  distribution(upcard: BjRank, shoe: Shoe): DealerDistribution {
    const topKey = `${upcard}${shoe.key()}`;
    const cached = this.topMemo.get(topKey);
    if (cached !== undefined) return cached;

    const out = new Float64Array(DEALER_OUTCOMES);
    const upValue = RANK_VALUE[upcard]!;
    const upSoft = upcard === ACE;

    for (let hole = 0; hole < NUM_BJ_RANKS; hole++) {
      const n = shoe.count(hole);
      if (n === 0) continue;
      const p = n / shoe.total;

      if (isNatural(upcard, hole)) {
        out[DEALER_BLACKJACK]! += p;
        continue;
      }

      const v = addCard(upValue, upSoft, hole);
      shoe.remove(hole);
      const sub = this.resolve(v.total, v.soft, shoe);
      shoe.restore(hole);

      for (let i = 0; i < DEALER_BLACKJACK; i++) out[i]! += p * sub[i]!;
    }
    if (this.topMemo.size >= this.cacheLimit) this.topMemo.clear();
    this.topMemo.set(topKey, out);
    return out;
  }

  /**
   * Distribution conditioned on the dealer not holding a natural — the state the
   * player actually faces in a peek game, where a dealer blackjack has already
   * been resolved before the player acts.
   */
  distributionGivenNoBlackjack(upcard: BjRank, shoe: Shoe): DealerDistribution {
    return conditionNoBlackjack(this.distribution(upcard, shoe));
  }

  /**
   * The distribution the player should be graded against under the active rules:
   * conditioned in a peek game, unconditioned in a no-hole-card game where the
   * dealer's natural is still live and takes the whole wager.
   */
  playerFacingDistribution(upcard: BjRank, shoe: Shoe): DealerDistribution {
    const dist = this.distribution(upcard, shoe);
    return this.rules.peek ? conditionNoBlackjack(dist) : dist;
  }

  /**
   * Distribution from a dealer hand already in progress. `total`/`soft` describe
   * the dealer's two-card hand; the natural check has already happened.
   */
  private resolve(total: number, soft: boolean, shoe: Shoe): DealerDistribution {
    if (total > 21) {
      const busted = new Float64Array(DEALER_OUTCOMES);
      busted[DEALER_BUST] = 1;
      return busted;
    }
    if (this.standsOn(total, soft)) {
      const stood = new Float64Array(DEALER_OUTCOMES);
      stood[indexOfTotal(total)] = 1;
      return stood;
    }

    const key = `${total}${soft ? 's' : 'h'}${shoe.key()}`;
    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;

    const out = new Float64Array(DEALER_OUTCOMES);
    const total_ = shoe.total;
    for (let r = 0; r < NUM_BJ_RANKS; r++) {
      const n = shoe.count(r);
      if (n === 0) continue;
      const p = n / total_;
      const v = addCard(total, soft, r);
      shoe.remove(r);
      const sub = this.resolve(v.total, v.soft, shoe);
      shoe.restore(r);
      for (let i = 0; i < DEALER_BLACKJACK; i++) out[i]! += p * sub[i]!;
    }

    this.states++;
    if (this.memo.size >= this.cacheLimit) this.memo.clear();
    this.memo.set(key, out);
    return out;
  }

  /** Dealer stands on hard 17+, and on soft 17 only under S17. */
  private standsOn(total: number, soft: boolean): boolean {
    if (total > 17) return true;
    if (total < 17) return false;
    return !(soft && this.rules.soft17 === 'H17');
  }
}

/**
 * Renormalise a distribution over the branches where the dealer has no natural.
 * Returns the input unchanged when there was no blackjack mass to remove.
 */
export function conditionNoBlackjack(dist: DealerDistribution): DealerDistribution {
  const bj = dist[DEALER_BLACKJACK]!;
  if (bj === 0) return dist;
  const scale = 1 / (1 - bj);
  const out = new Float64Array(DEALER_OUTCOMES);
  for (let i = 0; i < DEALER_BLACKJACK; i++) out[i] = dist[i]! * scale;
  return out;
}

/** Convenience wrapper for one-off use; allocates a fresh solver and cache. */
export function dealerDistribution(
  upcard: BjRank,
  shoe: Shoe,
  rules: BlackjackRules,
): DealerDistribution {
  return new DealerSolver(rules).distribution(upcard, shoe);
}

/** Human-readable view, for tests and for the reference screen. */
export function describeDistribution(dist: DealerDistribution): Record<string, number> {
  return {
    bust: dist[DEALER_BUST]!,
    17: dist[DEALER_17]!,
    18: dist[DEALER_18]!,
    19: dist[DEALER_19]!,
    20: dist[DEALER_20]!,
    21: dist[DEALER_21]!,
    blackjack: dist[DEALER_BLACKJACK]!,
  };
}
