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
  parseScenarioKey,
  RULE_PRESETS,
  rankOf,
  suitOf,
  severityForCost,
  type BlackjackAction,
  type BlackjackRules,
  type SeverityTier,
} from '@evtrainer/ev-engine';
import { BlackjackTable, type DecisionRecord } from '@evtrainer/game-engine';

import { actionName, explain } from './explain.ts';
import { chartFor, ruleSensitivity, type SensitivityNote } from './sensitivity.ts';

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

export interface SessionStats {
  hands: number;
  decisions: number;
  correct: number;
  /** Decision accuracy, the number §9.2 leads with. */
  accuracy: number;
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
  private bySeverity: Record<SeverityTier, number> = {
    optimal: 0,
    negligible: 0,
    minor: 0,
    significant: 0,
    blunder: 0,
  };
  private lastFeedback: unknown = null;
  private countedHand = -1;

  constructor(presetId = 'vegas-strip-6d-s17', seed = Date.now() % 2147483647) {
    this.presetId = presetId;
    this.rules = getPreset(presetId).rules;
    this.baseEdgePercent = houseEdge(this.rules).percent;
    chartFor(this.rules); // derive once, up front, so the first decision is not slow
    this.table = new BlackjackTable({ rules: this.rules, seed, grading: 'chart' });
  }

  get ruleSet(): { id: string; name: string; badge: string; note: string | null; edgePercent: number } {
    const preset = RULE_PRESETS.find((p) => p.id === this.presetId)!;
    const rules = this.rules;
    const badge = [
      `${rules.decks}D`,
      rules.soft17,
      rules.das ? 'DAS' : 'no DAS',
      rules.surrender === 'none' ? 'no surrender' : `${rules.surrender} surrender`,
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
    };
  }

  deal(): void {
    this.table.startHand(1);
    this.lastFeedback = null;
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

  /** Turn one graded decision into the feedback card §7.1 describes. */
  private absorb(record: DecisionRecord): void {
    this.decisions++;
    if (record.evCost === 0) this.correct++;
    this.evLost += record.evCost;
    this.bySeverity[record.severityTier]++;

    const scenario =
      record.scenarioKey === 'bj:insurance'
        ? ({ kind: 'insurance' } as const)
        : parseScenarioKey(record.scenarioKey);

    const ranked = record.legalActions
      .map((action) => ({
        action,
        label: action,
        ev: record.evByAction[action] ?? 0,
      }))
      .sort((a, b) => b.ev - a.ev);

    let sensitivity: SensitivityNote[] = [];
    let reason: string;
    if (scenario.kind === 'insurance') {
      reason = explain(scenario, 'stand', this.rules);
    } else {
      const optimal = record.optimalAction as BlackjackAction;
      reason = explain(scenario, optimal, this.rules);
      sensitivity = ruleSensitivity(record.scenarioKey, this.rules, optimal);
    }

    this.lastFeedback = {
      scenarioKey: record.scenarioKey,
      correct: record.evCost === 0,
      severity: record.severityTier,
      chosen: record.chosenAction,
      chosenLabel: prettyAction(record.chosenAction),
      optimal: record.optimalAction,
      optimalLabel: prettyAction(record.optimalAction),
      optimalVerb:
        record.scenarioKey === 'bj:insurance'
          ? prettyAction(record.optimalAction)
          : actionName(record.optimalAction as BlackjackAction),
      evCost: record.evCost,
      ranked,
      reason,
      sensitivity,
    };
  }

  /** Fold a finished hand into the session totals exactly once. */
  private settleIfDone(): void {
    if (this.table.view.phase !== 'settled') return;
    const record = this.table.handRecord;
    if (record.id === this.countedHand) return;
    this.countedHand = record.id;
    this.hands++;
    this.netUnits += record.netUnits;
  }

  get stats(): SessionStats {
    const accuracy = this.decisions === 0 ? 1 : this.correct / this.decisions;
    const evLostPer100 = this.hands === 0 ? 0 : (this.evLost / this.hands) * 100;
    return {
      hands: this.hands,
      decisions: this.decisions,
      correct: this.correct,
      accuracy,
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
      },
      legalActions: view.legalActions,
      insuranceOffered: view.phase === 'insurance',
      netUnits: view.netUnits,
      feedback: this.lastFeedback,
      stats: this.stats,
      ruleSet: this.ruleSet,
    };
  }

  /** The derived chart for the Reference screen (spec §10, screen 7). */
  get chart(): unknown {
    const chart = chartFor(this.rules);
    const cells: Record<string, string> = {};
    for (const [key, cell] of chart.cells) cells[key] = cell.optimalAction;
    return { rulesKey: chart.rulesKey, cells };
  }
}

function prettyAction(action: string): string {
  switch (action) {
    case 'takeInsurance':
      return 'Take insurance';
    case 'declineInsurance':
      return 'Decline insurance';
    default:
      return action.charAt(0).toUpperCase() + action.slice(1);
  }
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
