/**
 * Sampling helpers for the opt-in slow tests (spec §14.3).
 *
 * Deliberately independent of `src/`: its own PRNG, its own shoe as a plain
 * counter array, its own hand valuation. A simulation that imported the solver's
 * helpers would agree with the solver for the wrong reason.
 */

import { DEALER_OUTCOMES } from '../../src/blackjack/dealer.ts';

const VALUES = [11, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const ACE = 0;
const TEN = 9;

/** xorshift32. Small, seedable, and good enough for coarse agreement checks. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

class Sampler {
  readonly counts: Int32Array;
  left: number;
  private readonly decks: number;
  private readonly rng: () => number;

  constructor(decks: number, rng: () => number) {
    this.decks = decks;
    this.rng = rng;
    this.counts = new Int32Array(10);
    this.left = 0;
    this.reset();
  }

  reset(): void {
    for (let r = 0; r < 10; r++) this.counts[r] = r === TEN ? this.decks * 16 : this.decks * 4;
    this.left = this.decks * 52;
  }

  take(rank: number): void {
    this.counts[rank]!--;
    this.left--;
  }

  draw(): number {
    let x = (this.rng() * this.left) | 0;
    for (let r = 0; r < 10; r++) {
      const n = this.counts[r]!;
      if (x < n) {
        this.counts[r]!--;
        this.left--;
        return r;
      }
      x -= n;
    }
    throw new Error('sampler ran off the end of the shoe');
  }
}

function playDealer(s: Sampler, upcard: number, hole: number, h17: boolean): number {
  let total = 0;
  let acesHigh = 0;
  const add = (r: number) => {
    total += VALUES[r]!;
    if (r === ACE) acesHigh++;
    while (total > 21 && acesHigh > 0) {
      total -= 10;
      acesHigh--;
    }
  };
  add(upcard);
  add(hole);
  for (;;) {
    if (total > 21) return -1; // bust
    const soft = acesHigh > 0;
    if (total > 17 || (total === 17 && !(soft && h17))) return total;
    add(s.draw());
  }
}

/**
 * Sampled dealer distribution, laid out like `DealerDistribution`: index 0 bust,
 * 1..5 the totals 17..21, 6 a natural.
 */
export function simulateDealer(
  upcard: number,
  decks: number,
  h17: boolean,
  hands: number,
  seed: number,
): Float64Array {
  const s = new Sampler(decks, makeRng(seed));
  const out = new Float64Array(DEALER_OUTCOMES);

  for (let i = 0; i < hands; i++) {
    s.reset();
    s.take(upcard);
    const hole = s.draw();
    if ((upcard === ACE && hole === TEN) || (upcard === TEN && hole === ACE)) {
      out[6]! += 1;
      continue;
    }
    const total = playDealer(s, upcard, hole, h17);
    out[total < 0 ? 0 : total - 16]! += 1;
  }
  for (let i = 0; i < out.length; i++) out[i]! /= hands;
  return out;
}

/**
 * Sampled EV of holding `playerCards` against `upcard` and taking one fixed
 * action, in a peek game. Hands where the dealer turns out to hold a natural are
 * discarded, which is what conditioning on the peek means.
 */
export function simulateFixedAction(
  playerCards: readonly number[],
  upcard: number,
  action: 'stand' | 'double',
  decks: number,
  h17: boolean,
  hands: number,
  seed: number,
): { ev: number; standardError: number; samples: number } {
  const s = new Sampler(decks, makeRng(seed));
  let sum = 0;
  let sumSquares = 0;
  let n = 0;

  for (let i = 0; i < hands; i++) {
    s.reset();
    for (const c of playerCards) s.take(c);
    s.take(upcard);
    const hole = s.draw();
    if ((upcard === ACE && hole === TEN) || (upcard === TEN && hole === ACE)) continue;
    n++;

    let total = 0;
    let acesHigh = 0;
    const add = (r: number) => {
      total += VALUES[r]!;
      if (r === ACE) acesHigh++;
      while (total > 21 && acesHigh > 0) {
        total -= 10;
        acesHigh--;
      }
    };
    for (const c of playerCards) add(c);

    let stake = 1;
    if (action === 'double') {
      stake = 2;
      add(s.draw());
    }

    let result: number;
    if (total > 21) {
      result = -stake;
    } else {
      const dealer = playDealer(s, upcard, hole, h17);
      if (dealer < 0 || dealer < total) result = stake;
      else if (dealer > total) result = -stake;
      else result = 0;
    }
    sum += result;
    sumSquares += result * result;
  }

  const ev = sum / n;
  const variance = sumSquares / n - ev * ev;
  return { ev, standardError: Math.sqrt(variance / n), samples: n };
}
