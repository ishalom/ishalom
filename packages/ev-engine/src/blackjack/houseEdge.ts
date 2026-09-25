/**
 * The house edge of a rule set, computed rather than quoted (spec §16, §9.2).
 *
 * Spec §16 makes this a product requirement, not a statistic: "the onboarding
 * flow states the residual house edge for each game in plain numbers", and §1's
 * explicit non-goal is that the app never implies a path to profitability. A
 * number that important should come from the same engine that grades the play,
 * so that the figure shown to the user and the figure used to grade them cannot
 * drift apart.
 *
 * It is also the target §14.3's simulation converges to. Playing the engine's
 * own recommended action for millions of hands should realise exactly this edge;
 * if it does not, the game engine and the EV engine disagree about the rules,
 * which is the class of bug unit tests miss.
 *
 * Method: enumerate every opening deal — the player's two cards and the dealer's
 * upcard — weight each by how often it comes off a fresh shoe, and take the best
 * available EV. Naturals are handled separately because they are paid, not
 * played.
 */

import { BlackjackSolver, type CardRemovalMode } from './ev.ts';
import { DealerSolver, DEALER_BLACKJACK } from './dealer.ts';
import { isBlackjack } from './hand.ts';
import { blackjackPayoutMultiple, type BlackjackRules } from './rules.ts';
import { NUM_BJ_RANKS, Shoe, type BjRank } from './shoe.ts';

export interface HouseEdge {
  /** Expected value per unit wagered, playing perfectly. Negative in every real game. */
  expectedValue: number;
  /** The same number as a positive percentage, which is how it is usually quoted. */
  percent: number;
}

export interface HouseEdgeOptions {
  cardRemoval?: CardRemovalMode;
}

/**
 * Exact expected value of a rule set under optimal play, from a fresh shoe.
 *
 * Insurance never enters: it is negative in every standard shoe, so perfect play
 * declines it and it contributes nothing.
 */
export function houseEdge(rules: BlackjackRules, options: HouseEdgeOptions = {}): HouseEdge {
  const solver = new BlackjackSolver(rules, {
    cardRemoval: options.cardRemoval ?? 'static-dealer',
  });
  const dealer = new DealerSolver(rules);
  const naturalPayout = blackjackPayoutMultiple(rules);

  const fresh = Shoe.fresh(rules.decks);
  const total = fresh.total;
  // Ordered draws of three cards, so the weights below can count arrangements.
  const arrangements = total * (total - 1) * (total - 2);

  let weighted = 0;

  for (let a = 0; a < NUM_BJ_RANKS; a++) {
    for (let b = a; b < NUM_BJ_RANKS; b++) {
      for (let upcard = 0; upcard < NUM_BJ_RANKS; upcard++) {
        const shoe = Shoe.fresh(rules.decks);
        const countA = shoe.count(a);
        shoe.remove(a);
        const countB = shoe.count(b);
        shoe.remove(b);
        const countUp = shoe.count(upcard);
        if (countUp === 0) continue;
        shoe.remove(upcard);

        // Ordered ways to reach this deal: the player's two cards can arrive in
        // either order when they differ.
        const ways = (a === b ? countA * countB : 2 * countA * countB) * countUp;
        if (ways === 0) continue;

        weighted += ways * dealEv(a, b, upcard, shoe, rules, solver, dealer, naturalPayout);
      }
    }
  }

  const expectedValue = weighted / arrangements;
  return { expectedValue, percent: -expectedValue * 100 };
}

/** Unconditional EV of one opening deal, in units of the wager. */
function dealEv(
  a: BjRank,
  b: BjRank,
  upcard: BjRank,
  shoe: Shoe,
  rules: BlackjackRules,
  solver: BlackjackSolver,
  dealer: DealerSolver,
  naturalPayout: number,
): number {
  const pDealerNatural = dealer.distribution(upcard, shoe)[DEALER_BLACKJACK]!;

  if (isBlackjack([a, b])) {
    // A natural is paid, not played. It pushes against a dealer natural.
    return (1 - pDealerNatural) * naturalPayout;
  }

  const best = solver.evaluate([a, b], upcard, shoe).optimalEv;

  // In a peek game every action EV is already conditioned on the dealer not
  // holding a natural, so the natural branch has to be added back. With no hole
  // card the dealer's natural is already inside those EVs.
  if (!rules.peek) return best;
  return pDealerNatural * -1 + (1 - pDealerNatural) * best;
}
