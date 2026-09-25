/**
 * The Ultimate Texas Hold'em state machine (spec §5.2.1).
 *
 * The same shape as `BlackjackTable`, and here for the same reasons: the EV
 * engine is pure and cannot shuffle, legality is a property of where the hand
 * has got to rather than of the cards, and a decision should be graded beside
 * the state that produced it rather than beside the screen that drew it.
 *
 * What it does not do is decide anything. Every number it grades against comes
 * from the solvers — the 169-class table before the flop, `solveFlop` and
 * `solveRiver` after it — and every unit it pays out comes from `settle()`.
 * There is no EV arithmetic and no settlement rule in this file.
 *
 * The shape of the game
 * ---------------------
 * The Play bet is made exactly once, and the later it is made the smaller it is
 * allowed to be: 4x before the flop, 2x after it, 1x after the river. Checking
 * costs nothing in chips and everything in leverage, which is the whole
 * strategic shape of the game and the reason a trainer for it is worth having.
 *
 * The cards
 * ---------
 * All nine cards are dealt at the start and revealed street by street — the
 * same choice `BlackjackTable` makes with the hole card. An unknown card now
 * and an unknown card after the player acts are the same random card from the
 * same deck, so this keeps one dealing path and puts the whole hand in
 * `dealtCards` for replay.
 */

import {
  DEFAULT_BLIND_PAYTABLE,
  FLOP_RAISE,
  FOLD_RESULT,
  PREFLOP_RAISE,
  PREFLOP_RAISE_SMALL,
  RIVER_RAISE,
  blindPayout,
  dealerQualifies,
  evaluate7,
  fullDeck,
  holeClassLabel,
  preflopRow,
  settle,
  severityForCost,
  solveFlop,
  solveRiver,
  type BlindPaytable,
  type Card,
} from '@evtrainer/ev-engine/uth';

import { makeRng, shuffleInPlace } from './rng.ts';

/**
 * Milliseconds, from whichever high-resolution clock the runtime has.
 *
 * Read off `globalThis` rather than named directly: this package compiles
 * against the bare ES library, with neither the DOM's types nor Node's, because
 * it must not come to depend on either.
 */
const clock = (globalThis as { performance?: { now(): number } }).performance;
const now = (): number => (clock ? clock.now() : Date.now());
import type { DecisionRecordOf } from './types.ts';

/** Everything a player can do, across all three decision points. */
export type UthAction = 'raise4x' | 'raise3x' | 'check' | 'raise2x' | 'raise1x' | 'fold';

export type UthPhase =
  /** No hand in progress. */
  | 'idle'
  /** Two hole cards, nothing on the board: raise 4x, raise 3x or check. */
  | 'preflop'
  /** Three community cards out: raise 2x or check. */
  | 'flop'
  /** All five out: raise 1x or fold. */
  | 'river'
  /** Everything paid. */
  | 'settled';

export type UthDecisionRecord = DecisionRecordOf<UthAction>;

export const UTH_SCENARIO_KEYS = {
  preflop: 'uth:preflop',
  flop: 'uth:flop',
  river: 'uth:river',
} as const;

/** How many community cards are face up in each phase. */
const REVEALED: Record<UthPhase, number> = {
  idle: 0,
  preflop: 0,
  flop: 3,
  river: 5,
  settled: 5,
};

const LEGAL: Partial<Record<UthPhase, UthAction[]>> = {
  preflop: ['raise4x', 'raise3x', 'check'],
  flop: ['raise2x', 'check'],
  river: ['raise1x', 'fold'],
};

/** The Play bet each raise makes, in units of the ante. */
const RAISE_SIZE: Partial<Record<UthAction, number>> = {
  raise4x: PREFLOP_RAISE,
  raise3x: PREFLOP_RAISE_SMALL,
  raise2x: FLOP_RAISE,
  raise1x: RIVER_RAISE,
};

/**
 * What each of the three bets did, kept apart rather than summed.
 *
 * The Ante, the Play and the Blind resolve by three different rules — the Ante
 * on whether the dealer qualified, the Play on who won, the Blind on the
 * player's own hand — and a single net figure hides all three. A player who
 * wins with a straight against a dealer who did not qualify sees `+2.0` and
 * learns nothing; three lines tell them why.
 */
export interface UthSettlement {
  dealerQualified: boolean;
  /** Net on the Ante: +1, 0 (pushed, or the dealer did not qualify), or -1. */
  ante: number;
  /** The Play bet's size, and what it returned. */
  playBet: number;
  play: number;
  /** Net on the Blind: the paytable multiple on a win, 0 on a push, -1 on a loss. */
  blind: number;
  /** True when the Blind pushed because the hand was below a straight. */
  blindPushed: boolean;
  /** The three added up, which is what the stack moves by. */
  net: number;
  folded: boolean;
}

export interface UthTableOptions {
  /** The blind paytable. Only `standard` is solved pre-flop; see `preflop-table.ts`. */
  paytable?: BlindPaytable;
  seed?: number;
  /**
   * Evaluations already solved, shared between tables (round 32).
   *
   * A shared Ultimate table is derived again from its log on every read, and
   * each derivation plays every seat of every hand through its own `UthTable`
   * — so without this, each read re-solved every flop the table had ever seen,
   * at ~60 ms apiece. An evaluation is a pure function of the hole cards and
   * the board the player can see, so one solved for those cards is the answer
   * for those cards on any table. This is a memo and nothing else: the figures
   * are the solver's, unchanged, and a table without one solves as it always has.
   */
  solved?: Map<string, UthEvaluation>;
}

export interface UthView {
  phase: UthPhase;
  hole: Card[];
  /** Empty until the hand is settled. */
  dealerHole: Card[];
  dealerRevealed: boolean;
  /** Only the community cards the player can see. */
  board: Card[];
  /** Units at risk: Ante + Blind, plus the Play bet once it is made. */
  ante: number;
  blind: number;
  playBet: number;
  legalActions: UthAction[];
  settlement: UthSettlement | null;
  netUnits: number | null;
}

/**
 * Everything the solvers said about one decision point.
 *
 * The EVs grade the decision; the rest is what the card's one sentence is made
 * of. Kept together so a sentence can never quote a figure from a different
 * solve than the grade it sits under.
 */
export interface UthEvaluation {
  phase: 'preflop' | 'flop' | 'river';
  evByAction: Partial<Record<UthAction, number>>;
  optimalAction: UthAction;
  /** Pre-flop: the class label the table was read for. */
  holeClass?: string;
  /** Pre-flop: how often a checked hand of this class raises the flop. */
  flopRaiseFrequency?: number;
  /** Pre-flop and flop: how often checking leads to folding the river. */
  riverFoldFrequency?: number;
  /** River: dealer holdings beaten, tied and lost to, out of 990. */
  wins?: number;
  ties?: number;
  losses?: number;
  /**
   * What the card's worked line is built from (round 19). Absent pre-flop,
   * where the EVs are a table lookup and nothing was counted to produce them.
   *
   * Every field is a count or a sum of units taken during the solve that was
   * already running, so the arithmetic the player is shown is the arithmetic
   * the grade came from rather than a second, similar calculation.
   */
  counts?: {
    /** Outcomes the player wins, ties and loses. */
    wins: number;
    ties: number;
    losses: number;
    /** Units won across the winning outcomes and lost across the losing ones. */
    winUnits: number;
    lossUnits: number;
    /** How many outcomes are behind them: 990 on the river, 1,070,190 on the flop. */
    outcomes: number;
    /** Flop only: turn-and-river boards, those the river is then bet on, and their total value. */
    boards?: number;
    checkPlayBoards?: number;
    checkPlayTotal?: number;
    /** Flop only: the check branch's own showdowns, counted like the raise branch's. */
    checkWins?: number;
    checkTies?: number;
    checkLosses?: number;
    checkWinUnits?: number;
    checkLossUnits?: number;
    /** What the check branch's counts are out of. Not the raise branch's figure. */
    checkOutcomes?: number;
    /*
     * Pre-flop only (round 20), from the offline table. The Ante and the Blind
     * across the winning endings and across all of them, which is what lets one
     * enumeration rebuild 4x and 3x alike; and the check branch's two groups —
     * the flops it raises on and the flops it checks again.
     */
    winSide?: number;
    side?: number;
    flops?: number;
    flopRaises?: number;
    flopRaiseValue?: number;
    flopCheckValue?: number;
  };
  /** How long the solve took, in milliseconds. Zero for a table lookup. */
  solveMs: number;
}

export interface UthHandRecord {
  id: number;
  paytable: BlindPaytable;
  /** Every card dealt, in dealing order, which is all a replay needs. */
  dealtCards: Card[];
  hole: Card[];
  dealerHole: Card[];
  board: Card[];
  holeClass: string;
  settlement: UthSettlement;
  netUnits: number;
  decisions: UthDecisionRecord[];
}

export class UthTable {
  readonly paytable: BlindPaytable;

  private readonly rng;
  private deck: Card[] = [];
  private phase: UthPhase = 'idle';
  private handId = 0;

  private hole: Card[] = [];
  private dealerHole: Card[] = [];
  private board: Card[] = [];
  private dealtCards: Card[] = [];

  private playBet = 0;
  private folded = false;
  /**
   * How much of the board a folded hand shows.
   *
   * A fold ends the hand with the cards where they were. Turning the rest over
   * afterwards would show the player the hand they just gave up — exactly the
   * information §3.1 keeps away from a decision, arriving a second too late to
   * be anything but a reproach.
   */
  private foldedAt: number | null = null;
  private settlement: UthSettlement | null = null;
  private decisions: UthDecisionRecord[] = [];
  /** Cards to deal first on the next hand, for tests and drills. */
  private stacked: Card[] | null = null;
  /**
   * The current decision point's evaluation, once computed.
   *
   * The flop solve is ~80 ms in a browser tab. Computed at the moment of the
   * click, that is a freeze between the player's decision and the card that
   * grades it — the worst moment to have one. Cached, it can be computed while
   * the flop is still being turned over (see `evaluate()`), and the click then
   * costs nothing.
   */
  private evaluation: UthEvaluation | null = null;

  /** See `UthTableOptions.solved`. */
  private readonly solved: Map<string, UthEvaluation> | null;

  constructor(options: UthTableOptions = {}) {
    this.paytable = options.paytable ?? DEFAULT_BLIND_PAYTABLE;
    this.rng = makeRng(options.seed ?? Date.now() % 2147483647);
    this.solved = options.solved ?? null;
  }

  // --- Reading the table ---------------------------------------------------

  get view(): UthView {
    return {
      phase: this.phase,
      hole: [...this.hole],
      // The dealer's cards stay down until there is nothing left to decide.
      dealerHole: this.phase === 'settled' && !this.folded ? [...this.dealerHole] : [],
      dealerRevealed: this.phase === 'settled' && !this.folded,
      board: this.board.slice(0, this.foldedAt ?? REVEALED[this.phase]),
      ante: this.phase === 'idle' ? 0 : 1,
      blind: this.phase === 'idle' ? 0 : 1,
      playBet: this.playBet,
      legalActions: LEGAL[this.phase] ?? [],
      settlement: this.settlement,
      netUnits: this.settlement?.net ?? null,
    };
  }

  get handRecord(): UthHandRecord {
    if (this.phase !== 'settled' || !this.settlement) {
      throw new Error('The hand is not finished');
    }
    return {
      id: this.handId,
      paytable: this.paytable,
      dealtCards: [...this.dealtCards],
      hole: [...this.hole],
      dealerHole: [...this.dealerHole],
      board: [...this.board],
      holeClass: holeClassLabel(this.hole[0]!, this.hole[1]!),
      settlement: this.settlement,
      netUnits: this.settlement.net,
      decisions: [...this.decisions],
    };
  }

  /** The class the pre-flop decision is graded against. */
  get holeClass(): string {
    if (this.hole.length !== 2) throw new Error('No hand in progress');
    return holeClassLabel(this.hole[0]!, this.hole[1]!);
  }

  // --- Playing a hand ------------------------------------------------------

  /**
   * Shuffle and deal. Ante and Blind are posted here: they are mandatory, so
   * there is no decision to make about them and no point pretending otherwise.
   */
  startHand(): void {
    if (this.phase !== 'idle' && this.phase !== 'settled') {
      throw new Error('A hand is already in progress');
    }
    this.handId++;
    this.deck = fullDeck();
    shuffleInPlace(this.deck, this.rng);
    if (this.stacked) {
      // The named cards move to the front in the order given; everything else
      // keeps its shuffled order, so the rest of the deal stays honest.
      const wanted = this.stacked;
      this.deck = [...wanted, ...this.deck.filter((card) => !wanted.includes(card))];
      this.stacked = null;
    }

    this.hole = [this.deck[0]!, this.deck[1]!];
    this.dealerHole = [this.deck[2]!, this.deck[3]!];
    this.board = this.deck.slice(4, 9);
    this.dealtCards = this.deck.slice(0, 9);

    this.playBet = 0;
    this.folded = false;
    this.foldedAt = null;
    this.settlement = null;
    this.decisions = [];
    this.evaluation = null;
    this.phase = 'preflop';
  }

  /**
   * Force the next hand's cards, in dealing order: player, player, dealer,
   * dealer, then the five community cards. Fewer than nine is fine; the rest
   * come from the shuffle.
   *
   * The Blackjack shoe has the same facility for the same reason (spec §8):
   * waiting for a dealer who fails to qualify against a player straight to turn
   * up on its own is no way to test a settlement rule, and no way to drill one.
   */
  stackNextHand(cards: readonly Card[]): void {
    if (cards.length > 9) throw new Error('A hand uses nine cards');
    if (new Set(cards).size !== cards.length) throw new Error('A card cannot be dealt twice');
    this.stacked = [...cards];
  }

  legalActions(): UthAction[] {
    return LEGAL[this.phase] ?? [];
  }

  /** Play one action, graded. Spec §5.2.4. */
  act(action: UthAction, timeToDecideMs: number | null = null): UthDecisionRecord {
    const legal = this.legalActions();
    if (legal.length === 0) throw new Error(`Nothing to decide while ${this.phase}`);
    if (!legal.includes(action)) {
      throw new Error(`${action} is not legal here; legal actions are ${legal.join(', ')}`);
    }

    const record = this.grade(action, legal, timeToDecideMs);
    this.decisions.push(record);

    if (action === 'fold') {
      this.folded = true;
      this.foldedAt = REVEALED[this.phase];
      this.settleFold();
      return record;
    }

    const raise = RAISE_SIZE[action];
    if (raise !== undefined) {
      this.playBet = raise;
      this.showdown();
      return record;
    }

    // A check: the next street, and nothing staked.
    this.phase = this.phase === 'preflop' ? 'flop' : 'river';
    this.evaluation = null;
    return record;
  }

  // --- Grading -------------------------------------------------------------

  /**
   * The EV of every legal action at this decision point.
   *
   * Pre-flop is a lookup because solving it live is 2.1 billion outcomes per
   * class; the flop and the river are solved here and now, exactly, for the
   * actual cards on the table. There is no chart-versus-shoe question in this
   * game: every grade is exact for what the player can see.
   *
   * Memoised per decision point, so a caller can compute it early — while the
   * flop is being revealed — and the grading click that follows is free.
   */
  evaluate(): UthEvaluation {
    const legal = this.legalActions();
    if (legal.length === 0) throw new Error(`Nothing to decide while ${this.phase}`);
    if (this.evaluation) return this.evaluation;
    /*
     * The key is everything the answer depends on: the paytable, the decision
     * point, the hole cards and the board as far as it is face up.
     */
    const key = this.solved
      ? `${JSON.stringify(this.paytable)}|${this.phase}|${this.hole.join(',')}|${this.board.slice(0, REVEALED[this.phase]).join(',')}`
      : '';
    const known = this.solved?.get(key);
    if (known) {
      this.evaluation = known;
      return known;
    }

    const started = now();
    let evaluation: Omit<UthEvaluation, 'optimalAction' | 'solveMs'>;
    if (this.phase === 'preflop') {
      const row = preflopRow(this.holeClass);
      /*
       * The counts the offline job took while it walked the 2,097,572,400
       * endings (round 20). A table solved before they existed carries none,
       * and then the card says less rather than estimating.
       */
      const outcomes = 2_118_760 * 990;
      const counted =
        row.wins === undefined || row.losses === undefined || row.winSide === undefined || row.side === undefined
          ? undefined
          : {
              wins: row.wins,
              losses: row.losses,
              ties: outcomes - row.wins - row.losses,
              // At 4x, which is the raise this decision point is about; `winSide`
              // and `side` ride along so 3x can be rebuilt from the same counts.
              winUnits: row.winSide + 4 * row.wins,
              lossUnits: row.side - row.winSide - 4 * row.losses,
              outcomes,
              winSide: row.winSide,
              side: row.side,
              flops: row.flops,
              flopRaises: row.flopRaises,
              flopRaiseValue: row.flopRaiseValue,
              flopCheckValue: row.flopCheckValue,
              /*
               * And the check branch's own endings (round 28), out of their own
               * scale — ten times the raise branch's, because a five-card board
               * is reached by ten different flops and the check line is not the
               * same line on each. The table stores the scale so nothing here
               * has to assume it.
               */
              checkWins: row.checkWins,
              checkTies: row.checkTies,
              checkLosses: row.checkLosses,
              checkWinUnits: row.checkWinUnits,
              checkLossUnits: row.checkLossUnits,
              checkOutcomes: row.checkOutcomes,
            };
      evaluation = {
        phase: 'preflop',
        evByAction: { raise4x: row.ev4x, raise3x: row.ev3x, check: row.evCheck },
        holeClass: row.label,
        flopRaiseFrequency: row.flopRaiseFrequency,
        riverFoldFrequency: row.riverFoldFrequency,
        ...(counted ? { counts: counted } : {}),
      };
    } else if (this.phase === 'flop') {
      const solved = solveFlop(this.hole, this.board.slice(0, 3), this.paytable);
      evaluation = {
        phase: 'flop',
        evByAction: { raise2x: solved.evPlay, check: solved.evCheck },
        riverFoldFrequency: solved.riverFoldFrequency,
        counts: {
          wins: solved.wins,
          ties: solved.ties,
          losses: solved.losses,
          winUnits: solved.winUnits,
          lossUnits: solved.lossUnits,
          outcomes: solved.outcomes,
          boards: solved.boards,
          checkPlayBoards: solved.checkPlayBoards,
          checkPlayTotal: solved.checkPlayTotal,
          checkWins: solved.checkWins,
          checkTies: solved.checkTies,
          checkLosses: solved.checkLosses,
          checkWinUnits: solved.checkWinUnits,
          checkLossUnits: solved.checkLossUnits,
        },
      };
    } else {
      const solved = solveRiver(this.hole, this.board, this.paytable);
      evaluation = {
        phase: 'river',
        evByAction: { raise1x: solved.evPlay, fold: solved.evFold },
        wins: solved.wins,
        ties: solved.ties,
        losses: solved.losses,
        counts: {
          wins: solved.wins,
          ties: solved.ties,
          losses: solved.losses,
          winUnits: solved.winUnits,
          lossUnits: solved.lossUnits,
          outcomes: solved.wins + solved.ties + solved.losses,
        },
      };
    }
    const solveMs = this.phase === 'preflop' ? 0 : now() - started;

    let optimalAction = legal[0]!;
    let optimalEv = -Infinity;
    for (const candidate of legal) {
      const ev = evaluation.evByAction[candidate];
      if (ev === undefined) throw new Error(`${candidate} is legal but has no EV`);
      if (ev > optimalEv) {
        optimalEv = ev;
        optimalAction = candidate;
      }
    }
    this.evaluation = { ...evaluation, optimalAction, solveMs };
    this.solved?.set(key, this.evaluation);
    return this.evaluation;
  }

  private grade(
    action: UthAction,
    legal: UthAction[],
    timeToDecideMs: number | null,
  ): UthDecisionRecord {
    const { evByAction, optimalAction } = this.evaluate();
    const best = evByAction[optimalAction]!;
    const chosen = evByAction[action]!;
    // Never negative: the best action is the best by construction, and floating
    // point is not entitled to say otherwise.
    const evCost = Math.max(0, best - chosen);

    return {
      sequenceIndex: this.decisions.length,
      handIndex: 0,
      scenarioKey: UTH_SCENARIO_KEYS[this.phase as 'preflop' | 'flop' | 'river'],
      legalActions: [...legal],
      evByAction,
      optimalAction,
      chosenAction: action,
      evCost,
      severityTier: severityForCost(evCost),
      timeToDecideMs,
    };
  }

  // --- Resolving -----------------------------------------------------------

  private settleFold(): void {
    this.settlement = {
      dealerQualified: false,
      ante: -1,
      playBet: 0,
      play: 0,
      blind: -1,
      blindPushed: false,
      net: FOLD_RESULT,
      folded: true,
    };
    this.phase = 'settled';
  }

  /**
   * Pay the hand out, and check the three lines against `settle()`.
   *
   * The breakdown exists because one net figure teaches nothing: the Ante, the
   * Play and the Blind resolve by three unrelated rules and a player needs to
   * see which one did what. But re-deriving the three here is exactly how a
   * second, quietly different settlement rule gets written, so `settle()` stays
   * the authority and the parts are required to add up to it. A mismatch is a
   * bug in this file and throws rather than paying out.
   */
  private showdown(): void {
    const playerScore = evaluate7([...this.hole, ...this.board]);
    const dealerScore = evaluate7([...this.dealerHole, ...this.board]);
    const qualified = dealerQualifies(dealerScore);
    const tie = playerScore === dealerScore;
    const won = playerScore > dealerScore;

    const blindMultiple = blindPayout(playerScore, this.paytable);
    const settlement: UthSettlement = {
      dealerQualified: qualified,
      ante: tie ? 0 : !qualified ? 0 : won ? 1 : -1,
      playBet: this.playBet,
      play: tie ? 0 : won ? this.playBet : -this.playBet,
      blind: tie ? 0 : won ? blindMultiple : -1,
      blindPushed: !tie && won && blindMultiple === 0,
      net: 0,
      folded: false,
    };
    settlement.net = settlement.ante + settlement.play + settlement.blind;

    const authority = settle(playerScore, dealerScore, this.playBet, this.paytable);
    if (Math.abs(settlement.net - authority) > 1e-9) {
      throw new Error(
        `Settlement breakdown does not match settle(): ${settlement.net} vs ${authority}`,
      );
    }

    this.settlement = settlement;
    this.phase = 'settled';
  }
}

