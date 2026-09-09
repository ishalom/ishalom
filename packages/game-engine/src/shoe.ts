/**
 * The physical shoe: real cards, dealt in order, reshuffled at the cut card.
 *
 * Distinct from the EV engine's `Shoe`, which is a rank-bucketed composition
 * with no order and no identity — that one answers "what is left", this one
 * answers "what comes next". The two meet in `unseenComposition`, which hands
 * the solver the exact set of cards the player cannot see.
 */

import { bjRankOfCard, Shoe as Composition, type Card } from '@evtrainer/ev-engine';
import { fullDeck } from '@evtrainer/ev-engine';
import { shuffleInPlace, type Rng } from './rng.ts';

export class DealingShoe {
  readonly decks: number;
  /** Fraction of the shoe dealt before the cut card comes out. */
  readonly penetration: number;

  private cards: Card[] = [];
  private position = 0;
  private readonly rng: Rng;

  constructor(decks: number, rng: Rng, penetration = 0.75) {
    if (![1, 2, 4, 6, 8].includes(decks)) throw new Error(`Unsupported deck count: ${decks}`);
    if (penetration <= 0 || penetration >= 1) {
      throw new Error(`Penetration must be between 0 and 1, got ${penetration}`);
    }
    this.decks = decks;
    this.penetration = penetration;
    this.rng = rng;
    this.shuffle();
  }

  shuffle(): void {
    this.cards = [];
    for (let d = 0; d < this.decks; d++) this.cards.push(...fullDeck());
    shuffleInPlace(this.cards, this.rng);
    this.position = 0;
  }

  get cardsRemaining(): number {
    return this.cards.length - this.position;
  }

  get cardsDealt(): number {
    return this.position;
  }

  /** True once the cut card is reached. Checked between hands, never mid-hand. */
  get needsShuffle(): boolean {
    return this.position >= this.cards.length * this.penetration;
  }

  deal(): Card {
    if (this.position >= this.cards.length) {
      // Only reachable if a single hand outruns the whole shoe, which the cut
      // card makes impossible in practice. Failing loudly beats dealing garbage.
      throw new Error('The shoe is exhausted mid-hand');
    }
    return this.cards[this.position++]!;
  }

  /**
   * Composition of everything the player cannot see: the undealt cards, plus any
   * dealt cards still face down — the dealer's hole card, in practice.
   *
   * This is what the EV engine means by the remaining shoe. The hole card is
   * physically out of the shoe but unknown to the player, so it belongs here.
   */
  unseenComposition(hidden: readonly Card[] = []): Composition {
    const counts = new Array<number>(10).fill(0);
    for (let i = this.position; i < this.cards.length; i++) {
      counts[bjRankOfCard(this.cards[i]!)]!++;
    }
    for (const card of hidden) counts[bjRankOfCard(card)]!++;
    return Composition.fromCounts(counts);
  }

  /**
   * Force the next cards to be dealt, for Drill mode (spec §8): the engine has to
   * be able to deal "player has A,7 versus a nine" on demand, because naturally
   * dealt pairs of eights against a six turn up about once in 350 hands and
   * drilling cannot wait for them.
   *
   * The named cards are moved to the front of the undealt portion; everything
   * else keeps its shuffled order, so the rest of the shoe stays honest.
   */
  stack(cards: readonly Card[]): void {
    const wanted = [...cards];
    const rest: Card[] = [];
    for (let i = this.position; i < this.cards.length; i++) {
      const card = this.cards[i]!;
      const at = wanted.indexOf(card);
      if (at >= 0) wanted.splice(at, 1);
      else rest.push(card);
    }
    if (wanted.length > 0) {
      throw new Error(`Cannot stack cards that are no longer in the shoe: ${wanted.join(', ')}`);
    }
    this.cards.length = this.position;
    this.cards.push(...cards, ...rest);
  }
}
