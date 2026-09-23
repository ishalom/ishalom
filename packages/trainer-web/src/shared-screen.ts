/**
 * What a shared table looks like to one seat (round 22; spec A, round A2).
 *
 * `shared-table.ts` derives the table; this turns one seat's view of it into
 * the plain object a screen can draw without knowing anything about shoes,
 * reservations or grading. The split is deliberate: the derivation is the part
 * that must be identical on two phones, so it is tested on its own and has no
 * idea a screen exists.
 *
 * WHAT THIS FILE ENFORCES, AND WHY IT IS HERE RATHER THAN IN THE MARKUP.
 * Spec §3.7: a neighbour's two cards are face up at a real table, so they are
 * face up here, but **what he did with them stays hidden until you have played
 * your own hand.** That is enforced by `seatView` not putting his decisions in
 * the object at all — not by leaving them out of the markup, because markup can
 * be read and a promise you can read your way around is not a promise.
 *
 * THE TWO MEASURES (§3.5). Each player bets what he likes, so the stack and the
 * bar say different things and the screen says which is which: the bar is the
 * honest comparison because the share of decisions played correctly does not
 * care what anybody wagered, and the stack is the fun number. Under ten
 * decisions the bar prints no percentage at all — it reads as settling, the way
 * a provisional rating does.
 */

import { parseScenarioKey, severityForCost, type BlackjackAction } from '@evtrainer/ev-engine';

import { contest, explain } from './explain.ts';
import { PER_SITTING, RECORD_FLOOR, crownFor, gestureForSettlement, type CrownTier } from './gestures.ts';
import type { Locale } from './i18n.ts';
import { returnsBlock, stakeFor } from './returns-block.ts';
import { CLOSE_CALL, advanceStreak, cardView, totalOf, type CardView } from './session.ts';
import {
  deriveTable,
  rulesFor,
  scenarioKeyOf,
  seatView,
  tableEvents,
  tableReactions,
  wasAsked,
  type DerivedDecision,
  type HandDetail,
  type ReactionKey,
  type ReactionPost,
  type SeatGlance,
  type SeatStatus,
  type TableRecord,
} from './shared-table.ts';

/** Below this many decisions the bar prints no percentage. Spec §3.5. */
export const BAR_SETTLES_AT = 10;

export interface SeatPanel {
  seat: number;
  name: string;
  /** True for the seat whose screen this is. */
  mine: boolean;
  /**
   * Whether anybody is sitting in it (round 29).
   *
   * The screen used to ask `seat.playerId`, which is not on a panel: every
   * chair read as taken, so a player alone at his new table was shown a felt
   * with two seats instead of the link to send. A flag rather than the id,
   * because the other seats' ids are nothing this screen needs.
   */
  seated: boolean;
  /**
   * What the seat did in the hand on screen, in order — facts about the play,
   * never a grade (round 30, item 2). A neighbour's appear once I have made my
   * own first move of the hand, or once it is over (§3.7).
   */
  actions: string[];
  /**
   * Each hand the seat holds, with its own total and — once the dealer has
   * turned — its own result (round 30, item 3). One entry for an ordinary
   * hand, two or more after a split.
   */
  split: SplitHand[];
  bet: number;
  status: SeatStatus;
  /** Every hand this seat holds, as faces. More than one after a split. */
  hands: CardView[][];
  total: number | null;
  net: number | null;
  /** This table only (§3.7): never a rating, never another table. */
  stack: number;
  decisions: number;
  /**
   * The share of this seat's decisions that were right, or null while settling.
   *
   * Null under ten decisions rather than a small-sample percentage, because a
   * player who is 1-for-1 is not "100% correct" and a screen that says so is
   * lying in the direction that flatters.
   */
  bar: number | null;
  /** How many of this seat's decisions were right, and how many it has made. */
  right: number;
  /** Hands dealt to this seat here — summed into the table's figure by §3.6. */
  handsPlayed: number;
  /**
   * What its mistakes cost in total, in units.
   *
   * On the panel because §3.6 weights by decisions, and weighting means summing
   * the costs and the counts separately before dividing. The screen shows the
   * rate below; this is what the rate is built from.
   */
  evLost: number;
  /** What its mistakes cost, per 100 decisions, or null while the bar is settling. */
  evLostPer100: number | null;
  /** Its longest run of right decisions at this table. */
  streak: number;
}

/**
 * The table as one player, against the dealer (§3.6).
 *
 * Each measure is combined the way that measure can honestly be combined, and
 * the differences are the whole point. Chips and hands are **sums**, because
 * that is what they are. The bar and the EV lost are **weighted by decisions**,
 * never averaged, because a plain average lets a player with three decisions
 * swing the table's number — the same small-sample lie the bar already guards
 * against for one player. The best streak is the **maximum**, because two
 * people's runs added together would be a run nobody had.
 *
 * And the combined chips figure carries the same warning its personal version
 * does: everybody bets what he likes, so it measures the shoe, not the table's
 * play. The bar is the one that measures the play.
 */
export interface TableMeasures {
  /** How many seats are in these figures — the ones that have been dealt in. */
  seats: number;
  /** Summed. */
  stack: number;
  handsPlayed: number;
  decisions: number;
  /** Weighted by decisions, or null while the table as a whole is settling. */
  bar: number | null;
  evLostPer100: number | null;
  /** The best any one seat has managed. */
  streak: number;
}

/** One of a seat's hands, as the felt draws it after a split. */
export interface SplitHand {
  cards: CardView[];
  total: number;
  /** Null until the hand is settled. */
  net: number | null;
  doubled: boolean;
  surrendered: boolean;
  /** The hand being decided right now. */
  active: boolean;
}

/**
 * One line of what has just happened at the table (§3.10).
 *
 * Five kinds and no more: something a player said, a gesture the app has earned
 * the right to make, a record broken, somebody arriving and somebody leaving.
 * The last two are Idan's, added in round 25 — at a real table who just sat
 * down is the first thing anybody notices.
 *
 * **None of them carries money** — §3.10 is explicit, and it is the rule that
 * keeps the ticker from turning a trainer into a scoreboard. Nor does any of
 * them carry a judgement: a player dropped by the thirty-second rule *left*,
 * and the ticker does not say why. The kinds are here rather than as sentences
 * because the wording is the catalogue's job, in both languages.
 */
export type TickerItem =
  | { kind: 'reaction'; seat: number; name: string; hand: number; key: ReactionKey }
  | { kind: 'gesture'; seat: number; name: string; hand: number; decisions: number }
  | { kind: 'record'; seat: number; name: string; hand: number; streak: number }
  | { kind: 'arrived'; seat: number; name: string; hand: number }
  | { kind: 'left'; seat: number; name: string; hand: number };

/**
 * My own decision, with the working behind it — what **תסביר לי** opens (§3.9).
 *
 * Mine only. `seatView` will not put another seat's decisions in the object
 * until I have played my own hand, and this never reaches past what it is
 * given, so the promise §3.7 makes is kept in one place rather than two.
 */
export interface DecisionView {
  hand: number;
  round: number;
  action: string;
  optimalAction: string;
  evCost: number;
  /** Every action's return, best first — the returns block's own input. */
  ranked: Array<{ action: string; ev: number; value: number }>;
  /**
   * The block itself, built by the same function the private table builds it
   * with, from the same scenario and the same rules.
   *
   * Reused rather than rewritten, which matters more here than anywhere: a
   * second copy of the worked lines would be a second answer to "what does
   * this hand come back", and the whole app rests on there being one.
   */
  returns: unknown;
  /**
   * The private table's own words for this decision (round 30, item 5):
   * the headline and the three steps `explain()` writes for the solo feedback
   * card, from the same scenario, the same evaluation and the same rules.
   */
  headline: string;
  steps: string[];
  /** The engine's own severity tier for the cost, as the solo card colours it. */
  severity: string;
  correct: boolean;
  /**
   * The crown this decision earned, if its run reached 7, 14 or 21 (round 31).
   * Mine only, like everything in this object; the ticker never hears of it.
   */
  crown: CrownTier | null;
}

export interface SharedScreen {
  hand: number | null;
  dealer: CardView[];
  dealerTotal: number | null;
  dealerRevealed: boolean;
  seats: SeatPanel[];
  me: SeatPanel | null;
  /** What I may do now. Empty when it is not my move. */
  legal: string[];
  round: number;
  /** True when the table is waiting on me and nobody else — the clock's trigger. */
  onlyMe: boolean;
  waitingFor: number[];
  /** True once every seat has played and the dealer has turned. */
  handOver: boolean;
  /** Set when two seats disagree about what was dealt: the table is refused. */
  refused: boolean;
  /** Which of the two measures disagree, for the line that names them (§3.5). */
  comparison: Comparison | null;
  /** The table as one player, against the dealer (§3.6). */
  table: TableMeasures;
  /** Everything said at this table, oldest first (§3.9). */
  reactions: ReactionPost[];
  /** What the one rotating line has to choose from, oldest first (§3.10). */
  ticker: TickerItem[];
  /** My own graded decisions for the hand on screen, and nobody else's (§3.9). */
  mine: DecisionView[];
  /**
   * The hand's analysis (round 30, item 5): my decisions in the latest hand I
   * have played, so what I just did stays readable after the next hand is
   * dealt and until I make my next decision. Mine only.
   */
  analysis: DecisionView[];
}

/**
 * The line that appears when the stack and the bar point different ways.
 *
 * It exists because personal stakes make the stack a bad comparison and people
 * will compare it anyway. Naming both, in the same breath, is the only honest
 * way to show a number somebody bet his way to the top of.
 */
export interface Comparison {
  leaderByStack: string;
  leaderByBar: string;
  stacks: Array<{ name: string; stack: number }>;
  bars: Array<{ name: string; bar: number | null }>;
}

/** A rate per hundred decisions, or null when there are too few to state one. */
function per100(cost: number, decisions: number): number | null {
  return decisions >= BAR_SETTLES_AT ? (cost / decisions) * 100 : null;
}

/**
 * The seats, combined into the table (§3.6).
 *
 * Seats nobody is sitting in are left out rather than counted as a player with
 * nothing: an empty chair has no decisions and no chips, and including it would
 * only make the table look like it has more people than it does.
 */
function tableMeasures(seats: SeatPanel[]): TableMeasures {
  const playing = seats.filter((seat) => seat.handsPlayed > 0 || seat.decisions > 0);
  const decisions = playing.reduce((sum, seat) => sum + seat.decisions, 0);
  const right = playing.reduce((sum, seat) => sum + seat.right, 0);
  /*
   * Weighted by decisions, which here means simply summing the parts before
   * dividing — the sum of what was lost over the sum of what was decided. That
   * is what "weighted, never a plain average" means when the weights are the
   * decision counts themselves.
   */
  const lost = playing.reduce((sum, seat) => sum + seat.evLost, 0);
  return {
    seats: playing.length,
    stack: playing.reduce((sum, seat) => sum + seat.stack, 0),
    handsPlayed: playing.reduce((sum, seat) => sum + seat.handsPlayed, 0),
    decisions,
    bar: decisions >= BAR_SETTLES_AT ? right / decisions : null,
    evLostPer100: per100(lost, decisions),
    streak: playing.reduce((best, seat) => Math.max(best, seat.streak), 0),
  };
}

/**
 * What the ticker has to say, oldest first (§3.10).
 *
 * Everything here is derived from the record, which is what lets two phones
 * show the same line: there is no list of announcements anybody writes, and no
 * announcement that exists on one device and not the other.
 *
 * The gesture is the solo game's own — `gestureForSettlement`, asked the same
 * question with the same rule — rather than a second definition of what
 * "played it right and lost" means. One rule, two screens.
 */
function tickerFor(record: TableRecord): TickerItem[] {
  const table = deriveTable(record);
  const items: TickerItem[] = [];
  const nameOf = (seat: number) => record.seats.find((entry) => entry.seat === seat)?.name ?? '';

  /*
   * THE SOLO GAME'S RARITY, KEPT (round 30). This used to hand
   * `gestureForSettlement` a blank history every time and announce a record on
   * every right decision past a seat's own best — so on the first real night,
   * 97 hands said "played it right and lost" 53 times and "best run at this
   * table" 32 times, and not once mentioned any of the 37 mistakes. Idan: *"זה
   * נראה כאילו אתה צודק כל הזמן."* Each seat now keeps what the solo session
   * keeps — a sitting's count, one a hand, "right and lost" once, a record
   * announced once a run — and the table is the sitting.
   */
  const shown = new Map<number, { sitting: number; rightAndLost: boolean; announced: boolean }>();
  const shownOf = (seat: number) => {
    let entry = shown.get(seat);
    if (!entry) {
      entry = { sitting: 0, rightAndLost: false, announced: false };
      shown.set(seat, entry);
    }
    return entry;
  };
  const run = new Map<number, number>();
  /* "The best at this table so far" is the table's, not each seat's own. */
  let tableBest = 0;

  for (const hand of table.hands) {
    /* A hand still being played says nothing: its last decision may not be in. */
    if (hand.incomplete) break;
    const spokeThisHand = new Set<number>();

    for (const decision of hand.decisions) {
      if (decision.round < 0) continue; // insurance nobody was asked is not a decision
      const seat = decision.seat;
      const mark = shownOf(seat);
      if (decision.evCost > 0) {
        run.set(seat, 0);
        mark.announced = false;
        continue;
      }
      const now = (run.get(seat) ?? 0) + 1;
      run.set(seat, now);
      if (
        now > tableBest &&
        tableBest >= RECORD_FLOOR &&
        !mark.announced &&
        !spokeThisHand.has(seat) &&
        mark.sitting < PER_SITTING
      ) {
        items.push({ kind: 'record', seat, name: nameOf(seat), hand: hand.hand, streak: now });
        mark.announced = true;
        mark.sitting++;
        spokeThisHand.add(seat);
      }
      tableBest = Math.max(tableBest, now);
    }

    /* A hand played right and lost, which a hand that won can never produce. */
    for (const seatHand of hand.seats) {
      if (seatHand.net === null || seatHand.net >= 0) continue;
      const mark = shownOf(seatHand.seat);
      const mine = hand.decisions.filter((decision) => decision.seat === seatHand.seat && decision.round >= 0);
      const gesture = gestureForSettlement({
        net: seatHand.net,
        decisions: mine.length,
        allOptimal: mine.every((decision) => decision.evCost <= 0),
        shown: {
          sitting: mark.sitting,
          thisHand: spokeThisHand.has(seatHand.seat),
          rightAndLostThisSitting: mark.rightAndLost,
        },
      });
      if (gesture && gesture.kind === 'rightAndLost') {
        items.push({
          kind: 'gesture',
          seat: seatHand.seat,
          name: nameOf(seatHand.seat),
          hand: hand.hand,
          decisions: gesture.decisions,
        });
        mark.rightAndLost = true;
        mark.sitting++;
        spokeThisHand.add(seatHand.seat);
      }
    }
  }

  for (const post of tableReactions(record)) {
    items.push({ kind: 'reaction', seat: post.seat, name: post.name, hand: post.hand, key: post.key });
  }

  /*
   * Who arrived and who left (round 25, Idan's answer to round 24's question).
   * At a real table it is the first thing anybody notices, and the derivation
   * already has it: the events are merged from the seats' own rows, so this
   * needs no new writer and no new column.
   *
   * A drop is a departure and is worded as one. The thirty-second rule and a
   * vote both end in the same event, and the ticker says the player left rather
   * than why — it is not the place the app passes judgement on him, and §3.10's
   * rule that the line never announces money is not the only thing it should
   * never announce.
   */
  for (const event of tableEvents(record)) {
    const name = nameOf(event.seat);
    if (event.kind === 'join' || event.kind === 'return') {
      items.push({ kind: 'arrived', seat: event.seat, name, hand: event.hand });
    } else {
      items.push({ kind: 'left', seat: event.seat, name, hand: event.hand });
    }
  }

  return items.sort((a, b) => a.hand - b.hand || a.seat - b.seat);
}

/** My own decisions for the hand on screen, with the working behind each. */
function mineFor(
  record: TableRecord,
  decisions: DerivedDecision[],
  seat: number | null,
  locale: Locale,
): DecisionView[] {
  if (seat === null) return [];
  const rules = rulesFor(record);
  const crowns = crownsOf(record, seat);
  return decisions
    .filter((decision) => decision.seat === seat)
    .map((decision) => {
      const ranked = Object.entries(decision.evByAction)
        .map(([action, ev]) => ({ action, ev: ev ?? 0, value: 1 + (ev ?? 0) }))
        .sort((a, b) => b.ev - a.ev);
      const key = scenarioKeyOf(decision);
      const scenario = key === null ? ({ kind: 'insurance' } as const) : parseScenarioKey(key);
      const words = explain(
        scenario as Parameters<typeof explain>[0],
        {
          legalActions: Object.keys(decision.evByAction) as BlackjackAction[],
          evByAction: decision.evByAction as Partial<Record<BlackjackAction, number>>,
          optimalAction: decision.optimalAction as BlackjackAction,
          optimalEv: decision.evByAction[decision.optimalAction] ?? 0,
        },
        rules,
        locale,
        decision.action as BlackjackAction,
      );
      return {
        hand: decision.hand,
        round: decision.round,
        action: String(decision.action),
        optimalAction: decision.optimalAction,
        evCost: decision.evCost,
        ranked,
        returns: key === null ? null : returnsBlock(parseScenarioKey(key), ranked, stakeFor(key), rules),
        headline: words.headline,
        steps: [...words.steps],
        severity: severityForCost(decision.evCost),
        correct: decision.evCost <= 0,
        crown: crowns.get(`${decision.hand}:${decision.round}`) ?? null,
      };
    });
}

/**
 * Every crown a seat has earned at this table, by the decision that earned it.
 *
 * The run is the private table's own, `advanceStreak`, over the seat's
 * decisions in the order the shoe dealt them: a right decision extends it, a
 * wrong one ends it, a close call does neither. Two things only a shared table
 * has: an insurance nobody was asked is not a decision and is skipped, and a
 * forfeit — a turn the clock took — ends the run, because it is rated as the
 * worst thing he could have done. Leaving on purpose is not a forfeit.
 */
function crownsOf(record: TableRecord, seat: number): Map<string, CrownTier> {
  const table = deriveTable(record);
  const forfeits = new Set(
    tableEvents(record)
      .filter((event) => event.seat === seat && event.kind === 'drop' && event.why !== 'left')
      .map((event) => event.hand),
  );
  const out = new Map<string, CrownTier>();
  let run = 0;
  for (const hand of table.hands) {
    if (forfeits.has(hand.hand)) run = 0;
    for (const decision of hand.decisions) {
      if (decision.seat !== seat || !wasAsked(record, seat, decision)) continue;
      const gap = contest({
        legalActions: Object.keys(decision.evByAction) as BlackjackAction[],
        evByAction: decision.evByAction as Partial<Record<BlackjackAction, number>>,
        optimalAction: decision.optimalAction as BlackjackAction,
        optimalEv: decision.evByAction[decision.optimalAction] ?? 0,
      }).gap;
      const before = run;
      run = advanceStreak(run, { correct: decision.evCost <= 0, closeCall: gap < CLOSE_CALL });
      const crown = crownFor(before, run);
      if (crown) out.set(`${decision.hand}:${decision.round}`, crown);
    }
  }
  return out;
}

/**
 * My decisions in the latest hand I made any in, for the analysis (round 30).
 *
 * Read from the derivation rather than from the view, because the view carries
 * the hand on screen only — and the analysis has to outlive it: the next hand
 * is dealt without anybody pressing anything, and what I just did must not
 * vanish the moment it is.
 */
function analysisFor(record: TableRecord, seat: number | null, locale: Locale): DecisionView[] {
  if (seat === null) return [];
  const table = deriveTable(record);
  for (let i = table.hands.length - 1; i >= 0; i--) {
    const own = table.hands[i]!.decisions.filter((decision) => decision.seat === seat && decision.round >= 0);
    if (own.length > 0) return mineFor(record, own, seat, locale);
  }
  return [];
}

function panel(glance: SeatGlance, mine: boolean): SeatPanel {
  const hands = glance.hands.length > 0 ? glance.hands : glance.cards.length > 0 ? [glance.cards] : [];
  return {
    seat: glance.seat,
    name: glance.name,
    mine,
    seated: glance.playerId !== null,
    actions: [...glance.acted],
    split: splitOf(hands, glance.detail, glance.active),
    bet: glance.bet,
    status: glance.status,
    hands: hands.map((cards) => cards.map((card) => cardView(card))),
    total: hands.length > 0 ? totalOf(hands[0]!) : null,
    net: glance.net,
    stack: glance.stack,
    decisions: glance.decisions,
    bar: glance.decisions >= BAR_SETTLES_AT ? glance.right / glance.decisions : null,
    right: glance.right,
    handsPlayed: glance.handsPlayed,
    evLost: glance.evLost,
    evLostPer100: per100(glance.evLost, glance.decisions),
    streak: glance.streak,
  };
}

/** Each hand of a seat's, with its total, and its result once it has one. */
function splitOf(hands: number[][], detail: HandDetail[], active: number | null): SplitHand[] {
  return hands.map((cards, index) => {
    const known = detail[index];
    return {
      cards: cards.map((card) => cardView(card)),
      total: totalOf(cards),
      net: known ? known.net : null,
      doubled: known ? known.doubled : false,
      surrendered: known ? known.surrendered : false,
      active: active === index,
    };
  });
}

/**
 * Whether the two measures disagree, and who leads on each.
 *
 * Returned only when they actually point at different people: a line explaining
 * that the same player leads both would be noise, and §3.5 wants this said at
 * the moment it is worth saying.
 */
function comparisonOf(seats: SeatPanel[]): Comparison | null {
  const rated = seats.filter((seat) => seat.bar !== null);
  if (rated.length < 2 || seats.length < 2) return null;
  const byStack = [...seats].sort((a, b) => b.stack - a.stack);
  const byBar = [...rated].sort((a, b) => b.bar! - a.bar!);
  if (byStack[0]!.name === byBar[0]!.name) return null;
  return {
    leaderByStack: byStack[0]!.name,
    leaderByBar: byBar[0]!.name,
    stacks: seats.map((seat) => ({ name: seat.name, stack: seat.stack })),
    bars: seats.map((seat) => ({ name: seat.name, bar: seat.bar })),
  };
}

/** One seat's whole screen, from the record and nothing else. */
export function sharedScreen(record: TableRecord, seat: number | null, locale: Locale = 'en'): SharedScreen {
  const view = seatView(record, seat);
  const seats = view.seats.map((glance) => panel(glance, glance.seat === seat));
  const me = seats.find((panel) => panel.mine) ?? null;
  /*
   * The hole card is not in the object until the dealer turns it.
   *
   * Sliced here rather than hidden by the markup, for the same reason a
   * neighbour's decisions are: a face-down card that is in the page's state is
   * a face-down card anybody can read. The total goes with it — an upcard's
   * total is what a player can see, and the whole hand's would give it away.
   */
  const shown = view.dealerRevealed ? view.dealer : view.dealer.slice(0, 1);
  const dealer = shown.map((card) => cardView(card));
  return {
    hand: view.hand,
    dealer,
    dealerTotal: shown.length > 0 ? totalOf(shown) : null,
    dealerRevealed: view.dealerRevealed,
    seats,
    me,
    legal: view.legal,
    round: view.round,
    onlyMe: view.onlyMe,
    waitingFor: view.waitingFor,
    handOver: view.hand !== null && view.dealerRevealed,
    refused: view.disagrees,
    comparison: comparisonOf(seats),
    table: tableMeasures(seats),
    reactions: tableReactions(record),
    ticker: tickerFor(record),
    mine: mineFor(record, view.decisions, seat, locale),
    analysis: analysisFor(record, seat, locale),
  };
}
