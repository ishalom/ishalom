/**
 * The Blackjack state machine (spec §5.1.2).
 *
 * Sits above the EV engine and below the session controller. It deals, enforces
 * the rules, plays the dealer out, settles the money, and hands every decision
 * to the EV engine to be graded — but it makes no strategy judgements of its own
 * and knows nothing about screens, storage or drills.
 *
 * Grading
 * -------
 * By default a decision is graded against the derived chart for the active rule
 * set, not against the exact remaining shoe. That is deliberate: the app teaches
 * basic strategy, and basic strategy is a total-dependent chart. Grading against
 * live shoe composition would occasionally mark a chart-correct play as an error
 * because the count had drifted, which is a lesson from §15's card-counting
 * phase, not this one. `grading: 'exact-shoe'` switches to the live composition
 * for when that phase arrives.
 *
 * The hole card
 * -------------
 * In a no-hole-card game the dealer's second card is dealt here anyway, and
 * simply never peeked at. Drawing an unknown card now and drawing it after the
 * player acts are the same random card from the same shoe, so this keeps one
 * dealing path while leaving the rule difference where it belongs: in what the
 * dealer's natural is allowed to collect.
 */

import {
  BlackjackSolver,
  blackjackPayoutMultiple,
  deriveChart,
  gradeDecision,
  handValue,
  insuranceEv,
  isBlackjack,
  legalActions,
  scenarioKeyForHand,
  severityForCost,
  Shoe as Composition,
  bjRankOfCard,
  rankOf,
  TEN,
  INSURANCE_SCENARIO_KEY,
  type BlackjackAction,
  type BlackjackRules,
  type Card,
  type DecisionEvaluation,
  type SeverityTier,
  type StrategyChart,
} from '@evtrainer/ev-engine';

import { makeRng, type Rng } from './rng.ts';
import { DealingShoe } from './shoe.ts';
import type {
  DecisionRecord,
  GradedAction,
  HandRecord,
  Phase,
  PlayerHand,
  TableView,
} from './types.ts';

export interface TableOptions {
  rules: BlackjackRules;
  /** Seeds the shuffle. The same seed replays the same shoe exactly. */
  seed: number;
  /** Fraction of the shoe dealt before the cut card. */
  penetration?: number;
  /**
   * `'chart'` grades against the derived basic-strategy chart, which is what the
   * app teaches. `'exact-shoe'` grades against the live composition.
   */
  grading?: 'chart' | 'exact-shoe';
  /** A pre-derived chart, to avoid paying for one per table. */
  chart?: StrategyChart;
}

/**
 * Two ten-valued cards of different rank — a jack beside a queen.
 *
 * The solver cannot work this out for itself: it sees ten-buckets, in which
 * every court card is the same card. Only the table holds the real ones, so
 * under a house that splits identical ranks only, this is the one fact that has
 * to travel from the felt to the rule check.
 */
function unlikeTens(cards: readonly Card[]): boolean | undefined {
  if (cards.length !== 2) return undefined;
  const [a, b] = cards as [Card, Card];
  if (bjRankOfCard(a) !== TEN || bjRankOfCard(b) !== TEN) return undefined;
  return rankOf(a) !== rankOf(b);
}

export class BlackjackTable {
  readonly rules: BlackjackRules;
  readonly shoe: DealingShoe;

  private readonly rng: Rng;
  private readonly grading: 'chart' | 'exact-shoe';
  private readonly chart: StrategyChart;
  private readonly solver: BlackjackSolver;

  private phase: Phase = 'idle';
  private hands: PlayerHand[] = [];
  private activeHandIndex = 0;
  private dealerCards: Card[] = [];
  private dealerRevealed = false;
  private baseBet = 1;
  private insuranceOffered = false;
  private insuranceTaken = false;
  private insuranceNet = 0;
  private dealtCards: Card[] = [];
  private decisions: DecisionRecord[] = [];
  private handId = 0;
  private settledNet: number | null = null;

  constructor(options: TableOptions) {
    this.rules = options.rules;
    this.rng = makeRng(options.seed);
    this.shoe = new DealingShoe(options.rules.decks, this.rng, options.penetration ?? 0.75);
    this.grading = options.grading ?? 'chart';
    this.chart = options.chart ?? deriveChart(options.rules, { cardRemoval: 'static-dealer' });
    this.solver = new BlackjackSolver(options.rules, { cardRemoval: 'static-dealer' });
  }

  // --- Reading the table ---------------------------------------------------

  get view(): TableView {
    return {
      phase: this.phase,
      hands: this.hands,
      activeHandIndex: this.activeHandIndex,
      dealerVisible: this.dealerRevealed ? this.dealerCards : this.dealerCards.slice(0, 1),
      dealerRevealed: this.dealerRevealed,
      legalActions: this.phase === 'player' ? this.legalActions() : [],
      insuranceOffered: this.insuranceOffered,
      insuranceTaken: this.insuranceTaken,
      netUnits: this.settledNet,
    };
  }

  legalActions(): BlackjackAction[] {
    if (this.phase !== 'player') return [];
    const hand = this.hands[this.activeHandIndex]!;
    const { total, soft } = handValue(hand.cards.map(bjRankOfCard));
    return legalActions(
      {
        cards: hand.cards.map(bjRankOfCard),
        total,
        soft,
        fromSplit: hand.fromSplit,
        handCount: this.hands.length,
        unlikeTens: unlikeTens(hand.cards),
      },
      this.rules,
    );
  }

  /**
   * The EV of every action available right now, without committing to one.
   *
   * The trainer never shows this before the player decides — §3.1 is emphatic
   * that feedback follows the decision. It exists for the simulation harness,
   * which plays the engine's own recommendation, and for Guided mode (§8), where
   * hints are the point.
   */
  currentEvaluation(): DecisionEvaluation {
    if (this.phase !== 'player') throw new Error(`No decision pending while ${this.phase}`);
    return this.evaluate(this.hands[this.activeHandIndex]!, this.legalActions());
  }

  /** EV of taking insurance, in units of the wager. Positive means take it. */
  insuranceEvaluation(): number {
    if (this.phase !== 'insurance') throw new Error('Insurance is not on offer');
    return insuranceEv(this.unseenComposition());
  }

  // --- Playing a hand ------------------------------------------------------

  /** Deal a new hand. Spec §5.1.2 steps 1 and 2. */
  startHand(bet = 1): void {
    if (this.phase === 'player' || this.phase === 'insurance') {
      throw new Error('A hand is already in progress');
    }
    if (this.shoe.needsShuffle) this.shoe.shuffle();

    this.handId++;
    this.baseBet = bet;
    this.hands = [];
    this.dealerCards = [];
    this.dealerRevealed = false;
    this.activeHandIndex = 0;
    this.insuranceOffered = false;
    this.insuranceTaken = false;
    this.insuranceNet = 0;
    this.dealtCards = [];
    this.decisions = [];
    this.settledNet = null;

    const playerCards: Card[] = [];
    playerCards.push(this.draw());
    this.dealerCards.push(this.draw()); // upcard
    playerCards.push(this.draw());
    this.dealerCards.push(this.draw()); // hole card, face down

    this.hands.push({
      cards: playerCards,
      bet,
      doubled: false,
      fromSplit: false,
      surrendered: false,
      finished: false,
      net: null,
    });

    // Insurance is a bet on the hole card being a ten, so it is offered whenever
    // the dealer shows an ace — in a no-hole-card game too, where it simply
    // settles at the end along with everything else.
    if (bjRankOfCard(this.dealerCards[0]!) === 0) {
      this.insuranceOffered = true;
      this.phase = 'insurance';
      return;
    }
    this.afterOpening();
  }

  private draw(): Card {
    const card = this.shoe.deal();
    this.dealtCards.push(card);
    return card;
  }

  /**
   * Spec §5.1.2 step 4: a dealer natural in a peek game ends the hand before the
   * player acts, and a player natural resolves on the deal either way.
   */
  private afterOpening(): void {
    const dealerNatural = isBlackjack(this.dealerCards.map(bjRankOfCard));
    const playerNatural = isBlackjack(this.hands[0]!.cards.map(bjRankOfCard));

    if ((this.rules.peek && dealerNatural) || playerNatural) {
      this.settle();
      return;
    }
    this.phase = 'player';
    this.activeHandIndex = 0;
  }

  /**
   * The insurance decision (spec §5.1.3). It is a bet on the hole card and
   * nothing else — the player's own hand never enters it, which is the lesson.
   */
  takeInsurance(take: boolean): DecisionRecord {
    if (this.phase !== 'insurance') throw new Error('Insurance is not on offer');

    const evTake = insuranceEv(this.unseenComposition());
    const record = this.pushDecision({
      handIndex: 0,
      scenarioKey: INSURANCE_SCENARIO_KEY,
      legalActions: ['takeInsurance', 'declineInsurance'],
      evByAction: { takeInsurance: evTake, declineInsurance: 0 },
      optimalAction: evTake > 0 ? 'takeInsurance' : 'declineInsurance',
      chosenAction: take ? 'takeInsurance' : 'declineInsurance',
    });

    this.insuranceTaken = take;
    if (take) {
      // Half the original stake, paying 2:1, so +1 unit when the hole card is a
      // ten and -0.5 when it is not.
      const holeIsTen = bjRankOfCard(this.dealerCards[1]!) === 9;
      this.insuranceNet = holeIsTen ? this.baseBet : -0.5 * this.baseBet;
    }

    this.afterOpening();
    return record;
  }

  /** Play one action on the active hand. Spec §5.1.2 step 5. */
  act(action: BlackjackAction, timeToDecideMs: number | null = null): DecisionRecord {
    if (this.phase !== 'player') throw new Error(`Cannot act while ${this.phase}`);

    const handIndex = this.activeHandIndex;
    const hand = this.hands[handIndex]!;
    const legal = this.legalActions();
    if (!legal.includes(action)) {
      throw new Error(`${action} is not legal here; legal actions are ${legal.join(', ')}`);
    }

    const evaluation = this.evaluate(hand, legal);
    const grade = gradeDecision(evaluation, action);
    const record = this.pushDecision({
      handIndex,
      scenarioKey: scenarioKeyForHand(
        hand.cards.map(bjRankOfCard),
        bjRankOfCard(this.dealerCards[0]!),
        legal.includes('split'),
      ),
      legalActions: legal,
      evByAction: evaluation.evByAction,
      optimalAction: evaluation.optimalAction,
      chosenAction: action,
      evCost: grade.evCost,
      severityTier: grade.severity,
      timeToDecideMs,
    });

    this.apply(action, handIndex);
    this.advance();
    return record;
  }

  // --- Applying actions ----------------------------------------------------

  private apply(action: BlackjackAction, handIndex: number): void {
    const hand = this.hands[handIndex]!;
    switch (action) {
      case 'stand':
        hand.finished = true;
        break;

      case 'hit': {
        hand.cards.push(this.draw());
        const { total } = handValue(hand.cards.map(bjRankOfCard));
        // Twenty-one and a bust both end the hand: there is nothing left to decide.
        if (total >= 21) hand.finished = true;
        break;
      }

      case 'double':
        hand.bet *= 2;
        hand.doubled = true;
        hand.cards.push(this.draw());
        hand.finished = true;
        break;

      case 'surrender':
        hand.surrendered = true;
        hand.finished = true;
        break;

      case 'split': {
        // Spec §5.1.2 step 6: the hands are played one at a time, each generating
        // its own decisions. The new hand is inserted directly after this one so
        // that order is the order they are played.
        const moved = hand.cards.pop()!;
        hand.fromSplit = true;
        const sibling: PlayerHand = {
          cards: [moved],
          bet: this.baseBet,
          doubled: false,
          fromSplit: true,
          surrendered: false,
          finished: false,
          net: null,
        };
        this.hands.splice(handIndex + 1, 0, sibling);
        hand.cards.push(this.draw());
        this.settleSplitAce(hand);
        break;
      }
    }
  }

  /** A split ace takes one card and stops, unless the house allows hitting them. */
  private settleSplitAce(hand: PlayerHand): void {
    if (!hand.fromSplit || hand.cards.length !== 2) return;
    if (bjRankOfCard(hand.cards[0]!) !== 0) return;
    if (this.rules.hitSplitAces) return;
    // Re-splitting is still allowed if the house permits it, so leave a pair of
    // aces live for the player to split again.
    if (this.rules.resplitAces && bjRankOfCard(hand.cards[1]!) === 0) {
      if (this.hands.length < this.rules.maxSplitHands) return;
    }
    hand.finished = true;
  }

  /** Move to the next unfinished hand, dealing it a card if it has only one. */
  private advance(): void {
    for (;;) {
      const hand = this.hands[this.activeHandIndex];
      if (hand && !hand.finished) {
        if (hand.cards.length === 1) {
          hand.cards.push(this.draw());
          this.settleSplitAce(hand);
          continue;
        }
        this.phase = 'player';
        return;
      }
      if (this.activeHandIndex >= this.hands.length - 1) break;
      this.activeHandIndex++;
    }
    this.playDealer();
    this.settle();
  }

  // --- Grading -------------------------------------------------------------

  /**
   * EV of every legal action.
   *
   * In chart mode the numbers come from the derived basic-strategy chart, which
   * is what the app is teaching, restricted to the actions actually legal here —
   * a chart cell is built from two-card hands and so carries a `double` EV that
   * a three-card hand cannot use. If the cell cannot cover the spot, the exact
   * solver answers instead rather than the grade being quietly wrong.
   */
  private evaluate(hand: PlayerHand, legal: BlackjackAction[]): DecisionEvaluation {
    if (this.grading === 'chart') {
      const key = scenarioKeyForHand(
        hand.cards.map(bjRankOfCard),
        bjRankOfCard(this.dealerCards[0]!),
        legal.includes('split'),
      );
      const cell = this.chart.cells.get(key);
      if (cell && legal.every((action) => cell.evByAction[action] !== undefined)) {
        const evByAction: Partial<Record<BlackjackAction, number>> = {};
        let optimalAction = legal[0]!;
        let optimalEv = -Infinity;
        for (const action of legal) {
          const ev = cell.evByAction[action]!;
          evByAction[action] = ev;
          if (ev > optimalEv) {
            optimalEv = ev;
            optimalAction = action;
          }
        }
        return { legalActions: legal, evByAction, optimalAction, optimalEv };
      }
    }

    return this.solver.evaluate(
      hand.cards.map(bjRankOfCard),
      bjRankOfCard(this.dealerCards[0]!),
      this.unseenComposition(),
      { fromSplit: hand.fromSplit, handCount: this.hands.length },
    );
  }

  /**
   * What the player cannot see: the undealt shoe plus the dealer's hole card,
   * which is out of the shoe but face down.
   */
  private unseenComposition(): Composition {
    const hole = this.dealerRevealed ? [] : this.dealerCards.slice(1);
    return this.shoe.unseenComposition(hole);
  }

  private pushDecision(input: {
    handIndex: number;
    scenarioKey: string;
    legalActions: GradedAction[];
    evByAction: Partial<Record<GradedAction, number>>;
    optimalAction: GradedAction;
    chosenAction: GradedAction;
    evCost?: number;
    severityTier?: SeverityTier;
    timeToDecideMs?: number | null;
  }): DecisionRecord {
    const best = input.evByAction[input.optimalAction] ?? 0;
    const chosen = input.evByAction[input.chosenAction] ?? 0;
    const raw = input.evCost ?? best - chosen;
    const evCost = raw < 1e-12 ? 0 : raw;

    const record: DecisionRecord = {
      sequenceIndex: this.decisions.length,
      handIndex: input.handIndex,
      scenarioKey: input.scenarioKey,
      legalActions: input.legalActions,
      evByAction: input.evByAction,
      optimalAction: input.optimalAction,
      chosenAction: input.chosenAction,
      evCost,
      severityTier: input.severityTier ?? severityForCost(evCost),
      timeToDecideMs: input.timeToDecideMs ?? null,
    };
    this.decisions.push(record);
    return record;
  }

  // --- Resolving -----------------------------------------------------------

  /** Spec §5.1.2 step 7. The dealer does not draw if no hand is still live. */
  private playDealer(): void {
    this.dealerRevealed = true;
    const live = this.hands.some(
      (hand) => !hand.surrendered && handValue(hand.cards.map(bjRankOfCard)).total <= 21,
    );
    if (!live) return;

    for (;;) {
      const { total, soft } = handValue(this.dealerCards.map(bjRankOfCard));
      if (total > 17) return;
      if (total === 17 && !(soft && this.rules.soft17 === 'H17')) return;
      this.dealerCards.push(this.draw());
    }
  }

  /** Spec §5.1.2 step 8. */
  private settle(): void {
    this.dealerRevealed = true;
    const dealerRanks = this.dealerCards.map(bjRankOfCard);
    const dealerNatural = isBlackjack(dealerRanks);
    const dealer = handValue(dealerRanks);

    let total = this.insuranceNet;
    for (const hand of this.hands) {
      hand.net = this.settleHand(hand, dealerNatural, dealer.total);
      total += hand.net;
    }
    this.settledNet = total;
    this.phase = 'settled';
  }

  private settleHand(hand: PlayerHand, dealerNatural: boolean, dealerTotal: number): number {
    if (hand.surrendered) return -0.5 * this.baseBet;

    const ranks = hand.cards.map(bjRankOfCard);
    // A hand that came out of a split is never a natural, however it is made up.
    const playerNatural = !hand.fromSplit && isBlackjack(ranks);
    const player = handValue(ranks);

    if (dealerNatural) {
      if (playerNatural) return 0;
      // In a peek game the player never got to act, so only the original wager
      // is at stake. With no hole card the dealer's natural takes the doubled
      // and split wagers too, which is what makes the rule expensive.
      return this.rules.peek ? -this.baseBet : -hand.bet;
    }

    if (playerNatural) return blackjackPayoutMultiple(this.rules) * hand.bet;
    if (player.total > 21) return -hand.bet;
    if (dealerTotal > 21) return hand.bet;
    if (player.total > dealerTotal) return hand.bet;
    if (player.total < dealerTotal) return -hand.bet;
    return 0;
  }

  // --- Records -------------------------------------------------------------

  /** The finished hand, as the shape §11 persists. */
  get handRecord(): HandRecord {
    if (this.phase !== 'settled') throw new Error('The hand is not finished');
    return {
      id: this.handId,
      rules: this.rules,
      dealtCards: [...this.dealtCards],
      playerCards: this.hands.map((hand) => [...hand.cards]),
      dealerCards: [...this.dealerCards],
      baseBet: this.baseBet,
      insuranceTaken: this.insuranceTaken,
      netUnits: this.settledNet ?? 0,
      decisions: [...this.decisions],
    };
  }
}
