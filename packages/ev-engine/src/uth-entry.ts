/**
 * The Ultimate Texas Hold'em half of the engine, flat.
 *
 * `index.ts` exports UTH under the `uth` namespace and the evaluator under
 * `poker`, which reads well from Node and does not survive the shared build:
 * `scripts/bundle.ts` folds every module into one scope and has no namespace
 * objects to hand out. `blackjack-browser.ts` exists for the same reason on the
 * Blackjack side. This is its counterpart, imported as `@evtrainer/ev-engine/uth`
 * by the state machine, so that one import line resolves to the same file under
 * Node, under the type checker and inside the bundle.
 *
 * It carries only what grading and settling a hand need. The pre-flop *solver*
 * comes along because it shares a module with the class labels; the table it
 * produced is what is actually read.
 */

export * from './core/cards.ts';
export { evaluate7 } from './poker/evaluator.ts';
export { severityForCost, type SeverityTier } from './blackjack/feedback.ts';
export * from './uth/index.ts';
