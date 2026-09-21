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

import { cardView, totalOf, type CardView } from './session.ts';
import {
  seatView,
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

function panel(glance: SeatGlance, mine: boolean): SeatPanel {
  const hands = glance.hands.length > 0 ? glance.hands : glance.cards.length > 0 ? [glance.cards] : [];
  return {
    seat: glance.seat,
    name: glance.name,
    mine,
    bet: glance.bet,
    status: glance.status,
    hands: hands.map((cards) => cards.map((card) => cardView(card))),
    total: hands.length > 0 ? totalOf(hands[0]!) : null,
    net: glance.net,
    stack: glance.stack,
    decisions: glance.decisions,
    bar: glance.decisions >= BAR_SETTLES_AT ? glance.right / glance.decisions : null,
  };
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
export function sharedScreen(record: TableRecord, seat: number | null): SharedScreen {
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
  };
}
