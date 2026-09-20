/**
 * The session controller (spec §12), in the small.
 *
 * Owns one table, tracks the statistics §9.2 asks for, and shapes everything the
 * client draws. Two of its choices are pedagogical rather than technical:
 *
 *   - Session stats lead with EV accuracy, never win/loss. §3.1 is explicit that
 *     confusing "I won" with "I played well" is the central learning failure, so
 *     units won is tracked but deliberately not surfaced first.
 *   - The grade is produced the moment the decision is made, before the hand
 *     resolves, so feedback can never be coloured by an outcome the player has
 *     already seen.
 */

import {
  ACE,
  formatCard,
  getPreset,
  houseEdge,
  bjRankOfCard,
  parseScenarioKey,
  scenarioKeyForHand,
  RULE_PRESETS,
  RANK_VALUE,
  rankOf,
  suitOf,
  severityForCost,
  type BlackjackAction,
  type BlackjackPayout,
  type BlackjackRules,
  type Scenario,
  type SeverityTier,
} from '@evtrainer/ev-engine';
import { BlackjackTable, type DecisionRecord } from '@evtrainer/game-engine';

import {
  actionName,
  bustOnNextCard,
  dealerOdds,
  dealerOutcomes,
  explain,
  INSURANCE_STAKE,
  insuranceOdds,
  standOutcome,
} from './explain.ts';
import { returned } from './returns.ts';
import { applyRestrictions, type Restrictions } from './restrictions.ts';
import { returnsBlock, stakeFor } from './returns-block.ts';
import {
  difficultyTable,
  type ScenarioDifficulty,
  newRating,
  updateRatingWithReach,
  type DifficultyMode,
  type Rating,
} from './difficulty.ts';
import { chartFor, ruleSensitivity, type SensitivityNote } from './sensitivity.ts';
import {
  gestureForDecision,
  gestureForSettlement,
  masteryState,
  sittingSummary,
  type Gesture,
} from './gestures.ts';
import { t, type Locale } from './i18n.ts';
import { TRACK_HANDS, trackDot, type TrackRow } from './track.ts';
import {
  TABLE_LIMITS,
  applyBet,
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

export { applyRestrictions, type Restrictions } from './restrictions.ts';

const RANKS = '23456789TJQKA';
const SUITS = 'cdhs';
const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'];

export interface CardView {
  rank: string;
  suit: string;
  /** Clubs and spades are dark, hearts and diamonds red. */
  red: boolean;
  /** Screen-reader label; §13 requires ranks legible without colour. */
  label: string;
}

function cardView(card: number): CardView {
  const rank = RANKS[rankOf(card)]!;
  const suit = suitOf(card);
  const suitName = ['clubs', 'diamonds', 'hearts', 'spades'][suit]!;
  const rankName =
    { T: 'ten', J: 'jack', Q: 'queen', K: 'king', A: 'ace' }[rank] ?? rank;
  return {
    rank: rank === 'T' ? '10' : rank,
    suit: SUIT_SYMBOLS[suit]!,
    red: suit === 1 || suit === 2,
    label: `${rankName} of ${suitName}`,
  };
}

/** One finished hand, kept so it can be reviewed rather than only counted. */
export interface PlayedHand {
  id: number;
  /** Cards as dealt, which is all Replay mode (§8) needs to reconstruct it. */
  dealtCards: number[];
  playerHands: CardView[][];
  dealerCards: CardView[];
  netUnits: number;
  insuranceTaken: boolean;
  /** Chips per unit the hand was dealt at. Absent on hands saved before round 6b, which were 1. */
  bet?: number;
  decisions: Array<{
    scenarioKey: string;
    headline: string;
    chosen: string;
    optimal: string;
    /**
     * The actions as ids, so the log can word the decision again in whatever
     * language is on screen (round 9). Absent on hands saved before, whose
     * labels are matched back to ids instead.
     */
    chosenAction?: string;
    optimalAction?: string;
    correct: boolean;
    evCost: number;
    severity: SeverityTier;
    closeCall: boolean;
    /** Null off the 311-cell grid, and on records saved before this existed. */
    spot?: SpotDescription | null;
    steps: string[];
    ranked: Array<{ action: string; ev: number }>;
  }>;
}

/**
 * Per-scenario history (spec §11, ScenarioStat).
 *
 * The mastery grid, weakness detection and any adaptive difficulty all need
 * this and none of them can exist without it, which is why it is kept from the
 * start even though nothing reads it yet.
 */
/**
 * A saved session, as `progress` produces it and `restore` consumes it.
 *
 * Version 2 keeps one rating per mode rather than one rating. Version 1 blobs
 * are still out there — in browsers and in the shared table — and still restore,
 * with their single rating loaded into the mode it was earned in.
 */
export interface SessionProgressV2 {
  version: 2;
  name: string | null;
  hands: number;
  decisions: number;
  /** Never reset by a rule change or a mode change. See `lifetimeDecisions`. */
  lifetimeDecisions: number;
  correct: number;
  evLost: number;
  netUnits: number;
  closeCalls: number;
  closeCallsCorrect: number;
  bySeverity: Record<SeverityTier, number>;
  mode: DifficultyMode;
  ratings: Record<DifficultyMode, Rating>;
  scenarioStats: ScenarioStat[];
  history: PlayedHand[];
}

/** The shape before ratings were kept per mode. Read, never written. */
export interface SessionProgressV1 {
  version: 1;
  name: string | null;
  hands: number;
  decisions: number;
  correct: number;
  evLost: number;
  netUnits: number;
  closeCalls: number;
  closeCallsCorrect: number;
  bySeverity: Record<SeverityTier, number>;
  rating: Rating;
  scenarioStats: ScenarioStat[];
  history: PlayedHand[];
}

/**
 * Version 3: version 2, plus room for Ultimate Texas Hold'em.
 *
 * The Blackjack fields are exactly version 2's. `uth` belongs to `UthSession`,
 * which reads and writes it; this class never looks inside it and never needs
 * to, which is what keeps a UTH hand from reaching the Blackjack rating by any
 * route. The shell composes the two into the one blob a player's row holds.
 *
 * No database change: `progress` is a single JSON column. A version 2 blob read
 * here loads with no `uth`, and `UthSession` starts that part at zero.
 */
export interface SessionProgressV3 extends Omit<SessionProgressV2, 'version'> {
  version: 3;
  uth?: unknown;
}

/**
 * Version 4: version 3, plus the chips (round 6b).
 *
 * The stack, the bet ready for the next hand, the last bet dealt, and the table
 * limits it was built under. Everything graded stays in units exactly as in
 * version 3; a version 3 save opens at a bet of 1 with the stack it last showed.
 */
export interface SessionProgressV4 extends Omit<SessionProgressV3, 'version'> {
  version: 4;
  chips: { stack: number; bet: number; lastBet: number; limits: { min: number; max: number } };
}

/**
 * Version 5: version 4, plus the one thing the gestures keep (round 20).
 *
 * The best run of correct decisions this player has ever had. Not the live run —
 * a run that survives closing the tab is a chain, and §16 says the app does not
 * hand anybody a chain. A record is a thing that already happened.
 *
 * No database change: `progress` is a single JSON column, and a version 4 blob
 * read here opens with no record and sets one the first time a run beats five.
 * Two devices merge it the way the counters merge — by the larger of the two,
 * which is the only correct rule for a record.
 */
export interface SessionProgressV5 extends Omit<SessionProgressV4, 'version'> {
  version: 5;
  records?: { streakBest: number };
}

export type SessionProgress =
  | SessionProgressV5
  | SessionProgressV4
  | SessionProgressV3
  | SessionProgressV2
  | SessionProgressV1;

export interface ScenarioStat {
  scenarioKey: string;
  attempts: number;
  correct: number;
  consecutiveCorrect: number;
  evCostTotal: number;
  /** What was played when it was wrong — the basis for "you keep standing on 12". */
  confusion: Record<string, number>;
  lastAttemptAt: number;
}

/**
 * How hard the spot was, for the player who just played it.
 *
 * Numbers and an untranslated band name, never prose: the feedback card is
 * rebuilt in the new language when the player switches, and anything already
 * phrased would survive that untouched and be left in the old one.
 */
export interface SpotDescription {
  /** The mode this difficulty is measured on — the ladders differ. */
  mode: DifficultyMode;
  /** 800 to 2200, on the same scale as the player's own rating. */
  rating: number;
  band: SpotBand;
  /** Roughly one hand in this many, so "hard" is paired with "and rare". */
  oneIn: number;
  /** Above the player's own rating by a clear margin, once they have one. */
  aboveYou: boolean;
  /** Whether it counts toward the hard tally of a streak. */
  hard: boolean;
}

export type SpotBand = 'routine' | 'ordinary' | 'tricky' | 'brutal';

/**
 * Absolute thresholds, not relative to the player.
 *
 * A band has to mean the same thing to everyone. Scaling it to the player would
 * relabel easy cells as hard for a weak player, which flatters them and makes
 * the tag worthless the moment they compare notes with anybody. The relative
 * fact is carried separately by `aboveYou`.
 */
export function bandFor(rating: number): SpotBand {
  if (rating >= 1700) return 'brutal';
  if (rating >= 1500) return 'tricky';
  if (rating >= 1300) return 'ordinary';
  return 'routine';
}

export const STREAK_MILESTONES: readonly number[] = [10, 25, 50, 100];

/** Every ladder a player can climb. One rating each, kept for the session. */
export const RATING_MODES: readonly DifficultyMode[] = ['basic', 'recall', 'value'];

/**
 * The run of correct decisions.
 *
 * Close calls are invisible to it in both directions — the same exclusion the
 * accuracy denominator makes (§9.2). Pure, so every combination can be checked
 * without dealing a card.
 */
export function advanceStreak(
  current: number,
  outcome: { correct: boolean; closeCall: boolean },
): number {
  if (outcome.closeCall) return current;
  return outcome.correct ? current + 1 : 0;
}

/** Two significant figures, so a rounded number reads as one. */
function roundish(value: number): number {
  if (value < 10) return Math.max(1, Math.round(value));
  const scale = 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.round(value / scale) * scale;
}

function describeSpot(cell: ScenarioDifficulty, rating: Rating): SpotDescription {
  const difficulty = cell[rating.mode];
  const band = bandFor(difficulty);
  return {
    mode: rating.mode,
    rating: Math.round(difficulty),
    band,
    // Rounded to two figures, because the sentence says "about". "One hand in
    // 1,135" claims a precision the word in front of it disclaims.
    oneIn: roundish(1000 / Math.max(cell.perThousand, 0.01)),
    aboveYou: !rating.provisional && difficulty >= rating.rating + 100,
    hard: band === 'tricky' || band === 'brutal',
  };
}

export interface SessionStats {
  hands: number;
  decisions: number;
  correct: number;
  /**
   * Decision accuracy, the number §9.2 leads with — measured over decisions
   * where the top two actions differ by more than a hundredth of a unit.
   */
  accuracy: number;
  /** Decisions left out of that denominator because they were coin-flips. */
  closeCallsExcluded: number;
  /** Accuracy counting everything, for anyone who wants the harsher number. */
  accuracyIncludingCloseCalls: number;
  evLost: number;
  evLostPer100: number;
  bySeverity: Record<SeverityTier, number>;
  /** Optimal house edge plus the player's own leak, as one number (§9.2). */
  effectiveHouseEdgePercent: number;
  /** Tracked, but deliberately not the headline (§3.1). */
  netUnits: number;
}

export class TrainerSession {
  private table: BlackjackTable;
  private rules: BlackjackRules;
  private presetId: string;
  private baseEdgePercent: number;

  private hands = 0;
  private decisions = 0;
  private correct = 0;
  private evLost = 0;
  private netUnits = 0;
  private closeCalls = 0;
  private closeCallsCorrect = 0;
  /*
   * The current run of correct decisions, and the best of this session.
   *
   * Deliberately absent from `progress`, from storage and from the shared
   * table. A run that survives closing the tab stops being an observation and
   * becomes a chain you must not break, which is the compulsion §16 exists to
   * keep out. Best-of-session is a fact about the last twenty minutes;
   * best-of-all-time is a leash.
   */
  private streak = 0;
  private streakBest = 0;
  /*
   * The streak's record, and the only thing the gestures keep (round 20).
   *
   * The *run* is deliberately not saved: a run that survives closing the tab is
   * a chain a player must not break, which is the §16 failure. A record is the
   * opposite — it has already happened, and nothing done with a browser tab can
   * take it away. So the record is saved and the run is not.
   */
  private streakRecord = 0;
  /** Whether this run has already been announced as a record. */
  private recordAnnounced = false;
  /** What this sitting has shown, and whether this hand has had one. */
  private gesturesShown = 0;
  private gestureThisHand = false;
  private rightAndLostShown = false;
  /** The gesture the settlement earned, if any. */
  private settlementGesture: Gesture | null = null;
  /** This sitting, for the line that ends it. Not saved: a sitting is a sitting. */
  private sittingDecisions = 0;
  private sittingMistakes = 0;
  /*
   * And this sitting's spots, separately from the lifetime ones.
   *
   * The sentence says "this sitting: 11 decisions, 3 of them wrong" and then
   * names the spot that cost the most. Taking that spot's count from the
   * lifetime record produced "3 wrong … 5 times" on one line — two numbers in
   * the same sentence measuring different spans, which is the contradiction
   * every figure in this app is supposed to avoid. So the sitting has its own
   * tally, and it is thrown away with the sitting.
   */
  private sittingSpots = new Map<string, { attempts: number; correct: number; evCostTotal: number }>();
  private streakHard = 0;
  private streakMilestone: number | null = null;
  private bySeverity: Record<SeverityTier, number> = {
    optimal: 0,
    negligible: 0,
    minor: 0,
    significant: 0,
    blunder: 0,
  };
  /* Null until the player types one. The screen fills in a placeholder in
     whatever language it is showing, which a fixed 'Player' here could not. */
  private playerName: string | null = null;
  /* The language every generated sentence is composed in. It lives on the
     session rather than on each request because the dealer's prose and the
     feedback card have to agree — a Hebrew explanation under an English
     headline would read as a bug, not a mixture. */
  private locale: Locale = 'en';
  private lastFeedback: unknown = null;
  /* The decision the card on screen describes. Kept because the card is
     *composed*, not stored: switching language has to build it again from the
     same numbers, or the player is left reading two languages at once. */
  private lastRecord: DecisionRecord | null = null;
  private countedHand = -1;
  /** Finished hands, newest first. */
  private history: PlayedHand[] = [];
  /** Decisions of the hand in progress, moved into `history` when it settles. */
  private pending: PlayedHand['decisions'] = [];
  private scenarioStats = new Map<string, ScenarioStat>();
  private clock = 0;
  /*
   * One rating per mode, and which one is in play.
   *
   * Each mode is its own ladder — a number earned against the costly hands
   * means something different from one earned against the rare ones — but
   * "its own ladder" has to mean the session keeps all three, not that it
   * discards the old one on the way past. `docs/elo-difficulty.md` specified
   * ratings keyed by (player, mode) from the start; this is the code catching
   * up with it.
   */
  private ratings: Record<DifficultyMode, Rating> = {
    basic: newRating('basic'),
    recall: newRating('recall'),
    value: newRating('value'),
  };
  private mode: DifficultyMode = 'basic';
  private lastRatingDelta: number | null = null;
  /*
   * Decisions graded over the life of this player, across every mode and every
   * rule set. Unlike `decisions`, nothing resets it — which is what makes it
   * safe to use when deciding which of two saved copies is further along.
   */
  private lifetimeDecisions = 0;
  /*
   * The chips (round 6b): the stack, the bet being built, the last bet dealt.
   * Only ever a multiplier on units — nothing graded reads it.
   */
  private chips: ChipBook = newChipBook();
  /** Chips per unit of the hand on the felt, fixed when it is dealt. */
  private handBet = 1;

  /**
   * Two house restrictions the player can switch on over any preset.
   *
   * They are rules, not display filters: they go into the rule set the solver
   * memoises on, so the chart is re-derived, the house edge is recomputed, and
   * every recursive sub-decision inside a split or a double is answered under
   * the same restriction. Hiding a button would have graded the player against
   * a game nobody was playing.
   */
  private restrictions: Restrictions = { noSurrender: false, likeRanksOnly: false };

  constructor(
    presetId = 'vegas-strip-6d-s17',
    seed = Date.now() % 2147483647,
    restrictions: Restrictions = { noSurrender: false, likeRanksOnly: false },
  ) {
    this.presetId = presetId;
    this.restrictions = restrictions;
    this.rules = applyRestrictions(getPreset(presetId).rules, restrictions);
    this.baseEdgePercent = houseEdge(this.rules).percent;
    chartFor(this.rules); // derive once, up front, so the first decision is not slow
    this.table = new BlackjackTable({ rules: this.rules, seed, grading: 'chart' });
  }

  get ruleSet(): {
    id: string;
    name: string;
    badge: string;
    note: string | null;
    edgePercent: number;
    blackjackPayout: BlackjackPayout;
    restrictions: Restrictions;
  } {
    const preset = RULE_PRESETS.find((p) => p.id === this.presetId)!;
    const rules = this.rules;
    // Worded in the language on screen (round 11): the Hebrew sweep found the
    // rules bar reading "Vegas Strip 6-deck S17 · late surrender" inside Hebrew.
    // The rule codes — 6D, S17, H17, DAS, 3:2 — stay codes in both languages.
    const L = this.locale;
    const badge = [
      `${rules.decks}D`,
      rules.soft17,
      rules.das ? 'DAS' : t(L, 'badge.noDas'),
      t(L, `badge.surrender.${rules.surrender}`),
      rules.splitUnlikeTens ? '' : t(L, 'badge.likeRanks'),
      rules.blackjackPayout,
      rules.peek ? '' : t(L, 'badge.noHoleCard'),
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      id: preset.id,
      name: t(L, `preset.${preset.id}`),
      badge,
      note: preset.note ? t(L, `preset.${preset.id}.note`) : null,
      edgePercent: this.baseEdgePercent,
      // What a natural actually pays, for the one line on screen that quotes it.
      blackjackPayout: rules.blackjackPayout,
      restrictions: this.restrictions,
    };
  }

  deal(): void {
    /*
     * The table limits and the free rebuy are held here, not only on the rail.
     * The hand is still dealt at one unit: the engine and every grade stay in
     * units, and the bet only says how many chips a unit is.
     */
    if (needsRebuy(this.chips)) throw new Error('The stack is below the table minimum: take the free rebuy first');
    if (!validBet(this.chips.bet)) throw new Error(`A bet is between ${TABLE_LIMITS.min} and ${TABLE_LIMITS.max}`);
    this.table.startHand(1);
    this.handBet = this.chips.bet;
    this.chips = { ...this.chips, lastBet: this.chips.bet };
    this.lastFeedback = null;
    this.lastRatingDelta = null;
    // A milestone belongs to the decision that reached it, not to the run.
    this.streakMilestone = null;
    // And a gesture belongs to the hand that earned it: one a hand, at most.
    this.gestureThisHand = false;
    this.settlementGesture = null;
    this.pending = [];
    this.settleIfDone();
  }

  act(action: BlackjackAction): unknown {
    this.counterFavoured = false;
    const record = this.table.act(action);
    this.absorb(record);
    this.settleIfDone();
    return this.lastFeedback;
  }

  insurance(take: boolean): unknown {
    /*
     * What the shoe actually held, read before the decision closes the phase.
     *
     * It never touches the grade, the cost or the rating — those come from the
     * chart, because the chart is what the app teaches. It exists so that the
     * one hand in a few hundred where the count really did call for insurance
     * is not silently contradicted: a player who has read anything about
     * counting deserves to be told that this was that hand, rather than left to
     * conclude the app does not know.
     */
    this.counterFavoured = this.table.insuranceLiveEv() > 0;
    const record = this.table.takeInsurance(take);
    this.absorb(record);
    this.settleIfDone();
    return this.lastFeedback;
  }

  /**
   * The gap below which a decision is treated as a coin-flip.
   *
   * Two actions this close are within the noise of what basic strategy even
   * claims, and counting a miss on one as a full error makes a player who nails
   * every expensive decision look worse than one who gets the trivia right —
   * backwards for a trainer. They are excluded from the accuracy denominator
   * only: they still count toward mastery, the drill queue and the rating, since
   * those are exactly the cells a serious player most wants to own.
   */
  private static readonly CLOSE_CALL = 0.01;

  /**
   * What the player sits down with, in units of the base bet.
   *
   * The engine reasons in units of the wager and always will — that is what
   * makes an EV comparable between a one-chip hand and a doubled one. The stack
   * is the same number given a rail to sit on, so a hand feels like a hand
   * rather than an exercise. Two hundred is chosen so an ordinary bad run moves
   * it visibly without emptying it, which is the only thing the figure has to do.
   */
  private static readonly STARTING_STACK = 200;

  /**
   * Whether the live shoe favoured insurance on the decision just taken. Text
   * only — see `insurance()`.
   */
  private counterFavoured = false;

  /** Turn one graded decision into the feedback card §7.1 describes. */
  private absorb(record: DecisionRecord): void {
    this.lastRecord = record;
    const scenario =
      record.scenarioKey === 'bj:insurance'
        ? ({ kind: 'insurance' } as const)
        : parseScenarioKey(record.scenarioKey);

    // The explanation layer needs the whole EV vector, not just the winner: the
    // statistic it quotes has to speak to the contest between the top two
    // actions, and it cannot find the runner-up without them.
    const evaluation = {
      legalActions: record.legalActions as BlackjackAction[],
      evByAction: record.evByAction as Partial<Record<BlackjackAction, number>>,
      optimalAction: record.optimalAction as BlackjackAction,
      optimalEv: record.evByAction[record.optimalAction] ?? 0,
    };

    const explanation = explain(
      scenario,
      evaluation,
      this.rules,
      this.locale,
      record.chosenAction as BlackjackAction,
    );
    const closeCall = explanation.gap < TrainerSession.CLOSE_CALL;
    const correct = record.evCost === 0;

    /*
     * How hard this spot is, looked up once and used three times.
     *
     * It has to come before the counters because the streak wants to know
     * whether the run included any hard hands, and before `updateRating`
     * because that mutates the rating this comparison reads. Off the 311-cell
     * grid — hard 18 through 21, which turn up constantly and are trivially
     * correct — there is no cell and nothing to rate.
     */
    const chart = chartFor(this.rules);
    const cell = difficultyTable(this.rules, chart).get(record.scenarioKey);
    const spot = cell === undefined ? null : describeSpot(cell, this.rating);

    this.decisions++;
    if (correct) this.correct++;
    this.evLost += record.evCost;
    this.bySeverity[record.severityTier]++;
    if (closeCall) {
      this.closeCalls++;
      if (correct) this.closeCallsCorrect++;
    }

    /*
     * The run of correct decisions.
     *
     * A close call neither extends it nor breaks it — the same exclusion the
     * accuracy denominator makes (§9.2), which lets the whole rule be stated in
     * one verifiable sentence: the accuracy numerator, run consecutively.
     * Breaking a thirty-run on a hand the accuracy panel says does not count
     * would be indefensible; letting one extend the run would grow it on
     * coin-flips, which is the free-points ratchet §16 forbids.
     */
    const before = this.streak;
    this.streak = advanceStreak(this.streak, { correct, closeCall });
    if (this.streak === 0) this.streakHard = 0;
    else if (this.streak > before && spot?.hard) this.streakHard++;
    this.streakBest = Math.max(this.streakBest, this.streak);
    this.streakMilestone =
      this.streak > before && STREAK_MILESTONES.includes(this.streak) ? this.streak : null;

    /*
     * What each action is worth, and what a player now reads for it.
     *
     * `ev` is the stored figure and stays exactly as it was: net of the stake,
     * in units of the wager. `value` is round 13's display scale — what one
     * unit already at risk comes back — and is never stored, never compared and
     * never written into a record. Both are carried so that the card can show
     * one while everything that grades, costs or rates reads the other.
     */
    const stake = stakeFor(record.scenarioKey);
    const ranked = record.legalActions
      .map((action) => ({
        action,
        label: prettyAction(action, this.locale),
        ev: record.evByAction[action] ?? 0,
        value: returned(record.evByAction[action] ?? 0, stake),
      }))
      .sort((a, b) => b.ev - a.ev);

    const sensitivity: SensitivityNote[] =
      scenario.kind === 'insurance'
        ? []
        : ruleSensitivity(record.scenarioKey, this.rules, evaluation.optimalAction);

    // Last, because it moves the rating every comparison above had to read.
    this.lifetimeDecisions++;
    this.lastRatingDelta = cell
      ? updateRatingWithReach(this.ratings[this.mode], cell[this.mode], record.severityTier)
      : null;

    this.pending.push({
      scenarioKey: record.scenarioKey,
      headline: explanation.headline,
      chosen: prettyAction(record.chosenAction, this.locale),
      optimal: prettyAction(record.optimalAction, this.locale),
      chosenAction: record.chosenAction,
      optimalAction: record.optimalAction,
      correct,
      evCost: record.evCost,
      severity: record.severityTier,
      closeCall,
      spot,
      steps: [...explanation.steps],
      ranked: ranked.map((r) => ({ action: r.action, ev: r.ev })),
    });

    const stat = this.scenarioStats.get(record.scenarioKey) ?? {
      scenarioKey: record.scenarioKey,
      attempts: 0,
      correct: 0,
      consecutiveCorrect: 0,
      evCostTotal: 0,
      confusion: {},
      lastAttemptAt: 0,
    };
    stat.attempts++;
    stat.evCostTotal += record.evCost;
    stat.lastAttemptAt = this.clock++;
    if (record.evCost === 0) {
      stat.correct++;
      stat.consecutiveCorrect++;
    } else {
      stat.consecutiveCorrect = 0;
      stat.confusion[record.chosenAction] = (stat.confusion[record.chosenAction] ?? 0) + 1;
    }
    this.scenarioStats.set(record.scenarioKey, stat);

    /*
     * The gesture, chosen from what has just been written and never writing any
     * of it (round 20). `gestures.ts` is handed a snapshot and hands back a
     * gesture or nothing; it cannot reach a grade, an EV or a rating, because it
     * imports nothing that has one.
     */
    this.sittingDecisions++;
    if (!correct) this.sittingMistakes++;
    const sittingSpot = this.sittingSpots.get(record.scenarioKey) ?? { attempts: 0, correct: 0, evCostTotal: 0 };
    sittingSpot.attempts++;
    if (correct) sittingSpot.correct++;
    sittingSpot.evCostTotal += record.evCost;
    this.sittingSpots.set(record.scenarioKey, sittingSpot);
    const gesture = gestureForDecision({
      correct,
      stat: { attempts: stat.attempts, correct: stat.correct, consecutiveCorrect: stat.consecutiveCorrect, confusion: { ...stat.confusion } },
      streak: { current: this.streak, record: this.streakRecord, announcedThisRun: this.recordAnnounced },
      shown: { sitting: this.gesturesShown, thisHand: this.gestureThisHand },
    });
    if (gesture) {
      this.gesturesShown++;
      this.gestureThisHand = true;
      if (gesture.kind === 'record') this.recordAnnounced = true;
    }
    // The record itself rises whether or not anything was said about it.
    if (this.streak > this.streakRecord) this.streakRecord = this.streak;
    if (this.streak === 0) this.recordAnnounced = false;

    this.lastFeedback = {
      scenarioKey: record.scenarioKey,
      gesture: this.wordGesture(gesture, record.scenarioKey),
      // Anchors every step of the reveal to what was actually decided, which
      // matters once a split has replaced the hand on the board with two others.
      headline: explanation.headline,
      steps: explanation.steps,
      gap: explanation.gap,
      closeCall,
      correct,
      severity: record.severityTier,
      // How hard the spot was, and the run it belongs to — both about the
      // decision, both known before a single card of the outcome is turned.
      spot,
      ratingDelta: this.lastRatingDelta,
      streak: { current: this.streak, best: this.streakBest, hard: this.streakHard },
      milestone: this.streakMilestone,
      chosen: record.chosenAction,
      chosenLabel: prettyAction(record.chosenAction, this.locale),
      optimal: record.optimalAction,
      optimalLabel: prettyAction(record.optimalAction, this.locale),
      optimalVerb:
        record.scenarioKey === 'bj:insurance'
          ? prettyAction(record.optimalAction, this.locale)
          : actionName(record.optimalAction as BlackjackAction, this.locale),
      evCost: record.evCost,
      counterNote: this.counterNote(record),
      ranked,
      returns: returnsBlock(scenario, ranked, stake, this.rules),
      /*
       * The Advanced breakdown's one piece of arithmetic that is not already on
       * the card (round 14): everything the dealer can end up with, from this
       * upcard, conditioned on the natural the peek has already ruled out.
       *
       * Computed at every level and for every hand, like everything else here.
       * A level decides what is drawn, never what is worked out — otherwise a
       * player who moves up a level would find a gap where his history was.
       */
      breakdown:
        scenario.kind === 'insurance' || scenario.upcard === undefined
          ? null
          : { dealer: dealerOutcomes(scenario.upcard, this.rules) },
      sensitivity,
    };
  }

  /** The card-counter remark, or nothing at all. Costs and rating never see it. */
  private counterNote(record: DecisionRecord): string | null {
    if (record.scenarioKey !== 'bj:insurance' || !this.counterFavoured) return null;
    return t(this.locale, 'insurance.counterNote');
  }

  /**
   * Fold a finished hand into the session totals exactly once — and keep it.
   *
   * This used to read `id` and `netUnits` off the record and throw the rest
   * away on the next deal, which is why there was no hand log, no mastery grid
   * and no way to build a rating. The record is complete and replayable; the
   * only thing that was missing was somewhere to put it.
   */
  private settleIfDone(): void {
    if (this.table.view.phase !== 'settled') return;
    const record = this.table.handRecord;
    if (record.id === this.countedHand) return;
    this.countedHand = record.id;
    this.hands++;
    this.netUnits += record.netUnits;
    // Exact, and allowed below zero: a hand that needed more than the stack
    // still played (round 6b, option B).
    this.chips = { ...this.chips, stack: roundChips(this.chips.stack + record.netUnits * this.handBet) };

    /*
     * And the one that can only fire on a hand that lost (round 20). It reads
     * the outcome on purpose: a won hand can never produce it, which is what
     * makes it the inverse of the rule the other three follow.
     */
    const allOptimal = this.pending.length > 0 && this.pending.every((d) => d.evCost === 0);
    this.settlementGesture = gestureForSettlement({
      net: record.netUnits,
      decisions: this.pending.length,
      allOptimal,
      shown: {
        sitting: this.gesturesShown,
        thisHand: this.gestureThisHand,
        rightAndLostThisSitting: this.rightAndLostShown,
      },
    });
    if (this.settlementGesture) {
      this.gesturesShown++;
      this.rightAndLostShown = true;
    }

    this.history.unshift({
      id: record.id,
      dealtCards: [...record.dealtCards],
      playerHands: record.playerCards.map((hand) => hand.map(cardView)),
      dealerCards: record.dealerCards.map(cardView),
      netUnits: record.netUnits,
      insuranceTaken: record.insuranceTaken,
      bet: this.handBet,
      decisions: this.pending,
    });
    this.pending = [];
  }

  /**
   * Build the bet between hands: add a chip, take the last one back, clear it,
   * repeat the last bet or double it. The table limits are enforced here.
   */
  placeBet(op: BetOp, chip?: number): void {
    const phase = this.table.view.phase;
    if (phase === 'player' || phase === 'insurance') throw new Error('The bet stays until the hand is over');
    this.chips = applyBet(this.chips, op, chip);
  }

  /** The free rebuy: only below the table minimum, always back to the starting stack. */
  rebuy(): void {
    const phase = this.table.view.phase;
    if (phase === 'player' || phase === 'insurance') throw new Error('Finish the hand first');
    this.chips = rebuyBook(this.chips);
  }

  get stats(): SessionStats {
    // Close calls leave the denominator with their outcomes, so a player is
    // neither rewarded nor punished for guessing them.
    const graded = this.decisions - this.closeCalls;
    const gradedCorrect = this.correct - this.closeCallsCorrect;
    const accuracy = graded === 0 ? 1 : gradedCorrect / graded;
    const evLostPer100 = this.hands === 0 ? 0 : (this.evLost / this.hands) * 100;
    return {
      hands: this.hands,
      decisions: this.decisions,
      correct: this.correct,
      accuracy,
      closeCallsExcluded: this.closeCalls,
      accuracyIncludingCloseCalls: this.decisions === 0 ? 1 : this.correct / this.decisions,
      evLost: this.evLost,
      evLostPer100,
      bySeverity: { ...this.bySeverity },
      // Spec §9.2: what the game costs plus what the player costs themselves,
      // expressed as the single number that actually applies to them.
      effectiveHouseEdgePercent:
        this.baseEdgePercent + (this.hands === 0 ? 0 : (this.evLost / this.hands) * 100),
      netUnits: this.netUnits,
    };
  }

  /** Everything the client needs to draw the table. */
  get view(): unknown {
    const view = this.table.view;
    const settled = view.phase === 'settled';
    return {
      phase: view.phase,
      hands: view.hands.map((hand, index) => ({
        cards: hand.cards.map(cardView),
        total: totalOf(hand.cards),
        /*
         * What the hand was before it drew (round 17).
         *
         * Idan's question at showdown is "what did I win with — especially if I
         * hit", and the answer reads better as a path than as an endpoint: 12 →
         * 20 says the draw worked. It is the same arithmetic as `total`, over
         * the two cards the hand was dealt, so the header can never disagree
         * with the grade about what this hand is worth.
         */
        startTotal: hand.cards.length > 2 ? totalOf(hand.cards.slice(0, 2)) : null,
        // In chips at the bet; `units` is what the engine staked.
        bet: roundChips(hand.bet * this.handBet),
        units: hand.bet,
        doubled: hand.doubled,
        surrendered: hand.surrendered,
        finished: hand.finished,
        net: hand.net === null ? null : roundChips(hand.net * this.handBet),
        active: !settled && index === view.activeHandIndex,
      })),
      dealer: {
        cards: view.dealerVisible.map(cardView),
        hidden: !view.dealerRevealed,
        total: view.dealerRevealed ? totalOf(view.dealerVisible) : null,
        // The dealer only plays out when a hand is still live. Showing a bare
        // "DEALER · 12" after the player busts reads as "I would have won by
        // standing", when in fact a twelve is forced to draw and reaches 17 or
        // better most of the time. Say so rather than letting the total imply it.
        didNotDraw:
          settled &&
          view.hands.every(
            (hand) => hand.surrendered || totalOf(hand.cards) > 21,
          ),
      },
      legalActions: view.legalActions,
      insuranceOffered: view.phase === 'insurance',
      netUnits: view.netUnits,
      stack: {
        start: TrainerSession.STARTING_STACK,
        // Settled hands only, in chips. A wager still on the felt has not been
        // lost yet, and showing it as though it had would misreport the one
        // figure on screen that is supposed to be simple arithmetic. It can be
        // below zero after a hand that needed more than the stack held.
        balance: this.chips.stack,
        // Swept the moment the hand settles, because by then it has already
        // moved into the balance — leaving it on the felt would show the same
        // chips in two places and make the arithmetic look wrong.
        wager: settled
          ? 0
          : roundChips(
              (view.hands.reduce((total, hand) => total + hand.bet, 0) + (view.insuranceTaken ? 0.5 : 0)) *
                this.handBet,
            ),
        lastNet: view.netUnits === null ? null : roundChips(view.netUnits * this.handBet),
      },
      // The rail between hands: the bet, the limits, what may change.
      chips: chipsView(this.chips, view.phase !== 'player' && view.phase !== 'insurance'),
      feedback: this.lastFeedback,
      rating: { ...this.rating, lastDelta: this.lastRatingDelta },
      history: this.history.slice(0, 40).map((hand) => this.wordedHand(hand)),
      // The decision track: the last hands, newest first, one dot a decision.
      track: this.history.slice(0, TRACK_HANDS).map(
        (hand, index): TrackRow => ({
          index,
          id: hand.id,
          dots: hand.decisions.map((d) => trackDot(d.severity, Boolean(d.closeCall))),
          // In chips at the bet the hand was dealt at.
          net: roundChips(hand.netUnits * (hand.bet ?? 1)),
        }),
      ),
      stats: this.stats,
      ruleSet: this.ruleSet,
      /*
       * The gestures' three surfaces (round 20). All three are read-only views
       * of state written elsewhere: nothing here is a score, and nothing here
       * can move one.
       */
      // The hand that was played perfectly and lost, said once a sitting.
      settlementGesture: settled ? this.settlementGesture : null,
      // The records line on home: chip-shaped, and it touches no figure.
      records: {
        streak: this.streakRecord,
        mastered: this.masteredCount,
        cells: chartFor(this.rules).cells.size,
        decisions: this.lifetimeDecisions,
      },
      // Which spots have been met and which are mastered, for the chart's
      // second mode. Only the keys with something behind them travel.
      mastery: this.masteryMap,
      // What this sitting came to, for the one sentence that ends it. The leak
      // is worded here, where the language is, and never on the page.
      sitting: this.sittingLine,
    };
  }

  /**
   * A gesture with its spot and its action in words (round 20).
   *
   * The numbers are the gesture; these two are how it reads. They are worded
   * here, beside everything else the card carries, and re-worded by `recompose`
   * when the language changes — a gesture left in English on a Hebrew card is
   * the bug round 4a spent a round removing.
   */
  private wordGesture(gesture: Gesture | null, scenarioKey: string): unknown {
    if (!gesture) return null;
    return {
      ...gesture,
      spot: describeScenarioKey(scenarioKey, this.locale),
      playedLabel:
        gesture.kind === 'improved' && gesture.played
          ? prettyAction(gesture.played, this.locale)
          : null,
    };
  }

  /**
   * Take a record from another copy of this player (round 20).
   *
   * The larger of the two, never the sum — the same rule the counters and the
   * day count merge by, and the only correct one for a record. It writes one
   * number and can touch nothing else.
   */
  absorbRecords(records: { streakBest?: number } | null | undefined): void {
    const best = Number(records?.streakBest);
    if (Number.isFinite(best) && best > this.streakRecord) this.streakRecord = Math.floor(best);
  }

  /** The sitting's summary, with its one leak in words (round 20). */
  private get sittingLine(): unknown {
    const summary = sittingSummary({
      decisions: this.sittingDecisions,
      mistakes: this.sittingMistakes,
      spots: [...this.sittingSpots.entries()].map(([scenarioKey, spot]) => ({
        scenarioKey,
        attempts: spot.attempts,
        correct: spot.correct,
        evCostTotal: spot.evCostTotal,
      })),
    });
    if (!summary) return null;
    return {
      ...summary,
      leakSpot: summary.leak ? describeScenarioKey(summary.leak, this.locale) : null,
    };
  }

  /*
   * How many cells there are to master: the chart's own, counted rather than
   * written down — the reference screen draws exactly these keys, and a number
   * typed here by hand would be a second source for the same fact.
   */
  /** Every spot the player has met, and whether it is mastered (round 20). */
  private get masteryMap(): Record<string, 'met' | 'mastered'> {
    const out: Record<string, 'met' | 'mastered'> = {};
    for (const stat of this.scenarioStats.values()) {
      const state = masteryState(stat);
      if (state !== 'none') out[stat.scenarioKey] = state;
    }
    return out;
  }

  private get masteredCount(): number {
    let count = 0;
    for (const stat of this.scenarioStats.values()) if (masteryState(stat) === 'mastered') count++;
    return count;
  }

  /** Finished hands, newest first — the reviewable record of the session. */
  get hands_(): PlayedHand[] {
    return this.history;
  }

  /**
   * Scenarios ranked by §9.3's weighting: error rate × how often the spot comes
   * up × what the average error costs. A rare cheap mistake matters less than a
   * common expensive one.
   */
  get weakSpots(): unknown {
    const chart = chartFor(this.rules);
    return [...this.scenarioStats.values()]
      .filter((stat) => stat.attempts > stat.correct)
      .map((stat) => {
        const errors = stat.attempts - stat.correct;
        const errorRate = errors / stat.attempts;
        const averageCost = stat.evCostTotal / stat.attempts;
        const cell = chart.cells.get(stat.scenarioKey);
        return {
          scenarioKey: stat.scenarioKey,
          attempts: stat.attempts,
          errors,
          errorRate,
          averageCost,
          optimal: cell?.optimalAction ?? null,
          confusion: stat.confusion,
          // §9.3's product. Frequency is not shipped yet, so this is the two
          // terms that exist; the third lands with the frequency asset.
          weight: errorRate * averageCost,
        };
      })
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10);
  }

  /**
   * What the dealer can be asked, and what she answers.
   *
   * §3.1 constrains this: before the decision she may state facts — how often
   * she breaks, how often you break, what the two candidate plays are worth —
   * but not name the best one. "Why?" and the rule-sensitivity flag give the
   * answer away, so they are held back until the decision is made. Guided mode
   * (§8) is where the answer comes early, and this is not it.
   */
  get coach(): unknown {
    const view = this.table.view;
    const asks: Array<{ id: string; question: string; answer: string }> = [];

    if (view.phase === 'player') {
      const upcard = bjRankOfCard(view.dealerVisible[0]!);
      const hand = view.hands[view.activeHandIndex]!;
      const scenario = parseScenarioKey(
        scenarioKeyForHand(
          hand.cards.map(bjRankOfCard),
          upcard,
          view.legalActions.includes('split'),
        ),
      );
      const odds = dealerOdds(upcard, this.rules);
      const bust = bustOnNextCard(scenario, this.rules);
      const evaluation = this.table.currentEvaluation();
      const ranked = view.legalActions
        .map((action) => ({ action, ev: evaluation.evByAction[action] ?? 0 }))
        .sort((a, b) => b.ev - a.ev);

      asks.push({
        id: 'odds',
        question: t(this.locale, 'coach.q.odds'),
        answer:
          t(this.locale, 'coach.a.odds', {
            bust: Math.round(odds.bust * 100),
            made: Math.round(odds.madeHand * 100),
          }) +
          ' ' +
          (bust > 0
            ? t(this.locale, 'coach.a.oddsYouBreak', { bust: Math.round(bust * 100) })
            : t(this.locale, 'coach.a.oddsNoBreak')),
      });

      // The spread between the two candidates, without naming which is which:
      // a fact about the hand, not the answer to it.
      if (ranked.length >= 2) {
        const spread = Math.abs(ranked[0]!.ev - ranked[1]!.ev);
        asks.push({
          id: 'close',
          question: t(this.locale, 'coach.q.close'),
          answer:
            spread < 0.01
              ? t(this.locale, 'coach.a.closeVery')
              : t(this.locale, spread < 0.05 ? 'coach.a.closeSome' : 'coach.a.closeNot', {
                  spread: spread.toFixed(3),
                }),
        });
      }
      return { phase: 'player', asks, prompt: this.prompt(scenario, view.legalActions.length) };
    }

    if (view.phase === 'insurance') {
      // The same two figures the feedback card quotes, from the same place, so
      // the coach and the verdict cannot disagree about the odds.
      const odds = insuranceOdds(this.rules);
      const pct = (value: number) => `${Math.round(value * 100)}%`;
      return {
        phase: 'insurance',
        prompt: t(this.locale, 'coach.insurance.prompt'),
        asks: [
          {
            id: 'odds',
            question: t(this.locale, 'coach.q.odds'),
            answer: t(this.locale, 'coach.insurance.odds', {
              tens: pct(odds.tens),
              breakEven: pct(odds.breakEven),
            }),
          },
        ],
      };
    }

    return { phase: view.phase, prompt: null, asks: [] };
  }

  /** A line naming the spot, without hinting at the answer. */
  private prompt(scenario: ReturnType<typeof parseScenarioKey>, choices: number): string {
    const label =
      scenario.kind === 'pair'
        ? t(this.locale, 'label.pair')
        : scenario.kind === 'soft'
          ? t(this.locale, 'label.soft', { total: scenario.total ?? 0 })
          : t(this.locale, 'label.hard', { total: scenario.total ?? 0 });
    if (scenario.kind === 'pair') return t(this.locale, 'coach.prompt.pair');
    return t(this.locale, choices <= 2 ? 'coach.prompt.few' : 'coach.prompt.open', { label });
  }

  /** Everything the home screen needs. */
  get profile(): unknown {
    const chart = chartFor(this.rules);
    const table = difficultyTable(this.rules, chart);
    const ladderKeys = [
      'bj:pairT:vs9',
      'bj:hard12:vs10',
      'bj:pair8:vs6',
      'bj:hard16:vs10',
      'bj:soft18:vs9',
      'bj:hard15:vs10',
      'bj:soft13:vs5',
    ];
    const ladder = ladderKeys
      .map((key) => {
        const d = table.get(key);
        const cell = chart.cells.get(key);
        if (!d || !cell) return null;
        return {
          scenarioKey: key,
          label: describeScenarioKey(key, this.locale),
          difficulty: d[this.mode],
          margin: d.margin,
          optimal: cell.optimalAction,
          // Worded in the language on screen, as the hand log is (round 11): the
          // id alone read "stand" and "split" inside a Hebrew home screen.
          optimalLabel: prettyAction(cell.optimalAction, this.locale),
          oneIn: Math.round(1000 / Math.max(d.perThousand, 0.01)),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => a.difficulty - b.difficulty);

    return {
      player: { name: this.playerName },
      locale: this.locale,
      rating: { ...this.rating, lastDelta: this.lastRatingDelta },
      stats: this.stats,
      ruleSet: this.ruleSet,
      ladder,
    };
  }

  setPlayerName(name: string): void {
    const trimmed = name.trim();
    if (trimmed.length > 0) this.playerName = trimmed.slice(0, 24);
  }


  /**
   * Everything a player has earned, in a form that survives the tab closing.
   *
   * The rating is the point. It is built one decision at a time over hundreds of
   * hands, and until now it started again from 1200 every time the page was
   * opened — which made it a score for the last twenty minutes rather than a
   * measure of anyone's play, and put a number on the shared table that meant
   * nothing.
   *
   * Deliberately excluded: the hand in progress, the card currently on screen,
   * and the shoe. A restored session begins between hands, which is the only
   * boundary where resuming is unambiguous — half a split restored into a
   * freshly shuffled shoe would be a different hand wearing the same cards.
   */
  get progress(): SessionProgressV5 {
    return {
      version: 5,
      records: { streakBest: this.streakRecord },
      name: this.playerName,
      hands: this.hands,
      decisions: this.decisions,
      correct: this.correct,
      evLost: this.evLost,
      netUnits: this.netUnits,
      closeCalls: this.closeCalls,
      closeCallsCorrect: this.closeCallsCorrect,
      lifetimeDecisions: this.lifetimeDecisions,
      bySeverity: { ...this.bySeverity },
      mode: this.mode,
      ratings: {
        basic: { ...this.ratings.basic },
        recall: { ...this.ratings.recall },
        value: { ...this.ratings.value },
      },
      scenarioStats: [...this.scenarioStats.values()],
      history: this.history.slice(0, 40),
      chips: {
        stack: this.chips.stack,
        bet: this.chips.bet,
        lastBet: this.chips.lastBet,
        limits: { ...TABLE_LIMITS },
      },
    };
  }

  /**
   * Put a saved session back.
   *
   * Ignores anything it does not recognise rather than throwing: a player whose
   * stored progress predates a change to this shape should lose the fields that
   * moved, not the ability to open the app.
   */
  restore(saved: SessionProgress | null | undefined): void {
    // Versions 2 and 3 hold the same Blackjack fields; version 3 only adds
    // `uth`, which is `UthSession`'s to read.
    // Versions 2 to 4 hold the same Blackjack fields; 3 adds `uth`, which is
    // `UthSession`'s to read, and 4 adds the chips.
    if (
      !saved ||
      (saved.version !== 1 &&
        saved.version !== 2 &&
        saved.version !== 3 &&
        saved.version !== 4 &&
        saved.version !== 5)
    ) {
      return;
    }
    const n = (value: unknown, fallback = 0): number =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback;

    if (typeof saved.name === 'string' && saved.name.trim().length > 0) {
      this.playerName = saved.name.trim().slice(0, 24);
    }
    this.hands = n(saved.hands);
    this.decisions = n(saved.decisions);
    this.correct = n(saved.correct);
    this.evLost = n(saved.evLost);
    this.netUnits = n(saved.netUnits);
    this.closeCalls = n(saved.closeCalls);
    this.closeCallsCorrect = n(saved.closeCallsCorrect);
    for (const tier of Object.keys(this.bySeverity) as SeverityTier[]) {
      this.bySeverity[tier] = n(saved.bySeverity?.[tier]);
    }
    /*
     * A version 1 blob holds one rating and the mode it was earned in. It goes
     * into that mode's slot, and the other two start fresh — which is the only
     * reading that loses nothing: the old shape never held the others, so there
     * is nothing to lose there, and putting the number anywhere else would
     * credit it to a ladder it was not climbed on.
     */
    if (saved.version === 1) {
      const rating = saved.rating;
      if (rating && typeof rating.rating === 'number') {
        const mode = RATING_MODES.includes(rating.mode) ? rating.mode : 'basic';
        this.ratings[mode] = { ...newRating(mode), ...rating, mode };
        this.mode = mode;
      }
      // v1 had no lifetime counter. The decisions it did record are the best
      // lower bound available, and a lower bound is safe here: the comparison
      // it feeds only ever needs to not go backwards.
      this.lifetimeDecisions = n(saved.decisions);
    } else {
      this.lifetimeDecisions = n(saved.lifetimeDecisions, n(saved.decisions));
      if (RATING_MODES.includes(saved.mode)) this.mode = saved.mode;
      for (const mode of RATING_MODES) {
        const rating = saved.ratings?.[mode];
        this.ratings[mode] =
          rating && typeof rating.rating === 'number'
            ? { ...newRating(mode), ...rating, mode }
            : newRating(mode);
      }
    }
    this.scenarioStats = new Map(
      (saved.scenarioStats ?? []).map((stat) => [stat.scenarioKey, { ...stat }]),
    );
    this.history = [...(saved.history ?? [])];
    /*
     * Before version 4 the stack was never saved: it was drawn as the starting
     * stack plus this session's units, which is what the player last saw, so
     * that is where it reopens — at a bet of 1, the bet every one of those
     * hands was played at.
     */
    const chips = saved.version === 4 || saved.version === 5 ? saved.chips : undefined;
    this.chips = readChipBook(
      chips,
      chips && typeof chips.stack === 'number' ? chips.stack : TrainerSession.STARTING_STACK + n(saved.netUnits),
    );
    this.handBet = 1;
    /*
     * The record comes back; the run does not (round 20). Reopening the app
     * with a live streak of 31 would make closing the tab a thing to be afraid
     * of, and the record is the part that was actually earned.
     */
    this.streakRecord = saved.version === 5 ? Math.max(0, Math.floor(n(saved.records?.streakBest))) : 0;
    this.recordAnnounced = false;
    this.gesturesShown = 0;
    this.gestureThisHand = false;
    this.rightAndLostShown = false;
    this.settlementGesture = null;
    this.sittingDecisions = 0;
    this.sittingMistakes = 0;
    this.sittingSpots = new Map();
    // A restored session is between hands by construction, so nothing from the
    // previous one is left pointing at a table that no longer exists.
    this.pending = [];
    this.lastFeedback = null;
    this.lastRecord = null;
    this.countedHand = -1;
  }

  /** The ladder currently being climbed. */
  private get rating(): Rating {
    return this.ratings[this.mode];
  }

  /** The language in force, so a new session can carry it over. */
  get localeCode(): Locale {
    return this.locale;
  }

  setLocale(locale: Locale): void {
    if (locale !== 'en' && locale !== 'he') return;
    if (locale === this.locale) return;
    this.locale = locale;
    // The card on screen was composed in the old language. Compose it again
    // rather than leaving a Hebrew explanation under an English verdict — the
    // numbers are unchanged, so this is a re-render, not a re-grade.
    if (this.lastRecord) this.recompose(this.lastRecord);
  }

  /** Decisions already worded, per saved object, with the language they were worded in. */
  private worded = new WeakMap<object, { locale: Locale; decision: PlayedHand['decisions'][number] }>();

  /**
   * A saved hand, worded in the language on screen now (round 9).
   *
   * A hand used to keep the sentences it was graded with, so a player who played
   * in English and then chose Hebrew read an English headline inside a Hebrew
   * row. The numbers never change, so the words are composed again from them —
   * the same `explain` the card used, over the same EVs and the same rules. What
   * is saved stays as it was; only what is shown is worded.
   */
  private wordedHand(hand: PlayedHand): PlayedHand {
    return { ...hand, decisions: hand.decisions.map((decision) => this.wordedDecision(decision)) };
  }

  private wordedDecision(decision: PlayedHand['decisions'][number]): PlayedHand['decisions'][number] {
    const kept = this.worded.get(decision);
    if (kept && kept.locale === this.locale) return kept.decision;

    let worded = decision;
    const ranked = Array.isArray(decision.ranked) ? decision.ranked : [];
    const actions = ranked.map((entry) => entry.action);
    // A hand saved before the ids were kept names its actions by label, in the
    // language it was played in. Either language's label finds the id.
    const byLabel = (label: string) =>
      actions.find((action) => prettyAction(action, 'en') === label || prettyAction(action, 'he') === label);
    const optimal = decision.optimalAction ?? byLabel(decision.optimal) ?? actions[0];
    const chosen = decision.chosenAction ?? byLabel(decision.chosen) ?? (decision.correct ? optimal : undefined);
    if (optimal && chosen && actions.length > 0) {
      try {
        const scenario =
          decision.scenarioKey === 'bj:insurance'
            ? ({ kind: 'insurance' } as const)
            : parseScenarioKey(decision.scenarioKey);
        const evByAction = Object.fromEntries(ranked.map((entry) => [entry.action, entry.ev]));
        const explanation = explain(
          scenario,
          {
            legalActions: actions as BlackjackAction[],
            evByAction: evByAction as Partial<Record<BlackjackAction, number>>,
            optimalAction: optimal as BlackjackAction,
            optimalEv: evByAction[optimal] ?? 0,
          },
          this.rules,
          this.locale,
          chosen as BlackjackAction,
        );
        worded = {
          ...decision,
          headline: explanation.headline,
          steps: [...explanation.steps],
          chosen: prettyAction(chosen, this.locale),
          optimal: prettyAction(optimal, this.locale),
          chosenAction: chosen,
          optimalAction: optimal,
        };
      } catch {
        // A key this build cannot read: shown as it was saved, rather than not at all.
      }
    }
    this.worded.set(decision, { locale: this.locale, decision: worded });
    return worded;
  }

  /**
   * Rebuild the visible feedback card in the current language.
   *
   * Only the prose is rebuilt. Nothing here touches the running totals, the
   * rating or the history — a language change is not a decision, and grading it
   * twice would be a quiet way to corrupt a session.
   */
  private recompose(record: DecisionRecord): void {
    const scenario =
      record.scenarioKey === 'bj:insurance'
        ? ({ kind: 'insurance' } as const)
        : parseScenarioKey(record.scenarioKey);
    const evaluation = {
      legalActions: record.legalActions as BlackjackAction[],
      evByAction: record.evByAction as Partial<Record<BlackjackAction, number>>,
      optimalAction: record.optimalAction as BlackjackAction,
      optimalEv: record.evByAction[record.optimalAction] ?? 0,
    };
    const explanation = explain(
      scenario,
      evaluation,
      this.rules,
      this.locale,
      record.chosenAction as BlackjackAction,
    );
    const previous = this.lastFeedback as Record<string, unknown> | null;
    if (!previous) return;
    this.lastFeedback = {
      ...previous,
      headline: explanation.headline,
      steps: [...explanation.steps],
      counterNote: this.counterNote(record),
      chosenLabel: prettyAction(record.chosenAction, this.locale),
      optimalLabel: prettyAction(record.optimalAction, this.locale),
      optimalVerb:
        record.scenarioKey === 'bj:insurance'
          ? prettyAction(record.optimalAction, this.locale)
          : actionName(record.optimalAction as BlackjackAction, this.locale),
      ranked: (previous.ranked as Array<Record<string, unknown>>).map((entry) => ({
        ...entry,
        label: prettyAction(entry.action as string, this.locale),
      })),
      // The gesture's numbers do not change with the language; its two words do.
      gesture: previous.gesture
        ? {
            ...(previous.gesture as Record<string, unknown>),
            spot: describeScenarioKey(record.scenarioKey, this.locale),
            playedLabel:
              (previous.gesture as { played?: string }).played
                ? prettyAction((previous.gesture as { played: string }).played, this.locale)
                : null,
          }
        : null,
    };
  }

  setMode(mode: DifficultyMode): void {
    // Nothing is created or destroyed here: all three ladders exist for the
    // life of the session, and this only says which one is being climbed.
    // Replacing the rating on the way past is how the Basic rating used to be
    // lost by visiting Recall and coming back.
    if (this.ratings[mode]) this.mode = mode;
  }

  /** The derived chart for the Reference screen (spec §10, screen 7). */
  get chart(): unknown {
    const chart = chartFor(this.rules);
    const cells: Record<string, string> = {};
    for (const [key, cell] of chart.cells) cells[key] = cell.optimalAction;
    return { rulesKey: chart.rulesKey, cells };
  }
}

function prettyAction(action: string, locale: Locale = 'en'): string {
  return t(locale, `action.${action}`);
}

/** Best total of a hand, for display. */
function totalOf(cards: readonly number[]): number {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    const rank = rankOf(card);
    const value = rank === 12 ? 11 : rank >= 8 ? 10 : rank + 2;
    total += value;
    if (rank === 12) aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

/** A scenario key as it reads on the difficulty ladder: "8,8 vs 6". */
function describeScenarioKey(key: string, locale: Locale = 'en'): string {
  if (key === 'bj:insurance') return t(locale, 'label.insurance');
  const scenario = parseScenarioKey(key);
  const up = key.slice(key.indexOf(':vs') + 3);
  if (scenario.kind === 'pair') {
    const rank = scenario.pairRank!;
    const label = rank === 0 ? 'A' : rank === 9 ? '10' : String(rank + 1);
    return t(locale, 'label.vs', { hand: `${label},${label}`, up });
  }
  if (scenario.kind === 'soft') {
    return t(locale, 'label.vs', { hand: `A,${(scenario.total ?? 0) - 11}`, up });
  }
  return t(locale, 'label.vs', { hand: String(scenario.total), up });
}
