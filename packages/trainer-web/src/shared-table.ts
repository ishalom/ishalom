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
  bjRankOfCard,
  deriveChart,
  getPreset,
  scenarioKeyForHand,
  type BlackjackAction,
  type BlackjackRules,
  type Card,
  type StrategyChart,
} from '@evtrainer/ev-engine';
import { BlackjackTable, DealingShoe, makeRng } from '@evtrainer/game-engine';

import type { UthAction } from '@evtrainer/game-engine';

import { advanceRun, crownFor, isCloseCall, type CrownTier } from './gestures.ts';
import { applyRestrictions, type Restrictions } from './restrictions.ts';
import { totalOf } from './session.ts';
import {
  isUthTable,
  deriveUthTable,
  uthForfeitSpot,
  uthLegalFor,
  uthSeatRatable,
  type UthDecisionFacts,
  type UthHandFacts,
} from './shared-uth.ts';

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
  action: BlackjackAction | 'takeInsurance' | 'declineInsurance' | UthAction;
  /**
   * How long the player took, in milliseconds, from his buttons appearing to
   * his tap — measured by his own phone and written into his own row (round 35).
   *
   * **The derivation never reads it.** Nothing about a card, a grade or a
   * rating can be reached from it: moves are matched by hand, round and action
   * and nothing else, and `test/shared-pace.test.ts` holds that by deriving a
   * table with and without every time and comparing everything. Absent on a
   * first hand, after a reload, and whenever the phone did not see the buttons
   * appear — such a decision has no time rather than a guessed one.
   */
  ms?: number;
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
  vote?: { hand: number | null; against: number; at: number; needs: number } | null;
  /**
   * What happened to *this* seat: it joined, it left, it came back.
   *
   * In the seat's own row, like everything else, because the alternative was the
   * one row in this design with two writers — and round 22 shipped exactly that
   * before it was closed here. Two players leaving in the same instant used to
   * cost one of the events, because each sent the whole list it had last read.
   *
   * A seat is only ever the subject of its own events. The one thing that is
   * *about* a seat but not written *by* it is being voted out, and that is not
   * written at all: it is derived from the votes, which are themselves in their
   * own writers' rows. See `tableEvents`.
   */
  events?: TableEvent[];
  /** What this seat saw dealt, hashed. See `cardsHash`. */
  cardsHash?: string;
  /**
   * What this seat said, by hand — the six fixed reactions of §3.9.
   *
   * In the sender's own row, like his moves and his vote, so the one-writer
   * rule holds for speech as well as for play. Keyed by hand rather than by a
   * timestamp: the table's own clock is the hand number, and a reaction that
   * carried a wall clock would be the first thing at this table that did.
   *
   * **The derivation never reads this.** Nothing about a card can be reached
   * from what anybody said, which `test/shared-reactions.test.ts` holds by
   * changing every reaction at a table and checking every checksum is
   * unmoved.
   */
  reactions?: SeatReactions;
  /**
   * How many of this seat's decisions have already been taken into its owner's
   * rating — §3.11's *one seed, one score*, as a mark rather than a flag.
   *
   * A count rather than a boolean because a table is played for an evening and
   * a rating that only arrived when somebody finally closed the tab would
   * usually never arrive at all. The decisions are in a fixed order — the order
   * the shoe dealt them — so "the first N have been rated" means the same thing
   * on both of this player's devices and tomorrow as it does now, and the mark
   * only ever moves forward. Each decision therefore reaches the record exactly
   * once, which is the property the spec's phrase is there to protect.
   *
   * In the seat's own row, like everything else, and written by the one player
   * whose rating it is about.
   */
  ratedDecisions?: number;
}

/**
 * The six things a player can say, in Idan's words and his order (§3.9).
 *
 * A fixed set and no free text — not a moderation decision, but the same one
 * that makes every other message in this app a key: a table between friends on
 * two phones is not a chat room, and six taps say the things that actually get
 * said at a table.
 *
 * Two of them are about luck, which breaks the decisions-never-outcomes rule
 * the app holds itself to. Cowork withdrew that rule for this case and was
 * right to: the rule is about what the *app* says when it is teaching, and
 * ribbing a friend about a lucky hand is the texture that brings people back.
 * The condition is the one §3.9 sets — they are the player's speech, attributed
 * and visually apart, never mixed into anything the app says about a decision.
 */
export const REACTIONS = ['brave', 'where', 'withYou', 'shame', 'mum', 'explain'] as const;

export type ReactionKey = (typeof REACTIONS)[number];

/** What one seat said, by hand: `{ '3': ['brave', 'mum'] }`. Only that seat writes it. */
export type SeatReactions = Record<string, ReactionKey[]>;

/** One thing one player said, with everything the ticker needs to attribute it. */
export interface ReactionPost {
  seat: number;
  name: string;
  hand: number;
  key: ReactionKey;
  /** Its place within the hand, so two reactions in one hand keep their order. */
  index: number;
}

/** Whether a string is one of the six. Anything else is dropped rather than shown. */
export function isReaction(key: unknown): key is ReactionKey {
  return typeof key === 'string' && (REACTIONS as readonly string[]).includes(key);
}

/**
 * Everything said at the table, merged from the seats' own rows in one order.
 *
 * Canonical order is `(hand, seat, index)` — the same merge `tableEvents` does
 * and for the same reason: two phones that read the rows back in different
 * orders must still show the same line of talk.
 */
export function tableReactions(record: TableRecord): ReactionPost[] {
  const posts: ReactionPost[] = [];
  for (const seat of record.seats) {
    for (const [hand, keys] of Object.entries(seat.reactions ?? {})) {
      const at = Number(hand);
      if (!Number.isInteger(at) || !Array.isArray(keys)) continue;
      keys.forEach((key, index) => {
        if (isReaction(key)) posts.push({ seat: seat.seat, name: occupantAt(seat, at).name, hand: at, key, index });
      });
    }
  }
  return posts.sort((a, b) => a.hand - b.hand || a.seat - b.seat || a.index - b.index);
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
  /*
   * A join names who sat down (round 35): a seat can now be left for good and
   * taken by somebody else, so the row keeps each occupant's arrival — and so
   * each hand's play stays his, under his name — rather than one name for the
   * seat's whole life. Joins written before round 35 carry neither, and read as
   * the row's own player.
   */
  | { kind: 'join'; seat: number; hand: number; playerId?: string; name?: string }
  | { kind: 'drop'; seat: number; hand: number; why?: string }
  | { kind: 'return'; seat: number; hand: number };

export interface TableRecord {
  id: string;
  seed: number;
  presetId: string;
  restrictions: Restrictions;
  seats: SeatRecord[];
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
  /** An Ultimate decision's evaluation and cards (round 32). Absent in Blackjack. */
  uth?: UthDecisionFacts;
}

export interface DerivedSeatHand {
  seat: number;
  /** Every card this seat was dealt, in the order it arrived. */
  cards: Card[];
  /** Its hands at the end, which is more than one after a split. */
  hands: Card[][];
  net: number | null;
  /**
   * Each of those hands as the engine settled it (round 30): its own result,
   * and whether it was doubled or surrendered. Read off the engine's own hands,
   * so a split's two results are the engine's two results and never a second
   * settlement worked out here.
   */
  detail: HandDetail[];
  /** Which hand the seat is deciding now, while it owes one; null otherwise. */
  active: number | null;
}

/** One hand of a seat's, as the engine left it. */
export interface HandDetail {
  net: number | null;
  doubled: boolean;
  surrendered: boolean;
}

function detailOf(hands: ReadonlyArray<{ net: number | null; doubled: boolean; surrendered: boolean }>): HandDetail[] {
  return hands.map((hand) => ({ net: hand.net, doubled: hand.doubled, surrendered: hand.surrendered }));
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
  /** The board, the street and the dealer's reveal of an Ultimate hand (round 32). */
  uth?: UthHandFacts;
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
  /**
   * What the seat the table is waiting on was looking at — asked for, never
   * computed unasked.
   *
   * The forfeit needs the spot a dropped player was sitting at, and that spot
   * exists only at the moment he is skipped for owing an action. Evaluating it
   * for every waiting seat on every derivation would put a solver call in the
   * hot path of a screen that redraws every second and a half, so it happens
   * only when somebody has passed this in — which is `forfeitSpot`, and nothing
   * else.
   */
  inspect?: (
    seat: number,
    round: number,
    legal: string[],
    evaluation: { evByAction: Partial<Record<string, number>>; optimalAction: string },
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
        if (inspect) {
          const waiting = play.table.currentEvaluation();
          inspect(seat.seat, round, legal as string[], {
            evByAction: waiting.evByAction as Partial<Record<string, number>>,
            optimalAction: waiting.optimalAction as string,
          });
        }
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
        detail: detailOf(plays[index]!.table.view.hands),
        active: owing.has(seat.seat) ? plays[index]!.table.view.activeHandIndex : null,
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
      play.table.act(move.action as BlackjackAction);
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
        detail: detailOf(view.hands),
        active: null,
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
   * One screen asks for the same table four or five times — the view, the
   * ticker, the analysis, the evening — and a long table costs a whole
   * derivation each time (round 34). The last one is kept, keyed by every
   * field the derivation reads; the next record with the same key gets the
   * same answer, which a pure function would have given it anyway. Callers
   * treat what they are handed as read-only.
   */
  const key = derivationKey(record);
  if (LAST_DERIVED && LAST_DERIVED.key === key) return LAST_DERIVED.table;
  const table = isUthTable(record)
    ? deriveUthTable(record)
    : run(record, handsDealt(record), (seat, hand, round) => {
        const move = record.seats
          .find((entry) => entry.seat === seat)
          ?.moves.find((entry) => entry.hand === hand && entry.round === round);
        return move ? move.action : null;
      });
  LAST_DERIVED = { key, table };
  return table;
}

/** The last table derived, and the key it was derived for. See `deriveTable`. */
let LAST_DERIVED: { key: string; table: DerivedTable } | null = null;

/** Forget the last derivation, so the next one is worked out afresh (for the tests). */
export function forgetLastDerivation(): void {
  LAST_DERIVED = null;
}

/** Everything the derivation reads from a record, and nothing it does not. */
function derivationKey(record: TableRecord): string {
  return JSON.stringify([
    record.seed,
    record.presetId,
    record.restrictions,
    record.seats.map((seat) => [seat.seat, seat.bet, seat.moves, seat.hands ?? 0, seat.events ?? [], seat.vote ?? null]),
  ]);
}

/** How many hands a table has dealt, read from the seats' own rows. */
export function handsDealt(record: TableRecord): number {
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
  return handCount;
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
  /** Passed straight through to `playHand`. See the note on its own parameter. */
  inspect?: (
    seat: number,
    round: number,
    legal: string[],
    evaluation: { evByAction: Partial<Record<string, number>>; optimalAction: string },
  ) => void,
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
      inspect,
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
  for (const event of tableEvents(record)) {
    if (event.seat !== seat || event.hand > hand) continue;
    if (event.kind === 'join' || event.kind === 'return') live = true;
    if (event.kind === 'drop') live = false;
  }
  return live;
}

/**
 * Every event at the table, merged from the seats' own rows in canonical order.
 *
 * Two kinds go in. The ones a seat wrote about itself — it joined, it left, it
 * came back — are read straight out of its row. The ones nobody wrote are the
 * drops a vote decided: those are *derived* from the votes, so that the one
 * thing at this table that is about a player but not done by him still needs no
 * row with two writers.
 *
 * Canonical order is `(hand, seat)`, so the merge is the same on every device
 * whatever order the rows came back in.
 */
export function tableEvents(record: TableRecord): TableEvent[] {
  const events: TableEvent[] = [];
  for (const seat of record.seats) {
    for (const event of seat.events ?? []) events.push(event);
  }
  for (const dropped of votedOut(record)) events.push(dropped);
  return events.sort((a, b) => a.hand - b.hand || a.seat - b.seat);
}

/**
 * The drops a vote decided, worked out from the votes themselves.
 *
 * Each waiting player records, in his own row, who he wants dropped, at which
 * hand, and **how many agreements that attempt needed** — a number he read off
 * the same record everybody else has. A drop follows when the votes for one
 * player reach the most permissive threshold any of them was cast under, which
 * is what the escalating ladder means: the first attempt needs every waiting
 * player, and each later one needs one fewer.
 *
 * Nothing here asks what time it is. The clock decided *when* a vote was written
 * and which rung it was written on; both are recorded, so two phones reading the
 * same rows reach the same answer for ever after.
 */
function votedOut(record: TableRecord): TableEvent[] {
  const byTarget = new Map<string, { hand: number; against: number; seats: Set<number>; needs: number }>();
  for (const seat of record.seats) {
    const vote = seat.vote;
    if (!vote || vote.hand === null || vote.against === seat.seat) continue;
    const key = `${vote.hand}:${vote.against}`;
    const found = byTarget.get(key) ?? {
      hand: vote.hand,
      against: vote.against,
      seats: new Set<number>(),
      needs: Number.POSITIVE_INFINITY,
    };
    found.seats.add(seat.seat);
    found.needs = Math.min(found.needs, Math.max(1, vote.needs));
    byTarget.set(key, found);
  }
  const out: TableEvent[] = [];
  for (const tally of byTarget.values()) {
    if (tally.seats.size >= tally.needs) {
      out.push({ kind: 'drop', seat: tally.against, hand: tally.hand, why: 'vote' });
    }
  }
  return out;
}

/**
 * Every card a seat saw, hashed — what each seat writes into its own row.
 *
 * Written as `count:hash`: how many cards the seat had seen when it wrote, and
 * the hash of those. The count is what makes the check below fair (round 29).
 */
export function seatCardsHash(table: DerivedTable, seat: number): string {
  const seen = table.seen.get(seat) ?? [];
  return `${seen.length}:${cardsHash(seen)}`;
}

/**
 * Whether two seats agree about what was dealt.
 *
 * They always should. If they ever do not, something about the derivation has
 * drifted between two devices, and the only honest answer is to refuse the
 * table rather than show two people two different truths about one hand.
 *
 * AGREEING ABOUT THE PAST, NOT ABOUT THE PRESENT (round 29). A seat's hash is
 * what it had seen *when it last wrote*, and the table moves on without it: the
 * friend who sat down wrote his row with no cards in it, the other phone dealt,
 * and the derivation now gives him two. Compared whole, that read as the two
 * phones disagreeing, and the first hand ever dealt at a real two-phone table
 * refused itself on both. Cards are only ever appended to what a seat has seen,
 * so the honest question is whether the first `count` of them are still the
 * ones it saw — and a seat claiming more cards than the table has dealt it is a
 * disagreement too. A hash with no count (written before this) is compared
 * whole, as it always was.
 */
export function seatsAgree(record: TableRecord, table: DerivedTable): boolean {
  return record.seats.every((seat) => {
    if (seat.cardsHash === undefined) return true;
    const seen = table.seen.get(seat.seat) ?? [];
    const at = seat.cardsHash.indexOf(':');
    if (at < 0) return seat.cardsHash === cardsHash(seen);
    const count = Number(seat.cardsHash.slice(0, at));
    if (!Number.isInteger(count) || count < 0 || count > seen.length) return false;
    return seat.cardsHash.slice(at + 1) === cardsHash(seen.slice(0, count));
  });
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
  /**
   * What this seat's mistakes cost, in units, across the whole table.
   *
   * Kept as a total rather than as a rate so that §3.6 can weight it: a table's
   * EV lost per 100 is the sum of the costs over the sum of the decisions, and
   * averaging the seats' rates would let a player with three decisions swing
   * the table's number — the same small-sample lie the bar already guards
   * against.
   */
  evLost: number;
  /** The longest run of decisions this seat played right at this table. */
  streak: number;
  /** How many hands this seat has been dealt into here. Summed by §3.6. */
  handsPlayed: number;
  /**
   * What this seat did in the hand on screen, in order (round 30) — `hit`,
   * `stand`, `double`, `split`, `surrender`, and `forfeit` when the clock
   * ended his hand for him.
   *
   * A fact about the play and never a grade. A neighbour's arrive under the same
   * rule as his graded decisions (§3.7): once I have made my own first move of
   * the hand, or once the hand is over. Mine are always here.
   */
  acted: string[];
  /** Each of this seat's hands as the engine settled it. See `DerivedSeatHand.detail`. */
  detail: HandDetail[];
  /** Which of his hands he is deciding now, or null. */
  active: number | null;
  /** The round each entry of `acted` was made at (round 34), so a tag can find its grade. */
  actedRounds: number[];
  /** His graded decisions in the hand on screen that this screen may show (round 34). */
  shown: DerivedDecision[];
  /**
   * His average time to decide, from the times his own phone wrote into his
   * own moves (round 35), and how many timed decisions it is over. Null when
   * none was timed. Display only: see `SeatMove.ms`.
   */
  pace: { ms: number; n: number } | null;
  /**
   * How many of his cards are face down to me (round 32). An Ultimate player's
   * two cards are his own, as at a real table, until the hand is over — and the
   * grade never counts them, so showing them would show a player something
   * the grade then ignores. Zero in Blackjack, where everything is face up.
   */
  faceDown: number;
  /**
   * The crown on this seat's current run (round 33): a fact about his run, on
   * his own row. Read from the decisions this screen may see, so it can no more
   * say whether a neighbour got this hand right before I have played mine than
   * the bar can.
   */
  crown: { tier: CrownTier | null; run: number };
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
  /**
   * True once every seat has played and the hand is settled (round 32).
   *
   * Blackjack read this off the dealer's reveal, which is the same moment
   * there. In Ultimate it is not always: a hand everybody folded is over with
   * the dealer's cards still down.
   */
  handOver: boolean;
  /** The Ultimate hand's board and reveal, for the seat's screen. Absent in Blackjack. */
  uth?: UthHandFacts;
}

/**
 * One seat's running numbers at this table, as the seats are counted through.
 *
 * `run` is the live streak and `streak` the best it has reached: the record is
 * what §3.6 combines across the table, taking the maximum, because a best run
 * is the one measure where adding two people's together would mean nothing.
 */
interface SeatTally {
  decisions: number;
  right: number;
  evLost: number;
  streak: number;
  run: number;
  /**
   * The run the crown is read off (round 33) — the private tables' rule, not
   * the bar's: a close call neither extends it nor breaks it, and a forfeit
   * ends it. The bar's own `run` above counts every right decision.
   */
  crownRun: number;
}

/**
 * One graded decision, folded into a seat's tally.
 *
 * A decision is *right* when it cost nothing, which is the same test the solo
 * game applies — an action tied with the best is not a mistake, and grading it
 * as one would make the shared table stricter than the private one about
 * exactly the hands where the chart is indifferent.
 */
function countDecision(tally: SeatTally, decision: DerivedDecision): void {
  tally.crownRun = advanceRun(tally.crownRun, {
    correct: decision.evCost <= 0,
    closeCall: isCloseCall(decision.evByAction),
  });
  tally.decisions++;
  if (decision.evCost <= 0) {
    tally.right++;
    tally.run++;
    tally.streak = Math.max(tally.streak, tally.run);
  } else {
    tally.evLost += decision.evCost;
    tally.run = 0;
  }
}

/**
 * Whether a seat was actually asked this decision.
 *
 * Only insurance can fail it. The shared table has no insurance button, so the
 * derivation declines insurance for every seat under an ace, and nobody decided
 * anything. Round 30 kept those out of the bars; round 31 keeps them out of the
 * rating, which had been taking each as a free right answer. A seat's own moves
 * holding an answer at round -1 is what "asked" means.
 */
export function wasAsked(record: TableRecord, seat: number, decision: { hand: number; round: number }): boolean {
  if (decision.round !== -1) return true;
  return (record.seats.find((entry) => entry.seat === seat)?.moves ?? []).some(
    (move) => move.hand === decision.hand && move.round === -1,
  );
}

/**
 * Whether one graded decision belongs in the bars a given screen draws (round 30).
 *
 * Two kinds stay out, and both are about what the screen shows, not what is
 * recorded — the rating is not read from here.
 *
 *   - **A neighbour's decision in the hand still being played, before I have
 *     made mine.** The bar moving the instant he acted said whether he got it
 *     right before I had played my own hand, which §3.7 forbids — Idan's
 *     *"אחוזי ההצלחה השתנו"*, the figure moving when it should not.
 *   - **Insurance nobody was asked.** The shared table has no insurance
 *     button, so the derivation declines it for every seat under an ace, and
 *     that was being counted as a right decision for everybody — a point
 *     earned by nobody deciding anything.
 */
function countsOnScreen(
  record: TableRecord,
  decision: DerivedDecision,
  hand: DerivedHand,
  current: DerivedHand | null,
  seat: number | null,
  pending: number | null,
): boolean {
  if (!wasAsked(record, decision.seat, decision)) return false;
  return gradeVisible(decision, hand, current, seat, pending);
}

/**
 * Whether a graded decision may be shown on one seat's screen (round 34).
 *
 * One rule for everything that shows a grade: the bars, the crowns, the
 * coloured action tags and the figures beside each seat. It is §3.7's, made
 * exact per round. A neighbour's decision in the hand still being played is
 * hidden **while I still owe a decision at that round or a later one** —
 * `pending` is the round I owe, or null when I owe nothing. Once I have
 * answered that round, or have nothing left to decide, or the hand is over,
 * his grade there can tell me nothing I have yet to decide.
 *
 * It replaces round 30's coarser rule ("once I have acted at all this hand"),
 * which let a neighbour's flop grade show while I was still deciding my flop.
 * A watcher with no seat sees no grade from a hand in play.
 */
function gradeVisible(
  decision: DerivedDecision,
  hand: DerivedHand,
  current: DerivedHand | null,
  seat: number | null,
  pending: number | null,
): boolean {
  if (hand !== current || !current.incomplete) return true;
  if (decision.seat === seat) return true;
  if (seat === null) return false;
  return pending === null || decision.round < pending;
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

  /*
   * What I may do, asked of the engine rather than worked out here — the same
   * `legalActions()` the solo game asks, on a table stacked with my own cards.
   * Asked first, because the round I owe is what decides which of my
   * neighbours' grades this screen may show (`gradeVisible`).
   */
  let legal: string[] = [];
  let round = 0;
  let pending: number | null = null;
  if (seat !== null && current && current.incomplete && current.waitingFor.includes(seat)) {
    const asked = legalFor(record, current.hand, seat);
    legal = asked.legal;
    round = asked.round;
    pending = asked.round;
  }

  /* This table's running numbers, per seat, summed over every settled hand. */
  const stacks = new Map<number, number>();
  const counts = new Map<number, SeatTally>();
  for (const entry of record.seats) {
    stacks.set(entry.seat, 0);
    counts.set(entry.seat, { decisions: 0, right: 0, evLost: 0, streak: 0, run: 0, crownRun: 0 });
  }
  const dealtIn = new Map<number, number>();
  /*
   * A forfeit ends the crown's run (round 33): the clock taking a turn is
   * rated as the worst thing he could have done. Leaving on purpose is not a
   * forfeit and ends nothing. Each seat's forfeits, by the hand they fell at.
   */
  const forfeitAt = new Map<number, number[]>();
  for (const event of tableEvents(record)) {
    if (event.kind !== 'drop' || event.why === 'left') continue;
    forfeitAt.set(event.seat, [...(forfeitAt.get(event.seat) ?? []), event.hand]);
  }
  for (const entry of record.seats) {
    const start = tenureStart(entry);
    forfeitAt.set(entry.seat, (forfeitAt.get(entry.seat) ?? []).filter((hand) => hand >= start));
  }
  const endRunsUpTo = (hand: number) => {
    for (const [who, hands] of forfeitAt) {
      const due = hands.filter((at) => at <= hand);
      if (due.length === 0) continue;
      const tally = counts.get(who);
      if (tally) tally.crownRun = 0;
      forfeitAt.set(who, hands.filter((at) => at > hand));
    }
  };
  /* Each seat's figures are its present occupant's, from his own arrival (round 35). */
  const since = new Map(record.seats.map((entry) => [entry.seat, tenureStart(entry)]));
  for (const hand of table.hands) {
    endRunsUpTo(hand.hand);
    for (const seatHand of hand.seats) {
      if (hand.hand < (since.get(seatHand.seat) ?? 0)) continue;
      dealtIn.set(seatHand.seat, (dealtIn.get(seatHand.seat) ?? 0) + 1);
      if (seatHand.net !== null) stacks.set(seatHand.seat, (stacks.get(seatHand.seat) ?? 0) + seatHand.net);
    }
    for (const decision of hand.decisions) {
      const tally = counts.get(decision.seat);
      if (!tally) continue;
      if (hand.hand < (since.get(decision.seat) ?? 0)) continue;
      if (!countsOnScreen(record, decision, hand, current, seat, pending)) continue;
      countDecision(tally, decision);
    }
  }

  endRunsUpTo(Number.POSITIVE_INFINITY);

  const handIndex = current ? current.hand : null;
  const iActed = seat !== null && handIndex !== null && hasActed(record, seat, handIndex);
  /* A neighbour's play is shown once mine is in, or once the hand is over (§3.7). */
  const seesAll = iActed || Boolean(current && !current.incomplete);
  const forfeits = new Set(
    handIndex === null
      ? []
      : votedOut(record)
          .filter((event) => event.hand === handIndex)
          .map((event) => event.seat),
  );

  const glance = (entry: SeatRecord): SeatGlance => {
    const dealt = current?.seats.find((row) => row.seat === entry.seat) ?? null;
    const hidden = Boolean(dealt && current && current.uth && current.incomplete && entry.seat !== seat);
    const seatHand = dealt && hidden ? { ...dealt, cards: [], hands: [] } : dealt;
    const tally = counts.get(entry.seat) ?? { decisions: 0, right: 0, evLost: 0, streak: 0, run: 0, crownRun: 0 };
    let status: SeatStatus = 'betting';
    if (handIndex !== null && !isLive(record, entry.seat, handIndex)) status = 'away';
    else if (!current) status = 'betting';
    else if (current.waitingFor.includes(entry.seat)) status = 'deciding';
    /*
     * An Ultimate seat that has raised or folded has nothing left to decide in
     * the hand (round 32, Idan): it is finished, and shown as finished, while
     * the others play the streets out.
     */
    else if (current.incomplete && current.uth && seatHand && isFinishedUth(current, entry.seat)) status = 'done';
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
      evLost: tally.evLost,
      streak: tally.streak,
      handsPlayed: dealtIn.get(entry.seat) ?? 0,
      acted:
        handIndex !== null && (entry.seat === seat || seesAll)
          ? [
              ...movesOf(entry, handIndex)
                .filter((move) => move.action !== 'takeInsurance' && move.action !== 'declineInsurance')
                .map((move) => String(move.action)),
              ...(forfeits.has(entry.seat) ? ['forfeit'] : []),
            ]
          : [],
      actedRounds:
        handIndex !== null && (entry.seat === seat || seesAll)
          ? movesOf(entry, handIndex)
              .filter((move) => move.action !== 'takeInsurance' && move.action !== 'declineInsurance')
              .map((move) => move.round)
          : [],
      /*
       * This seat's graded decisions in the hand on screen that this screen may
       * show (round 34): what colours his tags and fills the figures beside his
       * cards. Held by the same rule as the bars — see `gradeVisible`.
       */
      shown: current
        ? current.decisions.filter(
            (decision) =>
              decision.seat === entry.seat &&
              decision.round >= 0 &&
              gradeVisible(decision, current, current, seat, pending),
          )
        : [],
      detail: seatHand ? seatHand.detail.map((hand) => ({ ...hand })) : [],
      active: seatHand ? seatHand.active : null,
      faceDown: hidden ? dealt!.cards.length : 0,
      crown: { tier: crownFor(tally.crownRun), run: tally.crownRun },
      pace: paceOf(entry.moves.filter((move) => move.hand >= (since.get(entry.seat) ?? 0))),
    };
  };

  const seats = record.seats.map(glance);
  const waitingFor = current ? current.waitingFor : [];

  return {
    hand: handIndex,
    dealer: current ? [...current.dealer] : [],
    dealerRevealed: Boolean(current && !current.incomplete && (current.uth ? current.uth.dealerShown : true)),
    handOver: Boolean(current && !current.incomplete),
    ...(current && current.uth ? { uth: current.uth } : {}),
    me: mine ? glance(mine) : null,
    seats,
    legal,
    round,
    onlyMe: seat !== null && waitingFor.length === 1 && waitingFor[0] === seat,
    waitingFor: [...waitingFor],
    decisions: current ? current.decisions.filter((d) => d.seat === seat || (iActed && gradeVisible(d, current, current, seat, pending))) : [],
    disagrees,
  };
}

/**
 * The hand the seat's present occupant sat down at (round 35).
 *
 * A seat left for good is freed and may be taken by somebody else, and what
 * the seat shows — its bar, chips, crown and pace — is the present occupant's,
 * from his own arrival. A player who comes back to his own seat keeps his
 * tenure: only a join by somebody *else* starts a new one. A row whose joins
 * name nobody (written before round 35) has one occupant from the start.
 */
export function tenureStart(row: SeatRecord): number {
  let start = 0;
  let owner: string | undefined;
  for (const event of [...(row.events ?? [])].sort((a, b) => a.hand - b.hand)) {
    if (event.kind !== 'join' || !event.playerId) continue;
    if (event.playerId !== owner) {
      owner = event.playerId;
      start = event.hand;
    }
  }
  return start;
}

/** Who sat in a seat at a given hand, by the joins in its row; the row's own name otherwise. */
export function occupantAt(row: SeatRecord, hand: number): { playerId: string | null; name: string } {
  let found: { playerId: string | null; name: string } | null = null;
  for (const event of [...(row.events ?? [])].sort((a, b) => a.hand - b.hand)) {
    if (event.kind !== 'join' || event.hand > hand || !event.playerId) continue;
    found = { playerId: event.playerId, name: event.name ?? row.name };
  }
  return found ?? { playerId: row.playerId, name: row.name };
}

/** The player who sat down last in a seat, by its joins, or null if none is named. */
export function lastOccupant(row: SeatRecord): string | null {
  let last: string | null = null;
  for (const event of [...(row.events ?? [])].sort((a, b) => a.hand - b.hand)) {
    if (event.kind === 'join' && event.playerId) last = event.playerId;
  }
  return last;
}

/** A seat's average time to decide, over the moves its own phone timed (round 35). */
function paceOf(moves: readonly SeatMove[]): { ms: number; n: number } | null {
  const timed = moves.filter((move) => typeof move.ms === 'number' && Number.isFinite(move.ms) && move.ms > 0);
  if (timed.length === 0) return null;
  return { ms: timed.reduce((sum, move) => sum + move.ms!, 0) / timed.length, n: timed.length };
}

/** Whether an Ultimate seat has nothing left to decide in the hand: it raised, or it folded. */
function isFinishedUth(hand: DerivedHand, seat: number): boolean {
  if (!hand.uth) return false;
  return (hand.uth.playBet.get(seat) ?? 0) > 0 || (hand.uth.folded.get(seat) ?? false);
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
  if (isUthTable(record)) return uthLegalFor(record, hand, seat);
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

/* ---------------------------------------------------------------------------
 * The folklore, shown (§3.8) — the two things a shared shoe can prove
 * ------------------------------------------------------------------------- */

/**
 * What the table would have dealt you if your neighbour had chosen otherwise.
 *
 * This is the one claim about a shared shoe that everybody at a real table
 * makes and nobody has ever been able to check: *he took my card*. Here it can
 * be checked, because the whole table is a function of the seed and the log —
 * so the alternative is not modelled or estimated, it is **dealt**. One
 * decision of his is changed, the shoe is run again from the same seed, and the
 * cards that come out are the cards that would have come out.
 *
 * And the half that matters more is the half it disproves: the replay moves the
 * cards and cannot touch the grade. What the chart said about the hand you then
 * held was decided by your cards, his upcard and the table's rules, and none of
 * those three is a thing he can reach. **He can move your stack and he cannot
 * move your bar** — §3.8 asks for that folklore shown rather than asserted, and
 * this is the showing.
 */
export interface Counterfactual {
  /** The neighbour whose decision was changed. */
  seat: number;
  name: string;
  /** The hand his decision was made on. */
  hand: number;
  /**
   * The hand of mine whose cards moved, which is not always the same one.
   *
   * §3.2's reservation rule is why. Within a hand, the card a seat can be dealt
   * in a round sits at a position fixed before the round begins — that is the
   * whole reason two people can tap at once — so a neighbour cannot reach into
   * a round you are both in and take your card out of it. What he can still do
   * is decide how many rounds he stays live, and therefore how many cards the
   * hand eats before the shoe reaches the next one. So the commoner true
   * statement is about the hand *after* his decision, and it is no less true.
   */
  showing: number;
  /** What he was holding when he decided, and what it came to. */
  theirCards: Card[];
  theirTotal: number;
  /** What he did, and the alternative that was replayed instead. */
  was: SeatMove['action'];
  instead: SeatMove['action'];
  /** Which of your cards changed, counting from one, as a player would say it. */
  position: number;
  /** That card as it was dealt, and as it would have been. */
  actualCard: Card;
  otherCard: Card;
  /** Your hand's total, as it was and as it would have been. */
  actualTotal: number;
  otherTotal: number;
}

/**
 * How far a replayed hand may run before the line is given up on.
 *
 * The alternative is filled with standing, so a hand ends within a round or
 * two. The cap is here only so that a corrupt log cannot spin.
 */
const REPLAY_ROUNDS = 12;

/**
 * The counterfactual for one hand, or null when there is not an honest one.
 *
 * Null is the common answer and is meant to be: on most hands the neighbour's
 * choice changes nothing you can see, and §3.8 asks for this *once a session,
 * on a hand where the counterfactual actually differs*. A line that fired every
 * hand would be a party trick; one that fires when the cards really did move is
 * the app's own evidence.
 */
export function counterfactual(
  record: TableRecord,
  seat: number,
  hand: number,
  showing = hand,
): Counterfactual | null {
  /*
   * Ultimate has none to give (round 32): every card of a hand is laid out at
   * the shuffle, by seat, so no neighbour's choice moves a single one of them.
   * "He took my card" is not a thing that can happen there, so it is not asked.
   */
  if (isUthTable(record)) return null;
  const actual = deriveTable(record);
  const mineNow = handFor(actual, showing, seat);
  if (!mineNow || mineNow.length === 0) return null;

  for (const other of record.seats) {
    if (other.seat === seat) continue;
    const moves = other.moves.filter((move) => move.hand === hand).sort((a, b) => a.round - b.round);
    for (const move of moves) {
      if (move.action === 'takeInsurance' || move.action === 'declineInsurance') continue;
      /*
       * Standing is the alternative to everything else, and hitting is the
       * alternative to standing. Both are legal wherever the one they replace
       * was — a hand you may stand on is a hand you may hit — which keeps the
       * replay a real deal rather than a line the engine refuses.
       */
      const instead: SeatMove['action'] = move.action === 'stand' ? 'hit' : 'stand';
      const replayed = replayWith(record, other.seat, hand, move.round, instead);
      if (!replayed) continue;
      const mineThen = handFor(replayed, showing, seat);
      if (!mineThen) continue;
      const at = firstDifference(mineNow, mineThen);
      if (at === null) continue;
      const theirs = actual.hands
        .find((entry) => entry.hand === hand)
        ?.decisions.find((decision) => decision.seat === other.seat && decision.round === move.round);
      return {
        seat: other.seat,
        name: other.name,
        hand,
        showing,
        theirCards: theirs ? [...theirs.cards] : [],
        theirTotal: theirs ? totalOf(theirs.cards) : 0,
        was: move.action,
        instead,
        position: at + 1,
        actualCard: mineNow[at]!,
        otherCard: mineThen[at]!,
        actualTotal: totalOf(mineNow),
        otherTotal: totalOf(mineThen),
      };
    }
  }
  return null;
}

/**
 * The best counterfactual the table has to offer, searching back from a hand.
 *
 * Two shapes, and the stronger one is tried first everywhere before the weaker
 * one is tried anywhere.
 *
 * **In the same hand** is §3.8's own example, and it is the one a player means
 * when he says *he took my card*. It is also **rare**, and rare for a reason
 * that is not a bug: §3.2's reservation rule was adopted precisely to stop a
 * neighbour reaching into a round you are both in. Measured over 600 hands a
 * size, it happens on 0.7% of hands at two seats and 1.7% at six — so on most
 * ten-hand tables it never happens at all.
 *
 * **In the hand after** is what is left of the coupling, and it is still the
 * same shoe and still his doing: how long he stayed live decided how many cards
 * the hand ate, so the shoe reached the next hand in a different place. Over
 * the same 600 hands, 55 of 60 two-seat tables had one and every three-seat
 * table did.
 *
 * Both are dealt rather than modelled. Neither is worded as the other: the
 * screen says which hand moved, because a line that implied he reached into
 * this round would be false about the rule the whole table is built on.
 */
export function counterfactualBack(record: TableRecord, seat: number, upTo: number): Counterfactual | null {
  if (isUthTable(record)) return null;
  /*
   * Only the last few hands are searched, and that is about cost rather than
   * taste: every candidate replays the whole table from the seed, so the price
   * of one question grows with how long the table has been running. Six hands
   * back was enough for 55 of 60 two-seat tables and for every three-seat one,
   * and it keeps the tap instant on a phone at hand ninety.
   */
  const from = Math.max(0, upTo - COUNTERFACTUAL_REACH + 1);
  for (let hand = upTo; hand >= from; hand--) {
    const here = counterfactual(record, seat, hand);
    if (here) return here;
  }
  for (let hand = upTo - 1; hand >= from; hand--) {
    const next = counterfactual(record, seat, hand, hand + 1);
    if (next) return next;
  }
  return null;
}

/** How many hands back the search looks. See `counterfactualBack`. */
const COUNTERFACTUAL_REACH = 6;

/** Every card one seat was dealt in one hand, or null when it was not dealt in. */
function handFor(table: DerivedTable, hand: number, seat: number): Card[] | null {
  const found = table.hands.find((entry) => entry.hand === hand);
  const seatHand = found?.seats.find((entry) => entry.seat === seat);
  return seatHand ? [...seatHand.cards] : null;
}

/**
 * The first place two lists of cards part company, or null when they never do.
 *
 * Two hands of different lengths that agree as far as the shorter one runs have
 * still parted: one of you drew a card the other did not, and the position that
 * card sits at is the answer.
 */
function firstDifference(a: readonly Card[], b: readonly Card[]): number | null {
  const shared = Math.min(a.length, b.length);
  for (let at = 0; at < shared; at++) if (a[at] !== b[at]) return at;
  return null;
}

/**
 * The same table with one seat's one decision changed, dealt again from the seed.
 *
 * The rounds after the changed one are filled with standing rather than left
 * empty, because a hand nobody finishes never settles and the cards after it
 * are never dealt — and those cards are precisely the question being asked.
 * Standing is the one action always open to a live hand, so the filled rounds
 * are a hand somebody could really have played.
 */
function replayWith(
  record: TableRecord,
  seat: number,
  hand: number,
  round: number,
  instead: SeatMove['action'],
): DerivedTable | null {
  const changed: TableRecord = {
    ...record,
    seats: record.seats.map((entry) => {
      if (entry.seat !== seat) return { ...entry, moves: [...entry.moves] };
      const kept = entry.moves.filter((move) => move.hand !== hand || move.round < round);
      const filled: SeatMove[] = [{ hand, round, action: instead }];
      for (let next = round + 1; next < round + REPLAY_ROUNDS; next++) {
        filled.push({ hand, round: next, action: 'stand' });
      }
      return { ...entry, moves: [...kept, ...filled] };
    }),
  };
  try {
    return deriveTable(changed);
  } catch {
    // A line the engine refuses is not a counterfactual; the caller tries the next.
    return null;
  }
}

/**
 * A spot you both met, and played differently.
 *
 * The different-cards design was supposed to have cost the table its
 * comparison: you are not holding the same hand, so there is nothing to argue
 * about. §3.8 recovers it — you are playing one shoe, so sooner or later you
 * both meet the same **cell of the chart**, and that is decision against
 * decision on identical terms. The keys already exist for every graded
 * decision, so this costs nothing but the looking.
 */
export interface SharedSpot {
  scenarioKey: string;
  /** Which hand each of you met it on, for a screen that wants to say when. */
  myHand: number;
  theirHand: number;
  seat: number;
  name: string;
  myAction: string;
  theirAction: string;
  /** What the chart says, which is the point of putting the two side by side. */
  optimalAction: string;
  /** Whether each of you played it the way the chart does. */
  mineRight: boolean;
  theirsRight: boolean;
}

/**
 * The chart cells two seats have both met and answered differently.
 *
 * Only the disagreements: a spot you both played the same way has nothing to
 * say about it, and the screen has one line to spend.
 */
export function sharedSpots(record: TableRecord, seat: number): SharedSpot[] {
  // Blackjack's chart cells. Ultimate has none, and two hole-card pairs are not one spot.
  if (isUthTable(record)) return [];
  const table = deriveTable(record);
  const mine = new Map<string, { hand: number; action: string; right: boolean }>();
  const theirs = new Map<
    number,
    Map<string, { hand: number; action: string; right: boolean; optimal: string }>
  >();

  for (const hand of table.hands) {
    for (const decision of hand.decisions) {
      const key = scenarioKeyOf(decision);
      if (key === null) continue;
      const entry = {
        hand: hand.hand,
        action: String(decision.action),
        right: decision.evCost <= 0,
        optimal: decision.optimalAction,
      };
      if (decision.seat === seat) {
        /*
         * The first time you met a spot is the one that counts — what you did
         * before the table had any chance to teach you the answer.
         */
        if (!mine.has(key)) mine.set(key, entry);
      } else {
        const forSeat = theirs.get(decision.seat) ?? new Map();
        if (!forSeat.has(key)) forSeat.set(key, entry);
        theirs.set(decision.seat, forSeat);
      }
    }
  }

  const out: SharedSpot[] = [];
  for (const [who, spots] of theirs) {
    const name = record.seats.find((entry) => entry.seat === who)?.name ?? '';
    for (const [key, entry] of spots) {
      const ours = mine.get(key);
      if (!ours || ours.action === entry.action) continue;
      out.push({
        scenarioKey: key,
        myHand: ours.hand,
        theirHand: entry.hand,
        seat: who,
        name,
        myAction: ours.action,
        theirAction: entry.action,
        optimalAction: entry.optimal,
        mineRight: ours.right,
        theirsRight: entry.right,
      });
    }
  }
  return out.sort((a, b) => Math.max(a.myHand, a.theirHand) - Math.max(b.myHand, b.theirHand));
}

/**
 * A decision's cell of the chart, or null when it does not have one.
 *
 * Insurance is the null: it is a side bet on the dealer's hole card rather than
 * a way to play a hand, so it has no cell, and two players "disagreeing" about
 * it would be comparing nothing. For the *rating*, insurance does have a key —
 * see `ratingKeyOf`, which is the one the private table uses.
 */
export function scenarioKeyOf(decision: DerivedDecision): string | null {
  if (decision.action === 'takeInsurance' || decision.action === 'declineInsurance') return null;
  const ranks = decision.cards.map((card) => bjRankOfCard(card));
  const upcard = bjRankOfCard(decision.upcard);
  return scenarioKeyForHand(ranks, upcard, decision.evByAction.split !== undefined);
}

/**
 * The key the rating looks a decision up by — exactly the private table's.
 *
 * It differs from `scenarioKeyOf` in one place and the difference matters:
 * **insurance is `bj:insurance`**, which is a real cell of the difficulty grid
 * and is rated when it is taken alone. Comparing two players on it is
 * meaningless, which is why the spots version returns null; rating one player on
 * it is what the private table has always done, and a shared table that skipped
 * it would be a second, laxer game.
 */
export function ratingKeyOf(decision: DerivedDecision): string {
  if (decision.action === 'takeInsurance' || decision.action === 'declineInsurance') {
    return 'bj:insurance';
  }
  const ranks = decision.cards.map((card) => bjRankOfCard(card));
  const upcard = bjRankOfCard(decision.upcard);
  return scenarioKeyForHand(ranks, upcard, decision.evByAction.split !== undefined);
}

/** One decision, reduced to the two things a rating needs from it. */
export interface RatableDecision {
  hand: number;
  round: number;
  scenarioKey: string;
  evCost: number;
  /**
   * What he actually did — the mastery grid's `confusion` needs it, to be able
   * to say "you used to hit this" rather than only "you used to get it wrong".
   * Absent on a forfeit, which is not an action anybody took.
   */
  action?: string;
  /**
   * True when this is not a decision at all but a forfeit (§3.3, round 26).
   *
   * It is rated — that is the whole point of it — and it is rated through the
   * same function every real decision goes through. What it must never do is
   * behave like a decision anywhere else: not in the hand log, not in the
   * accuracy figure, not in the mastery grid, and not in the "you used to get
   * this wrong" gesture. The app would otherwise tell a player he is weak on 16
   * against a ten on a hand he never played.
   *
   * Carrying the flag on the decision is what lets one list serve both: the
   * rating reads every row, and everything that teaches skips the ones marked
   * here.
   */
  forfeit?: true;
  /**
   * An Ultimate decision's EVs (round 32): the Ultimate rating reads a spot's
   * difficulty from them rather than from a chart cell. Absent in Blackjack.
   */
  evByAction?: Partial<Record<string, number>>;
}

/**
 * What a forfeited turn costs the rating — Idan's rule, round 26.
 *
 * > *"הדירוג שהיה יורד אילו היה בוחר בטעות החמורה ביותר בתור שבו הופעל
 * > הוויתור."*
 *
 * The rating drops by what it would have dropped had he chosen **the worst
 * action available at the spot he was sitting at** when the clock ran out. No
 * second formula and no invented constant: the cost is a real EV cost, read off
 * a real spot, and it goes through `rateOneDecision` like everything else.
 *
 * **The spot exists, but not in the table you can see.** A drop at hand *h*
 * takes the seat out of hand *h* — that is what "it costs him the hand" means —
 * so the derivation of the record as it stands has no such seat in that hand at
 * all. The spot is therefore read from the same table with that one drop event
 * removed: the hand he was actually in, at the round he never answered. It is a
 * replay, exactly like the counterfactual, and it asks no clock.
 */
export interface ForfeitSpot {
  seat: number;
  hand: number;
  round: number;
  scenarioKey: string;
  /** The largest EV cost available to him there — the worst thing he could do. */
  evCost: number;
  /** What he could have done, for a report or a screen that wants to say it. */
  legal: string[];
  worstAction: string;
  /** Ultimate only: the spot's EVs, which the Ultimate rating is read from. */
  evByAction?: Partial<Record<string, number>>;
}

/**
 * The spot a dropped seat was sitting at, or null when there is not one.
 *
 * Null is a real answer and the round asked for each case to be reported rather
 * than invented:
 *
 *   - **he was not waiting on anything.** A drop can land on a hand he had
 *     already answered, or before he was ever dealt in. There is no turn, so
 *     there is no forfeited turn.
 *   - **one legal action, or none.** "The worst available action" is then the
 *     only one, and choosing it is not a mistake — its EV cost is zero, so the
 *     rating moves by what a correct decision on that spot moves it by. That
 *     follows from Idan's sentence rather than departing from it, and it is
 *     returned rather than nulled.
 *   - **the spot is off the grid** (hard 18 through 21). The cost is real but
 *     there is no cell to rate it against, and `rateOneDecision` declines it —
 *     the same way it declines the same spot played properly. Returned here and
 *     refused one layer up, so the two behave alike.
 *   - **insurance.** It is a cell (`bj:insurance`) and it is rated, exactly as
 *     it is when a player answers it himself.
 */
export function forfeitSpot(record: TableRecord, seat: number, hand: number): ForfeitSpot | null {
  if (isUthTable(record)) return uthForfeitSpot(record, seat, hand);
  /*
   * The same table, minus the drop that is being priced. Without this the seat
   * is not live at the hand and there is nothing to look at — the drop having
   * already taken the hand away from him is precisely what makes the spot
   * invisible in the record as it stands.
   */
  const before: TableRecord = {
    ...record,
    seats: record.seats.map((entry) =>
      entry.seat === seat
        ? {
            ...entry,
            moves: [...entry.moves],
            events: (entry.events ?? []).filter(
              (event) => !(event.kind === 'drop' && event.hand === hand),
            ),
          }
        : { ...entry, moves: [...entry.moves] },
    ),
    // A vote is what a derived drop is made of, so it goes too.
    ...{},
  };
  for (const entry of before.seats) {
    if (entry.vote && entry.vote.against === seat && entry.vote.hand === hand) entry.vote = null;
  }

  /*
   * What the seat was looking at, caught as it is skipped. The chart cell is
   * worked out afterwards, from the table this same run produces, so the whole
   * of this costs one derivation rather than two.
   */
  let waiting: {
    round: number;
    legal: string[];
    evaluation: { evByAction: Partial<Record<string, number>>; optimalAction: string };
  } | null = null;
  let derived: DerivedTable;
  try {
    derived = run(
      before,
      hand + 1,
      (who, atHand, atRound) =>
        before.seats
          .find((entry) => entry.seat === who)
          ?.moves.find((entry) => entry.hand === atHand && entry.round === atRound)?.action ?? null,
      (who, round, legal, evaluation) => {
        if (waiting || who !== seat) return;
        waiting = { round, legal: [...legal], evaluation };
      },
    );
  } catch {
    // A log the engine refuses is not a forfeit anybody can price.
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
    const ev = (evaluation.evByAction as Record<string, number>)[action];
    if (ev === undefined) continue;
    if (ev < worst) {
      worst = ev;
      worstAction = action;
    }
  }
  return {
    seat,
    hand,
    round,
    scenarioKey: spotKeyFor(derived, seat, hand, evaluation, legal),
    evCost: Math.max(0, best - worst),
    legal,
    worstAction,
  };
}

/**
 * The chart cell a waiting seat is sitting on.
 *
 * Read from the hand it is holding, the same way `ratingKeyOf` reads it from a
 * decision that was made — so a forfeited turn is rated against the same cell
 * the turn would have been rated against had he answered it.
 */
function spotKeyFor(
  table: DerivedTable,
  seat: number,
  hand: number,
  evaluation: { evByAction: Partial<Record<string, number>>; optimalAction: string },
  legal: string[],
): string {
  if (legal.includes('takeInsurance') || legal.includes('declineInsurance')) return 'bj:insurance';
  const found = table.hands.find((entry) => entry.hand === hand);
  const seatHand = found?.seats.find((entry) => entry.seat === seat);
  const cards = seatHand ? (seatHand.hands[0] ?? seatHand.cards) : [];
  const dealer = found?.dealer ?? [];
  if (cards.length === 0 || dealer.length === 0) return 'bj:insurance';
  return scenarioKeyForHand(
    cards.map((card) => bjRankOfCard(card)),
    bjRankOfCard(dealer[0]!),
    evaluation.evByAction.split !== undefined,
  );
}

/**
 * Everything one seat has decided at this table, in the table's own order.
 *
 * The order is `(hand, round)` — the order the shoe dealt them — and it is a
 * property of the record rather than of when anybody's phone read it, which is
 * what lets "the first N of these have been rated" mean the same thing on two
 * devices and on the same device tomorrow.
 */
export function seatRatable(record: TableRecord, seat: number): RatableDecision[] {
  if (isUthTable(record)) return uthSeatRatable(record, seat);
  const table = deriveTable(record);
  const out: RatableDecision[] = [];
  for (const hand of table.hands) {
    for (const decision of hand.decisions) {
      if (decision.seat !== seat) continue;
      out.push({
        hand: hand.hand,
        round: decision.round,
        scenarioKey: ratingKeyOf(decision),
        evCost: decision.evCost,
        action: String(decision.action),
      });
    }
  }

  /*
   * And what he forfeited (§3.3, round 26).
   *
   * A drop is priced at the worst action available where he was sitting, and it
   * takes its place in the same ordered list as everything else — so the mark
   * that makes a table score once covers it too, and a replay of the record
   * reproduces it rather than re-charging it.
   *
   * **Leaving deliberately costs nothing**, which is what makes the penalty
   * fair: the offence is not slowness, it is letting the table rot rather than
   * playing or leaving. That is the whole of the `why` test below.
   */
  for (const event of tableEvents(record)) {
    if (event.seat !== seat || event.kind !== 'drop' || event.why === 'left') continue;
    const spot = forfeitSpot(record, seat, event.hand);
    if (!spot) continue;
    out.push({
      hand: spot.hand,
      round: spot.round,
      scenarioKey: spot.scenarioKey,
      evCost: spot.evCost,
      forfeit: true,
    });
  }

  return out.sort((a, b) => a.hand - b.hand || a.round - b.round);
}
