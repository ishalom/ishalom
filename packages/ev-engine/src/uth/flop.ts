/**
 * The flop decision: bet 2x, or check and keep the river option (spec §6.3).
 *
 * Two things about this decision are worth stating before the code.
 *
 * The size of it. The spec puts the enumeration at C(45,2) x C(43,2) = 893,970,
 * but 45 and 43 are the river's numbers, where seven cards are already visible.
 * At the flop the player has seen only five — two hole cards and three community
 * cards — so 47 are unseen. The turn and river are two of those 47, and the
 * dealer holds two of the 45 that remain:
 *
 *     C(47,2) x C(45,2) = 1081 x 990 = 1,070,190
 *
 * about twenty per cent more than the spec's figure. It is still exact, still
 * enumerated in full, and still inside the 200 ms target.
 *
 * The shape of it. Checking the flop is not the end of the hand: the player
 * still gets the river decision, and will fold there if the board has gone badly
 * and bet 1x if it has not. So the value of checking is not the value of showing
 * down passively — it is the average, over every turn and river, of playing the
 * river *correctly*. Treating a check as terminal would undervalue it and push
 * the trainer toward recommending 2x too often.
 *
 * The player's hand only changes with the turn and river, so it is scored 1,081
 * times rather than 1,070,190; the dealer's is the inner loop.
 */

import { evaluate7 } from '../poker/evaluator.ts';
import { unseenCards, type Card } from '../core/cards.ts';
import { blindPayout, FLOP_RAISE, FOLD_RESULT, RIVER_RAISE, type BlindPaytable } from './rules.ts';
import { dealerQualifies } from './showdown.ts';

export interface FlopDecision {
  /** EV of raising 2x now, in units of the ante. */
  evPlay: number;
  /**
   * EV of checking, which keeps the hand alive to the river and assumes the
   * river is then played correctly.
   */
  evCheck: number;
  optimalAction: 'play' | 'check';
  /** What the wrong choice costs, in units. */
  margin: number;
  /** How often checking leads to folding the river. */
  riverFoldFrequency: number;
  /** Boards enumerated (1,081) and total outcomes (1,070,190). */
  boards: number;
  outcomes: number;
}

/**
 * Solve the flop decision exactly.
 *
 * @param playerHole the player's two hole cards
 * @param flop       the three community cards on the table
 */
export function solveFlop(
  playerHole: readonly Card[],
  flop: readonly Card[],
  paytable: BlindPaytable,
): FlopDecision {
  if (playerHole.length !== 2) throw new Error('The player holds exactly two cards');
  if (flop.length !== 3) throw new Error('The flop is three community cards');

  const unseen = unseenCards([...playerHole, ...flop]);
  if (unseen.length !== 47) throw new Error(`Expected 47 unseen cards, found ${unseen.length}`);

  // Reused buffers. The player's seven cards are hole + flop + turn + river; the
  // dealer's are flop + turn + river + two unseen.
  const playerCards: Card[] = [
    playerHole[0]!, playerHole[1]!, flop[0]!, flop[1]!, flop[2]!, 0, 0,
  ];
  const dealerCards: Card[] = [flop[0]!, flop[1]!, flop[2]!, 0, 0, 0, 0];
  const remaining: Card[] = new Array<Card>(45);

  let playTotal = 0;
  let checkTotal = 0;
  let riverFolds = 0;
  let boards = 0;
  let outcomes = 0;

  for (let i = 0; i < unseen.length; i++) {
    const turn = unseen[i]!;
    for (let j = i + 1; j < unseen.length; j++) {
      const river = unseen[j]!;

      playerCards[5] = turn;
      playerCards[6] = river;
      const playerScore = evaluate7(playerCards);
      const blind = blindPayout(playerScore, paytable);

      dealerCards[3] = turn;
      dealerCards[4] = river;

      // The 45 cards the dealer could hold, once the turn and river are spoken for.
      let n = 0;
      for (let k = 0; k < unseen.length; k++) {
        if (k === i || k === j) continue;
        remaining[n++] = unseen[k]!;
      }

      // Settlement splits cleanly into a part that does not depend on the raise
      // size and a part that is exactly the raise: the ante and blind are the
      // same whether the player bet 1x or 2x, and the play bet is the multiple.
      // So one pass yields both, and the river's value comes free.
      let anteAndBlind = 0;
      let net = 0; // wins minus losses, i.e. the play bet per unit raised
      for (let a = 0; a < n; a++) {
        dealerCards[5] = remaining[a]!;
        for (let b = a + 1; b < n; b++) {
          dealerCards[6] = remaining[b]!;
          const dealerScore = evaluate7(dealerCards);
          if (playerScore > dealerScore) {
            anteAndBlind += (dealerQualifies(dealerScore) ? 1 : 0) + blind;
            net += 1;
          } else if (playerScore < dealerScore) {
            anteAndBlind += (dealerQualifies(dealerScore) ? -1 : 0) - 1;
            net -= 1;
          }
          outcomes++;
        }
      }

      const holdings = (n * (n - 1)) / 2;
      const evRiverPlay = (anteAndBlind + net * RIVER_RAISE) / holdings;
      const evFlopPlay = (anteAndBlind + net * FLOP_RAISE) / holdings;

      playTotal += evFlopPlay;
      // At the river the player takes the better of betting and folding.
      if (evRiverPlay >= FOLD_RESULT) {
        checkTotal += evRiverPlay;
      } else {
        checkTotal += FOLD_RESULT;
        riverFolds++;
      }
      boards++;
    }
  }

  const evPlay = playTotal / boards;
  const evCheck = checkTotal / boards;

  return {
    evPlay,
    evCheck,
    optimalAction: evPlay >= evCheck ? 'play' : 'check',
    margin: Math.abs(evPlay - evCheck),
    riverFoldFrequency: riverFolds / boards,
    boards,
    outcomes,
  };
}
