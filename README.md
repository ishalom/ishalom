# ishalom
hello world, i am ishalom and i am awsome.

---

## EV Trainer

A practice app that deals real hands of Blackjack and Ultimate Texas Hold'em,
lets you decide, then grades each decision against the expected-value-maximizing
play.

It does not make either game profitable. Perfect Blackjack basic strategy still
faces a house edge of roughly 0.4–0.6% depending on the rules, and perfect UTH
strategy still faces roughly 2.2% of the ante. The app teaches you to lose less,
and says so in-product rather than burying it.

| Package | Status |
| --- | --- |
| [`packages/ev-engine`](packages/ev-engine) | Blackjack exact EV solver, derived charts, decision grading. Standalone and dependency-free. |

The EV engine is the core of the product: if it is wrong, the app actively
teaches errors. It is built and validated in isolation, ahead of the game loop
and the UI, and it ships as a library with no dependency on either.

Ultimate Texas Hold'em — the 7-card evaluator, the river and flop solvers, and
the precomputed pre-flop table — is Phase 3 and not built yet.
