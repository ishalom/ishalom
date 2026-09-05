/**
 * @evtrainer/ev-engine
 *
 * The strategy and EV engine from spec §6, as a standalone library.
 *
 * It is pure and deterministic — same inputs, same outputs, no I/O — and it has
 * no dependency on the UI or persistence layers, which is what makes it
 * exhaustively testable and separately shippable (spec §12). It has no runtime
 * dependencies at all.
 */

export * as cards from './core/cards.ts';
export * from './blackjack/index.ts';
