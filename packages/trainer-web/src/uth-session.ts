/**
 * An Ultimate Texas Hold'em session: the table, the stack, the stats, the hand
 * log, and the card that grades each decision (spec §5.2, §7.1, §9.2).
 *
 * A sibling of `TrainerSession` rather than a mode inside it. The two games
 * share the grading vocabulary — severity tiers, EV chips, a cost in units — and
 * the arithmetic of the stat strip, and nothing else: not a board, not a rating,
 * not a history. Folding them into one class would put two games' worth of
 * branches in the object that has to stay readable, and would make it possible
 * for a UTH hand to touch the Blackjack rating by accident. Kept apart, it is
 * not possible at all.
 *
 * Since round 4b this session is saved. It reads and writes the `uth` part of a
 * version 3 progress blob; the shell composes that with the Blackjack part into
 * the one record a browser and a player's row hold.
 *
 * Since round 5 it also explains in plain words: percentages on the river and
 * the hands that beat you, both final hands named at showdown with their five
 * cards, the starting hand described rather than written as "62s", and what the
 * suit is worth before the flop. Every figure still comes from the engine.
 */

import {
  NAMED_RANKS,
  PREFLOP_TABLE,
  TRIPS_PAYTABLES,
  analyseTrips,
  tripsResult,
  bestFive,
  categoryOf,
  evaluateCards,
  formatCard,
  holeClassLabel,
  preflopRow,
  rankOf,
  riverOdds,
  severityForCost,
  significantRanks,
  suitOf,
  type Card,
  type HandCategory,
  type PreflopRow,
  type SeverityTier,
} from '@evtrainer/ev-engine/uth';
import {
  UthTable,
  type UthAction,
  type UthDecisionRecord,
  type UthEvaluation,
  type UthSettlement,
} from '@evtrainer/game-engine';

import { newRating, type Rating } from './difficulty.ts';
import {
  PREFLOP_OUTCOMES,
  UTH_STAKE,
  uthMoneyFor,
  uthOddsFor,
  uthSharesFor,
  uthTieHidden,
  uthWorkedFor,
  type UthWork,
  type UthCounts,
} from './uth-worked.ts';
import { displayFigure } from './figure.ts';
import { equivalentGroups, RETURN_SCALE_MAX, returned, returnFigure } from './returns.ts';
import { t, type Locale } from './i18n.ts';
import { uthDifficulty, updateUthRating } from './uth-rating.ts';
import { TRACK_HANDS, trackDot, type TrackRow } from './track.ts';
import {
  TABLE_LIMITS,
  applyBet,
  chipsFor,
  chipsView,
  needsRebuy,
  newChipBook,
  readChipBook,
  rebuyBook,
  roundChips,
  validBet,
  type BetOp,
  type ChipBook,
} from './chips.ts';

/*
 * Named for the game rather than generically. The shared build folds every
 * module into one scope, and `session.ts` and `explain.ts` already declare
 * `RANKS`, `cardView`, `units` and `percent` — the bundler refuses the page
 * rather than let one silently shadow the other, which is what it did here.
 */
const POKER_RANKS = '23456789TJQKA';
const POKER_SUITS = ['♣', '♦', '♥', '♠'];

export interface PokerCardView {
  rank: string;
  suit: string;
  red: boolean;
  label: string;
  /** The engine's card number, so the page can mark the five that make a hand. */
  code: number;
}

export function pokerCardView(card: Card): PokerCardView {
  const suit = suitOf(card);
  const rank = POKER_RANKS[rankOf(card)]!;
  return {
    rank: rank === 'T' ? '10' : rank,
    suit: POKER_SUITS[suit]!,
    red: suit === 1 || suit === 2,
    label: formatCard(card),
    code: card,
  };
}

/** A rank as it is printed on a card: 2–10, J, Q, K, A. */
const rankSymbol = (rank: number): string => (rank === 8 ? '10' : POKER_RANKS[rank]!);

/** The label key for each action, and the physical key that plays it. */
const ACTIONS: Record<UthAction, { label: string; key: string; code: string }> = {
  raise4x: { label: 'uth.raise4', key: '4', code: 'Digit4' },
  raise3x: { label: 'uth.raise3', key: '3', code: 'Digit3' },
  check: { label: 'uth.check', key: 'C', code: 'KeyC' },
  raise2x: { label: 'uth.raise2', key: '2', code: 'Digit2' },
  raise1x: { label: 'uth.raise1', key: '1', code: 'Digit1' },
  fold: { label: 'uth.fold', key: 'F', code: 'KeyF' },
};

const UTH_ACTIONS = Object.keys(ACTIONS) as UthAction[];
const TIERS: SeverityTier[] = ['optimal', 'negligible', 'minor', 'significant', 'blunder'];

/*
 * What is already at risk at every Ultimate decision — the Ante and the Blind,
 * which are equal, mandatory and both forfeited by folding — now lives in
 * `uth-worked.ts` beside the arithmetic that divides by it. The engine quotes
 * its EVs in units of the ante and folding is exactly −2, so `UTH_STAKE` is the
 * stake round 13's figures are per unit of.
 */

/** Dealer holdings the river solve enumerates: 45 unseen cards, taken two at a time. */
const UTH_DEALER_HANDS = 990;

/**
 * Keep a figure in one piece inside right-to-left text.
 *
 * In a Hebrew sentence a signed number or a raise size is a left-to-right run
 * beside right-to-left words, and the bidirectional algorithm treats the sign
 * and the × as neutral characters that belong to whichever side they touch. On
 * the live page that turned "אנטה −1" into "אנטה 1−" and "העלאה 1×" into
 * "העלאה ×1" — a player reading the settlement saw the minus on the wrong side
 * of every loss. A left-to-right isolate (U+2066 … U+2069) makes each figure an
 * island the algorithm cannot split. English needs none, and gets none.
 */
const LRI = '⁦';
const PDI = '⁩';
const isolateFor = (locale: Locale) => (text: string): string =>
  locale === 'he' ? `${LRI}${text}${PDI}` : text;

const uthUnits = (value: number): string =>
  `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(3)}`;
const uthPercent = (value: number): string => `${Math.round(value * 100)}%`;

/**
 * An action's worth as a player now reads it: what one unit of the Ante and the
 * Blind comes back (round 13). The stored EV is untouched. A *gap* between two
 * of these figures is `uthBackGap`, on the same scale — quoting a net gap beside
 * two return figures would contradict the subtraction the reader can do.
 */
const uthBack = (ev: number): string => returnFigure(returned(ev, UTH_STAKE));
const uthBackGap = (gap: number): string => uthUnits(gap / UTH_STAKE);
/**
 * A settlement figure, by the one figure rule every screen uses (round 8):
 * at most two decimals, trailing zeros dropped. It used to keep one place,
 * a different rule from the strip, the track and the log.
 */
const money = (value: number): string => displayFigure(value, true);

/**
 * Whole-number percentages that add to exactly 100.
 *
 * Rounding each share separately can show 83% + 11% + 5% = 99%, and a player who
 * adds them up — some will — has caught the page in a small lie. Largest
 * remainder: round everything down, then hand the missing points to the shares
 * that lost the most in rounding.
 */
/**
 * A worked line with its win / tie / lose percentages attached (round 27).
 *
 * The percentages ride on the worked line rather than beside it because they
 * describe the very same endings its sum divides by: the line says *"1,842 of
 * 2,652 endings win, paying 3.14 each"*, and this says what share of endings
 * that is. Two numbers on one screen that describe the same thing must come
 * from the same place, or sooner or later they disagree.
 *
 * Rounded here, through `wholePercents`, so the three always add to exactly
 * 100 — a player who adds them up, and some will, must not catch the page out.
 *
 * **An action with no worked line still gets its percentages.** Folding has no
 * arithmetic to show and the pre-flop raises had none before round 20, but how
 * often a hand wins is worth saying either way, so a line is made for it.
 */
function withOdds(
  work: UthWork | null,
  odds: { wins: number; ties: number; losses: number } | null,
  action: string,
  value: number,
): UthWork | null {
  if (!odds) return work;
  const [win, tie, lose] = wholePercents([odds.wins, odds.ties, odds.losses]);
  const base: UthWork = work ?? { action, kind: 'uthOddsOnly', value, digits: 3 };
  /*
   * Whether the tie is worth printing, decided on the **unrounded** share
   * (Idan, round 28). A tie of 5.04% is below the line and goes, even though it
   * would have printed as "5%" — the decision is about the thing rather than
   * about how it rounds.
   *
   * The three shares are still rounded together and still add to 100. Hiding
   * one is a fact about the sentence, not about the arithmetic: the hidden tie
   * is still in the record, so `win + lose + the hidden tie` comes to 100, and
   * the copy says in one line why the two on screen do not.
   */
  const hidden = uthTieHidden(odds.wins, odds.ties, odds.losses);
  return {
    ...base,
    oddsWin: win,
    oddsTie: tie,
    oddsLose: lose,
    oddsTieHidden: hidden,
  };
}

export function wholePercents(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return counts.map(() => 0);
  const exact = counts.map((count) => (count * 100) / total);
  const floors = exact.map((value) => Math.floor(value));
  const missing = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ remainder: value - floors[index]!, index }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let k = 0; k < missing; k++) floors[order[k]!.index]!++;
  return floors;
}

/**
 * The Trips paytable this table is dealing (round 11, made changeable in round 19).
 *
 * Paytable I — 3-4-7-8-30-40-50, California's UTH-03 — is the default and was
 * the only one offered while there was no panel to change it in.
 *
 * WHY THIS ONE MAY BE A SETTING AND THE BLIND PAYTABLE MAY NOT. Trips is settled
 * on the player's own seven cards and the dealer is irrelevant to it: no solver
 * reads it, no graded decision depends on it, and so no difficulty and no rating
 * can move when it changes. The Blind paytable is the opposite — `solveRiver`,
 * `solveFlop` and the offline pre-flop job all take it, so changing it would
 * change every EV in the game, and the pre-flop table was solved against the
 * standard one and no other. `preflop-table.ts` says so in its own header.
 */
const DEFAULT_TRIPS_PAYTABLE = TRIPS_PAYTABLES[0]!;

/** Below this gap between the top two actions a decision is a coin-flip — Blackjack's figure. */
const UTH_CLOSE_CALL = 0.01;

/** Whether a saved decision was a close call: its top two plays within that gap. */
function uthCloseCall(d: { legalActions: UthAction[]; evByAction: Partial<Record<UthAction, number>> }): boolean {
  const evs = d.legalActions.map((a) => d.evByAction[a] ?? 0).sort((a, b) => b - a);
  return evs.length > 1 && evs[0]! - evs[1]! < UTH_CLOSE_CALL;
}

/** How many finished hands the log and the saved record keep — Blackjack's figure. */
const UTH_HISTORY_KEPT = 40;

let perfectPlayEdge: number | null = null;

/**
 * What the game takes from a player who never makes a mistake, as a percentage
 * of the Ante.
 *
 * Read off the solved pre-flop table: each class's best EV, weighted by how many
 * of the 1,326 starting hands fall in it — a pair 6, suited 4, offsuit 12. The
 * pre-flop EVs already assume the flop and river are then played perfectly, so
 * this is the whole game's edge, not the first decision's. It comes to 2.185%,
 * which is also the published figure; the stat strip's floor is this number.
 */
export function uthPerfectPlayEdgePercent(): number {
  if (perfectPlayEdge !== null) return perfectPlayEdge;
  let weight = 0;
  let ev = 0;
  for (const row of Object.values(PREFLOP_TABLE)) {
    const combinations = row.label.length === 2 ? 6 : row.label.endsWith('s') ? 4 : 12;
    weight += combinations;
    ev += combinations * Math.max(row.ev4x, row.ev3x, row.evCheck);
  }
  perfectPlayEdge = (-100 * ev) / weight;
  return perfectPlayEdge;
}

/** A group of dealer holdings that beat the player, as saved: data, worded later. */
interface SavedThreat {
  category: HandCategory;
  ranks: number[];
  count: number;
}

/** The river facts the card words, saved with the decision so the log can word them again. */
interface RiverFacts {
  wins?: number;
  ties?: number;
  losses?: number;
  /** The closest groups that beat the player, weakest first. */
  threats?: SavedThreat[];
  /** True when those groups are every dealer holding that beats the player. */
  covered?: boolean;
  /** The player's river hand, for "the same hand with a better kicker". */
  playerValue?: number;
}

type Explained = UthEvaluation & RiverFacts;

export interface UthFeedback {
  phase: 'preflop' | 'flop' | 'river';
  headline: string;
  correct: boolean;
  severity: SeverityTier;
  verdict: string;
  /** Present only when the choice was not the best one. */
  youChose: string | null;
  chosen: UthAction;
  optimal: UthAction;
  evCost: number;
  /**
   * Every legal action, best first. `ev` is net; `value` is what comes back per
   * unit of the Ante and the Blind; `money` is the same action in chips — what
   * it puts out now, what is then at risk, and what comes back on average.
   */
  ranked: Array<{
    action: UthAction;
    label: string;
    ev: number;
    value: number;
    money: { puts: number; risk: number; back: number };
  }>;
  /** What the card draws: the same scale Blackjack uses (round 13). */
  returns: {
    stake: number;
    scaleMax: number;
    best: number;
    equivalent: string[][];
    /** One line per action rebuilding its own figure, or null where nothing was counted. */
    worked: Array<Record<string, unknown> | null>;
    /** The Ante this hand is being played for, so the money lines can be in chips. */
    bet: number;
    /** Outcomes behind the pre-flop figure, and null at every other decision point. */
    scale: number | null;
    example: { kind: string; win: number; tie: number; value: number } | null;
  };
  /** One plain sentence, from the same solve as the grade. */
  sentence: string;
  /** Further lines, each shown only when it is true for this hand. */
  notes: string[];
  /** How long the solve took. Zero pre-flop, where it is a lookup. */
  solveMs: number;
}

/** One graded decision as it is saved: data only, so it can be worded in any language later. */
export interface UthSavedDecision {
  phase: 'preflop' | 'flop' | 'river';
  legalActions: UthAction[];
  evByAction: Partial<Record<UthAction, number>>;
  optimalAction: UthAction;
  chosenAction: UthAction;
  evCost: number;
  severityTier: SeverityTier;
  facts: {
    flopRaiseFrequency?: number;
    riverFoldFrequency?: number;
  } & RiverFacts;
}

export interface UthPlayedHand {
  id: number;
  hole: Card[];
  dealerHole: Card[];
  board: Card[];
  holeClass: string;
  settlement: UthSettlement;
  decisions: UthSavedDecision[];
  /** Chips per unit the hand was dealt at. Absent on hands saved before round 6b, which were 1. */
  bet?: number;
  /** The Trips bet on this hand and the multiple it paid (-1 lost), when there was one (round 11). */
  trips?: { bet: number; multiple: number };
}

/** The `uth` part of a version 3 progress blob. */
export interface UthProgressV1 {
  version: 1;
  /** Between hands: a hand still on the felt when this was taken is not in it. */
  balance: number;
  hands: number;
  decisions: number;
  correct: number;
  evLost: number;
  netUnits: number;
  closeCalls: number;
  closeCallsCorrect: number;
  bySeverity: Record<SeverityTier, number>;
  /** Only ever rises; the shell uses it to decide which saved copy is newer. */
  lifetimeDecisions: number;
  history: UthPlayedHand[];
}

/**
 * The `uth` part since round 6b: version 1, plus the bet.
 *
 * `balance` was already the stack, in units at the only bet there was, so it
 * carries straight over as chips. The Ante the next hand posts is `bet`.
 */
export interface UthProgressV2 extends Omit<UthProgressV1, 'version'> {
  version: 2;
  bet: number;
  lastBet: number;
  limits: { min: number; max: number };
  /**
   * The Ultimate rating (round 10). Absent on parts saved before it existed,
   * which open unrated at 1200 — a player who never rated an Ultimate decision
   * is not shown as rated.
   */
  rating?: Rating;
  /** Which Trips paytable was being dealt (round 19). Absent on parts saved before. */
  tripsTable?: string;
  /**
   * Trips (round 11): the bet being built, the last one dealt, and what it has
   * done. Absent on parts saved before, which open with nothing on Trips.
   */
  trips?: { bet: number; lastBet: number; hands: number; wagered: number; net: number };
}

/** Blackjack's `SessionStats`, field for field, so the strip and its tooltips read the same. */
export interface UthStats {
  hands: number;
  decisions: number;
  correct: number;
  accuracy: number;
  closeCallsExcluded: number;
  accuracyIncludingCloseCalls: number;
  evLost: number;
  /** In units of the Ante. */
  evLostPer100: number;
  bySeverity: Record<SeverityTier, number>;
  /** Percent of the Ante: the game's perfect-play edge plus what mistakes add. */
  effectiveHouseEdgePercent: number;
  netUnits: number;
}

const zeroSeverity = (): Record<SeverityTier, number> => ({
  optimal: 0,
  negligible: 0,
  minor: 0,
  significant: 0,
  blunder: 0,
});

/**
 * An evaluation, with the river facts the card words added when it is a river.
 *
 * The same 990 holdings the river was graded on, asked which ones beat the
 * player most narrowly. Counted again rather than read off the grade, and held
 * to the solver's counts by a test in the engine. One function, because the
 * shared table (round 32) words its river decisions with the private table's
 * own card and must not grow a second way of finding the threats.
 */
function withRiverFacts(evaluation: UthEvaluation, hole: Card[], board: Card[]): Explained {
  const explained: Explained = { ...evaluation };
  if (explained.phase !== 'river') return explained;
  const odds = riverOdds(hole, board, 3);
  explained.threats = odds.closest.map((g) => ({ category: g.category, ranks: g.ranks, count: g.count }));
  explained.covered = odds.closest.reduce((sum, g) => sum + g.count, 0) === odds.losses;
  explained.playerValue = odds.playerValue;
  return explained;
}

/** The best play in a pre-flop row, and what it is worth. */
function bestOf(row: PreflopRow): { action: UthAction; ev: number } {
  if (row.optimalAction === 'raise4x') return { action: 'raise4x', ev: row.ev4x };
  if (row.optimalAction === 'raise3x') return { action: 'raise3x', ev: row.ev3x };
  return { action: 'check', ev: row.evCheck };
}

export class UthSession {
  /** The stack a new player opens with, in units of the Ante. */
  static readonly STARTING_STACK = 200;

  private readonly table: UthTable;
  private locale: Locale = 'en';

  /** The stack, the bet being built and the last bet dealt, in chips (round 6b). */
  private chips: ChipBook = newChipBook();
  /** Chips per unit of the hand on the felt: the Ante, fixed when it is dealt. */
  private handBet = 1;
  private hands = 0;
  private decisions = 0;
  private correct = 0;
  private evLost = 0;
  private netUnits = 0;
  private closeCalls = 0;
  private closeCallsCorrect = 0;
  private bySeverity = zeroSeverity();
  private lifetimeDecisions = 0;
  private history: UthPlayedHand[] = [];

  /** The Ultimate rating (round 10): its own ladder, never Blackjack's, Basic mode only. */
  private rating: Rating = newRating('basic');
  /**
   * The rating as the hand on the felt was dealt. A save taken mid-hand keeps
   * this, as it keeps the counters without that hand's decisions.
   */
  private ratingAtDeal: Rating = newRating('basic');
  /** What the last graded decision did to it, for the card; null when it was not rated. */
  private lastRatingDelta: number | null = null;

  /*
   * Trips (round 11; spec A as approved). An optional bet on the player's own
   * seven cards, paid by paytable I, never graded: it changes no decision, so the
   * solver, the grades, the rating, the track, EV-lost and accuracy never see it.
   * Its amount is its own, anywhere inside the table limits, empty by default,
   * and it stays for the next hand like the Ante.
   */
  private trips: ChipBook = { stack: 0, bet: 0, lastBet: 0, placed: [] };
  /**
   * Which Trips paytable this table is dealing (round 19). A setting rather
   * than a constant, and safe to be one: see `DEFAULT_TRIPS_PAYTABLE`.
   */
  private tripsPaytable = DEFAULT_TRIPS_PAYTABLE;
  /** The Trips bet on the felt for the hand being played; 0 for none. */
  private handTrips = 0;
  /** The last settled hand's Trips, for its settlement line. */
  private lastTrips: { bet: number; multiple: number } | null = null;
  /** For the Stats row: hands with Trips, chips put on it, and what it did net. */
  private tripsHands = 0;
  private tripsWagered = 0;
  private tripsNet = 0;
  /** The hand whose settlement says what Trips costs: the first Trips hand of the sitting. */
  private tripsNoteHand: number | null = null;

  /** Decisions of the hand on the felt, saved when it settles. */
  private pending: UthSavedDecision[] = [];
  private lastNet: number | null = null;

  /** The last graded decision, kept so a language change can re-word the card. */
  private last: { record: UthDecisionRecord; evaluation: Explained; holeClass: string } | null = null;

  constructor(seed?: number) {
    this.table = new UthTable(seed === undefined ? {} : { seed });
  }

  setLocale(locale: Locale): void {
    this.locale = locale;
  }

  /** Post Ante and Blind and deal. */
  deal(): unknown {
    const phase = this.table.view.phase;
    if (phase !== 'idle' && phase !== 'settled') {
      throw new Error('Finish the hand before dealing another');
    }
    if (needsRebuy(this.chips)) throw new Error('The stack is below the table minimum: take the free rebuy first');
    if (!validBet(this.chips.bet)) throw new Error(`An Ante is between ${TABLE_LIMITS.min} and ${TABLE_LIMITS.max}`);
    this.table.startHand();
    // The Ante is the bet, and the Blind always equals it: both onto the felt.
    // The stack may go below zero here; the hand still plays (option B).
    this.handBet = this.chips.bet;
    this.chips = {
      ...this.chips,
      lastBet: this.chips.bet,
      stack: roundChips(this.chips.stack - 2 * this.handBet),
    };
    this.lastNet = null;
    this.last = null;
    this.pending = [];
    this.ratingAtDeal = { ...this.rating };
    this.lastRatingDelta = null;
    // Trips, when there is one: its own amount, off the stack with the Ante and Blind.
    this.handTrips = this.trips.bet;
    this.lastTrips = null;
    if (this.handTrips > 0) {
      this.trips = { ...this.trips, lastBet: this.trips.bet };
      this.chips = { ...this.chips, stack: roundChips(this.chips.stack - this.handTrips) };
    }
    return this.view;
  }

  /**
   * Compute the current decision point's evaluation now, so the grading click
   * that follows is instant.
   *
   * The page calls this straight after the flop is drawn. The solve runs while
   * the cards are still animating in — CSS transforms run on the compositor, so
   * the turn-over does not stall — and by the time the player can press a
   * button the answer is already cached on the table.
   */
  prepare(): { solveMs: number; phase: string } {
    const legal = this.table.legalActions();
    if (legal.length === 0) return { solveMs: 0, phase: this.table.view.phase };
    const evaluation = this.table.evaluate();
    return { solveMs: evaluation.solveMs, phase: evaluation.phase };
  }

  act(action: UthAction): unknown {
    const holeClass = this.table.holeClass;
    // Read before acting: `act()` moves the phase on and clears the cache.
    const before = this.table.view;
    const evaluation = withRiverFacts(this.table.evaluate(), before.hole, before.board);
    const record = this.table.act(action);
    this.last = { record, evaluation, holeClass };
    this.count(record, evaluation);

    const raise = { raise4x: 4, raise3x: 3, raise2x: 2, raise1x: 1 }[action as string];
    // A raise is the rule's multiple of the Ante: 4× on an Ante of 5 is 20.
    if (raise !== undefined) {
      this.chips = { ...this.chips, stack: roundChips(this.chips.stack - raise * this.handBet) };
    }

    const view = this.table.view;
    if (view.phase === 'settled' && view.settlement) {
      const settlement = view.settlement;
      // Everything staked comes back, plus or minus what it won — in chips, at the bet.
      this.chips = {
        ...this.chips,
        stack: roundChips(this.chips.stack + (2 + settlement.playBet + settlement.net) * this.handBet),
      };
      this.lastNet = roundChips(settlement.net * this.handBet);
      this.netUnits += settlement.net;
      this.hands++;
      const hand = this.table.handRecord;
      /*
       * Trips settles on the player's own seven cards, whatever the dealer holds
       * and even after a fold: "If the player has a three of a kind or better,
       * the Trips wager always wins - even if the player folds" (California
       * Bureau of Gambling Control, Standard Game: Ultimate Texas Hold'em, rev.
       * March 2015). A fold happens only on the river, so all seven are face up.
       *
       * It is kept out of the hand's own figure: the grade, the track, the strip
       * and the stack's swing measure the play, and Trips is a cost stated on its
       * own line. Its chips never move across the felt, win or lose.
       */
      let trips: { bet: number; multiple: number } | undefined;
      if (this.handTrips > 0) {
        const multiple = tripsResult(bestFive([...hand.hole, ...hand.board]).value, this.tripsPaytable);
        trips = { bet: this.handTrips, multiple };
        this.chips = { ...this.chips, stack: roundChips(this.chips.stack + this.handTrips * (1 + multiple)) };
        this.tripsHands++;
        this.tripsWagered += this.handTrips;
        this.tripsNet = roundChips(this.tripsNet + this.handTrips * multiple);
        if (this.tripsNoteHand === null) this.tripsNoteHand = hand.id;
      }
      this.lastTrips = trips ?? null;
      this.history.unshift({
        id: hand.id,
        hole: [...hand.hole],
        dealerHole: [...hand.dealerHole],
        board: [...hand.board],
        holeClass: hand.holeClass,
        settlement: { ...settlement },
        decisions: this.pending,
        bet: this.handBet,
        ...(trips ? { trips } : {}),
      });
      this.history.length = Math.min(this.history.length, UTH_HISTORY_KEPT);
      this.pending = [];
    }
    return this.view;
  }

  /** The same counters, and the same close-call rule, as Blackjack's `absorb`. */
  private count(record: UthDecisionRecord, evaluation: Explained): void {
    const evs = record.legalActions
      .map((a) => record.evByAction[a] ?? 0)
      .sort((a, b) => b - a);
    const closeCall = evs.length > 1 && evs[0]! - evs[1]! < UTH_CLOSE_CALL;
    const correct = record.evCost === 0;

    this.decisions++;
    this.lifetimeDecisions++;
    if (correct) this.correct++;
    this.evLost += record.evCost;
    this.bySeverity[record.severityTier]++;
    if (closeCall) {
      this.closeCalls++;
      if (correct) this.closeCallsCorrect++;
    }

    // Rated from the EVs the grade already holds: nothing is solved to rate it,
    // and the grade itself is untouched. Too obvious to rate means not rated.
    const legalEvs = Object.fromEntries(record.legalActions.map((a) => [a, record.evByAction[a] ?? 0]));
    const difficulty = uthDifficulty(legalEvs);
    this.lastRatingDelta = difficulty === null ? null : updateUthRating(this.rating, difficulty, record.severityTier);

    this.pending.push({
      phase: evaluation.phase,
      legalActions: [...record.legalActions],
      evByAction: { ...record.evByAction },
      optimalAction: record.optimalAction,
      chosenAction: record.chosenAction,
      evCost: record.evCost,
      severityTier: record.severityTier,
      facts: {
        flopRaiseFrequency: evaluation.flopRaiseFrequency,
        riverFoldFrequency: evaluation.riverFoldFrequency,
        wins: evaluation.wins,
        ties: evaluation.ties,
        losses: evaluation.losses,
        threats: evaluation.threats,
        covered: evaluation.covered,
        playerValue: evaluation.playerValue,
      },
    });
  }

  // --- The shared table (round 32) ------------------------------------------

  /**
   * Decisions made at a shared Ultimate table, taken into this player's rating.
   *
   * Blackjack's `absorbRated`, for the other game: the table grades with its own
   * `UthTable`s and never meets a session, and this is where its graded
   * decisions reach the one Ultimate rating — through `uthDifficulty` and
   * `updateUthRating`, exactly as `count()` rates a decision at the private
   * table. **Only the rating and the lifetime count move**, as in Blackjack:
   * this sitting's hands, accuracy, stack and log describe the private table,
   * and a hand dealt somewhere else did not happen at it.
   *
   * A forfeit is rated at the cost of the worst action where the seat was
   * sitting (Idan, round 26) and is not a decision, so it does not count as one.
   * Returns how many decisions moved the rating.
   */
  absorbRated(
    decisions: ReadonlyArray<{ evByAction?: Partial<Record<string, number>>; evCost: number; forfeit?: true }>,
  ): number {
    let rated = 0;
    for (const decision of decisions) {
      if (!decision.forfeit) this.lifetimeDecisions++;
      // Nothing to read a difficulty from is nothing to rate, as `count()` declines an obvious spot.
      if (!decision.evByAction) continue;
      const difficulty = uthDifficulty(decision.evByAction);
      if (difficulty === null) continue;
      updateUthRating(this.rating, difficulty, severityForCost(decision.evCost));
      rated++;
    }
    // A save taken now is between the private table's hands; keep the two in step.
    const phase = this.table.view.phase;
    if (phase === 'idle' || phase === 'settled') this.ratingAtDeal = { ...this.rating };
    return rated;
  }

  /**
   * The private table's own card, for a decision made at a shared table.
   *
   * The same `compose()` — headline, verdict, rows, worked lines, the
   * percentages and the calculation — asked about a decision this session did
   * not deal, so a shared Ultimate decision is explained by the one function
   * that explains a private one. `bet` is the seat's own Ante, which is what the
   * money lines are counted in.
   */
  explainDecision(decision: {
    record: UthDecisionRecord;
    evaluation: UthEvaluation;
    holeClass: string;
    hole: Card[];
    board: Card[];
    bet: number;
  }): UthFeedback {
    const evaluation = withRiverFacts(decision.evaluation, decision.hole, decision.board);
    const kept = this.handBet;
    this.handBet = decision.bet;
    try {
      return this.compose({ record: decision.record, evaluation, holeClass: decision.holeClass });
    } finally {
      this.handBet = kept;
    }
  }

  /**
   * A hand in words, as the private table's seat headers say it (round 19):
   * two hole cards by their class, five or more cards by the best hand in them.
   */
  describeCards(cards: Card[]): { words: string; five: string | null; codes: Card[] } {
    if (cards.length === 2) {
      return { words: this.classWords(holeClassLabel(cards[0]!, cards[1]!)), five: null, codes: [...cards] };
    }
    const hand = this.handWords(cards);
    return { words: hand.phrase, five: hand.five, codes: [...hand.cards] };
  }

  // --- The bet -------------------------------------------------------------

  /**
   * Build the Ante between hands: add a chip, take the last one back, clear it,
   * repeat the last Ante or double it. The table limits are enforced here.
   */
  placeBet(op: BetOp, chip?: number, spot: 'ante' | 'trips' = 'ante'): void {
    const phase = this.table.view.phase;
    if (phase !== 'idle' && phase !== 'settled') throw new Error('The Ante stays until the hand is over');
    // Trips is its own circle: the same chips, the same limits, its own amount (round 11).
    if (spot === 'trips') this.trips = applyBet(this.trips, op, chip);
    else this.chips = applyBet(this.chips, op, chip);
  }

  /** The free rebuy: only below the table minimum, always back to the starting stack. */
  rebuy(): void {
    const phase = this.table.view.phase;
    if (phase !== 'idle' && phase !== 'settled') throw new Error('Finish the hand first');
    this.chips = rebuyBook(this.chips);
  }

  // --- Saving and restoring ------------------------------------------------

  get stats(): UthStats {
    // Close calls leave the denominator with their outcomes, as in Blackjack.
    const graded = this.decisions - this.closeCalls;
    const gradedCorrect = this.correct - this.closeCallsCorrect;
    const evLostPer100 = this.hands === 0 ? 0 : (this.evLost / this.hands) * 100;
    return {
      hands: this.hands,
      decisions: this.decisions,
      correct: this.correct,
      accuracy: graded === 0 ? 1 : gradedCorrect / graded,
      closeCallsExcluded: this.closeCalls,
      accuracyIncludingCloseCalls: this.decisions === 0 ? 1 : this.correct / this.decisions,
      evLost: this.evLost,
      evLostPer100,
      bySeverity: { ...this.bySeverity },
      effectiveHouseEdgePercent: uthPerfectPlayEdgePercent() + evLostPer100,
      netUnits: this.netUnits,
    };
  }

  /**
   * The `uth` part of the saved record.
   *
   * Always between hands. A hand still on the felt has not happened yet as far
   * as the record is concerned — its Ante, Blind and any Play bet go back on the
   * balance, and its decisions are not counted — which is how Blackjack treats a
   * hand in progress too. Closing the tab mid-hand therefore costs nothing.
   */
  get progress(): UthProgressV2 {
    const view = this.table.view;
    const inHand = view.phase !== 'idle' && view.phase !== 'settled';
    const pendingCost = this.pending.reduce((sum, d) => sum + d.evCost, 0);
    const pendingCorrect = this.pending.filter((d) => d.evCost === 0).length;
    const pendingBy = zeroSeverity();
    for (const d of this.pending) pendingBy[d.severityTier]++;

    const unwound = (value: number, pending: number) => (inHand ? value - pending : value);
    const bySeverity = zeroSeverity();
    for (const tier of TIERS) bySeverity[tier] = unwound(this.bySeverity[tier], pendingBy[tier]);

    // Close calls inside the unfinished hand come off as well.
    let pendingClose = 0;
    let pendingCloseCorrect = 0;
    if (inHand) {
      for (const d of this.pending) {
        const evs = d.legalActions.map((a) => d.evByAction[a] ?? 0).sort((a, b) => b - a);
        if (evs.length > 1 && evs[0]! - evs[1]! < UTH_CLOSE_CALL) {
          pendingClose++;
          if (d.evCost === 0) pendingCloseCorrect++;
        }
      }
    }

    return {
      version: 2,
      balance: inHand
        ? roundChips(this.chips.stack + (view.ante + view.blind + view.playBet) * this.handBet + this.handTrips)
        : this.chips.stack,
      bet: this.chips.bet,
      lastBet: this.chips.lastBet,
      limits: { ...TABLE_LIMITS },
      hands: this.hands,
      decisions: unwound(this.decisions, this.pending.length),
      correct: unwound(this.correct, pendingCorrect),
      evLost: unwound(this.evLost, pendingCost),
      netUnits: this.netUnits,
      closeCalls: this.closeCalls - pendingClose,
      closeCallsCorrect: this.closeCallsCorrect - pendingCloseCorrect,
      bySeverity,
      lifetimeDecisions: unwound(this.lifetimeDecisions, this.pending.length),
      rating: inHand ? { ...this.ratingAtDeal } : { ...this.rating },
      tripsTable: this.tripsPaytable.id,
      trips: {
        bet: this.trips.bet,
        lastBet: this.trips.lastBet,
        hands: this.tripsHands,
        wagered: this.tripsWagered,
        net: this.tripsNet,
      },
      history: this.history.map((hand) => ({
        ...hand,
        hole: [...hand.hole],
        dealerHole: [...hand.dealerHole],
        board: [...hand.board],
        settlement: { ...hand.settlement },
        decisions: hand.decisions.map((d) => ({ ...d, legalActions: [...d.legalActions] })),
      })),
    };
  }

  /**
   * Take a saved `uth` part back.
   *
   * Anything that is not a version 1 object — including the nothing a version 1
   * or 2 blob holds, from before Ultimate was saved — leaves the session at zero
   * with a full stack, which is where those players genuinely are. Every number
   * is checked on the way in: a record passed around a family can be half-written.
   */
  restore(saved: unknown): void {
    const phase = this.table.view.phase;
    if (phase !== 'idle' && phase !== 'settled') {
      throw new Error('Restore between hands, not during one');
    }
    this.reset();
    const s = saved as (Partial<Omit<UthProgressV2, 'version'>> & { version?: unknown }) | null | undefined;
    if (!s || typeof s !== 'object' || (s.version !== 1 && s.version !== 2)) return;

    const n = (value: unknown, fallback = 0): number =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback;

    // A version 1 part has no bet: it opens at 1, the bet all of its hands were played at.
    this.chips = readChipBook(s.version === 2 ? s : undefined, n(s.balance, UthSession.STARTING_STACK));
    this.handBet = 1;
    this.hands = n(s.hands);
    this.decisions = n(s.decisions);
    this.correct = n(s.correct);
    this.evLost = n(s.evLost);
    this.netUnits = n(s.netUnits);
    this.closeCalls = n(s.closeCalls);
    this.closeCallsCorrect = n(s.closeCallsCorrect);
    for (const tier of TIERS) this.bySeverity[tier] = n(s.bySeverity?.[tier]);
    this.lifetimeDecisions = n(s.lifetimeDecisions, this.decisions);
    const rating = s.rating as Partial<Rating> | undefined;
    if (rating && typeof rating === 'object' && Number.isFinite(rating.rating)) {
      const rated = Math.max(0, Math.floor(n(rating.ratedDecisions)));
      this.rating = {
        mode: 'basic',
        rating: Math.max(800, Math.min(2200, rating.rating!)),
        peak: Math.max(800, Math.min(2200, n(rating.peak, rating.rating!))),
        ratedDecisions: rated,
        provisional: rated < 30,
        // A restored session is a new sitting: nothing has moved in it yet.
        sessionDelta: 0,
      };
    }
    this.ratingAtDeal = { ...this.rating };
    const savedTable = TRIPS_PAYTABLES.find((table) => table.id === s.tripsTable);
    if (savedTable) this.tripsPaytable = savedTable;
    const trips = s.trips as Partial<NonNullable<UthProgressV2['trips']>> | undefined;
    if (trips && typeof trips === 'object') {
      const bet = typeof trips.bet === 'number' && (trips.bet === 0 || validBet(trips.bet)) ? trips.bet : 0;
      const lastBet = typeof trips.lastBet === 'number' && validBet(trips.lastBet) ? trips.lastBet : 0;
      this.trips = { stack: 0, bet, lastBet, placed: chipsFor(bet) };
      this.tripsHands = Math.max(0, Math.floor(n(trips.hands)));
      this.tripsWagered = Math.max(0, n(trips.wagered));
      this.tripsNet = n(trips.net);
    }
    this.history = (Array.isArray(s.history) ? s.history : [])
      .filter(
        (hand): hand is UthPlayedHand =>
          !!hand &&
          Array.isArray(hand.hole) &&
          Array.isArray(hand.board) &&
          Array.isArray(hand.decisions) &&
          hand.decisions.every((d) => UTH_ACTIONS.includes(d.chosenAction) && TIERS.includes(d.severityTier)) &&
          !!hand.settlement,
      )
      .slice(0, UTH_HISTORY_KEPT);
  }

  /**
   * Change the Trips paytable (round 19).
   *
   * Nothing graded moves: Trips is settled on the player's own seven cards and
   * no solver reads it, so the rating, the accuracy and every EV on the card
   * are the same figures before and after. What does not survive is the Trips
   * row of the Stats: what the bet has cost this player is measured against one
   * paytable's house edge, and a figure averaged over two of them would measure
   * nothing. So those three counters start again, and nothing else does.
   *
   * Between hands only, like every other change to the table.
   */
  setTripsPaytable(id: string): boolean {
    const phase = this.table.view.phase;
    if (phase !== 'idle' && phase !== 'settled') return false;
    const table = TRIPS_PAYTABLES.find((entry) => entry.id === id);
    if (!table || table.id === this.tripsPaytable.id) return false;
    this.tripsPaytable = table;
    this.tripsHands = 0;
    this.tripsWagered = 0;
    this.tripsNet = 0;
    this.tripsNoteHand = null;
    return true;
  }

  private reset(): void {
    this.chips = newChipBook();
    this.handBet = 1;
    this.hands = 0;
    this.decisions = 0;
    this.correct = 0;
    this.evLost = 0;
    this.netUnits = 0;
    this.closeCalls = 0;
    this.closeCallsCorrect = 0;
    this.bySeverity = zeroSeverity();
    this.lifetimeDecisions = 0;
    this.history = [];
    this.pending = [];
    this.last = null;
    this.lastNet = null;
    this.rating = newRating('basic');
    this.ratingAtDeal = newRating('basic');
    this.lastRatingDelta = null;
    // The paytable is the table's, not the session's, so a reset leaves it alone
    // and `restore` sets it from the saved record when there is one.
    this.trips = { stack: 0, bet: 0, lastBet: 0, placed: [] };
    this.handTrips = 0;
    this.lastTrips = null;
    this.tripsHands = 0;
    this.tripsWagered = 0;
    this.tripsNet = 0;
    this.tripsNoteHand = null;
  }

  // --- What the page draws -------------------------------------------------

  get view(): unknown {
    const table = this.table.view;
    const settled = table.phase === 'settled';
    const inHand = table.phase !== 'idle';
    const iso = isolateFor(this.locale);
    return {
      game: 'uth',
      phase: table.phase,
      hole: table.hole.map(pokerCardView),
      dealerHole: table.dealerHole.map(pokerCardView),
      dealerRevealed: table.dealerRevealed,
      board: table.board.map(pokerCardView),
      boardHidden: inHand ? 5 - table.board.length : 0,
      /*
       * What each seat is holding, in words, under its name (round 19; round
       * 17's treatment on the Blackjack table, same principle).
       *
       * The player's from the flop on, because before it there are two cards
       * and no five-card hand to name. The dealer's only once his cards are
       * turned over, exactly as his total is withheld on the other table. The
       * five ranks ride along for the showdown, where both hands are ringed and
       * a shared board card carries both marks, so "which five are mine" is the
       * one moment the list earns its space.
       */
      seats: {
        you:
          inHand && table.board.length >= 3
            ? this.handWords([...table.hole, ...table.board])
            : null,
        dealer:
          table.dealerRevealed && table.board.length >= 3
            ? this.handWords([...table.dealerHole, ...table.board])
            : null,
        showFive: settled,
      },
      // Notation for the tooltip; words for the player.
      holeClass: inHand ? this.table.holeClass : null,
      holeWords: inHand ? this.classWords(this.table.holeClass) : null,
      // In chips at the bet: an Ante of 5 posts a Blind of 5, and 4× is 20.
      stake: {
        ante: roundChips(table.ante * this.handBet),
        blind: roundChips(table.blind * this.handBet),
        play: roundChips(table.playBet * this.handBet),
        total: roundChips((table.ante + table.blind + table.playBet) * this.handBet),
      },
      stack: {
        start: UthSession.STARTING_STACK,
        balance: this.chips.stack,
        lastNet: this.lastNet,
      },
      // The rail between hands: the Ante being built, the limits, what may change.
      chips: chipsView(this.chips, !inHand || settled),
      hands: this.hands,
      stats: this.stats,
      // The floor under the effective edge, as the tooltip quotes it.
      rulesEdge: iso(`${uthPerfectPlayEdgePercent().toFixed(2)}%`),
      /*
       * What the panel behind "Rules" states and what it lets a player change
       * (round 19).
       *
       * One control, and it is the Trips paytable. The Blind paytable is stated
       * and not offered: every EV in the game is solved against it, and the
       * pre-flop table was computed against the standard one over two billion
       * outcomes a class. The table limits are stated for the same reason they
       * are on the other table — they are the rules, and §10.1 says the rules
       * are visible.
       */
      rules: {
        blindName: t(this.locale, 'uth.blind.standard'),
        blindNote: t(this.locale, 'uth.blind.fixed'),
        limits: { ...TABLE_LIMITS },
        trips: this.tripsPaytable.id,
        tripsOptions: TRIPS_PAYTABLES.map((table) => ({
          id: table.id,
          name: t(this.locale, `uth.trips.${table.id}`),
          // Every payout, so the choice is a fact and not a name.
          pays: iso(
            [table.threeOfAKind, table.straight, table.flush, table.fullHouse, table.fourOfAKind, table.straightFlush, table.royalFlush]
              .map((multiple) => `${multiple}`)
              .join(' · '),
          ),
          // And what it costs, worked out for that paytable rather than quoted.
          edge: iso(`${analyseTrips(table).houseEdgePercent.toFixed(2)}%`),
        })),
      },
      legalActions: table.legalActions.map((action) => ({
        action,
        label: t(this.locale, ACTIONS[action].label),
        key: ACTIONS[action].key,
        code: ACTIONS[action].code,
      })),
      // The flop is the one decision point that costs a solve. The page asks for
      // it to be done early; this tells the page whether it still needs asking.
      needsPrepare: table.phase === 'flop' || table.phase === 'river',
      feedback: this.last ? this.compose(this.last) : null,
      // The Ultimate rating, for the card and home — never the strip (round 10).
      rating: { ...this.rating, lastDelta: this.lastRatingDelta },
      // Trips (round 11): its circle between hands and on the felt, and its Stats row.
      trips: {
        ...chipsView({ ...this.trips, stack: this.chips.stack }, !inHand || settled),
        onFelt: inHand ? this.handTrips : 0,
      },
      tripsStats: {
        hands: this.tripsHands,
        wagered: this.tripsWagered,
        expectedCost: roundChips((this.tripsWagered * analyseTrips(this.tripsPaytable).houseEdgePercent) / 100),
        net: this.tripsNet,
        edge: iso(`${analyseTrips(this.tripsPaytable).houseEdgePercent.toFixed(2)}%`),
      },
      settlement:
        settled && table.settlement
          ? this.lines(
              table.settlement,
              this.handBet,
              this.lastTrips && { ...this.lastTrips, cards: [...table.hole, ...table.board] },
              Boolean(this.lastTrips) && this.tripsNoteHand === this.table.handRecord.id,
            )
          : null,
      showdown:
        settled && table.settlement && !table.settlement.folded
          ? this.showdown(table.hole, table.dealerHole, table.board)
          : null,
      history: this.history.map((hand) => this.logEntry(hand)),
      // The decision track, built the way Blackjack's is.
      track: this.history.slice(0, TRACK_HANDS).map(
        (hand, index): TrackRow => ({
          index,
          id: hand.id,
          dots: hand.decisions.map((d) => trackDot(d.severityTier, uthCloseCall(d))),
          // In chips at the Ante the hand was dealt at.
          net: roundChips(hand.settlement.net * (hand.bet ?? 1)),
        }),
      ),
      howTo: this.howTo(),
    };
  }

  /**
   * "How to play", including the one line about Trips.
   *
   * Trips is not offered as a bet. What it would cost is not left as a claim:
   * `analyseTrips` works it out exactly under the default paytable, 3.50%.
   */
  private howTo(): string[] {
    const trips = analyseTrips(this.tripsPaytable);
    return [
      t(this.locale, 'uth.howto.1'),
      t(this.locale, 'uth.howto.2'),
      t(this.locale, 'uth.keys'),
      t(this.locale, 'uth.howto.trips', {
        edge: isolateFor(this.locale)(`${trips.houseEdgePercent.toFixed(2)}%`),
      }),
    ];
  }

  // --- Plain words ---------------------------------------------------------

  /**
   * A starting hand in words: "A-K, different suits", "a pair of sevens".
   *
   * "62s" is poker notation, and most of the family does not read it. The
   * notation is kept in the view for a tooltip; everything a player reads first
   * uses this.
   */
  private classWords(label: string): string {
    const L = this.locale;
    const hi = POKER_RANKS.indexOf(label[0]!);
    const lo = POKER_RANKS.indexOf(label[1]!);
    if (hi === lo) return t(L, 'uth.class.pair', { p: t(L, `rankPlural.${hi}`) });
    const hilo = isolateFor(L)(`${rankSymbol(hi)}-${rankSymbol(lo)}`);
    return t(L, label.endsWith('s') ? 'uth.class.suited' : 'uth.class.offsuit', { hilo });
  }

  /** A hand described from its category and the ranks that decide it. */
  private handPhrase(category: HandCategory, ranks: readonly number[]): string {
    const L = this.locale;
    if (category === 8 && ranks[0] === 12) return t(L, 'uthHand.royal');
    return t(L, `uthHand.${category}`, {
      r1: t(L, `rankName.${ranks[0] ?? 0}`),
      p1: t(L, `rankPlural.${ranks[0] ?? 0}`),
      p2: t(L, `rankPlural.${ranks[1] ?? 0}`),
    });
  }

  /**
   * One hand named, with the five cards that make it and their ranks in
   * playing order — extracted in round 19 so the seat headers and the
   * showdown lines cannot drift apart: both call this.
   *
   * `bestFive` asks the same evaluator the settlement was paid on, so the cards
   * ringed on the felt, the ranks in the header and the hand in words are one
   * answer written three ways.
   */
  private handWords(cards: Card[]): { phrase: string; five: string; cards: Card[]; value: number } {
    /*
     * Five cards on the flop, seven at the river. `bestFive` answers which five
     * of seven scored the hand; with five there is nothing to choose, and
     * `evaluateCards` is the same evaluator asked about the five directly — so
     * the flop's header and the river's come from one source either way.
     */
    const best =
      cards.length === 7
        ? bestFive(cards)
        : { value: evaluateCards(cards), cards: [...cards] };
    const category = categoryOf(best.value);
    const counts = new Map<number, number>();
    for (const card of best.cards) counts.set(rankOf(card), (counts.get(rankOf(card)) ?? 0) + 1);
    const ordered = [...best.cards].sort((a, b) => {
      const byCount = counts.get(rankOf(b))! - counts.get(rankOf(a))!;
      return byCount !== 0 ? byCount : rankOf(b) - rankOf(a);
    });
    // A wheel reads 5-4-3-2-A, the way it is played.
    const ranks = ordered.map((card) => rankOf(card));
    const wheel = (category === 4 || category === 8) && ranks[0] === 12 && ranks[1] === 3;
    const shown = wheel ? [...ranks.slice(1), 12] : ranks;
    return {
      phrase: this.handPhrase(category, significantRanks(best.value)),
      five: shown.map(rankSymbol).join('-'),
      cards: best.cards,
      value: best.value,
    };
  }

  /**
   * Both final hands, named, with the five cards that make each.
   *
   * `bestFive` asks the same evaluator which five of the seven scored the hand,
   * so the cards ringed on the felt and the ranks in brackets can never disagree
   * with the hand the settlement was paid on.
   */
  private showdown(hole: Card[], dealerHole: Card[], board: Card[]) {
    const L = this.locale;
    const iso = isolateFor(L);
    const describe = (cards: Card[], key: string) => {
      const hand = this.handWords(cards);
      return {
        words: t(L, key, { hand: hand.phrase, five: iso(hand.five) }),
        cards: hand.cards,
        value: hand.value,
        phrase: hand.phrase,
      };
    };
    const player = describe([...hole, ...board], 'uth.show.you');
    const dealer = describe([...dealerHole, ...board], 'uth.show.dealer');
    return {
      player,
      dealer,
      winner: this.winnerLine(player, dealer),
      legend: t(L, 'uth.show.legend'),
    };
  }

  /**
   * Who won, by the cards, in one plain line (round 7).
   *
   * Only the cards decide it here. Whether the dealer qualified moves the Ante,
   * which the settlement lines already say; it does not make either hand
   * better. The evaluator's values compare directly, so the line can never name
   * a winner the settlement did not pay. When both hands read the same in words,
   * the kicker decided it — or nothing did, and it is a tie.
   */
  private winnerLine(player: { value: number; phrase: string }, dealer: { value: number; phrase: string }): string {
    const L = this.locale;
    if (player.value === dealer.value) return t(L, 'uth.show.tie', { hand: player.phrase });
    const youWin = player.value > dealer.value;
    if (player.phrase === dealer.phrase) {
      return t(L, youWin ? 'uth.show.youWinKicker' : 'uth.show.dealerWinsKicker', { hand: player.phrase });
    }
    return t(L, youWin ? 'uth.show.youWin' : 'uth.show.dealerWins', { you: player.phrase, dealer: dealer.phrase });
  }

  // --- The hand log ----------------------------------------------------------

  /**
   * One finished hand, worded now in the current language.
   *
   * The Blackjack log's structure from round 3: a summary that describes the
   * hand rather than one decision in it, then one block per decision under its
   * own header, then the result, quieter than any of it.
   */
  private logEntry(hand: UthPlayedHand): unknown {
    const L = this.locale;
    // A run of cards is left-to-right notation; inside Hebrew text "7♠ 2♦"
    // otherwise draws as "♠7 ♦2", the suit being a neutral character.
    const cards = (list: Card[]) =>
      isolateFor(L)(
        list
          .map((card) => {
            const v = pokerCardView(card);
            return `${v.rank}${v.suit}`;
          })
          .join(' '),
      );

    const decisions = hand.decisions.map((d, index) => {
      const record: UthDecisionRecord = {
        sequenceIndex: index,
        handIndex: 0,
        scenarioKey: `uth:${d.phase}`,
        legalActions: d.legalActions,
        evByAction: d.evByAction,
        optimalAction: d.optimalAction,
        chosenAction: d.chosenAction,
        evCost: d.evCost,
        severityTier: d.severityTier,
        timeToDecideMs: null,
      };
      const evaluation: Explained = {
        phase: d.phase,
        evByAction: d.evByAction,
        optimalAction: d.optimalAction,
        ...d.facts,
        solveMs: 0,
      };
      const card = this.compose({ record, evaluation, holeClass: hand.holeClass });
      return {
        header: t(L, card.correct ? 'log.right' : 'log.played', {
          headline: `${card.headline} → ${this.label(d.optimalAction)}`,
          chosen: this.label(d.chosenAction).toLowerCase(),
        }),
        severity: d.severityTier,
        correct: card.correct,
        sentence: card.sentence,
        notes: card.notes,
      };
    });

    const off = decisions.filter((d) => !d.correct).length;
    const summary =
      decisions.length === 1
        ? decisions[0]!.header
        : off === 0
          ? t(L, 'log.allRight', { n: decisions.length })
          : t(L, 'log.someOff', { n: decisions.length, bad: off });
    const worst = hand.decisions.reduce<SeverityTier>(
      (acc, d) => (TIERS.indexOf(d.severityTier) > TIERS.indexOf(acc) ? d.severityTier : acc),
      'optimal',
    );
    const result = this.lines(hand.settlement, hand.bet ?? 1, hand.trips && { ...hand.trips, cards: [...hand.hole, ...hand.board] });
    const shown = hand.settlement.folded ? null : this.showdown(hand.hole, hand.dealerHole, hand.board);

    return {
      id: hand.id,
      cards: {
        hole: cards(hand.hole),
        dealer: hand.settlement.folded ? null : cards(hand.dealerHole),
        board: cards(hand.board),
      },
      summary,
      severity: worst,
      net: roundChips(hand.settlement.net * (hand.bet ?? 1)),
      decisions,
      showdown: shown ? [shown.player.words, shown.dealer.words, shown.winner] : [],
      lines: result.lines,
      netLine: result.net,
    };
  }

  // --- The card ------------------------------------------------------------

  private label(action: UthAction): string {
    return t(this.locale, ACTIONS[action].label);
  }

  private compose(last: {
    record: UthDecisionRecord;
    evaluation: Explained;
    holeClass: string;
  }): UthFeedback {
    const { record, evaluation, holeClass } = last;
    const phase = evaluation.phase;
    const correct = record.evCost === 0;
    /*
     * The Ante and the Blind are already on the table at every decision, so
     * they are what "per unit staked" means here — and folding, which forfeits
     * both, reads 0.000: nothing comes back. Break-even is 1.000, as it is in
     * Blackjack. `ev` stays the stored figure, net, in units of the ante.
     */
    const ranked = record.legalActions
      .map((action) => ({
        action,
        label: this.label(action),
        ev: record.evByAction[action] ?? 0,
        value: returned(record.evByAction[action] ?? 0, UTH_STAKE),
        /*
         * And the same action in chips (round 19, Idan's ask). What Ultimate
         * hides is not the odds, it is how much is on the table: 4x is an Ante,
         * a Blind and four more — six units — while a check is two. `back` is
         * what is at risk plus what the choice is worth, so folding at the
         * river reads two chips at risk and nothing coming back.
         */
        money: uthMoneyFor(action, record.evByAction[action] ?? 0, this.handBet),
      }))
      .sort((a, b) => b.ev - a.ev);

    return {
      phase,
      headline: t(this.locale, `uth.h.${phase}`, { class: this.classWords(holeClass) }),
      correct,
      severity: record.severityTier,
      verdict: correct
        ? t(this.locale, 'fb.correct', { action: this.label(record.optimalAction) })
        : t(this.locale, 'fb.wrong', {
            severity: t(this.locale, `fb.${record.severityTier}`),
            // Round 14, Idan's call: what the mistake cost, on the same scale
            // as the bars an inch below it. `evCost` itself is untouched — the
            // record, the rating, the leaderboard and EV-lost all keep the
            // figure in units of the Ante. Only this line is converted, and
            // only because a player can find the contradiction by subtracting
            // two bars in front of him.
            cost: isolateFor(this.locale)(uthBackGap(record.evCost).replace('+', '')),
          }),
      youChose: correct
        ? null
        : t(this.locale, 'fb.youChose', {
            chosen: this.label(record.chosenAction).toLowerCase(),
            best: this.label(record.optimalAction).toLowerCase(),
          }),
      chosen: record.chosenAction,
      optimal: record.optimalAction,
      evCost: record.evCost,
      ranked,
      returns: {
        stake: UTH_STAKE,
        scaleMax: RETURN_SCALE_MAX,
        best: ranked[0]?.value ?? 0,
        equivalent: equivalentGroups(ranked),
        /*
         * One worked line per action, each rebuilding its own figure exactly —
         * Blackjack's round 15 rule, arriving here in round 19. The river and
         * the flop counted something on the way to the grade, so both can be
         * said forward; before the flop the EVs are a lookup and there is
         * nothing counted to show, so those actions carry no line rather than a
         * line derived backwards from the answer.
         */
        worked: ranked.flatMap((row) => [
          withOdds(
            uthWorkedFor(row.action, row.value, phase, evaluation.counts as UthCounts | undefined),
            uthOddsFor(row.action, phase, evaluation.counts as UthCounts | undefined),
            row.action,
            row.value,
          ),
          /*
           * And the same figure written from the percentages (round 28). A
           * second line rather than a replacement: the first counts endings,
           * this one multiplies the shares those counts make. It carries no
           * percentages of its own, so the block draws one odds line per action
           * rather than two.
           */
          uthSharesFor(row.action, row.value, phase, evaluation.counts as UthCounts | undefined),
        ]),
        /* What the whole decision is worth in chips, for the money lines. */
        bet: this.handBet,
        /*
         * The size of the pre-flop answer (round 19). Every board against every
         * dealer holding, for one pair of hole cards — the figure is a lookup
         * because this cannot be run while somebody waits. Advanced only; the
         * page decides, as it does with every other level.
         */
        scale: phase === 'preflop' ? PREFLOP_OUTCOMES : null,
        // The river is the one decision whose odds are exact and countable, so
        // it is the one that can show the player what is behind the figure.
        example:
          phase === 'river' && evaluation.wins !== undefined
            ? {
                kind: 'river',
                win: (evaluation.wins ?? 0) / UTH_DEALER_HANDS,
                tie: (evaluation.ties ?? 0) / UTH_DEALER_HANDS,
                value: ranked.find((row) => row.action === 'raise1x')?.value ?? ranked[0]!.value,
              }
            : null,
      },
      sentence: this.sentence(record, evaluation),
      notes: phase === 'preflop' ? this.preflopNotes(holeClass) : phase === 'river' ? this.riverNotes(evaluation) : [],
      solveMs: evaluation.solveMs,
    };
  }

  /**
   * The one sentence, and only facts the solve itself produced.
   *
   * Each describes the spot rather than the choice, so it reads true whether
   * the player got it right or not — with one exception. A 3× raise gets its
   * own sentence, because §5.2.3 is the lesson the button exists to teach and it
   * is a claim about the choice, not the spot: 3× is the best play on none of
   * the 169 starting hands.
   */
  private sentence(record: UthDecisionRecord, evaluation: Explained): string {
    const ev = record.evByAction;
    const L = this.locale;
    const iso = isolateFor(L);

    if (evaluation.phase === 'preflop') {
      if (record.chosenAction === 'raise3x') {
        return t(L, 'uth.s.threeX', {
          cost: iso(uthBackGap(record.evCost).replace('+', '')),
          best: this.label(record.optimalAction).toLowerCase(),
        });
      }
      if (record.optimalAction === 'raise4x') {
        return t(L, 'uth.s.preRaise', {
          gap: iso(uthBackGap((ev.raise4x ?? 0) - (ev.check ?? 0)).replace('+', '')),
        });
      }
      return t(L, 'uth.s.preCheck', {
        flopRaise: uthPercent(evaluation.flopRaiseFrequency ?? 0),
        riverFold: uthPercent(evaluation.riverFoldFrequency ?? 0),
      });
    }

    if (evaluation.phase === 'flop') {
      // On the card's scale, like every other gap quoted beside these figures.
      const gap = Math.abs((ev.raise2x ?? 0) - (ev.check ?? 0));
      return t(L, record.optimalAction === 'raise2x' ? 'uth.s.flopRaise' : 'uth.s.flopCheck', {
        gap: iso(uthBackGap(gap).replace('+', '')),
        riverFold: uthPercent(evaluation.riverFoldFrequency ?? 0),
      });
    }

    /*
     * The river, in percentages a player reads at a glance. The counts are the
     * solver's; the rounding keeps the three shares adding to exactly 100.
     */
    const [win, tie, lose] = wholePercents([evaluation.wins ?? 0, evaluation.ties ?? 0, evaluation.losses ?? 0]);
    return t(L, record.optimalAction === 'raise1x' ? 'uth.s.riverRaise' : 'uth.s.riverFold', {
      win: `${win}%`,
      tie: `${tie}%`,
      lose: `${lose}%`,
      fold: iso('−2'),
    });
  }

  /**
   * On the river: the dealer holdings that beat the player most narrowly.
   *
   * "Only with" is said only when those groups are every holding that beats the
   * player; otherwise the line says they are the closest, which is what they are.
   */
  private riverNotes(evaluation: Explained): string[] {
    const L = this.locale;
    const threats = evaluation.threats;
    if (!threats) return [];
    if (threats.length === 0) return [t(L, 'uth.note.nothingBeats')];
    const player = evaluation.playerValue ?? -1;
    const playerCategory = player >= 0 ? categoryOf(player) : -1;
    const playerNamed = player >= 0 ? significantRanks(player).slice(0, NAMED_RANKS[categoryOf(player)]) : [];
    const phrases = threats.map((threat) => {
      const phrase = this.handPhrase(threat.category, threat.ranks);
      const sameHand =
        threat.category === playerCategory &&
        threat.ranks.length === playerNamed.length &&
        threat.ranks.every((rank, i) => rank === playerNamed[i]);
      return sameHand ? t(L, 'uthHand.kicker', { hand: phrase }) : phrase;
    });
    // "a full house, three jacks and two fours" has a comma of its own, so a
    // list of such hands is separated with semicolons or it cannot be read.
    const sep = phrases.some((phrase) => phrase.includes(',')) ? ';' : ',';
    const list =
      phrases.length === 1
        ? phrases[0]!
        : `${phrases.slice(0, -1).join(`${sep} `)}${sep === ';' ? ';' : ''}${t(L, 'uth.list.or')}${phrases[phrases.length - 1]}`;
    return [t(L, evaluation.covered ? 'uth.note.onlyWith' : 'uth.note.closest', { list })];
  }

  /**
   * Before the flop: what the suit is worth, and the suited-connector surprise.
   *
   * Both come from the table and appear only when true. A suited hand is set
   * beside the same ranks in different suits — the suit flips the decision in 7
   * of the 78 suited classes and only adds value in the rest — and a suited
   * connector gets Idan's line only when the table says check (T9s yes, QJs no).
   * Pairs have no suited twin, and a hand in different suits is not told what a
   * suit would have added: that is the same fact from the other side, and on a
   * hand the player cannot change it is noise.
   */
  private preflopNotes(holeClass: string): string[] {
    const L = this.locale;
    const iso = isolateFor(L);
    // A pair can never share a suit, so there is nothing about suits to say.
    if (holeClass.length === 2) return [];
    /*
     * In different suits: the same fact from the other side (round 7). The felt
     * used to say "different suits" beside You; it no longer does, so the card
     * says it here, with what the same ranks would be worth in one suit.
     */
    if (!holeClass.endsWith('s')) {
      const off = bestOf(preflopRow(holeClass));
      const same = bestOf(preflopRow(`${holeClass.slice(0, 2)}s`));
      return [
        t(L, off.action !== same.action ? 'uth.note.suitOffFlips' : 'uth.note.suitOffSame', {
          best: this.label(off.action).toLowerCase(),
          ev: iso(uthBack(off.ev)),
          suitedBest: this.label(same.action).toLowerCase(),
          suitedEv: iso(uthBack(same.ev)),
        }),
      ];
    }
    const suitedRow = preflopRow(holeClass);
    const offRow = preflopRow(`${holeClass.slice(0, 2)}o`);
    const suited = bestOf(suitedRow);
    const off = bestOf(offRow);
    const notes: string[] = [];
    if (suited.action !== off.action) {
      notes.push(
        t(L, 'uth.note.suitFlips', {
          best: this.label(suited.action).toLowerCase(),
          ev: iso(uthBack(suited.ev)),
          offBest: this.label(off.action).toLowerCase(),
          offEv: iso(uthBack(off.ev)),
        }),
      );
    } else {
      notes.push(
        t(L, 'uth.note.suitSame', {
          best: this.label(suited.action).toLowerCase(),
          ev: iso(uthBack(suited.ev)),
          offEv: iso(uthBack(off.ev)),
          gap: iso(uthBackGap(suited.ev - off.ev)),
        }),
      );
    }
    const hi = POKER_RANKS.indexOf(holeClass[0]!);
    const lo = POKER_RANKS.indexOf(holeClass[1]!);
    if (hi - lo === 1 && suitedRow.optimalAction === 'check') notes.push(t(L, 'uth.note.connector'));
    return notes;
  }

  /**
   * Showdown, as three separate lines.
   *
   * The Ante, the Play and the Blind resolve by three unrelated rules, and one
   * net figure explains none of them. So the dealer's line carries the Ante
   * (which is the only bet qualification touches), then the Play, then the
   * Blind — and the total comes last and quietest.
   */
  /**
   * The settlement's lines, and Trips' after them when a Trips bet was on the
   * hand (round 11): what it paid and on which hand, or that it lost; and, on
   * the first Trips hand of a sitting, the one sentence about what it costs.
   * The hand's own figure stays the play's alone.
   */
  private lines(
    s: UthSettlement,
    perUnit: number,
    trips?: { bet: number; multiple: number; cards: Card[] } | null,
    costNote = false,
  ): { lines: string[]; net: string; folded: boolean } {
    const out = this.gameLines(s, perUnit);
    if (!trips || trips.bet <= 0) return out;
    const L = this.locale;
    const iso = isolateFor(L);
    const cash = (value: number) => iso(money(roundChips(value)));
    if (trips.multiple > 0) {
      const value = bestFive(trips.cards).value;
      out.lines.push(
        t(L, 'uth.line.tripsPaid', {
          multiple: iso(String(trips.multiple)),
          hand: this.handPhrase(categoryOf(value), significantRanks(value)),
          won: cash(trips.bet * trips.multiple),
        }),
      );
    } else {
      out.lines.push(t(L, 'uth.line.tripsLose', { lost: cash(-trips.bet) }));
    }
    if (costNote) {
      out.lines.push(
        t(L, 'uth.line.tripsCost', { edge: iso(`${analyseTrips(this.tripsPaytable).houseEdgePercent.toFixed(2)}%`) }),
      );
    }
    return out;
  }

  private gameLines(s: UthSettlement, perUnit: number): { lines: string[]; net: string; folded: boolean } {
    const L = this.locale;
    const iso = isolateFor(L);
    // Every figure in chips at the bet; the multiple on the Play bet stays a multiple.
    const cash = (value: number) => iso(money(roundChips(value * perUnit)));
    const bet = iso(`${s.playBet}×`);
    if (s.folded) {
      return {
        lines: [t(L, 'uth.line.folded'), t(L, 'uth.line.foldPlay'), t(L, 'uth.line.forfeit', { lost: cash(-2) })],
        net: t(L, 'uth.line.net', { net: cash(s.net) }),
        folded: true,
      };
    }
    const tie = s.ante === 0 && s.play === 0 && s.blind === 0 && s.dealerQualified;
    if (tie) {
      return {
        lines: [t(L, 'uth.line.tie'), t(L, 'uth.line.playPush', { bet }), t(L, 'uth.line.blindTie')],
        net: t(L, 'uth.line.net', { net: cash(s.net) }),
        folded: false,
      };
    }
    const dealer = s.dealerQualified
      ? t(L, 'uth.line.dealerQualified', { ante: cash(s.ante) })
      : t(L, 'uth.line.dealerNotQualified');
    const play =
      s.play > 0
        ? t(L, 'uth.line.playWin', { bet, play: cash(s.play) })
        : s.play < 0
          ? t(L, 'uth.line.playLose', { bet, play: cash(s.play) })
          : t(L, 'uth.line.playPush', { bet });
    const blind =
      s.blind > 0
        ? t(L, 'uth.line.blindPaid', { blind: cash(s.blind) })
        : s.blindPushed
          ? t(L, 'uth.line.blindPush')
          : s.blind < 0
            ? t(L, 'uth.line.blindLose', { blind: cash(s.blind) })
            : t(L, 'uth.line.blindTie');
    return {
      lines: [dealer, play, blind],
      net: t(L, 'uth.line.net', { net: cash(s.net) }),
      folded: false,
    };
  }
}
