/**
 * An Ultimate Texas Hold'em session: the table, the practice stack, and the card
 * that grades each decision (spec §5.2, §7.1).
 *
 * A sibling of `TrainerSession` rather than a mode inside it. The two games
 * share the grading vocabulary — severity tiers, EV chips, a cost in units — and
 * nothing else: not a board, not a rating, not a history. Folding them into one
 * class would put two games' worth of branches in the object that has to stay
 * readable, and would make it possible for a UTH hand to touch the Blackjack
 * rating by accident. Kept apart, it is not possible at all.
 *
 * Round 4a scope: in memory only. No stats panel, no saved progress, no hand
 * log. The stack is honest about that on screen.
 */

import {
  formatCard,
  rankOf,
  suitOf,
  type Card,
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
}

function pokerCardView(card: Card): PokerCardView {
  const suit = suitOf(card);
  const rank = POKER_RANKS[rankOf(card)]!;
  return {
    rank: rank === 'T' ? '10' : rank,
    suit: POKER_SUITS[suit]!,
    red: suit === 1 || suit === 2,
    label: formatCard(card),
  };
}

/** The label key for each action, and the physical key that plays it. */
const ACTIONS: Record<UthAction, { label: string; key: string; code: string }> = {
  raise4x: { label: 'uth.raise4', key: '4', code: 'Digit4' },
  raise3x: { label: 'uth.raise3', key: '3', code: 'Digit3' },
  check: { label: 'uth.check', key: 'C', code: 'KeyC' },
  raise2x: { label: 'uth.raise2', key: '2', code: 'Digit2' },
  raise1x: { label: 'uth.raise1', key: '1', code: 'Digit1' },
  fold: { label: 'uth.fold', key: 'F', code: 'KeyF' },
};

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
const LRI = '\u2066';
const PDI = '\u2069';
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

export interface UthFeedback {
  phase: 'preflop' | 'flop' | 'river';
  headline: string;
  correct: boolean;
  severity: UthDecisionRecord['severityTier'];
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
  /** How long the solve took. Zero pre-flop, where it is a lookup. */
  solveMs: number;
}

export class UthSession {
  /** The practice stack a session opens with. Round 4a keeps it in memory only. */
  static readonly STARTING_STACK = 200;

  private readonly table: UthTable;
  private locale: Locale = 'en';
  private balance = UthSession.STARTING_STACK;
  private lastNet: number | null = null;
  private hands = 0;

  /** The last graded decision, kept so a language change can re-word the card. */
  private last: { record: UthDecisionRecord; evaluation: UthEvaluation; holeClass: string } | null =
    null;

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
    const evaluation = this.table.evaluate();
    const record = this.table.act(action);
    this.last = { record, evaluation, holeClass };

    const raise = { raise4x: 4, raise3x: 3, raise2x: 2, raise1x: 1 }[action as string];
    if (raise !== undefined) this.balance -= raise;

    const view = this.table.view;
    if (view.phase === 'settled' && view.settlement) {
      const settlement = view.settlement;
      // Everything staked comes back, plus or minus what it won.
      const staked = 2 + settlement.playBet;
      this.balance += staked + settlement.net;
      this.lastNet = settlement.net;
      this.hands++;
    }
    return this.view;
  }

  // --- What the page draws -------------------------------------------------

  get view(): unknown {
    const table = this.table.view;
    const settled = table.phase === 'settled';
    const inHand = table.phase !== 'idle';
    return {
      game: 'uth',
      phase: table.phase,
      hole: table.hole.map(pokerCardView),
      dealerHole: table.dealerHole.map(pokerCardView),
      dealerRevealed: table.dealerRevealed,
      board: table.board.map(pokerCardView),
      boardHidden: inHand ? 5 - table.board.length : 0,
      holeClass: inHand ? this.table.holeClass : null,
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
        memoryOnly: true,
      },
      hands: this.hands,
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
    };
  }

  // --- The card ------------------------------------------------------------

  private label(action: UthAction): string {
    return t(this.locale, ACTIONS[action].label);
  }

  private compose(last: {
    record: UthDecisionRecord;
    evaluation: UthEvaluation;
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
      headline: t(this.locale, `uth.h.${phase}`, { class: isolateFor(this.locale)(holeClass) }),
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
      sentence: this.sentence(record, evaluation, holeClass),
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
  private sentence(record: UthDecisionRecord, evaluation: UthEvaluation, holeClass: string): string {
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
          class: iso(holeClass),
          gap: iso(uthUnits((ev.raise4x ?? 0) - (ev.check ?? 0)).replace('+', '')),
        });
      }
      return t(L, 'uth.s.preCheck', {
        class: iso(holeClass),
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

    return t(L, record.optimalAction === 'raise1x' ? 'uth.s.riverRaise' : 'uth.s.riverFold', {
      wins: evaluation.wins ?? 0,
      ties: evaluation.ties ?? 0,
    });
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
