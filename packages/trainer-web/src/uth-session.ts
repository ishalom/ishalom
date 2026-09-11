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
  bestFive,
  categoryOf,
  formatCard,
  preflopRow,
  rankOf,
  riverOdds,
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

import { t, type Locale } from './i18n.ts';

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

function pokerCardView(card: Card): PokerCardView {
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
/** A settlement figure: whole units where it is whole, otherwise one place. */
const money = (value: number): string => {
  const text = Math.abs(value) % 1 === 0 ? Math.abs(value).toFixed(0) : Math.abs(value).toFixed(1);
  return `${value < 0 ? '−' : value > 0 ? '+' : ''}${text}`;
};

/**
 * Whole-number percentages that add to exactly 100.
 *
 * Rounding each share separately can show 83% + 11% + 5% = 99%, and a player who
 * adds them up — some will — has caught the page in a small lie. Largest
 * remainder: round everything down, then hand the missing points to the shares
 * that lost the most in rounding.
 */
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

/** Below this gap between the top two actions a decision is a coin-flip — Blackjack's figure. */
const UTH_CLOSE_CALL = 0.01;

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
  /** Every legal action, best first. */
  ranked: Array<{ action: UthAction; label: string; ev: number }>;
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

  private balance = UthSession.STARTING_STACK;
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
    this.table.startHand();
    this.balance -= 2; // Ante 1 + Blind 1, onto the felt
    this.lastNet = null;
    this.last = null;
    this.pending = [];
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
    const evaluation: Explained = { ...this.table.evaluate() };
    if (evaluation.phase === 'river') {
      /*
       * The same 990 holdings the river was graded on, asked which ones beat the
       * player most narrowly. Counted again rather than read off the grade, and
       * held to the solver's counts by a test in the engine.
       */
      const view = this.table.view;
      const odds = riverOdds(view.hole, view.board, 3);
      evaluation.threats = odds.closest.map((g) => ({ category: g.category, ranks: g.ranks, count: g.count }));
      evaluation.covered = odds.closest.reduce((sum, g) => sum + g.count, 0) === odds.losses;
      evaluation.playerValue = odds.playerValue;
    }
    const record = this.table.act(action);
    this.last = { record, evaluation, holeClass };
    this.count(record, evaluation);

    const raise = { raise4x: 4, raise3x: 3, raise2x: 2, raise1x: 1 }[action as string];
    if (raise !== undefined) this.balance -= raise;

    const view = this.table.view;
    if (view.phase === 'settled' && view.settlement) {
      const settlement = view.settlement;
      // Everything staked comes back, plus or minus what it won.
      this.balance += 2 + settlement.playBet + settlement.net;
      this.lastNet = settlement.net;
      this.netUnits += settlement.net;
      this.hands++;
      const hand = this.table.handRecord;
      this.history.unshift({
        id: hand.id,
        hole: [...hand.hole],
        dealerHole: [...hand.dealerHole],
        board: [...hand.board],
        holeClass: hand.holeClass,
        settlement: { ...settlement },
        decisions: this.pending,
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
  get progress(): UthProgressV1 {
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
      version: 1,
      balance: inHand ? this.balance + view.ante + view.blind + view.playBet : this.balance,
      hands: this.hands,
      decisions: unwound(this.decisions, this.pending.length),
      correct: unwound(this.correct, pendingCorrect),
      evLost: unwound(this.evLost, pendingCost),
      netUnits: this.netUnits,
      closeCalls: this.closeCalls - pendingClose,
      closeCallsCorrect: this.closeCallsCorrect - pendingCloseCorrect,
      bySeverity,
      lifetimeDecisions: unwound(this.lifetimeDecisions, this.pending.length),
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
    const s = saved as Partial<UthProgressV1> | null | undefined;
    if (!s || typeof s !== 'object' || s.version !== 1) return;

    const n = (value: unknown, fallback = 0): number =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback;

    this.balance = n(s.balance, UthSession.STARTING_STACK);
    this.hands = n(s.hands);
    this.decisions = n(s.decisions);
    this.correct = n(s.correct);
    this.evLost = n(s.evLost);
    this.netUnits = n(s.netUnits);
    this.closeCalls = n(s.closeCalls);
    this.closeCallsCorrect = n(s.closeCallsCorrect);
    for (const tier of TIERS) this.bySeverity[tier] = n(s.bySeverity?.[tier]);
    this.lifetimeDecisions = n(s.lifetimeDecisions, this.decisions);
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

  private reset(): void {
    this.balance = UthSession.STARTING_STACK;
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
      // Notation for the tooltip; words for the player.
      holeClass: inHand ? this.table.holeClass : null,
      holeWords: inHand ? this.classWords(this.table.holeClass) : null,
      stake: {
        ante: table.ante,
        blind: table.blind,
        play: table.playBet,
        total: table.ante + table.blind + table.playBet,
      },
      stack: {
        start: UthSession.STARTING_STACK,
        balance: this.balance,
        lastNet: this.lastNet,
      },
      hands: this.hands,
      stats: this.stats,
      // The floor under the effective edge, as the tooltip quotes it.
      rulesEdge: iso(`${uthPerfectPlayEdgePercent().toFixed(2)}%`),
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
      settlement: settled && table.settlement ? this.lines(table.settlement) : null,
      showdown:
        settled && table.settlement && !table.settlement.folded
          ? this.showdown(table.hole, table.dealerHole, table.board)
          : null,
      history: this.history.map((hand) => this.logEntry(hand)),
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
    const trips = analyseTrips(TRIPS_PAYTABLES[0]!);
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
      const best = bestFive(cards);
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
        words: t(L, key, {
          hand: this.handPhrase(category, significantRanks(best.value)),
          five: iso(shown.map(rankSymbol).join('-')),
        }),
        cards: best.cards,
      };
    };
    return {
      player: describe([...hole, ...board], 'uth.show.you'),
      dealer: describe([...dealerHole, ...board], 'uth.show.dealer'),
      legend: t(L, 'uth.show.legend'),
    };
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
    const result = this.lines(hand.settlement);
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
      net: hand.settlement.net,
      decisions,
      showdown: shown ? [shown.player.words, shown.dealer.words] : [],
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
    const ranked = record.legalActions
      .map((action) => ({ action, label: this.label(action), ev: record.evByAction[action] ?? 0 }))
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
            cost: isolateFor(this.locale)(record.evCost.toFixed(3)),
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
          cost: iso(uthUnits(-record.evCost).replace('−', '')),
          best: this.label(record.optimalAction).toLowerCase(),
        });
      }
      if (record.optimalAction === 'raise4x') {
        return t(L, 'uth.s.preRaise', {
          gap: iso(uthUnits((ev.raise4x ?? 0) - (ev.check ?? 0)).replace('+', '')),
        });
      }
      return t(L, 'uth.s.preCheck', {
        flopRaise: uthPercent(evaluation.flopRaiseFrequency ?? 0),
        riverFold: uthPercent(evaluation.riverFoldFrequency ?? 0),
      });
    }

    if (evaluation.phase === 'flop') {
      const gap = Math.abs((ev.raise2x ?? 0) - (ev.check ?? 0));
      return t(L, record.optimalAction === 'raise2x' ? 'uth.s.flopRaise' : 'uth.s.flopCheck', {
        gap: iso(gap.toFixed(3)),
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
    if (holeClass.length === 2 || !holeClass.endsWith('s')) return [];
    const suitedRow = preflopRow(holeClass);
    const offRow = preflopRow(`${holeClass.slice(0, 2)}o`);
    const suited = bestOf(suitedRow);
    const off = bestOf(offRow);
    const notes: string[] = [];
    if (suited.action !== off.action) {
      notes.push(
        t(L, 'uth.note.suitFlips', {
          best: this.label(suited.action).toLowerCase(),
          ev: iso(uthUnits(suited.ev)),
          offBest: this.label(off.action).toLowerCase(),
          offEv: iso(uthUnits(off.ev)),
        }),
      );
    } else {
      notes.push(
        t(L, 'uth.note.suitSame', {
          best: this.label(suited.action).toLowerCase(),
          ev: iso(uthUnits(suited.ev)),
          offEv: iso(uthUnits(off.ev)),
          gap: iso(uthUnits(suited.ev - off.ev)),
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
  private lines(s: UthSettlement): { lines: string[]; net: string; folded: boolean } {
    const L = this.locale;
    const iso = isolateFor(L);
    const cash = (value: number) => iso(money(value));
    const bet = iso(`${s.playBet}×`);
    if (s.folded) {
      return {
        lines: [t(L, 'uth.line.folded'), t(L, 'uth.line.foldPlay'), t(L, 'uth.line.forfeit')],
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
            ? t(L, 'uth.line.blindLose')
            : t(L, 'uth.line.blindTie');
    return {
      lines: [dealer, play, blind],
      net: t(L, 'uth.line.net', { net: cash(s.net) }),
      folded: false,
    };
  }
}
