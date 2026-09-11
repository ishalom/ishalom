/**
 * An independent dealer-distribution oracle, for §14.1.
 *
 * This exists to disagree with `DealerSolver`. It is written to be structurally
 * different in every way that could hide a shared bug:
 *
 *   - it walks *forward*, pushing probability mass out from the deal, where the
 *     solver recurses *backward*, pulling expectations up from the leaves;
 *   - it keys states on the multiset of cards the dealer has drawn, not on the
 *     collapsed (total, soft) pair the solver carries, so a bug in that collapse
 *     cannot be mirrored here;
 *   - it re-derives the hand total from the cards every time, using its own
 *     valuation loop rather than importing `handValue`/`addCard`. The ace bug
 *     this suite guards against lived in exactly that code.
 *
 * It is slower and it allocates freely. That is fine; it only runs in tests.
 */

const NUM_RANKS = 10;
const VALUES = [11, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const ACE = 0;
const TEN = 9;

export interface OracleOutcome {
  bust: number;
  17: number;
  18: number;
  19: number;
  20: number;
  21: number;
  blackjack: number;
}

/** Independent hand valuation: sum with aces high, then demote while busted. */
function valueOf(cards: readonly number[]): { total: number; soft: boolean } {
  let total = 0;
  let acesHigh = 0;
  for (const r of cards) {
    total += VALUES[r]!;
    if (r === ACE) acesHigh++;
  }
  while (total > 21 && acesHigh > 0) {
    total -= 10;
    acesHigh--;
  }
  return { total, soft: acesHigh > 0 };
}

function stands(total: number, soft: boolean, h17: boolean): boolean {
  if (total > 17) return true;
  if (total < 17) return false;
  return !(soft && h17);
}

/**
 * @param upcard      dealer upcard, as a bucketed rank
 * @param counts      composition of the shoe *after* the upcard and every player
 *                    card has been removed
 * @param h17         dealer hits soft 17
 */
export function oracleDealerDistribution(
  upcard: number,
  counts: readonly number[],
  h17: boolean,
): OracleOutcome {
  const out: OracleOutcome = { bust: 0, 17: 0, 18: 0, 19: 0, 20: 0, 21: 0, blackjack: 0 };

  // Frontier states, keyed by the multiset of cards drawn after the upcard.
  // Distinct draw orders converge on the same key and their masses add, which is
  // what makes the forward walk finite.
  interface State {
    drawn: number[]; // per-rank counts of cards the dealer has taken
    prob: number;
  }
  let frontier = new Map<string, State>();
  frontier.set('start', { drawn: new Array<number>(NUM_RANKS).fill(0), prob: 1 });

  let depth = 0;
  while (frontier.size > 0) {
    if (++depth > 25) throw new Error('Oracle failed to terminate; dealer cannot draw 25 cards');
    const next = new Map<string, State>();

    for (const state of frontier.values()) {
      const cards: number[] = [upcard];
      for (let r = 0; r < NUM_RANKS; r++) {
        for (let i = 0; i < state.drawn[r]!; i++) cards.push(r);
      }
      const drawnCount = cards.length - 1;

      if (drawnCount >= 1) {
        if (drawnCount === 1) {
          const hole = cards[1]!;
          if ((upcard === ACE && hole === TEN) || (upcard === TEN && hole === ACE)) {
            out.blackjack += state.prob;
            continue;
          }
        }
        const { total, soft } = valueOf(cards);
        if (total > 21) {
          out.bust += state.prob;
          continue;
        }
        if (stands(total, soft, h17)) {
          out[total as 17 | 18 | 19 | 20 | 21] += state.prob;
          continue;
        }
      }

      let remaining = 0;
      for (let r = 0; r < NUM_RANKS; r++) remaining += counts[r]! - state.drawn[r]!;
      if (remaining <= 0) throw new Error('Oracle exhausted the shoe');

      for (let r = 0; r < NUM_RANKS; r++) {
        const left = counts[r]! - state.drawn[r]!;
        if (left <= 0) continue;
        const drawn = state.drawn.slice();
        drawn[r]!++;
        const key = drawn.join(',');
        const p = state.prob * (left / remaining);
        const existing = next.get(key);
        if (existing) existing.prob += p;
        else next.set(key, { drawn, prob: p });
      }
    }
    frontier = next;
  }

  return out;
}
