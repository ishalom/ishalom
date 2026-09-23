/**
 * The shared Ultimate table (round 32) — one board, one dealer, every seat its
 * own two cards.
 *
 * Idan settled the shape before a line was written: *as in a real casino*. The
 * flop, the turn and the river are the same cards for everybody, the dealer
 * plays one hand against all of them, and each player still wins or loses
 * against the dealer on his own. Nobody plays against anybody.
 *
 * And he settled how a hand runs, in one sentence: **everyone decides; when
 * everyone has decided, the board turns; and again, three times.**
 *
 * WHY NOTHING OF BLACKJACK'S DEALING IS HERE. Blackjack's reservation rule
 * exists because players draw cards in parallel and a card must not go to
 * whoever's network is faster. In Ultimate nobody draws a card after the deal.
 * So every card of a hand is laid out the moment the deck is shuffled, at a
 * position fixed by **seat index** rather than by who happens to be live:
 *
 *   seat k's two cards   deck[2k], deck[2k + 1]      (k = 0 … 5)
 *   the dealer's two     deck[12], deck[13]
 *   the board            deck[14 … 18]
 *
 * Nobody's choice, nobody's arrival and nobody's departure can move a card
 * anybody else holds, or the board — which is Idan's "no way for one player's
 * choice to change another's cards", made structural rather than argued. A
 * seat that is not live leaves its two cards in the deck, unseen.
 *
 * WHAT STAYS FROM BLACKJACK, BECAUSE IT COSTS NOTHING AND PROTECTS EVERYTHING.
 * The table is a pure function of the seed and the seats' own rows, with no
 * wall clock anywhere in it; every seat still writes a checksum of what it saw,
 * now including the board, which is what proves two phones show the same one;
 * who is live is read from the same events, and a drop is the same vote.
 *
 * WHAT THIS FILE REFUSES TO DO, AS ITS BLACKJACK COUSIN DOES. It does not grade
 * and it does not settle. Each live seat plays its hand on its own `UthTable` —
 * the class the private table plays on — stacked with exactly the nine cards
 * that seat's hand is made of, and every grade and every unit comes out of that
 * table's own `act()` and `settle()`. A shared decision and the same decision
 * alone are graded by one code path; `test/shared-uth.test.ts` proves it by
 * comparison.
 */

import { fullDeck, holeClassLabel, type Card as PokerCard } from '@evtrainer/ev-engine/uth';
import {
  UthTable,
  makeRng,
  shuffleInPlace,
  type UthAction,
  type UthDecisionRecord,
  type UthEvaluation,
} from '@evtrainer/game-engine';

import {
  handsDealt,
  isLive,
  tableEvents,
  type DerivedDecision,
  type DerivedHand,
  type DerivedTable,
  type ForfeitSpot,
  type RatableDecision,
  type SeatMove,
  type SeatRecord,
  type TableRecord,
} from './shared-table.ts';

/**
 * The preset a shared Ultimate table is recorded under.
 *
 * The `tables` row already carries a preset id and nothing else about the game,
 * so the game is the preset: no column was added and no migration was needed.
 */
export const UTH_PRESET_ID = 'uth-standard';

/** Whether a table record is an Ultimate table. Everything else is Blackjack. */
export function isUthTable(record: Pick<TableRecord, 'presetId'>): boolean {
  return record.presetId === UTH_PRESET_ID;
}

/** The three decision points, in order: the move's `round` is the index here. */
const UTH_STREETS = ['preflop', 'flop', 'river'] as const;

/** How much of the board is face up while the table decides each street. */
const UTH_BOARD_AT = [0, 3, 5] as const;

/** Where the dealer's cards and the board sit in each hand's deck. See the header. */
const UTH_DEALER_AT = 12;
const UTH_BOARD_FROM = 14;

/**
 * Every evaluation this page has solved, shared by every seat and every read.
 *
 * The table is derived afresh on every poll, and each derivation plays every
 * seat of every hand; a flop solve is ~60 ms, so without this a long evening
 * would re-solve the whole table's flops every second and a half. The memo is
 * keyed by the cards the answer depends on (see `UthTableOptions.solved`), so
 * it is correct for any table and any seat.
 */
const UTH_SOLVED = new Map<string, UthEvaluation>();

/**
 * What an Ultimate decision carries beyond what every decision carries: the
 * evaluation it was graded on, the class and cards the card words, and the
 * seat's Ante — everything the private table's card is composed from.
 */
export interface UthDecisionFacts {
  record: UthDecisionRecord;
  evaluation: UthEvaluation;
  holeClass: string;
  hole: PokerCard[];
  /** The board as it was face up when the decision was made. */
  board: PokerCard[];
  bet: number;
}

/** Everything the Ultimate derivation adds to a hand. */
export interface UthHandFacts {
  /** The board as far as it has turned: 0, 3 or 5 cards. */
  board: PokerCard[];
  /** Which street the table is deciding, while it is; 3 once the hand is over. */
  street: number;
  /**
   * Whether the dealer's two cards are turned over. Not when every live seat
   * folded: the private table does not show a folded player the hand he gave
   * up (§3.1), and a table where everybody folded is that, several times.
   */
  dealerShown: boolean;
  /** Per seat: whether it folded, and the Play bet it made (0 for none). */
  folded: Map<number, boolean>;
  playBet: Map<number, number>;
}

/** The cards one hand is made of, from its deck. */
function uthCardsOf(deck: readonly PokerCard[], seat: number) {
  return {
    hole: [deck[2 * seat]!, deck[2 * seat + 1]!],
    dealer: [deck[UTH_DEALER_AT]!, deck[UTH_DEALER_AT + 1]!],
    board: deck.slice(UTH_BOARD_FROM, UTH_BOARD_FROM + 5),
  };
}

/** What `inspect` is shown: the seat the table is waiting on, and its spot. */
type UthInspect = (
  seat: number,
  round: number,
  legal: string[],
  evaluation: { evByAction: Partial<Record<string, number>>; optimalAction: string },
) => void;

/**
 * Deal one hand to the seats live for it, and play it street by street.
 *
 * `moveFor` answers a seat's action at a street, or null while it has not
 * decided. The street is the whole of the lock-step: a street is over when
 * every seat that owes it a decision has made one, and only then does the
 * board turn for anybody. A seat that has raised or folded owes nothing
 * further, so it never holds the table up.
 */
function playUthHand(
  handIndex: number,
  deck: readonly PokerCard[],
  live: SeatRecord[],
  moveFor: (seat: number, round: number, legal: string[]) => SeatMove['action'] | null,
  record: (decision: DerivedDecision) => void,
  inspect?: UthInspect,
): DerivedHand {
  const plays = live.map((seat) => {
    const cards = uthCardsOf(deck, seat.seat);
    const table = new UthTable({ seed: 1, solved: UTH_SOLVED });
    table.stackNextHand([...cards.hole, ...cards.dealer, ...cards.board]);
    table.startHand();
    return { seat, table, hole: cards.hole };
  });

  const owing = new Set<number>();
  let street = 0;
  for (; street < UTH_STREETS.length; street++) {
    for (const { seat, table, hole } of plays) {
      if (table.view.phase !== UTH_STREETS[street]) continue;
      const legal = table.legalActions() as string[];
      const action = moveFor(seat.seat, street, legal);
      if (action === null) {
        owing.add(seat.seat);
        if (inspect) {
          const waiting = table.evaluate();
          inspect(seat.seat, street, legal, {
            evByAction: waiting.evByAction as Partial<Record<string, number>>,
            optimalAction: waiting.optimalAction,
          });
        }
        continue;
      }
      /*
       * Everything the card needs is read before the engine is asked: `act()`
       * moves the street on and clears the evaluation it graded with.
       */
      const evaluation = table.evaluate();
      const holeClass = table.holeClass;
      const board = [...table.view.board];
      const graded = table.act(action as UthAction);
      record({
        seat: seat.seat,
        hand: handIndex,
        round: street,
        action,
        cards: [...hole],
        // Ultimate has no upcard. Nothing reads this for an Ultimate decision.
        upcard: -1,
        fromSplit: false,
        handCount: 1,
        evByAction: { ...graded.evByAction } as Partial<Record<string, number>>,
        optimalAction: graded.optimalAction,
        evCost: graded.evCost,
        uth: { record: graded, evaluation, holeClass, hole: [...hole], board, bet: seat.bet },
      });
    }
    // The board turns only once every seat that owed this street has answered.
    if (owing.size > 0) break;
  }

  const incomplete = owing.size > 0;
  const shown = incomplete ? UTH_BOARD_AT[street]! : 5;
  const dealt = uthCardsOf(deck, 0);
  const folded = new Map<number, boolean>();
  const playBet = new Map<number, number>();
  for (const { seat, table } of plays) {
    folded.set(seat.seat, table.view.settlement?.folded ?? false);
    playBet.set(seat.seat, table.view.playBet);
  }
  const dealerShown = !incomplete && plays.some(({ table }) => !table.view.settlement?.folded);

  return {
    hand: handIndex,
    incomplete,
    waitingFor: [...owing].sort((a, b) => a - b),
    dealer: [...dealt.dealer],
    burned: [],
    reserved: [],
    decisions: [],
    seats: plays.map(({ seat, table, hole }) => {
      // In chips: the seat's own Ante times what the engine settled, in units.
      const net = incomplete || table.view.netUnits === null ? null : table.view.netUnits * seat.bet;
      return {
        seat: seat.seat,
        cards: [...hole],
        hands: [[...hole]],
        net,
        detail: [{ net, doubled: false, surrendered: false }],
        active: owing.has(seat.seat) ? 0 : null,
      };
    }),
    uth: {
      board: dealt.board.slice(0, shown),
      street: incomplete ? street : UTH_STREETS.length,
      dealerShown,
      folded,
      playBet,
    },
  };
}

/**
 * The one loop behind every Ultimate derivation: shuffle, deal, play.
 *
 * One shuffle per hand, from one seeded generator, whether or not anybody is
 * live for that hand — so hand N's deck depends on the seed and N and on
 * nothing that anybody did.
 */
function runUth(
  record: TableRecord,
  handCount: number,
  moveFor: (seat: number, hand: number, round: number, legal: string[]) => SeatMove['action'] | null,
  inspect?: UthInspect,
): DerivedTable {
  const rng = makeRng(record.seed);
  const hands: DerivedHand[] = [];
  const seen = new Map<number, number[]>();
  for (const seat of record.seats) seen.set(seat.seat, []);

  for (let hand = 0; hand < handCount; hand++) {
    const deck = fullDeck();
    shuffleInPlace(deck, rng);
    const live = record.seats.filter((seat) => isLive(record, seat.seat, hand));
    if (live.length === 0) continue;
    const decisions: DerivedDecision[] = [];
    const derived = playUthHand(
      hand,
      deck,
      live,
      (seat, round, legal) => moveFor(seat, hand, round, legal),
      (decision) => decisions.push(decision),
      inspect,
    );
    derived.decisions = decisions;
    /*
     * What each seat saw: its own two cards, the board as far as it has turned,
     * and the dealer's two once they are shown. The board is in every seat's
     * checksum, which is what makes "two phones see the same board" a thing the
     * table checks rather than a thing it hopes.
     */
    const facts = derived.uth!;
    for (const seatHand of derived.seats) {
      seen
        .get(seatHand.seat)!
        .push(...seatHand.cards, ...facts.board, ...(facts.dealerShown ? derived.dealer : []));
    }
    hands.push(derived);
  }
  return { hands, seen };
}

/** A seat's recorded move at one street of one hand, or null. */
function uthMoveOf(record: TableRecord, seat: number, hand: number, round: number): SeatMove['action'] | null {
  return (
    record.seats
      .find((entry) => entry.seat === seat)
      ?.moves.find((entry) => entry.hand === hand && entry.round === round)?.action ?? null
  );
}

/** Derive the whole Ultimate table from its seed and its record. */
export function deriveUthTable(record: TableRecord): DerivedTable {
  return runUth(record, handsDealt(record), (seat, hand, round) => uthMoveOf(record, seat, hand, round));
}

/**
 * Play an Ultimate table out, choosing each action as it comes, and write the
 * moves into the record — `playTable`'s counterpart, for the tests.
 */
export function playUthTable(
  record: TableRecord,
  hands: number,
  choose: (context: { seat: number; hand: number; round: number; legal: string[] }) => SeatMove['action'],
): DerivedTable {
  const derived = runUth(record, hands, (seat, hand, round, legal) => {
    const action = choose({ seat, hand, round, legal });
    record.seats.find((entry) => entry.seat === seat)?.moves.push({ hand, round, action });
    return action;
  });
  for (const seat of record.seats) seat.hands = Math.max(seat.hands ?? 0, hands);
  return derived;
}

/**
 * What one seat may do now, and at which street it would be recorded.
 *
 * Asked of its own `UthTable` at the moment the replay runs out of its moves —
 * the same `legalActions()` the private table asks.
 */
export function uthLegalFor(record: TableRecord, hand: number, seat: number): { legal: string[]; round: number } {
  let legal: string[] = [];
  let round = 0;
  runUth(record, hand + 1, (who, atHand, atRound, options) => {
    const move = uthMoveOf(record, who, atHand, atRound);
    if (who === seat && atHand === hand && move === null) {
      legal = [...options];
      round = atRound;
    }
    return move;
  });
  return { legal, round };
}

/**
 * The spot a dropped seat was sitting at — `forfeitSpot`'s counterpart.
 *
 * The same table with the drop being priced taken out, replayed until the seat
 * is found owing a decision; the cost is that of the worst action open to it
 * there (Idan, round 26), read off the evaluation the private table would have
 * graded it on.
 */
export function uthForfeitSpot(record: TableRecord, seat: number, hand: number): ForfeitSpot | null {
  const before: TableRecord = {
    ...record,
    seats: record.seats.map((entry) => ({
      ...entry,
      moves: [...entry.moves],
      events:
        entry.seat === seat
          ? (entry.events ?? []).filter((event) => !(event.kind === 'drop' && event.hand === hand))
          : entry.events,
      vote: entry.vote && entry.vote.against === seat && entry.vote.hand === hand ? null : entry.vote,
    })),
  };
  let waiting: { round: number; legal: string[]; evaluation: { evByAction: Partial<Record<string, number>>; optimalAction: string } } | null = null;
  try {
    runUth(
      before,
      hand + 1,
      (who, atHand, atRound) => uthMoveOf(before, who, atHand, atRound),
      (who, round, legal, evaluation) => {
        if (waiting || who !== seat) return;
        waiting = { round, legal: [...legal], evaluation };
      },
    );
  } catch {
    return null;
  }
  if (!waiting) return null;
  const { round, legal, evaluation } = waiting as {
    round: number;
    legal: string[];
    evaluation: { evByAction: Partial<Record<string, number>>; optimalAction: string };
  };
  const best = evaluation.evByAction[evaluation.optimalAction] ?? 0;
  let worstAction = evaluation.optimalAction;
  let worst = best;
  for (const action of legal) {
    const ev = evaluation.evByAction[action];
    if (ev !== undefined && ev < worst) {
      worst = ev;
      worstAction = action;
    }
  }
  return {
    seat,
    hand,
    round,
    scenarioKey: `uth:${UTH_STREETS[round] ?? 'preflop'}`,
    evCost: Math.max(0, best - worst),
    legal,
    worstAction,
    evByAction: { ...evaluation.evByAction },
  };
}

/**
 * Everything one seat has decided at an Ultimate table, in the table's order,
 * with the EVs the Ultimate rating reads its difficulty from — `seatRatable`'s
 * counterpart.
 */
export function uthSeatRatable(record: TableRecord, seat: number): RatableDecision[] {
  const out: RatableDecision[] = [];
  for (const hand of deriveUthTable(record).hands) {
    for (const decision of hand.decisions) {
      if (decision.seat !== seat) continue;
      out.push({
        hand: hand.hand,
        round: decision.round,
        scenarioKey: `uth:${UTH_STREETS[decision.round]}`,
        evCost: decision.evCost,
        action: String(decision.action),
        evByAction: { ...decision.evByAction },
      });
    }
  }
  for (const event of tableEvents(record)) {
    if (event.seat !== seat || event.kind !== 'drop' || event.why === 'left') continue;
    const spot = uthForfeitSpot(record, seat, event.hand);
    if (!spot) continue;
    out.push({
      hand: spot.hand,
      round: spot.round,
      scenarioKey: spot.scenarioKey,
      evCost: spot.evCost,
      evByAction: spot.evByAction,
      forfeit: true,
    });
  }
  return out.sort((a, b) => a.hand - b.hand || a.round - b.round);
}

/** The class label of two hole cards, for a card that words a decision. */
export function uthHoleClass(hole: readonly PokerCard[]): string {
  return holeClassLabel(hole[0]!, hole[1]!);
}
