/**
 * Playing-card primitives shared by every game module.
 *
 * A card is an integer in [0, 52): `rank * 4 + suit`. This keeps cards cheap to
 * store in typed arrays and cheap to compare, which matters for the poker
 * evaluator later. Nothing here allocates during hot loops.
 *
 * Pure and deterministic: no I/O, no randomness, no dependency on any other
 * layer of the app (spec §12).
 */

/** Rank index, 0 = deuce .. 12 = ace. */
export type RankIndex = number;
/** Suit index, 0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades. */
export type SuitIndex = number;
/** Card index in [0, 52). */
export type Card = number;

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'cdhs';

export const NUM_RANKS = 13;
export const NUM_SUITS = 4;
export const NUM_CARDS = 52;

export function makeCard(rank: RankIndex, suit: SuitIndex): Card {
  return rank * NUM_SUITS + suit;
}

export function rankOf(card: Card): RankIndex {
  return (card / NUM_SUITS) | 0;
}

export function suitOf(card: Card): SuitIndex {
  return card % NUM_SUITS;
}

/** Parse a card such as `"As"`, `"Th"`, `"7c"`. Case-insensitive on the rank. */
export function parseCard(text: string): Card {
  if (text.length !== 2) throw new Error(`Not a card: ${JSON.stringify(text)}`);
  const rank = RANK_CHARS.indexOf(text[0]!.toUpperCase());
  const suit = SUIT_CHARS.indexOf(text[1]!.toLowerCase());
  if (rank < 0 || suit < 0) throw new Error(`Not a card: ${JSON.stringify(text)}`);
  return makeCard(rank, suit);
}

/** Parse a whitespace- or comma-separated list of cards, e.g. `"As Kd 7c"`. */
export function parseCards(text: string): Card[] {
  return text
    .split(/[\s,]+/)
    .filter((t) => t.length > 0)
    .map(parseCard);
}

export function formatCard(card: Card): string {
  return RANK_CHARS[rankOf(card)]! + SUIT_CHARS[suitOf(card)]!;
}

export function formatCards(cards: readonly Card[]): string {
  return cards.map(formatCard).join(' ');
}

/** A fresh, ordered 52-card deck. Shuffling belongs to the game layer. */
export function fullDeck(): Card[] {
  return Array.from({ length: NUM_CARDS }, (_, i) => i);
}
