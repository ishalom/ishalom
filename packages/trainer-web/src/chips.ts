/**
 * Chip betting (round 6b): the bet a player builds, the table limits, the stack.
 *
 * The engine and every grade stay in units. A bet here is only a multiplier —
 * chips per unit — so a blunder at a bet of 100 costs exactly the rating, the
 * EV and the accuracy it costs at 1, and only the stack feels the difference.
 * Both sessions keep one of these books, so the two tables bet the same way.
 *
 * Idan's decision (round 6, option B): the bet is limited by the table limits
 * and nothing else. A hand that needs more than the stack holds — a split and a
 * double, an Ultimate raise — still plays, and the stack may go below zero until
 * the free rebuy. The arithmetic stays exact.
 */

/** The chips on the rail, smallest first. */
export const CHIP_VALUES: readonly number[] = [1, 5, 25, 100];

/** The table limits printed on the felt. */
export const TABLE_LIMITS: Readonly<{ min: number; max: number }> = { min: 1, max: 100 };

/** What a new player sits down with, and what the free rebuy returns the stack to. */
export const STARTING_CHIPS = 200;

export type BetOp = 'add' | 'removeLast' | 'clear' | 'repeat' | 'double';

export interface ChipBook {
  /** Chips behind the bet. May be negative: see the note at the top. */
  stack: number;
  /** The bet ready for the next hand, in chips per unit. Zero after Clear. */
  bet: number;
  /** The bet the last hand was dealt at, which Repeat and Double read. */
  lastBet: number;
  /** The chips the bet is made of, in the order placed, so a tap takes back the last. */
  placed: number[];
}

/** What the rail needs to draw and enable its controls. */
export interface ChipsView {
  stack: number;
  bet: number;
  lastBet: number;
  limits: { min: number; max: number };
  values: number[];
  /** One per value in `values`: whether adding it stays inside the limit. */
  canAdd: boolean[];
  canRemove: boolean;
  canClear: boolean;
  canRepeat: boolean;
  canDouble: boolean;
  canDeal: boolean;
  needsRebuy: boolean;
  startingChips: number;
}

/**
 * Chips as figures: exact to the cent.
 *
 * A unit result can be 1.5 or 1.2 (a natural at 3:2 or 6:5) and a bet is any
 * whole number, so products like 1.2 × 7 land a hair off in floating point. The
 * stack is the one figure on the table that is meant to be plain arithmetic.
 */
export function roundChips(value: number): number {
  return Math.round(value * 100) / 100;
}

export function validBet(bet: number): boolean {
  return Number.isInteger(bet) && bet >= TABLE_LIMITS.min && bet <= TABLE_LIMITS.max;
}

/** The chips a bet is laid out in, largest first, so the smallest is taken back first. */
export function chipsFor(bet: number): number[] {
  const out: number[] = [];
  let left = Math.max(0, Math.floor(bet));
  for (const value of [...CHIP_VALUES].reverse()) {
    while (left >= value) {
      out.push(value);
      left -= value;
    }
  }
  return out;
}

export function newChipBook(): ChipBook {
  return { stack: STARTING_CHIPS, bet: 1, lastBet: 1, placed: [1] };
}

export function needsRebuy(book: ChipBook): boolean {
  return book.stack < TABLE_LIMITS.min;
}

/** One change to the bet. Throws, and changes nothing, when it would break the limits. */
export function applyBet(book: ChipBook, op: BetOp, chip?: number): ChipBook {
  switch (op) {
    case 'add': {
      if (typeof chip !== 'number' || !CHIP_VALUES.includes(chip)) throw new Error('No such chip');
      if (book.bet + chip > TABLE_LIMITS.max) throw new Error(`The table maximum is ${TABLE_LIMITS.max}`);
      return { ...book, bet: book.bet + chip, placed: [...book.placed, chip] };
    }
    case 'removeLast': {
      const last = book.placed[book.placed.length - 1];
      if (last === undefined) throw new Error('There is no chip to take back');
      return { ...book, bet: book.bet - last, placed: book.placed.slice(0, -1) };
    }
    case 'clear':
      return { ...book, bet: 0, placed: [] };
    case 'repeat':
      if (!validBet(book.lastBet)) throw new Error('There is no last bet to repeat');
      return { ...book, bet: book.lastBet, placed: chipsFor(book.lastBet) };
    case 'double': {
      const doubled = book.lastBet * 2;
      if (!validBet(doubled)) throw new Error(`The table maximum is ${TABLE_LIMITS.max}`);
      return { ...book, bet: doubled, placed: chipsFor(doubled) };
    }
    default:
      throw new Error(`No such bet change: ${String(op)}`);
  }
}

/** The free rebuy: only below the table minimum, always back to the starting stack, the bet untouched. */
export function rebuyBook(book: ChipBook): ChipBook {
  if (!needsRebuy(book)) throw new Error('A rebuy is for a stack below the table minimum');
  return { ...book, stack: STARTING_CHIPS };
}

/** The rail's view of a book. Nothing changes during a hand, so every control is off then. */
export function chipsView(book: ChipBook, betweenHands: boolean): ChipsView {
  const doubled = book.lastBet * 2;
  const rebuy = needsRebuy(book);
  return {
    stack: book.stack,
    bet: book.bet,
    lastBet: book.lastBet,
    limits: { ...TABLE_LIMITS },
    values: [...CHIP_VALUES],
    canAdd: CHIP_VALUES.map((value) => betweenHands && book.bet + value <= TABLE_LIMITS.max),
    canRemove: betweenHands && book.placed.length > 0,
    canClear: betweenHands && book.bet > 0,
    canRepeat: betweenHands && validBet(book.lastBet) && book.lastBet !== book.bet,
    canDouble: betweenHands && validBet(doubled) && doubled !== book.bet,
    canDeal: betweenHands && validBet(book.bet) && !rebuy,
    needsRebuy: betweenHands && rebuy,
    startingChips: STARTING_CHIPS,
  };
}

/**
 * A saved book, read defensively.
 *
 * A record passed around a family can be half-written, and older saves have no
 * bet at all: those come back at a bet of 1, which is what every hand before
 * round 6b was played at. The stack is worked out by the caller, because the
 * two games saved it differently before this existed.
 */
export function readChipBook(
  saved: { bet?: unknown; lastBet?: unknown } | null | undefined,
  stack: number,
): ChipBook {
  const bet = typeof saved?.bet === 'number' && (saved.bet === 0 || validBet(saved.bet)) ? saved.bet : 1;
  const lastBet = typeof saved?.lastBet === 'number' && validBet(saved.lastBet) ? saved.lastBet : 1;
  return {
    stack: Number.isFinite(stack) ? roundChips(stack) : STARTING_CHIPS,
    bet,
    lastBet,
    placed: chipsFor(bet),
  };
}
