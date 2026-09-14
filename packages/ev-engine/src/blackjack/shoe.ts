/**
 * Shoe composition for Blackjack.
 *
 * Suits are irrelevant to Blackjack EV, and the ten-valued ranks are
 * interchangeable, so the shoe collapses to ten counters. That collapse is what
 * makes exact card-removal computation affordable: the memoisation key for a
 * shoe is ten small integers rather than a 52-card multiset.
 *
 *   index 0        -> Ace
 *   index 1 .. 8   -> 2 .. 9
 *   index 9        -> ten-valued (T, J, Q, K)
 */

import { rankOf, type Card } from '../core/cards.ts';

/** Bucketed rank used throughout the Blackjack engine. */
export type BjRank = number;

export const ACE: BjRank = 0;
export const TEN: BjRank = 9;
export const NUM_BJ_RANKS = 10;

/** Hard value of a rank; an Ace is counted as 11 and softened when it busts. */
export const RANK_VALUE: readonly number[] = [11, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Place values for `Shoe.sig`: five bits per rank. */
const SIG_PLACE: readonly number[] = Array.from({ length: NUM_BJ_RANKS }, (_, r) => 2 ** (5 * r));
const SIG_MAX_REMOVED = 31;

const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T'];

export function rankLabel(rank: BjRank): string {
  const label = RANK_LABELS[rank];
  if (label === undefined) throw new Error(`Bad blackjack rank: ${rank}`);
  return label;
}

/** Parse `'A'`, `'2'` .. `'9'`, `'T'`/`'J'`/`'Q'`/`'K'`/`'10'` into a bucketed rank. */
export function parseRank(text: string): BjRank {
  const t = text.trim().toUpperCase();
  if (t === '10') return TEN;
  if (t === 'A') return ACE;
  if (t === 'T' || t === 'J' || t === 'Q' || t === 'K') return TEN;
  const digit = RANK_LABELS.indexOf(t);
  if (digit < 1 || digit > 8) throw new Error(`Bad blackjack rank: ${JSON.stringify(text)}`);
  return digit;
}

export function parseRanks(text: string): BjRank[] {
  return text
    .split(/[\s,]+/)
    .filter((t) => t.length > 0)
    .map(parseRank);
}

/** Convert a full 52-card index into its Blackjack bucket. */
export function bjRankOfCard(card: Card): BjRank {
  const r = rankOf(card); // 0 = deuce .. 12 = ace
  if (r === 12) return ACE;
  if (r >= 8) return TEN; // T, J, Q, K
  return r + 1; // deuce -> 1 ... nine -> 8
}

/**
 * A mutable multiset of undealt ranks.
 *
 * Mutation is deliberate: the solver walks a deep recursion and pushing/popping
 * a single counter is far cheaper than cloning. Every method that removes a card
 * has a matching restore, and the solver always pairs them.
 */
export class Shoe {
  readonly counts: Int32Array;
  total: number;
  /**
   * Numeric composition signature, used as a memo key on the solver's hot path.
   *
   * Each rank owns five bits, holding how many of that rank have been removed
   * since the shoe was created. Ten ranks is fifty bits, which stays inside the
   * exact-integer range of a double, so the whole composition is one number that
   * `Map` can hash without allocating a string.
   *
   * Five bits per rank caps a rank at 31 removals. No reachable blackjack state
   * holds 31 cards of one rank — even an all-ace hand stands or busts long
   * before that — but `remove` checks rather than trusting its caller, because a
   * silent carry into the next rank's field would corrupt every memo built on
   * this key.
   */
  sig: number;

  private readonly initialCounts: Int32Array;

  private constructor(counts: Int32Array, total: number, sig = 0, initial?: Int32Array) {
    this.counts = counts;
    this.total = total;
    this.sig = sig;
    this.initialCounts = initial ?? Int32Array.from(counts);
  }

  /** A full, undealt shoe of `decks` decks. */
  static fresh(decks: number): Shoe {
    const counts = new Int32Array(NUM_BJ_RANKS);
    for (let r = 0; r < NUM_BJ_RANKS; r++) counts[r] = r === TEN ? decks * 16 : decks * 4;
    return new Shoe(counts, decks * 52);
  }

  /** A shoe from explicit counts, for tests and for partially depleted shoes. */
  static fromCounts(counts: ArrayLike<number>): Shoe {
    if (counts.length !== NUM_BJ_RANKS) throw new Error('Expected 10 rank counts');
    const arr = new Int32Array(NUM_BJ_RANKS);
    let total = 0;
    for (let r = 0; r < NUM_BJ_RANKS; r++) {
      const c = counts[r]!;
      if (c < 0) throw new Error(`Negative count for rank ${rankLabel(r)}`);
      arr[r] = c;
      total += c;
    }
    return new Shoe(arr, total);
  }

  clone(): Shoe {
    return new Shoe(Int32Array.from(this.counts), this.total, this.sig, this.initialCounts);
  }

  count(rank: BjRank): number {
    return this.counts[rank]!;
  }

  /** Probability of drawing `rank` next. Zero when the rank is exhausted. */
  probability(rank: BjRank): number {
    return this.total === 0 ? 0 : this.counts[rank]! / this.total;
  }

  remove(rank: BjRank): void {
    // An out-of-range rank would slip past the count check (`undefined <= 0` is
    // false), write nowhere in the typed array, and poison `sig` with a NaN that
    // every memo table would then treat as one shared key. Reject it here.
    if (!Number.isInteger(rank) || rank < 0 || rank >= NUM_BJ_RANKS) {
      throw new Error(`Not a blackjack rank: ${rank}`);
    }
    if (this.counts[rank]! <= 0) {
      throw new Error(`Cannot remove ${rankLabel(rank)}: none left in the shoe`);
    }
    if (this.initialCounts[rank]! - this.counts[rank]! >= SIG_MAX_REMOVED) {
      throw new Error(`Signature overflow: more than ${SIG_MAX_REMOVED} ${rankLabel(rank)}s removed`);
    }
    this.counts[rank]!--;
    this.total--;
    this.sig += SIG_PLACE[rank]!;
  }

  restore(rank: BjRank): void {
    if (!Number.isInteger(rank) || rank < 0 || rank >= NUM_BJ_RANKS) {
      throw new Error(`Not a blackjack rank: ${rank}`);
    }
    this.counts[rank]!++;
    this.total++;
    this.sig -= SIG_PLACE[rank]!;
  }

  removeAll(ranks: readonly BjRank[]): void {
    for (const r of ranks) this.remove(r);
  }

  restoreAll(ranks: readonly BjRank[]): void {
    for (let i = ranks.length - 1; i >= 0; i--) this.restore(ranks[i]!);
  }

  /**
   * Compact, collision-free key for memoisation. One character per rank keeps
   * this a single short string, which V8 hashes quickly.
   */
  key(): string {
    const c = this.counts;
    return String.fromCharCode(
      c[0]!, c[1]!, c[2]!, c[3]!, c[4]!, c[5]!, c[6]!, c[7]!, c[8]!, c[9]!,
    );
  }

  toString(): string {
    const parts: string[] = [];
    for (let r = 0; r < NUM_BJ_RANKS; r++) parts.push(`${rankLabel(r)}:${this.counts[r]}`);
    return `Shoe(${this.total}) ${parts.join(' ')}`;
  }
}
