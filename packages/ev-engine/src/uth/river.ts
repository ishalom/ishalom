/**
 * The river decision: bet 1x or fold (spec §6.3).
 *
 * This one is trivially exact. Seven cards are visible — the player's two and
 * the five community cards — leaving 45 unseen, so the dealer holds one of
 * C(45,2) = 990 possible two-card combinations. Enumerate all of them, settle
 * each showdown, and compare the average against the -2 that folding costs.
 *
 * Every holding is equally likely, so the EV is a plain mean. There is no
 * sampling, no approximation and no table: it is the exact answer, and it takes
 * well under a millisecond.
 */

import { evaluate } from '../poker/evaluator.ts';
import { NUM_CARDS, type Card } from '../core/cards.ts';
import { FOLD_RESULT, RIVER_RAISE, type BlindPaytable } from './rules.ts';
import { settle } from './showdown.ts';

export interface RiverDecision {
  /** EV of making the 1x Play bet, in units of the ante. */
  evPlay: number;
  /** EV of folding. Always exactly -2. */
  evFold: number;
  optimalAction: 'play' | 'fold';
  /** What the mistake costs, in units. Zero when the choice is right. */
  margin: number;
  /** Dealer holdings the player beats, ties and loses to, out of 990. */
  wins: number;
  ties: number;
  losses: number;
}

/**
 * Cards not visible to the player. The dealer's two hole cards are unknown and
 * therefore still in here; nothing else is.
 */
function unseenCards(known: readonly Card[]): Card[] {
  const seen = new Uint8Array(NUM_CARDS);
  for (const card of known) {
    if (seen[card] === 1) throw new Error(`Duplicate card in the deal: ${card}`);
    seen[card] = 1;
  }
  const out: Card[] = [];
  for (let card = 0; card < NUM_CARDS; card++) if (seen[card] === 0) out.push(card);
  return out;
}

/**
 * Solve the river decision exactly.
 *
 * @param playerHole the player's two hole cards
 * @param board      all five community cards
 */
export function solveRiver(
  playerHole: readonly Card[],
  board: readonly Card[],
  paytable: BlindPaytable,
): RiverDecision {
  if (playerHole.length !== 2) throw new Error('The player holds exactly two cards');
  if (board.length !== 5) throw new Error('The river is dealt when all five community cards are out');

  const unseen = unseenCards([...playerHole, ...board]);
  if (unseen.length !== 45) throw new Error(`Expected 45 unseen cards, found ${unseen.length}`);

  // The player's hand is fixed now, so it is scored once rather than 990 times.
  const playerScore = evaluate([...playerHole, ...board]);

  // Reused buffer: the dealer's seven cards are the board plus two unseen cards,
  // and only the last two change.
  const dealerCards: Card[] = [
    board[0]!,
    board[1]!,
    board[2]!,
    board[3]!,
    board[4]!,
    0,
    0,
  ];

  let total = 0;
  let count = 0;
  let wins = 0;
  let ties = 0;
  let losses = 0;

  for (let i = 0; i < unseen.length; i++) {
    dealerCards[5] = unseen[i]!;
    for (let j = i + 1; j < unseen.length; j++) {
      dealerCards[6] = unseen[j]!;
      const dealerScore = evaluate(dealerCards);
      if (playerScore > dealerScore) wins++;
      else if (playerScore === dealerScore) ties++;
      else losses++;
      total += settle(playerScore, dealerScore, RIVER_RAISE, paytable);
      count++;
    }
  }

  const evPlay = total / count;
  const optimalAction = evPlay >= FOLD_RESULT ? 'play' : 'fold';

  return {
    evPlay,
    evFold: FOLD_RESULT,
    optimalAction,
    margin: Math.abs(evPlay - FOLD_RESULT),
    wins,
    ties,
    losses,
  };
}
