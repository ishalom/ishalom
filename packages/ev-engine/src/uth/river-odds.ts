/**
 * The river, counted the way a player can read it (spec §5.2, §6.3).
 *
 * `solveRiver` grades the decision and returns how many of the dealer's 990
 * possible holdings the player beats, ties and loses to. That is enough to
 * grade and not enough to explain: "you lose to 165 of 990" does not tell a
 * player what to be afraid of. This walks the same 990 holdings and, for the
 * ones that win, groups them by what they are — a pair of nines, two pair aces
 * and sevens, a flush to the king — so the card can name the few that beat the
 * player most narrowly.
 *
 * It does not grade anything and does not replace the solver. It is the same
 * enumeration, asked a second question, and a test holds its counts to
 * `solveRiver`'s.
 */

import { unseenCards, type Card } from '../core/cards.ts';
import { evaluate7 } from '../poker/evaluator.ts';
import { categoryOf, significantRanks, type HandCategory, type Rank } from '../poker/handValue.ts';

/** How many of a category's significant ranks a plain description names. */
export const NAMED_RANKS: Readonly<Record<HandCategory, number>> = {
  0: 1, // high card: the top card
  1: 1, // pair: the pair
  2: 2, // two pair: both pairs
  3: 1, // three of a kind
  4: 1, // straight: its high card
  5: 1, // flush: its top card
  6: 2, // full house: the three, then the two
  7: 1, // four of a kind
  8: 1, // straight flush: its high card
};

/** Dealer holdings that beat the player and share one plain description. */
export interface RiverThreat {
  category: HandCategory;
  /** The ranks the description names, most significant first. */
  ranks: Rank[];
  /** The weakest dealer hand in the group — how narrowly this group wins. */
  lowest: number;
  /** How many of the 990 holdings fall in the group. */
  count: number;
}

export interface RiverOdds {
  playerValue: number;
  wins: number;
  ties: number;
  losses: number;
  holdings: number;
  /** The groups that beat the player, weakest first, at most `limit` of them. */
  closest: RiverThreat[];
}

export function riverOdds(
  playerHole: readonly Card[],
  board: readonly Card[],
  limit = 3,
): RiverOdds {
  if (playerHole.length !== 2) throw new Error('The player holds exactly two cards');
  if (board.length !== 5) throw new Error('The river is dealt when all five community cards are out');

  const unseen = unseenCards([...playerHole, ...board]);
  const playerValue = evaluate7([...playerHole, ...board]);
  const dealerCards: Card[] = [board[0]!, board[1]!, board[2]!, board[3]!, board[4]!, 0, 0];

  let wins = 0;
  let ties = 0;
  let losses = 0;
  const groups = new Map<string, RiverThreat>();

  for (let i = 0; i < unseen.length; i++) {
    dealerCards[5] = unseen[i]!;
    for (let j = i + 1; j < unseen.length; j++) {
      dealerCards[6] = unseen[j]!;
      const dealer = evaluate7(dealerCards);
      if (playerValue > dealer) {
        wins++;
      } else if (playerValue === dealer) {
        ties++;
      } else {
        losses++;
        const category = categoryOf(dealer);
        const ranks = significantRanks(dealer).slice(0, NAMED_RANKS[category]);
        const key = `${category}:${ranks.join(',')}`;
        const group = groups.get(key);
        if (group) {
          group.count++;
          if (dealer < group.lowest) group.lowest = dealer;
        } else {
          groups.set(key, { category, ranks, lowest: dealer, count: 1 });
        }
      }
    }
  }

  const closest = [...groups.values()].sort((a, b) => a.lowest - b.lowest).slice(0, limit);
  return { playerValue, wins, ties, losses, holdings: wins + ties + losses, closest };
}
