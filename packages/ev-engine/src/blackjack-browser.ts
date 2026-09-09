/**
 * The Blackjack half of the engine, without the poker half.
 *
 * `index.ts` also exports the Ultimate Texas Hold'em solvers under namespaces,
 * which the browser build has no use for and which would carry the evaluator's
 * lookup tables along with them. This entry exists so the shareable build can
 * take exactly what Blackjack needs and nothing else.
 */

export * from './core/cards.ts';
export * from './blackjack/index.ts';
