/**
 * The pre-flop decision: raise 4x, or check (spec §6.3, §5.2.3).
 *
 * This is the one decision the spec says cannot be solved at runtime. Fully
 * exact means every board against every dealer holding:
 *
 *     C(50,5) x C(45,2) = 2,118,760 x 990 = 2,097,572,400
 *
 * outcomes, for one pair of hole cards. So it is an offline job whose output
 * ships as a lookup asset, keyed on the equivalence class of the player's two
 * cards — rank pair plus suitedness, 169 classes — with runtime lookup O(1).
 *
 * Two structural facts make the job tractable rather than merely large.
 *
 * The board is fixed across the dealer's 990 holdings, so its four suit masks
 * are built once and each dealer hand costs two ORs and a score. The player's
 * seven cards are that same board plus the two hole cards, which is the
 * identical operation — so one function and one set of masks serve both.
 *
 * And settlement splits into a part independent of the raise size (the ante and
 * the blind) and a part that is exactly the raise (the play bet). One pass over
 * a board therefore yields its value at every raise size at once: 4x, 3x, the 2x
 * available on the flop and the 1x available on the river. That is what lets the
 * check branch — which needs optimal play at both later streets — fall out of
 * the same enumeration instead of a second, far larger one.
 */

import { evaluateWithTwo } from '../poker/evaluator.ts';
import { RANK_CHARS, makeCard, unseenCards, type Card } from '../core/cards.ts';
import {
  blindPayout,
  FLOP_RAISE,
  FOLD_RESULT,
  PREFLOP_RAISE,
  PREFLOP_RAISE_SMALL,
  RIVER_RAISE,
  type BlindPaytable,
} from './rules.ts';
import { dealerQualifies } from './showdown.ts';

/** One of the 169 pre-flop equivalence classes, such as AKs, AKo or AA. */
export interface HoleClass {
  /** Canonical label: higher rank first, then s or o; a pair takes neither. */
  label: string;
  /** Representative cards. Every member of the class gives the same EVs. */
  cards: [Card, Card];
  highRank: number;
  lowRank: number;
  suited: boolean;
  /** How many of the C(52,2) = 1326 starting hands fall in this class. */
  combinations: number;
}

const SPADES = 3;
const HEARTS = 2;

/**
 * All 169 classes: 13 pairs, 78 suited and 78 offsuit.
 *
 * Suits matter only through whether the two cards share one, so a single
 * representative stands for the whole class. Spades and hearts are used
 * throughout, which keeps representatives comparable when debugging.
 */
export function allHoleClasses(): HoleClass[] {
  const out: HoleClass[] = [];
  for (let high = 12; high >= 0; high--) {
    for (let low = high; low >= 0; low--) {
      if (high === low) {
        out.push({
          label: `${RANK_CHARS[high]}${RANK_CHARS[low]}`,
          cards: [makeCard(high, SPADES), makeCard(low, HEARTS)],
          highRank: high,
          lowRank: low,
          suited: false,
          combinations: 6,
        });
        continue;
      }
      out.push({
        label: `${RANK_CHARS[high]}${RANK_CHARS[low]}s`,
        cards: [makeCard(high, SPADES), makeCard(low, SPADES)],
        highRank: high,
        lowRank: low,
        suited: true,
        combinations: 4,
      });
      out.push({
        label: `${RANK_CHARS[high]}${RANK_CHARS[low]}o`,
        cards: [makeCard(high, SPADES), makeCard(low, HEARTS)],
        highRank: high,
        lowRank: low,
        suited: false,
        combinations: 12,
      });
    }
  }
  return out;
}

export interface PreflopResult {
  label: string;
  /** EV of raising 4x before the flop, in units of the ante. */
  ev4x: number;
  /**
   * EV of raising 3x where a casino offers it. Spec §5.2.3 calls this the trap:
   * it is never correct, and the table demonstrates that rather than asserting it.
   */
  ev3x: number;
  /** EV of checking, then playing the flop and river correctly. */
  evCheck: number;
  optimalAction: 'raise4x' | 'check';
  /** What the wrong choice costs, in units. */
  margin: number;
  /** Share of flops on which a pre-flop check leads to a 2x raise. */
  flopRaiseFrequency: number;
  /** Share of all boards this hand would fold on the river. */
  riverFoldFrequency: number;
}

/**
 * Binomial coefficients up to C(50,5), for ranking five-card boards.
 *
 * A board has to be addressable by index, because the check branch revisits each
 * one through all ten of its flop splittings and must find the value the board
 * enumeration stored. The combinatorial number system gives that addressing for
 * free: the colex rank of five sorted indices is a bijection onto
 * [0, C(50,5)), so no hash map and no sorting is needed in the inner loop.
 */
const CHOOSE_N = 50;
const CHOOSE_K = 5;
const CHOOSE_WIDTH = CHOOSE_K + 1;

const BINOMIAL: Int32Array = (() => {
  const table = new Int32Array((CHOOSE_N + 1) * CHOOSE_WIDTH);
  for (let i = 0; i <= CHOOSE_N; i++) {
    table[i * CHOOSE_WIDTH] = 1;
    for (let j = 1; j <= CHOOSE_K; j++) {
      if (j > i) break;
      table[i * CHOOSE_WIDTH + j] =
        table[(i - 1) * CHOOSE_WIDTH + j - 1]! +
        (j <= i - 1 ? table[(i - 1) * CHOOSE_WIDTH + j]! : 0);
    }
  }
  return table;
})();

function choose(n: number, k: number): number {
  return n < k ? 0 : BINOMIAL[n * CHOOSE_WIDTH + k]!;
}

/**
 * Colex rank of five sorted card indices drawn from the 50 available.
 * Bijective onto [0, 2118760), which `preflop.test.ts` verifies exhaustively.
 */
export function boardIndex(a: number, b: number, c: number, d: number, e: number): number {
  return choose(a, 1) + choose(b, 2) + choose(c, 3) + choose(d, 4) + choose(e, 5);
}

export interface SolvePreflopOptions {
  /** Called with a fraction in [0,1] as the board enumeration proceeds. */
  onProgress?: (fraction: number) => void;
}

/** Boards in the enumeration: C(50,5). */
export const PREFLOP_BOARDS = 2_118_760;
/** Dealer holdings per board: C(45,2). */
const HOLDINGS = 990;

/**
 * Solve one hole-card class exactly.
 *
 * This is the multi-billion-outcome job. It takes minutes per class and belongs
 * to the offline script; the app reads the table it produces and never calls it.
 */
export function solvePreflop(
  holeClass: HoleClass,
  paytable: BlindPaytable,
  options: SolvePreflopOptions = {},
): PreflopResult {
  const holeA = holeClass.cards[0];
  const holeB = holeClass.cards[1];
  const available = unseenCards([holeA, holeB]);
  if (available.length !== 50) throw new Error('Expected 50 available cards');

  // Per-board value, stored so any raise size can be recovered from it:
  //   value(bet) = anteAndBlind + bet * net
  const anteAndBlind = new Float64Array(PREFLOP_BOARDS);
  const net = new Float64Array(PREFLOP_BOARDS);

  // Board suit masks after 0..5 cards, reused rather than reallocated.
  const masks = [
    new Int32Array(4), new Int32Array(4), new Int32Array(4),
    new Int32Array(4), new Int32Array(4), new Int32Array(4),
  ];
  const extend = (to: number, from: number, card: Card): void => {
    const target = masks[to]!;
    const source = masks[from]!;
    target[0] = source[0]!;
    target[1] = source[1]!;
    target[2] = source[2]!;
    target[3] = source[3]!;
    target[card % 4]! |= 1 << ((card / 4) | 0);
  };

  const dealerPool = new Int32Array(45);

  for (let i0 = 0; i0 < 46; i0++) {
    extend(1, 0, available[i0]!);
    const rank0 = choose(i0, 1);
    for (let i1 = i0 + 1; i1 < 47; i1++) {
      extend(2, 1, available[i1]!);
      const rank1 = rank0 + choose(i1, 2);
      for (let i2 = i1 + 1; i2 < 48; i2++) {
        extend(3, 2, available[i2]!);
        const rank2 = rank1 + choose(i2, 3);
        for (let i3 = i2 + 1; i3 < 49; i3++) {
          extend(4, 3, available[i3]!);
          const rank3 = rank2 + choose(i3, 4);
          for (let i4 = i3 + 1; i4 < 50; i4++) {
            extend(5, 4, available[i4]!);
            const index = rank3 + choose(i4, 5); // === boardIndex(i0..i4), accumulated
            const board = masks[5]!;

            // The player's seven cards are this board plus the two hole cards —
            // exactly the operation the dealer's hand needs.
            const playerScore = evaluateWithTwo(board, holeA, holeB);
            const blind = blindPayout(playerScore, paytable);

            let n = 0;
            for (let k = 0; k < 50; k++) {
              if (k === i0 || k === i1 || k === i2 || k === i3 || k === i4) continue;
              dealerPool[n++] = available[k]!;
            }

            let ab = 0;
            let sign = 0;
            for (let a = 0; a < 45; a++) {
              const cardA = dealerPool[a]!;
              for (let b = a + 1; b < 45; b++) {
                const dealerScore = evaluateWithTwo(board, cardA, dealerPool[b]!);
                if (playerScore > dealerScore) {
                  ab += (dealerQualifies(dealerScore) ? 1 : 0) + blind;
                  sign++;
                } else if (playerScore < dealerScore) {
                  ab += (dealerQualifies(dealerScore) ? -1 : 0) - 1;
                  sign--;
                }
              }
            }
            anteAndBlind[index] = ab / HOLDINGS;
            net[index] = sign / HOLDINGS;
          }
        }
      }
    }
    options.onProgress?.((i0 + 1) / 46);
  }

  return summarise(holeClass.label, anteAndBlind, net);
}

/**
 * Turn per-board values into the three pre-flop EVs.
 *
 * The raise branches are a straight average over boards, because raising ends
 * the decisions. Checking does not: the hand still faces the flop and then the
 * river, and it plays both correctly. So the check branch averages over flops
 * the better of raising 2x and checking again, where checking again averages
 * over turn-and-river the better of betting 1x and folding.
 */
function summarise(
  label: string,
  anteAndBlind: Float64Array,
  net: Float64Array,
): PreflopResult {
  let sum4 = 0;
  let sum3 = 0;
  let riverFolds = 0;
  for (let i = 0; i < PREFLOP_BOARDS; i++) {
    const ab = anteAndBlind[i]!;
    const nt = net[i]!;
    sum4 += ab + PREFLOP_RAISE * nt;
    sum3 += ab + PREFLOP_RAISE_SMALL * nt;
    if (ab + RIVER_RAISE * nt < FOLD_RESULT) riverFolds++;
  }

  const remaining = new Int32Array(47);
  const merged = new Int32Array(5);
  let checkSum = 0;
  let flops = 0;
  let flopRaises = 0;

  for (let f0 = 0; f0 < 48; f0++) {
    for (let f1 = f0 + 1; f1 < 49; f1++) {
      for (let f2 = f1 + 1; f2 < 50; f2++) {
        let m = 0;
        for (let k = 0; k < 50; k++) {
          if (k === f0 || k === f1 || k === f2) continue;
          remaining[m++] = k;
        }

        let betTotal = 0;
        let checkTotal = 0;
        let completions = 0;
        for (let t = 0; t < 47; t++) {
          const turn = remaining[t]!;
          for (let r = t + 1; r < 47; r++) {
            const index = rankFive(f0, f1, f2, turn, remaining[r]!, merged);
            const ab = anteAndBlind[index]!;
            const nt = net[index]!;
            betTotal += ab + FLOP_RAISE * nt;
            const river = ab + RIVER_RAISE * nt;
            checkTotal += river >= FOLD_RESULT ? river : FOLD_RESULT;
            completions++;
          }
        }

        const evFlopBet = betTotal / completions;
        const evFlopCheck = checkTotal / completions;
        if (evFlopBet >= evFlopCheck) {
          checkSum += evFlopBet;
          flopRaises++;
        } else {
          checkSum += evFlopCheck;
        }
        flops++;
      }
    }
  }

  const ev4x = sum4 / PREFLOP_BOARDS;
  const ev3x = sum3 / PREFLOP_BOARDS;
  const evCheck = checkSum / flops;

  return {
    label,
    ev4x,
    ev3x,
    evCheck,
    optimalAction: ev4x >= evCheck ? 'raise4x' : 'check',
    margin: Math.abs(ev4x - evCheck),
    flopRaiseFrequency: flopRaises / flops,
    riverFoldFrequency: riverFolds / PREFLOP_BOARDS,
  };
}

/**
 * Colex rank of the five board indices, given a sorted flop plus two further
 * sorted cards. The two runs are merged rather than sorted, since both are
 * already ordered.
 */
function rankFive(
  f0: number,
  f1: number,
  f2: number,
  turn: number,
  river: number,
  merged: Int32Array,
): number {
  let i = 0;
  let j = 0;
  for (let k = 0; k < 5; k++) {
    const left = i === 0 ? f0 : i === 1 ? f1 : i === 2 ? f2 : Infinity;
    const right = j === 0 ? turn : j === 1 ? river : Infinity;
    if (left < right) {
      merged[k] = left;
      i++;
    } else {
      merged[k] = right;
      j++;
    }
  }
  return boardIndex(merged[0]!, merged[1]!, merged[2]!, merged[3]!, merged[4]!);
}
