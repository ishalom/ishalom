/**
 * Seeded pseudo-random number generation.
 *
 * The EV engine is pure by construction; the game engine cannot be, because it
 * has to shuffle. So randomness is seeded instead: a hand is reproducible from
 * its `dealSeed` (spec §11), which is what makes the Replay mode in §8 possible
 * and what lets a hundred-million-hand simulation be re-run exactly when it
 * disagrees with the analytic answer.
 *
 * xoshiro128** is used rather than the usual one-liner because of that
 * simulation. Spec §14.3 asks for 10^8 hands, which is on the order of 10^9
 * draws — past the 2^32 period of a 32-bit-state generator, where a shoe would
 * start repeating itself and the realized edge would stop converging for reasons
 * that have nothing to do with the engine.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, bound), unbiased. */
  nextInt(bound: number): number;
}

/**
 * xoshiro128**, seeded through SplitMix32 so that neighbouring seeds do not
 * produce correlated streams.
 */
export function makeRng(seed: number): Rng {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;

  // SplitMix32 to spread one integer over the 128-bit state.
  let z = seed >>> 0;
  const mix = (): number => {
    z = (z + 0x9e3779b9) >>> 0;
    let t = z;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
    return (t ^ (t >>> 15)) >>> 0;
  };
  s0 = mix();
  s1 = mix();
  s2 = mix();
  s3 = mix();
  // An all-zero state is a fixed point of xoshiro; nudge it if we land there.
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;

  const nextUint32 = (): number => {
    const r = (Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0);
    const t = (s1 << 9) >>> 0;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    return r;
  };

  return {
    next: () => nextUint32() / 4294967296,
    nextInt: (bound: number): number => {
      if (!Number.isInteger(bound) || bound <= 0) {
        throw new Error(`nextInt needs a positive integer bound, got ${bound}`);
      }
      // Rejection sampling. Taking a modulus directly would favour the low
      // values, which over 10^8 shuffles is a visible bias, not a rounding error.
      const limit = Math.floor(4294967296 / bound) * bound;
      for (;;) {
        const value = nextUint32();
        if (value < limit) return value % bound;
      }
    },
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Fisher-Yates, in place. The only shuffle in the codebase. */
export function shuffleInPlace<T>(items: T[], rng: Rng): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const swap = items[i]!;
    items[i] = items[j]!;
    items[j] = swap;
  }
}
