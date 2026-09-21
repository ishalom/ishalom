/**
 * The shared table's shoe, seats and record (round 21; spec A, round A1).
 *
 * No screen in this file and nothing a player can see. What is here is the one
 * thing everything else will trust: **a whole table derived from a seed and a
 * list of events, with no wall clock anywhere in the derivation.**
 *
 * THE RULE THAT MAKES SIMULTANEOUS PLAY POSSIBLE. Each decision round the dealer
 * reserves one card for every live **hand**, ordered by `(seat index, hand
 * index)`, and a hand that does not draw turns its card over unused. A hand's
 * card for the round therefore sits at a position fixed *before* the round
 * begins, so two people tapping in the same millisecond take different cards and
 * neither has to wait for the other. It is also the reason the table is a pure
 * function of the seed and the decisions: nothing in here asks what time it is
 * or who answered first.
 *
 * PER HAND, NOT PER SEAT — and why a split waits a round. Spec A settled the
 * rule as one card per live *seat*, which breaks at the one place a seat holds
 * more than one hand. A split seat needs cards for both, so the rule is read one
 * level down: per live hand. That leaves the split itself, which would otherwise
 * change how many cards the round consumes *after* the round has begun — and a
 * round whose reservation is not fixed before it starts is the one thing this
 * whole derivation rests on not happening. So **a split takes effect from the
 * next round**: the decision is recorded and graded where the player made it,
 * its reserved card is turned over unused, and on the next round the seat has
 * two live hands, reserves a card for each, and the dealer slides them in. That
 * is also what a dealer does with his hands, which is the test that it is the
 * right rule rather than a convenient one.
 *
 * WHY IT IS EXACTLY ENOUGH, AND NEVER ONE TOO FEW. Inside a single `act()` the
 * engine draws for the active hand first and then, through `advance()`, one
 * opening card to each following hand it uncovers, in hand-index order. Every
 * one of those hands is unfinished, so every one of them is live, so every one
 * of them has a card of its own reserved — and because both sequences run in
 * hand-index order, each hand is handed the very card that was put aside for it.
 * The one gap is an action that draws nothing for the active hand: on a stand,
 * a surrender or the round a split is recorded, the active hand's card is turned
 * over *before* the engine is asked, so the hand behind it still gets its own.
 *
 * WHY THE DEALER COSTS TWO PASSES. At a real table the dealer draws last, which
 * is exactly what makes "he took the dealer's bust card" a thing people say. So
 * his cards must come out of the shoe *after* every seat has finished — and the
 * engine plays a dealer the moment its player stands. The derivation therefore
 * runs each seat twice: once to find out which cards it drew and when it
 * finished, and once more, after the dealer's cards are known, on a table
 * stacked with the whole hand from first card to last. The second pass is what
 * settles, so **settlement is the engine's, not this file's**.
 *
 * WHAT THIS FILE REFUSES TO DO. It does not grade, it does not settle and it
 * does not decide what is legal. Every one of those comes from `BlackjackTable`,
 * the same class the solo game plays on, reached through the same `act()` — so a
 * decision at a shared table and the same decision alone are graded by one code
 * path, and `test/shared-table.test.ts` proves it by comparison rather than by
 * reading.
 */

import {
  deriveChart,
  getPreset,
  type BlackjackAction,
  type BlackjackRules,
  type Card,
  type StrategyChart,
} from '@evtrainer/ev-engine';
import { BlackjackTable, DealingShoe, makeRng } from '@evtrainer/game-engine';

import { applyRestrictions, type Restrictions } from './restrictions.ts';

/** How many seats a table can hold. Spec A 3.1: your own full size, the rest compact. */
export const MAX_SEATS = 6;

/** What a seat did, in the order the table will replay it. */
export interface SeatMove {
  /** Which hand of the table, from zero. */
  hand: number;
  /**
   * Which decision round of that hand, from zero.
   *
   * The round is part of the record rather than something to infer, because it
   * is what the reservation rule counts: a move claiming round 3 before round 2
   * has been played is a corrupt log, and `replay` says so instead of dealing
   * from the wrong place.
   */
  round: number;
  action: BlackjackAction | 'takeInsurance' | 'declineInsurance';
}

/** One seat, as its own row holds it. Only this seat ever writes here. */
export interface SeatRecord {
  seat: number;
  playerId: string;
  name: string;
  /** Chips a unit, this seat's own (spec A 3.5: personal stakes). */
  bet: number;
  moves: SeatMove[];
  /**
   * How many hands this seat has been dealt.
   *
   * Written by this seat and nobody else, like everything else in its row, and
   * it is here because the moves alone cannot say. A hand where the dealer turns
   * a natural is a hand nobody decides anything in — it is dealt, it is lost,
   * and it leaves no move behind — so a table whose last hand was one of those
   * would replay one hand short if the count were inferred from the log. The
   * cards still follow the log; this only says how far the log runs.
   */
  hands?: number;
  /**
   * This seat's own vote to drop whoever is holding the table (§3.3).
   *
   * Here, in the voter's own row, because a tally is naturally one shared
   * number and a shared number is the one thing this design does not have. The
   * derivation never reads it: a vote that passes becomes a `drop` event, and
   * only the event reaches the cards.
   */
  vote?: { hand: number | null; against: number; at: number } | null;
  /** What this seat saw dealt, hashed. See `cardsHash`. */
  cardsHash?: string;
}

/**
 * Something that changed who is at the table — written by whoever caused it,
 * and always carrying the hand it happened at.
 *
 * A drop and a return are events, never timestamps: who is live decides how many
 * cards a round consumes, so a wall clock inside the ban would make the table
 * non-reproducible. The clock decides when an event is written; the log decides
 * what happened; the cards follow the log (spec A 3.3).
 */
export type TableEvent =
  | { kind: 'join'; seat: number; hand: number }
  | { kind: 'drop'; seat: number; hand: number }
  | { kind: 'return'; seat: number; hand: number };

export interface TableRecord {
  id: string;
  seed: number;
  presetId: string;
  restrictions: Restrictions;
  seats: SeatRecord[];
  events: TableEvent[];
}

/** One graded decision, exactly as the solo game grades one. */
export interface DerivedDecision {
  seat: number;
  hand: number;
  round: number;
  action: SeatMove['action'];
  /** The cards the decision was made on, and the dealer's one visible card. */
  cards: Card[];
  upcard: Card;
  /**
   * Whether this hand came out of a split, and how many hands the seat held.
   *
   * Both change what a hand is worth — a split hand cannot be a natural, and the
   * number of hands decides whether another split is on offer — so anything
   * comparing these figures against a fresh hand's has to know.
   */
  fromSplit: boolean;
  handCount: number;
  /** Straight from `BlackjackTable.currentEvaluation()`. */
  evByAction: Partial<Record<string, number>>;
  optimalAction: string;
  evCost: number;
}

export interface DerivedSeatHand {
  seat: number;
  /** Every card this seat was dealt, in the order it arrived. */
  cards: Card[];
  /** Its hands at the end, which is more than one after a split. */
  hands: Card[][];
  net: number | null;
}

/**
 * What one round put aside for one seat, before anybody in that round acted.
 *
 * This is the derivation's central claim made visible: the cards a seat can be
 * dealt in a round sit at positions fixed before the round begins, so no
 * neighbour's choice — however fast, in whatever order the writes land — can
 * move them. Invisible, it could only be argued about; recorded, the test can
 * change one seat's mind and check that its neighbour's round is untouched.
 */
export interface Reservation {
  round: number;
  seat: number;
  /** One card per live hand of that seat, in hand order. */
  cards: Card[];
}

export interface DerivedHand {
  hand: number;
  /** True while a seat still owes the table an action: nothing settles until it comes. */
  incomplete: boolean;
  /**
   * Which seats the table is waiting on, in seat order.
   *
   * This is the per-seat indicator and the thirty-second rule's trigger in one
   * value: a seat in here has not answered the round, everybody else has, and
   * when it is the only name on the list every other player is waiting for it.
   */
  waitingFor: number[];
  dealer: Card[];
  seats: DerivedSeatHand[];
  decisions: DerivedDecision[];
  /** Cards the dealer reserved and nobody took, in the order they were turned over. */
  burned: Card[];
  /** What each round put aside for each seat, before any of them acted. */
  reserved: Reservation[];
}

export interface DerivedTable {
  hands: DerivedHand[];
  /** Per seat, what it was dealt across the whole table — the checksum's input. */
  seen: Map<number, Card[]>;
}

/** The rules a table is dealt under, from the record. */
export function rulesFor(record: Pick<TableRecord, 'presetId' | 'restrictions'>): BlackjackRules {
  return applyRestrictions(getPreset(record.presetId).rules, record.restrictions);
}

/**
 * A seat's view of what was dealt, as a short hash.
 *
 * Two seats deriving the same table must agree about every card in it. If they
 * ever do not, the app says the table cannot be shown rather than showing two
 * people two different truths about the same hand — so each seat records this,
 * and a mismatch is a refusal rather than a mystery.
 *
 * FNV-1a over the card values: small, dependency-free, and it is a checksum
 * rather than a secret, so nothing here needs to resist an attacker.
 */
export function cardsHash(cards: readonly Card[]): string {
  let hash = 0x811c9dc5;
  for (const card of cards) {
    hash ^= card & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * The chart a rule set is graded against, derived once and shared.
 *
 * `BlackjackTable` derives a whole basic-strategy chart in its constructor
 * unless it is handed one, and the derivation builds a table per seat per hand,
 * twice over — so without this, deriving one table of four seats paid for the
 * chart forty times. The option exists on the engine for exactly this reason.
 * Nothing about grading changes: it is the same chart, from the same function,
 * for the same rules.
 */
const CHARTS = new Map<string, StrategyChart>();

function sharedChartFor(rules: BlackjackRules): StrategyChart {
  const key = JSON.stringify(rules);
  let chart = CHARTS.get(key);
  if (!chart) {
    chart = deriveChart(rules, { cardRemoval: 'static-dealer' });
    CHARTS.set(key, chart);
  }
  return chart;
}

/**
 * A seat being played out on its own table.
 *
 * The table is the engine's, so legality, grading and settlement are the ones
 * the solo game uses. What this wrapper adds is where the cards come from: they
 * are pushed in one at a time from the shared shoe, by the reservation rule.
 */
class SeatPlay {
  readonly table: BlackjackTable;
  /** Cards this seat has been dealt, in order, for the checksum and the tests. */
  readonly dealt: Card[] = [];

  constructor(rules: BlackjackRules, opening: Card[], bet: number) {
    this.table = new BlackjackTable({ rules, seed: 1, grading: 'chart', chart: sharedChartFor(rules) });
    this.table.shoe.stack(opening);
    this.table.startHand(bet);
    this.dealt.push(opening[0]!, opening[2]!);
  }

  /** Put this seat's reserved cards on top of its shoe, in the order it will take them. */
  offer(cards: readonly Card[]): void {
    if (cards.length > 0) this.table.shoe.stack([...cards]);
  }

  /**
   * How many cards are in this seat's hands — what "it drew" is counted by.
   *
   * Not the shoe's position: the engine plays the dealer out the moment its
   * player stands, and those cards come off the same shoe, so a seat that stood
   * would look as though it had drawn the dealer's hand. Counting the cards in
   * the hands themselves is immune to that, and a split moves a card between two
   * hands without changing the total, so it still counts a draw as one draw.
   */
  get taken(): number {
    return this.table.view.hands.reduce((cards, hand) => cards + hand.cards.length, 0);
  }

  get phase(): string {
    return this.table.view.phase;
  }

  get acting(): boolean {
    return this.phase === 'player' || this.phase === 'insurance';
  }

  /** The active hand's cards — what is graded, and what a split is decided on. */
  get activeCards(): Card[] {
    const view = this.table.view;
    return [...(view.hands[view.activeHandIndex]?.cards ?? [])];
  }

  /** Whether the active hand came out of a split, which changes what it is worth. */
  get activeFromSplit(): boolean {
    const view = this.table.view;
    return view.hands[view.activeHandIndex]?.fromSplit ?? false;
  }

  /**
   * How many of this seat's hands are still owed cards — the reservation.
   *
   * Every unfinished hand from the active one onward: the active hand, which may
   * draw, and each hand behind it still waiting for the opening card a split
   * left it. Hands before the active one are finished by construction, since the
   * engine only ever moves forward.
   */
  get liveHands(): number {
    const view = this.table.view;
    let live = 0;
    for (let i = view.activeHandIndex; i < view.hands.length; i++) {
      if (!view.hands[i]!.finished) live++;
    }
    return Math.max(1, live);
  }
}

/**
 * Deal one hand, given the seats that are live for it, and return what happened.
 *
 * `moveFor` is asked for a seat's action at each round; replaying a log and
 * playing a fresh table differ only in what that function does, which is what
 * keeps one implementation behind both.
 */
function playHand(
  handIndex: number,
  shoe: DealingShoe,
  rules: BlackjackRules,
  live: SeatRecord[],
  moveFor: (seat: number, round: number, legal: string[]) => SeatMove['action'] | null,
  record: (
    move: SeatMove & {
      seat: number;
      cards: Card[];
      upcard: Card;
      fromSplit: boolean;
      handCount: number;
      evByAction: Partial<Record<string, number>>;
      optimalAction: string;
      evCost: number;
    },
  ) => void,
): DerivedHand {
  /*
   * The deal, in the order a table deals: one card to every seat, the dealer's
   * upcard, a second card to every seat, and the dealer's hole card.
   */
  const first = live.map(() => shoe.deal());
  const upcard = shoe.deal();
  const second = live.map(() => shoe.deal());
  const hole = shoe.deal();

  const plays = live.map(
    (seat, index) => new SeatPlay(rules, [first[index]!, upcard, second[index]!, hole], seat.bet),
  );
  const burned: Card[] = [];
  const reserved: Reservation[] = [];
  const draws = new Map<number, Card[]>();
  /** Each seat's reserved cards, unspent. Its own, and nobody else can take them. */
  const queues = new Map<number, Card[]>();
  live.forEach((seat, index) => {
    draws.set(seat.seat, []);
    queues.set(index, []);
  });

  /*
   * Insurance first, and it takes no card: the dealer is asking a question, not
   * dealing. Every seat that is asked answers before the rounds begin.
   */
  for (let i = 0; i < live.length; i++) {
    const play = plays[i]!;
    if (play.phase !== 'insurance') continue;
    const action = moveFor(live[i]!.seat, -1, ['takeInsurance', 'declineInsurance']);
    const take = action === 'takeInsurance';
    /*
     * Insurance has its own evaluation in the engine — it is a different bet,
     * not a play of the hand — and the same one the solo game grades with:
     * against the chart's cell, not against the cards left in the shoe.
     */
    const ev = play.table.insuranceEvaluation();
    const evByAction = { takeInsurance: ev, declineInsurance: 0 };
    const optimalAction = ev > 0 ? 'takeInsurance' : 'declineInsurance';
    record({
      seat: live[i]!.seat,
      hand: handIndex,
      round: -1,
      action: take ? 'takeInsurance' : 'declineInsurance',
      cards: [...play.activeCards],
      upcard,
      fromSplit: false,
      handCount: 1,
      evByAction,
      optimalAction,
      evCost: Math.max(0, evByAction[optimalAction] - evByAction[take ? 'takeInsurance' : 'declineInsurance']),
    });
    play.table.takeInsurance(take);
  }

  /*
   * Then the rounds. Before any seat acts, every live hand at the table is
   * reserved one card, in `(seat index, hand index)` order — and what nobody
   * takes is turned over.
   */
  let incomplete = false;
  /** Seats that recorded a split last round, whose two hands are live from this one. */
  const splitting = new Set<number>();
  /** Seats the table is still waiting on, by seat number. Empty means nobody is owed. */
  const owing = new Set<number>();

  for (let round = 0; round < 60 && !incomplete; round++) {
    const acting = plays.map((play, index) => ({ play, index })).filter(({ play }) => play.acting);
    if (acting.length === 0) break;

    /*
     * The reservation, in seat order and before anybody acts. A seat that
     * recorded a split last round counts one hand more than the engine shows,
     * because the engine has not been told about the split yet — that is what
     * "from the next round" means, and it is why the two opening cards are
     * there when the split is finally slid in.
     */
    for (const { play, index } of acting) {
      const want = play.liveHands + (splitting.has(index) ? 1 : 0);
      const queue: Card[] = [];
      for (let i = 0; i < want; i++) queue.push(shoe.deal());
      queues.set(index, queue);
      reserved.push({ round, seat: live[index]!.seat, cards: [...queue] });
    }

    for (const { play, index } of acting) {
      const seat = live[index]!;
      const queue = queues.get(index)!;

      /*
       * A split recorded last round is this round's business for that seat. The
       * dealer is dealing, not asking: no move is read, and the two hands take
       * the two cards reserved for them.
       */
      if (splitting.has(index)) {
        splitting.delete(index);
        take(play, seat, queue, () => play.table.act('split'));
        burned.push(...queue);
        queue.length = 0;
        continue;
      }

      const legal = play.table.legalActions();
      const action = moveFor(seat.seat, round, legal as string[]);
      if (action === null) {
        /*
         * Nothing logged for this seat: the table is waiting for it, which is
         * the ordinary state of a hand somebody is halfway through.
         *
         * **The seat is skipped, not the round.** Its neighbours have already
         * been reserved this round's cards and may well have logged their
         * moves, and whoever is looking at this table is entitled to see his own
         * card the moment he takes it rather than when the slowest player at the
         * table gets round to acting — which is the whole promise of dealing
         * this way. So every other seat is played out, and only the seats that
         * still owe an action are held back.
         *
         * What does *not* happen is the next round. A round's cards are reserved
         * for everybody live in it, before any of them acts, and who is live in
         * round N + 1 is not known until round N is answered. So the table takes
         * the round lock-step even though the players inside it do not — and the
         * thirty-second rule exists precisely because one player can hold it
         * there.
         */
        owing.add(seat.seat);
        continue;
      }
      const evaluation = play.table.currentEvaluation();
      const cards = [...play.activeCards];
      record({
        seat: seat.seat,
        hand: handIndex,
        round,
        action,
        cards,
        upcard,
        fromSplit: play.activeFromSplit,
        handCount: play.table.view.hands.length,
        evByAction: evaluation.evByAction as Partial<Record<string, number>>,
        optimalAction: evaluation.optimalAction as string,
        evCost: Math.max(
          0,
          (evaluation.evByAction[evaluation.optimalAction] ?? 0) -
            ((evaluation.evByAction as Record<string, number>)[action] ?? 0),
        ),
      });

      if (action === 'split') {
        /*
         * Recorded and graded here, where the player made it, and applied next
         * round. This round's card for the hand goes to the tray: the player
         * asked for no card, he asked for another hand.
         */
        splitting.add(index);
        burned.push(...queue);
        queue.length = 0;
        continue;
      }

      /*
       * A stand and a surrender draw nothing for the active hand, so its card is
       * turned over before the engine is asked — otherwise the hand behind it,
       * which `advance()` may be about to open, would be handed a card that was
       * never its own.
       */
      if (action === 'stand' || action === 'surrender') burned.push(queue.shift()!);

      take(play, seat, queue, () => play.table.act(action as BlackjackAction));
      burned.push(...queue);
      queue.length = 0;
    }

    // Lock-step: the next round cannot be reserved until this one is answered.
    if (owing.size > 0) incomplete = true;
  }

  /**
   * Run one act against the seat's own reserved cards, and book what it used.
   *
   * The cards are slid to the seat, the engine acts, and however many it took
   * are the ones it took — counting beats predicting. A seat that outruns its
   * reservation would be taking a card another hand was promised, so it throws
   * rather than doing it quietly.
   */
  function take(play: SeatPlay, seat: SeatRecord, queue: Card[], act: () => void): void {
    play.offer(queue);
    const before = play.taken;
    act();
    const used = play.taken - before;
    if (used > queue.length) {
      throw new Error(
        `Seat ${seat.seat} took ${used} cards from a reservation of ${queue.length}` +
          ` | hands=${JSON.stringify(play.table.view.hands.map((h) => ({ n: h.cards.length, fin: h.finished, sp: h.fromSplit })))}` +
          ` active=${play.table.view.activeHandIndex} phase=${play.table.view.phase}`,
      );
    }
    for (let i = 0; i < used; i++) {
      const card = queue.shift()!;
      play.dealt.push(card);
      draws.get(seat.seat)!.push(card);
    }
  }

  /*
   * The dealer draws last, which is the whole point of the format — so his cards
   * come out of the shoe now, after every seat has finished. The engine decides
   * how many he needs; a generous slice is offered and the shoe is advanced by
   * exactly what he took.
   */
  // What nobody took goes in the discard tray when the hand ends.
  for (const queue of queues.values()) burned.push(...queue);

  if (incomplete) {
    return {
      hand: handIndex,
      dealer: [upcard, hole],
      burned,
      reserved,
      decisions: [],
      incomplete: true,
      waitingFor: [...owing].sort((a, b) => a - b),
      seats: live.map((seat, index) => ({
        seat: seat.seat,
        cards: [first[index]!, second[index]!, ...(draws.get(seat.seat) ?? [])],
        hands: plays[index]!.table.view.hands.map((hand) => [...hand.cards]),
        net: null,
      })),
    };
  }

  const offer: Card[] = [];
  for (let i = 0; i < 12; i++) offer.push(shoe.peek(i));
  const settled = live.map((seat, index) => {
    const play = new SeatPlay(
      rules,
      [first[index]!, upcard, second[index]!, hole, ...(draws.get(seat.seat) ?? []), ...offer],
      seat.bet,
    );
    // Replay this seat's own moves on a table that now holds the whole hand.
    for (const move of movesOf(seat, handIndex)) {
      if (move.action === 'takeInsurance' || move.action === 'declineInsurance') {
        if (play.phase === 'insurance') play.table.takeInsurance(move.action === 'takeInsurance');
        continue;
      }
      if (play.phase !== 'player') break;
      play.table.act(move.action);
    }
    return play;
  });

  /*
   * The dealer's hand is the longest one any seat saw.
   *
   * Not the first settled one: a seat that busted out watches the dealer take
   * no more cards, because a dealer with nothing left to beat does not draw —
   * and if another seat is still standing, he does. Taking the longest gets
   * both cases right and needs no rule of its own here, which is the point.
   */
  let dealer: Card[] = [upcard, hole];
  for (const play of settled) {
    if (play.phase !== 'settled') continue;
    const shown = play.table.view.dealerVisible;
    if (shown.length > dealer.length) dealer = [...shown];
  }
  // Advance the shared shoe by what the dealer actually used, and no more.
  for (let i = 2; i < dealer.length; i++) shoe.deal();

  return {
    hand: handIndex,
    dealer: [...dealer],
    burned,
    reserved,
    decisions: [],
    incomplete: false,
    waitingFor: [],
    seats: live.map((seat, index) => {
      const play = settled[index]!;
      const view = play.table.view;
      return {
        seat: seat.seat,
        cards: [first[index]!, second[index]!, ...(draws.get(seat.seat) ?? [])],
        hands: view.hands.map((hand) => [...hand.cards]),
        net: view.netUnits,
      };
    }),
  };
}

/** A seat's moves for one hand, in round order, insurance first. */
function movesOf(seat: SeatRecord, hand: number): SeatMove[] {
  return seat.moves
    .filter((move) => move.hand === hand)
    .sort((a, b) => a.round - b.round);
}

/**
 * Derive the whole table from its seed and its record.
 *
 * Given the same seed and the same moves this returns the same cards, always,
 * on any device — which is the property every other part of the shared table is
 * allowed to assume and `test/shared-table.test.ts` checks over hundreds of
 * random tables.
 */
export function deriveTable(record: TableRecord): DerivedTable {
  /*
   * How far the table runs: what the seats say they have been dealt, and never
   * less than the log needs — a move at hand 7 is proof that hand 7 was dealt,
   * whatever a stale `hands` says.
   *
   * The events are deliberately not consulted. A join or a return names the hand
   * a seat becomes live *from*, which is usually the next one and may not have
   * been dealt yet, so counting it would invent a hand nobody has seen.
   */
  let handCount = 0;
  for (const seat of record.seats) {
    handCount = Math.max(handCount, seat.hands ?? 0);
    for (const move of seat.moves) handCount = Math.max(handCount, move.hand + 1);
  }
  return run(record, handCount, (seat, hand, round) => {
    const move = record.seats
      .find((entry) => entry.seat === seat)
      ?.moves.find((entry) => entry.hand === hand && entry.round === round);
    return move ? move.action : null;
  });
}

/**
 * Play a table out, choosing each action as it comes — and write the moves into
 * the record as they are chosen.
 *
 * Replaying a log and playing a fresh table differ in one function and nothing
 * else, which is what keeps a table that was *played* and the same table
 * *derived* from agreeing by construction rather than by luck. It is what the
 * tests deal with, and what the screen in A2 will drive.
 */
export function playTable(
  record: TableRecord,
  hands: number,
  choose: (context: { seat: number; hand: number; round: number; legal: string[] }) => SeatMove['action'],
): DerivedTable {
  const derived = run(record, hands, (seat, hand, round, legal) => {
    const action = choose({ seat, hand, round, legal });
    record.seats.find((entry) => entry.seat === seat)?.moves.push({ hand, round, action });
    return action;
  });
  // Each seat writes how far it has been dealt into its own row. See `SeatRecord.hands`.
  for (const seat of record.seats) seat.hands = Math.max(seat.hands ?? 0, hands);
  return derived;
}

/** The one loop behind both: deal hand after hand, asking `moveFor` what happens. */
function run(
  record: TableRecord,
  handCount: number,
  moveFor: (seat: number, hand: number, round: number, legal: string[]) => SeatMove['action'] | null,
): DerivedTable {
  const rules = rulesFor(record);
  const rng = makeRng(record.seed);
  const shoe = new DealingShoe(rules.decks, rng);
  const hands: DerivedHand[] = [];
  const seen = new Map<number, Card[]>();
  for (const seat of record.seats) seen.set(seat.seat, []);

  for (let hand = 0; hand < handCount; hand++) {
    if (shoe.needsShuffle) shoe.shuffle();
    const live = record.seats.filter((seat) => isLive(record, seat.seat, hand));
    if (live.length === 0) continue;
    const decisions: DerivedDecision[] = [];
    const derived = playHand(
      hand,
      shoe,
      rules,
      live,
      (seat, round, legal) => moveFor(seat, hand, round, legal),
      (decision) => decisions.push(decision),
    );
    derived.decisions = decisions;
    for (const seatHand of derived.seats) {
      seen.get(seatHand.seat)!.push(...seatHand.cards);
    }
    hands.push(derived);
  }

  return { hands, seen };
}

/**
 * Whether a seat is live for a hand, read from the events and from nothing else.
 *
 * A seat is live from the hand it joined at, stops being live at the hand it was
 * dropped at, and is live again from the hand it returned at. No clock is
 * consulted, which is what keeps a dropped seat from changing the cards
 * depending on when the derivation happens to run.
 */
export function isLive(record: TableRecord, seat: number, hand: number): boolean {
  let live = false;
  for (const event of record.events) {
    if (event.seat !== seat || event.hand > hand) continue;
    if (event.kind === 'join' || event.kind === 'return') live = true;
    if (event.kind === 'drop') live = false;
  }
  return live;
}

/** Every card a seat saw, hashed — what each seat writes into its own row. */
export function seatCardsHash(table: DerivedTable, seat: number): string {
  return cardsHash(table.seen.get(seat) ?? []);
}

/**
 * Whether two seats agree about what was dealt.
 *
 * They always should. If they ever do not, something about the derivation has
 * drifted between two devices, and the only honest answer is to refuse the
 * table rather than show two people two different truths about one hand.
 */
export function seatsAgree(record: TableRecord, table: DerivedTable): boolean {
  return record.seats.every(
    (seat) => seat.cardsHash === undefined || seat.cardsHash === seatCardsHash(table, seat.seat),
  );
}

/* ---------------------------------------------------------------------------
 * The live view — what one seat's screen needs, and nothing it must not have
 * ------------------------------------------------------------------------- */

/** What a seat is doing, as the other players are allowed to see it. */
export type SeatStatus =
  | 'betting'
  | 'deciding'
  | 'decided'
  | 'waitingForDealer'
  | 'done'
  | 'away';

export interface SeatGlance {
  seat: number;
  name: string;
  playerId: string | null;
  bet: number;
  status: SeatStatus;
  /**
   * The seat's cards, as a neighbour may see them.
   *
   * Face up at a real table, so face up here. What is *not* here is what he did
   * with them: see `decisions`, which stays empty until you have played.
   */
  cards: Card[];
  hands: Card[][];
  net: number | null;
  /** This table only: chips, decisions, and how many of them were right. */
  stack: number;
  decisions: number;
  right: number;
}

export interface SeatView {
  /** Null while the table is not yet showing a hand. */
  hand: number | null;
  dealer: Card[];
  dealerRevealed: boolean;
  /** My own seat, or null if I am only watching. */
  me: SeatGlance | null;
  seats: SeatGlance[];
  /** What I may do right now. Empty when it is not my move. */
  legal: string[];
  /** The round my next decision would be recorded at. */
  round: number;
  /** True when the table is waiting on me and on nobody else. */
  onlyMe: boolean;
  /** Everyone the table is waiting on. */
  waitingFor: number[];
  /**
   * The graded decisions I am allowed to see.
   *
   * Mine always; everybody else's only once mine for this hand is recorded —
   * §3.7, enforced by not putting them in the view rather than by hiding them
   * in the markup, because markup can be read.
   */
  decisions: DerivedDecision[];
  /** True when two seats disagree about what was dealt. The table is refused. */
  disagrees: boolean;
}

/** Whether a seat has recorded anything at all for a hand. */
function hasActed(record: TableRecord, seat: number, hand: number): boolean {
  return record.seats.some(
    (entry) => entry.seat === seat && entry.moves.some((move) => move.hand === hand),
  );
}

/**
 * Everything one seat's screen may know, derived from the record alone.
 *
 * The important word is *may*. This is where §3.7 is enforced: another seat's
 * decisions and their grades are not in the returned object until my own action
 * for the hand is recorded, so a curious player reading the page's state finds
 * nothing to read. Hiding them in the markup would be a different promise.
 */
export function seatView(record: TableRecord, seat: number | null): SeatView {
  const table = deriveTable(record);
  const disagrees = !seatsAgree(record, table);
  const current = table.hands[table.hands.length - 1] ?? null;
  const mine = seat === null ? null : (record.seats.find((entry) => entry.seat === seat) ?? null);

  /* This table's running numbers, per seat, summed over every settled hand. */
  const stacks = new Map<number, number>();
  const counts = new Map<number, { decisions: number; right: number }>();
  for (const entry of record.seats) {
    stacks.set(entry.seat, 0);
    counts.set(entry.seat, { decisions: 0, right: 0 });
  }
  for (const hand of table.hands) {
    for (const seatHand of hand.seats) {
      if (seatHand.net !== null) stacks.set(seatHand.seat, (stacks.get(seatHand.seat) ?? 0) + seatHand.net);
    }
    for (const decision of hand.decisions) {
      const tally = counts.get(decision.seat);
      if (!tally) continue;
      tally.decisions++;
      if (decision.evCost <= 0) tally.right++;
    }
  }

  const handIndex = current ? current.hand : null;
  const iActed = seat !== null && handIndex !== null && hasActed(record, seat, handIndex);

  const glance = (entry: SeatRecord): SeatGlance => {
    const seatHand = current?.seats.find((row) => row.seat === entry.seat) ?? null;
    const tally = counts.get(entry.seat) ?? { decisions: 0, right: 0 };
    let status: SeatStatus = 'betting';
    if (handIndex !== null && !isLive(record, entry.seat, handIndex)) status = 'away';
    else if (!current) status = 'betting';
    else if (current.waitingFor.includes(entry.seat)) status = 'deciding';
    else if (current.incomplete) status = 'decided';
    else status = seatHand && seatHand.net !== null ? 'done' : 'waitingForDealer';
    return {
      seat: entry.seat,
      name: entry.name,
      playerId: entry.playerId,
      bet: entry.bet,
      status,
      cards: seatHand ? [...seatHand.cards] : [],
      hands: seatHand ? seatHand.hands.map((cards) => [...cards]) : [],
      net: seatHand ? seatHand.net : null,
      stack: stacks.get(entry.seat) ?? 0,
      decisions: tally.decisions,
      right: tally.right,
    };
  };

  const seats = record.seats.map(glance);
  const waitingFor = current ? current.waitingFor : [];

  /*
   * What I may do, asked of the engine rather than worked out here — the same
   * `legalActions()` the solo game asks, on a table stacked with my own cards.
   */
  let legal: string[] = [];
  let round = 0;
  if (seat !== null && handIndex !== null && waitingFor.includes(seat)) {
    const live = record.seats.filter((entry) => isLive(record, entry.seat, handIndex));
    const at = live.findIndex((entry) => entry.seat === seat);
    if (at >= 0) {
      const asked = legalFor(record, handIndex, seat);
      legal = asked.legal;
      round = asked.round;
    }
  }

  return {
    hand: handIndex,
    dealer: current ? [...current.dealer] : [],
    dealerRevealed: Boolean(current && !current.incomplete),
    me: mine ? glance(mine) : null,
    seats,
    legal,
    round,
    onlyMe: seat !== null && waitingFor.length === 1 && waitingFor[0] === seat,
    waitingFor: [...waitingFor],
    decisions: current ? current.decisions.filter((d) => d.seat === seat || iActed) : [],
    disagrees,
  };
}

/**
 * What one seat may legally do right now, and at which round it would be recorded.
 *
 * Derived by replaying the hand with that seat's own moves and asking the engine
 * the moment it runs out of them. It costs one derivation of one hand, which is
 * nothing beside being certain that the buttons on the screen and the rules the
 * grade is computed under are the same rules.
 */
function legalFor(
  record: TableRecord,
  hand: number,
  seat: number,
): { legal: string[]; round: number } {
  let legal: string[] = [];
  let round = 0;
  const asked = { ...record, seats: record.seats.map((entry) => ({ ...entry })) };
  run(asked, hand + 1, (who, atHand, atRound, options) => {
    if (who === seat && atHand === hand) {
      const move = record.seats
        .find((entry) => entry.seat === seat)
        ?.moves.find((entry) => entry.hand === atHand && entry.round === atRound);
      if (!move) {
        legal = [...options];
        round = atRound;
        return null;
      }
      return move.action;
    }
    return (
      record.seats
        .find((entry) => entry.seat === who)
        ?.moves.find((entry) => entry.hand === atHand && entry.round === atRound)?.action ?? null
    );
  });
  return { legal, round };
}
