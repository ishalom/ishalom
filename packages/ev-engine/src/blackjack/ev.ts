/**
 * Exact Blackjack expected-value solver (spec §6.2).
 *
 * Every action's EV is computed from first principles against the composition of
 * the remaining shoe — no chart is consulted and nothing is simulated. The EV of
 * every action is retained, not just the winner, because the feedback layer
 * needs the full vector (spec §7.1).
 *
 * All EVs are in units of the player's original wager, so a winning double
 * returns +2 and a surrender is exactly −0.5.
 *
 * Conventions
 * -----------
 * `shoe` always means the *unseen* cards: the player's cards and the dealer's
 * upcard are removed, but the dealer's hole card is not, because the player
 * cannot see it.
 *
 * In a peek game the dealer's natural is resolved before the player acts, so
 * every EV is conditioned on the dealer not holding one. In a no-hole-card game
 * it is not, so the dealer's natural stays in the distribution and collects the
 * player's doubled and split wagers too.
 */

import {
  DEALER_BLACKJACK,
  DEALER_BUST,
  DealerSolver,
  type DealerDistribution,
} from './dealer.ts';
import { addCard, handValue, isBlackjack } from './hand.ts';
import { legalActions, type BlackjackAction, type HandContext } from './actions.ts';
import { blackjackPayoutMultiple, type BlackjackRules } from './rules.ts';
import { ACE, NUM_BJ_RANKS, TEN, type BjRank } from './shoe.ts';
import type { Shoe } from './shoe.ts';

/**
 * How the dealer's distribution responds to the cards the player draws.
 *
 * `'exact'` recomputes the dealer's distribution against the true shoe at every
 * node of the player's draw recursion. It is the ground truth and it is what
 * generates the shipped charts, but a resplittable low pair can visit millions
 * of shoe states and take tens of seconds.
 *
 * `'static-dealer'` computes the dealer's distribution once, from the shoe as it
 * stands at the decision point, and holds it fixed while the player draws. It is
 * the classical treatment and the standard interactive compromise. The player's
 * own draws move an action's EV by around a thousandth of a unit at worst, which
 * sits below the 0.005 "negligible" severity floor in spec §7.2, so it cannot
 * move a decision across a severity tier. It can still flip the *recommended*
 * action on a cell where two actions are within that margin of each other, which
 * is why charts are generated in exact mode and the measured gap between the two
 * modes is asserted by `test/removal-modes.test.ts` rather than assumed.
 *
 * Interactive grading defaults to `'static-dealer'` to hold the §13 latency
 * budget; chart generation and cross-validation use `'exact'`.
 */
export type CardRemovalMode = 'exact' | 'static-dealer';

export interface SolverOptions {
  cardRemoval?: CardRemovalMode;
}

/** EV of standing on `total` against a dealer distribution. */
export function standEv(total: number, dist: DealerDistribution): number {
  if (total > 21) return -1;
  let ev = dist[DEALER_BUST]!;
  for (let d = 17; d <= 21; d++) {
    const p = dist[d - 16]!;
    if (d < total) ev += p;
    else if (d > total) ev -= p;
  }
  // A dealer natural beats every hand that can still be facing this call; a
  // player natural is resolved on the deal and never reaches here.
  ev -= dist[DEALER_BLACKJACK]!;
  return ev;
}

export interface DecisionEvaluation {
  /** Actions the rules permit in this spot, in a stable order. */
  legalActions: BlackjackAction[];
  /** EV of each legal action, in units of the original wager. */
  evByAction: Partial<Record<BlackjackAction, number>>;
  /** The argmax. Ties resolve toward the earlier entry in `legalActions` order. */
  optimalAction: BlackjackAction;
  optimalEv: number;
}

export interface EvaluateOptions {
  /** True when this hand came out of a split. */
  fromSplit?: boolean;
  /** Hands the player currently holds, including this one. Defaults to 1. */
  handCount?: number;
}

/**
 * Per-decision working state. Holding the memo tables here rather than on the
 * solver keeps `'static-dealer'` correct: its cached values are only valid
 * against the one frozen dealer distribution they were computed with.
 */
interface EvalCtx {
  upcard: BjRank;
  /** Frozen dealer distribution, or null in exact mode. */
  fixedDist: DealerDistribution | null;
  /**
   * Memo tables indexed by hand state, each holding a map from the shoe's
   * numeric signature to an EV. Splitting the key across an array index and a
   * numeric map key keeps the whole hot path free of string allocation.
   */
  standMemo: HandStateMemo;
  hitMemo: HandStateMemo;
}

/** One slot per (total, soft) pair; totals run 0..21, so 44 slots. */
type HandStateMemo = Array<Map<number, number> | undefined>;

const HAND_STATE_SLOTS = 44;

function handSlot(total: number, soft: boolean): number {
  return total * 2 + (soft ? 1 : 0);
}

function memoGet(memo: HandStateMemo, slot: number, sig: number): number | undefined {
  return memo[slot]?.get(sig);
}

function memoSet(memo: HandStateMemo, slot: number, sig: number, value: number): void {
  let table = memo[slot];
  if (table === undefined) {
    table = new Map<number, number>();
    memo[slot] = table;
  }
  table.set(sig, value);
}

function memoSize(memo: HandStateMemo | undefined): number {
  if (memo === undefined) return 0;
  let n = 0;
  for (let i = 0; i < memo.length; i++) n += memo[i]?.size ?? 0;
  return n;
}

/**
 * The solver. One instance per rule set; it carries the dealer memo tables, so
 * reusing it across the decisions of a session is what keeps latency inside the
 * §13 budget.
 */
export class BlackjackSolver {
  readonly rules: BlackjackRules;
  readonly dealer: DealerSolver;
  readonly cardRemoval: CardRemovalMode;

  /**
   * Shared across decisions in exact mode, where a cached value depends only on
   * (upcard, hand state, shoe) and so stays valid for the life of the solver.
   * Indexed by upcard.
   */
  private readonly exactStandMemo: HandStateMemo[] = [];
  private readonly exactHitMemo: HandStateMemo[] = [];

  constructor(rules: BlackjackRules, options: SolverOptions = {}) {
    this.rules = rules;
    this.cardRemoval = options.cardRemoval ?? 'static-dealer';
    this.dealer = new DealerSolver(rules);
  }

  clearCache(): void {
    this.exactStandMemo.length = 0;
    this.exactHitMemo.length = 0;
    this.dealer.clearCache();
  }

  get cacheSize(): number {
    let n = this.dealer.cacheSize;
    for (const m of this.exactStandMemo) n += memoSize(m);
    for (const m of this.exactHitMemo) n += memoSize(m);
    return n;
  }

  /** The dealer distribution the player faces, per §6.2 and the peek rule. */
  distributionFor(upcard: BjRank, shoe: Shoe): DealerDistribution {
    return this.dealer.playerFacingDistribution(upcard, shoe);
  }

  private makeCtx(upcard: BjRank, shoe: Shoe): EvalCtx {
    if (this.cardRemoval === 'exact') {
      this.exactStandMemo[upcard] ??= new Array(HAND_STATE_SLOTS);
      this.exactHitMemo[upcard] ??= new Array(HAND_STATE_SLOTS);
      return {
        upcard,
        fixedDist: null,
        standMemo: this.exactStandMemo[upcard]!,
        hitMemo: this.exactHitMemo[upcard]!,
      };
    }
    // The frozen distribution belongs to this decision point's shoe, so the memo
    // tables it feeds cannot outlive the decision.
    return {
      upcard,
      fixedDist: this.distributionFor(upcard, shoe),
      standMemo: new Array(HAND_STATE_SLOTS),
      hitMemo: new Array(HAND_STATE_SLOTS),
    };
  }

  /**
   * Grade one decision point. `playerCards` and `upcard` must already have been
   * removed from `shoe`.
   */
  evaluate(
    playerCards: readonly BjRank[],
    upcard: BjRank,
    shoe: Shoe,
    options: EvaluateOptions = {},
  ): DecisionEvaluation {
    const fromSplit = options.fromSplit ?? false;
    const handCount = options.handCount ?? 1;
    const { total, soft } = handValue(playerCards);

    if (!fromSplit && isBlackjack(playerCards)) {
      throw new Error('A natural is resolved on the deal; there is no decision to grade.');
    }
    if (total > 21) throw new Error('A busted hand has no decision to grade.');

    const ctx = this.makeCtx(upcard, shoe);
    const handCtx: HandContext = { cards: playerCards, total, soft, fromSplit, handCount };
    const legal = legalActions(handCtx, this.rules);
    const evByAction: Partial<Record<BlackjackAction, number>> = {};

    for (const action of legal) {
      switch (action) {
        case 'stand':
          evByAction.stand = this.stand(ctx, total, shoe);
          break;
        case 'hit':
          evByAction.hit = this.hit(ctx, total, soft, shoe);
          break;
        case 'double':
          evByAction.double = this.double(ctx, total, soft, shoe);
          break;
        case 'split':
          evByAction.split = this.split(ctx, playerCards[0]!, shoe, handCount);
          break;
        case 'surrender':
          evByAction.surrender = this.surrender(upcard, shoe);
          break;
      }
    }

    let optimalAction = legal[0]!;
    let optimalEv = evByAction[optimalAction]!;
    for (const action of legal) {
      const ev = evByAction[action]!;
      if (ev > optimalEv) {
        optimalEv = ev;
        optimalAction = action;
      }
    }

    return { legalActions: legal, evByAction, optimalAction, optimalEv };
  }

  // --- Individual actions, also usable directly by tests -------------------

  standEv(total: number, upcard: BjRank, shoe: Shoe): number {
    return this.stand(this.makeCtx(upcard, shoe), total, shoe);
  }

  hitEv(total: number, soft: boolean, upcard: BjRank, shoe: Shoe): number {
    return this.hit(this.makeCtx(upcard, shoe), total, soft, shoe);
  }

  doubleEv(total: number, soft: boolean, upcard: BjRank, shoe: Shoe): number {
    return this.double(this.makeCtx(upcard, shoe), total, soft, shoe);
  }

  splitEv(pairRank: BjRank, upcard: BjRank, shoe: Shoe, handCount = 1): number {
    return this.split(this.makeCtx(upcard, shoe), pairRank, shoe, handCount);
  }

  /**
   * Late surrender forfeits half the wager after the dealer has peeked, so it is
   * a flat −0.5 against the conditioned distribution. Early surrender is taken
   * before the peek, so it also dodges the dealer's natural; re-expressed on the
   * no-natural basis the other actions are measured on, that is worth more than
   * −0.5 whenever the dealer might have one.
   */
  surrenderEv(upcard: BjRank, shoe: Shoe): number {
    return this.surrender(upcard, shoe);
  }

  // --- Internals -----------------------------------------------------------

  private dist(ctx: EvalCtx, shoe: Shoe): DealerDistribution {
    return ctx.fixedDist ?? this.distributionFor(ctx.upcard, shoe);
  }

  private stand(ctx: EvalCtx, total: number, shoe: Shoe): number {
    if (total > 21) return -1;
    if (ctx.fixedDist !== null) return standEv(total, ctx.fixedDist);
    const slot = handSlot(total, false);
    const memo = memoGet(ctx.standMemo, slot, shoe.sig);
    if (memo !== undefined) return memo;
    const ev = standEv(total, this.dist(ctx, shoe));
    memoSet(ctx.standMemo, slot, shoe.sig, ev);
    return ev;
  }

  /**
   * EV of drawing, then playing optimally. Doubling is unavailable after a hit,
   * so every continuation is a stand-or-draw choice.
   */
  private hit(ctx: EvalCtx, total: number, soft: boolean, shoe: Shoe): number {
    if (total >= 21) return this.stand(ctx, total, shoe);
    const slot = handSlot(total, soft);
    const memo = memoGet(ctx.hitMemo, slot, shoe.sig);
    if (memo !== undefined) return memo;

    let ev = 0;
    const cardsLeft = shoe.total;
    for (let r = 0; r < NUM_BJ_RANKS; r++) {
      const n = shoe.count(r);
      if (n === 0) continue;
      const p = n / cardsLeft;
      const next = addCard(total, soft, r);

      let sub: number;
      if (next.total > 21) {
        sub = -1;
      } else {
        shoe.remove(r);
        const stay = this.stand(ctx, next.total, shoe);
        const draw = this.hit(ctx, next.total, next.soft, shoe);
        shoe.restore(r);
        sub = stay > draw ? stay : draw;
      }
      ev += p * sub;
    }

    memoSet(ctx.hitMemo, slot, shoe.sig, ev);
    return ev;
  }

  /** Exactly one card, then stand, at twice the stake. */
  private double(ctx: EvalCtx, total: number, soft: boolean, shoe: Shoe): number {
    let ev = 0;
    const cardsLeft = shoe.total;
    for (let r = 0; r < NUM_BJ_RANKS; r++) {
      const n = shoe.count(r);
      if (n === 0) continue;
      const p = n / cardsLeft;
      const next = addCard(total, soft, r);
      let sub: number;
      if (next.total > 21) {
        sub = -1;
      } else {
        shoe.remove(r);
        sub = this.stand(ctx, next.total, shoe);
        shoe.restore(r);
      }
      ev += p * sub;
    }
    return 2 * ev;
  }

  private surrender(upcard: BjRank, shoe: Shoe): number {
    if (this.rules.surrender !== 'early') return -0.5;
    const pNatural = this.dealer.distribution(upcard, shoe)[DEALER_BLACKJACK]!;
    if (pNatural === 0) return -0.5;
    // Unconditionally, early surrender is worth −0.5. Solve for its value on the
    // no-natural basis: −0.5 = p·(−0.5) + (1−p)·x.
    return (-0.5 - pNatural * -0.5) / (1 - pNatural);
  }

  /**
   * Splitting a pair (spec §6.2, "Split EV").
   *
   * The recursion tracks the global hand budget exactly, so `maxSplitHands`,
   * `resplitAces` and the one-card rule on split aces are all honoured, and card
   * removal is exact within each resulting hand. What it does not model is the
   * cards one split hand draws before its sibling is dealt: each hand sees the
   * shoe minus the split cards and minus its own first card. That is the
   * standard treatment; its effect is on the order of 1e-4 EV, an order of
   * magnitude below the "negligible" floor in §7.2. It is an approximation, and
   * it is called out as one rather than buried.
   */
  private split(ctx: EvalCtx, pairRank: BjRank, shoe: Shoe, handCount: number): number {
    // Both cards of the pair are already out of `shoe`; one stays with each hand.
    return this.splitSequence(ctx, 2, handCount + 1, pairRank, shoe);
  }

  /**
   * `pending` hands still to play, `handsDealt` hands in existence. Returns the
   * summed EV of the pending hands.
   *
   * The hand budget is tracked globally rather than per branch, which is what
   * makes `maxSplitHands` of 3 come out right: a per-branch budget would let
   * each half of a split resplit independently and reach more hands than the
   * house allows.
   *
   * The sibling hands' EV is evaluated from the shoe as it stands before this
   * hand takes its card — the same "siblings do not see each other's cards"
   * simplification documented on `split`, applied consistently. Doing it this
   * way collapses ten sub-recursions per node into one and is what brings a
   * resplittable low pair inside the latency budget.
   */
  private splitSequence(
    ctx: EvalCtx,
    pending: number,
    handsDealt: number,
    pairRank: BjRank,
    shoe: Shoe,
  ): number {
    if (pending === 0) return 0;

    const canResplit =
      handsDealt < this.rules.maxSplitHands && (pairRank !== ACE || this.rules.resplitAces);

    const cardsLeft = shoe.total;
    let ev = 0;
    let pPlayedOut = 0;

    for (let r = 0; r < NUM_BJ_RANKS; r++) {
      if (r === pairRank && canResplit) continue; // handled below
      const n = shoe.count(r);
      if (n === 0) continue;
      const p = n / cardsLeft;
      pPlayedOut += p;
      shoe.remove(r);
      ev += p * this.splitHand(ctx, pairRank, r, shoe);
      shoe.restore(r);
    }

    if (canResplit) {
      const n = shoe.count(pairRank);
      if (n > 0) {
        const p = n / cardsLeft;
        // The card just drawn becomes the new hand's first card.
        shoe.remove(pairRank);
        ev += p * this.splitSequence(ctx, pending + 1, handsDealt + 1, pairRank, shoe);
        shoe.restore(pairRank);
      }
    }

    if (pPlayedOut > 0) {
      ev += pPlayedOut * this.splitSequence(ctx, pending - 1, handsDealt, pairRank, shoe);
    }
    return ev;
  }

  /** Best play of one post-split hand holding `pairRank` plus `drawn`. */
  private splitHand(ctx: EvalCtx, pairRank: BjRank, drawn: BjRank, shoe: Shoe): number {
    const { total, soft } = handValue([pairRank, drawn]);

    // Split aces get one card and stand, unless the house allows hitting them.
    if (pairRank === ACE && !this.rules.hitSplitAces) {
      return this.stand(ctx, total, shoe);
    }

    let best = this.stand(ctx, total, shoe);
    if (total < 21) {
      const draw = this.hit(ctx, total, soft, shoe);
      if (draw > best) best = draw;
    }
    if (this.rules.das) {
      const handCtx: HandContext = {
        cards: [pairRank, drawn],
        total,
        soft,
        fromSplit: true,
        handCount: 2,
      };
      if (legalActions(handCtx, this.rules).includes('double')) {
        const dbl = this.double(ctx, total, soft, shoe);
        if (dbl > best) best = dbl;
      }
    }
    return best;
  }
}

/**
 * Insurance (spec §5.1.3). The bet is half the original wager and pays 2:1, so
 * in units of the original wager it returns +1 when the dealer has a ten in the
 * hole and −0.5 otherwise. It is a bet on the hole card and nothing else — the
 * player's own hand is irrelevant, which is the lesson.
 */
export function insuranceEv(shoe: Shoe): number {
  const pTen = shoe.probability(TEN);
  return pTen - 0.5 * (1 - pTen);
}

/** Value of a player natural against the given upcard, for completeness. */
export function naturalEv(
  upcard: BjRank,
  shoe: Shoe,
  rules: BlackjackRules,
  dealer = new DealerSolver(rules),
): number {
  const pDealerNatural = dealer.distribution(upcard, shoe)[DEALER_BLACKJACK]!;
  return (1 - pDealerNatural) * blackjackPayoutMultiple(rules);
}
