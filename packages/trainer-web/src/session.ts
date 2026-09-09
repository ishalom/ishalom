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
  formatCard,
  getPreset,
  houseEdge,
  bjRankOfCard,
  parseScenarioKey,
  scenarioKeyForHand,
  RULE_PRESETS,
  rankOf,
  suitOf,
  severityForCost,
  type BlackjackAction,
  type BlackjackRules,
  type SeverityTier,
} from '@evtrainer/ev-engine';
import { BlackjackTable, type DecisionRecord } from '@evtrainer/game-engine';

import {
  actionName,
  bustOnNextCard,
  dealerOdds,
  explain,
} from './explain.ts';
import {
  difficultyTable,
  newRating,
  updateRating,
  type DifficultyMode,
  type Rating,
} from './difficulty.ts';
import { chartFor, ruleSensitivity, type SensitivityNote } from './sensitivity.ts';
import { t, type Locale } from './i18n.ts';

/** House restrictions layered over a preset. See `TrainerSession.restrictions`. */
export interface Restrictions {
  /** The table does not offer late surrender. */
  noSurrender: boolean;
  /** A jack beside a queen is a hard twenty, not a splittable pair. */
  likeRanksOnly: boolean;
}

export function applyRestrictions(
  rules: BlackjackRules,
  restrictions: Restrictions,
): BlackjackRules {
  return {
    ...rules,
    surrender: restrictions.noSurrender ? 'none' : rules.surrender,
    splitUnlikeTens: !restrictions.likeRanksOnly,
  };
}

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
  decisions: Array<{
    scenarioKey: string;
    headline: string;
    chosen: string;
    optimal: string;
    correct: boolean;
    evCost: number;
    severity: SeverityTier;
    closeCall: boolean;
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
  private countedHand = -1;
  /** Finished hands, newest first. */
  private history: PlayedHand[] = [];
  /** Decisions of the hand in progress, moved into `history` when it settles. */
  private pending: PlayedHand['decisions'] = [];
  private scenarioStats = new Map<string, ScenarioStat>();
  private clock = 0;
  private rating: Rating = newRating('basic');
  private lastRatingDelta: number | null = null;

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
    restrictions: Restrictions;
  } {
    const preset = RULE_PRESETS.find((p) => p.id === this.presetId)!;
    const rules = this.rules;
    const badge = [
      `${rules.decks}D`,
      rules.soft17,
      rules.das ? 'DAS' : 'no DAS',
      rules.surrender === 'none' ? 'no surrender' : `${rules.surrender} surrender`,
      rules.splitUnlikeTens ? '' : 'like ranks only',
      rules.blackjackPayout,
      rules.peek ? '' : 'no hole card',
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      id: preset.id,
      name: preset.name,
      badge,
      note: preset.note ?? null,
      edgePercent: this.baseEdgePercent,
      restrictions: this.restrictions,
    };
  }

  deal(): void {
    this.table.startHand(1);
    this.lastFeedback = null;
    this.lastRatingDelta = null;
    this.pending = [];
    this.settleIfDone();
  }

  act(action: BlackjackAction): unknown {
    const record = this.table.act(action);
    this.absorb(record);
    this.settleIfDone();
    return this.lastFeedback;
  }

  insurance(take: boolean): unknown {
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

  /** Turn one graded decision into the feedback card §7.1 describes. */
  private absorb(record: DecisionRecord): void {
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

    this.decisions++;
    if (record.evCost === 0) this.correct++;
    this.evLost += record.evCost;
    this.bySeverity[record.severityTier]++;
    if (closeCall) {
      this.closeCalls++;
      if (record.evCost === 0) this.closeCallsCorrect++;
    }

    const ranked = record.legalActions
      .map((action) => ({ action, label: action, ev: record.evByAction[action] ?? 0 }))
      .sort((a, b) => b.ev - a.ev);

    const sensitivity: SensitivityNote[] =
      scenario.kind === 'insurance'
        ? []
        : ruleSensitivity(record.scenarioKey, this.rules, evaluation.optimalAction);

    // Rate it — unless the spot is off the 311-cell grid. Hard 18 through 21
    // have no chart cell but turn up constantly, and standing on 19 is trivially
    // correct, so rating them would be a stream of free points.
    const chart = chartFor(this.rules);
    const difficulty = difficultyTable(this.rules, chart).get(record.scenarioKey);
    this.lastRatingDelta = difficulty
      ? updateRating(this.rating, difficulty[this.rating.mode], record.severityTier)
      : null;

    this.pending.push({
      scenarioKey: record.scenarioKey,
      headline: explanation.headline,
      chosen: prettyAction(record.chosenAction, this.locale),
      optimal: prettyAction(record.optimalAction, this.locale),
      correct: record.evCost === 0,
      evCost: record.evCost,
      severity: record.severityTier,
      closeCall,
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

    this.lastFeedback = {
      scenarioKey: record.scenarioKey,
      // Anchors every step of the reveal to what was actually decided, which
      // matters once a split has replaced the hand on the board with two others.
      headline: explanation.headline,
      steps: explanation.steps,
      gap: explanation.gap,
      closeCall,
      correct: record.evCost === 0,
      severity: record.severityTier,
      chosen: record.chosenAction,
      chosenLabel: prettyAction(record.chosenAction, this.locale),
      optimal: record.optimalAction,
      optimalLabel: prettyAction(record.optimalAction, this.locale),
      optimalVerb:
        record.scenarioKey === 'bj:insurance'
          ? prettyAction(record.optimalAction)
          : actionName(record.optimalAction as BlackjackAction, this.locale),
      evCost: record.evCost,
      ranked,
      sensitivity,
    };
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

    this.history.unshift({
      id: record.id,
      dealtCards: [...record.dealtCards],
      playerHands: record.playerCards.map((hand) => hand.map(cardView)),
      dealerCards: record.dealerCards.map(cardView),
      netUnits: record.netUnits,
      insuranceTaken: record.insuranceTaken,
      decisions: this.pending,
    });
    this.pending = [];
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
        bet: hand.bet,
        doubled: hand.doubled,
        surrendered: hand.surrendered,
        finished: hand.finished,
        net: hand.net,
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
      feedback: this.lastFeedback,
      rating: { ...this.rating, lastDelta: this.lastRatingDelta },
      history: this.history.slice(0, 40),
      stats: this.stats,
      ruleSet: this.ruleSet,
    };
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
      return {
        phase: 'insurance',
        prompt: t(this.locale, 'coach.insurance.prompt'),
        asks: [
          {
            id: 'odds',
            question: t(this.locale, 'coach.q.odds'),
            answer: t(this.locale, 'coach.insurance.odds'),
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
          difficulty: d[this.rating.mode],
          margin: d.margin,
          optimal: cell.optimalAction,
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

  /** The language in force, so a new session can carry it over. */
  get localeCode(): Locale {
    return this.locale;
  }

  setLocale(locale: Locale): void {
    if (locale === 'en' || locale === 'he') this.locale = locale;
  }

  setMode(mode: DifficultyMode): void {
    if (mode === this.rating.mode) return;
    // Each mode is its own ladder, so it gets its own rating rather than
    // carrying a number earned against a different set of hands.
    this.rating = newRating(mode);
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
