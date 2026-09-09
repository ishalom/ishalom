/**
 * @evtrainer/game-engine
 *
 * The Blackjack game engine from spec §12: the state machine that deals hands,
 * enforces the rules, plays the dealer out and settles the money, handing every
 * decision to the EV engine to be graded.
 *
 * It sits above the EV engine and below the session controller, and knows
 * nothing about screens, storage or drill selection. Its only impurity is the
 * shuffle, and that is seeded — the same seed replays the same shoe exactly,
 * which is what Replay mode (§8) and the simulation validation (§14.3) both need.
 */

export * from './rng.ts';
export * from './shoe.ts';
export * from './table.ts';
export * from './types.ts';
