# @evtrainer/ev-engine

The strategy and EV engine from §6 of the EV Trainer spec, built as a standalone
library.

Spec §6 opens with "this is the core of the product. If this component is wrong,
the app actively teaches errors, so it gets the heaviest validation burden." So
it is built first and in isolation, before there is a game loop to tangle it
into, and the §14.1 tests came with it rather than after it.

## What it does

Given a hand, a dealer upcard, the exact composition of the remaining shoe and a
rule set, it returns the expected value of **every** legal action — not just the
winner, because the feedback card in §7.1 shows the whole vector.

```ts
import { BlackjackSolver, Shoe, makeRules, parseRanks, parseRank, gradeDecision }
  from '@evtrainer/ev-engine';

const rules = makeRules({ decks: 6, soft17: 'H17', surrender: 'late' });
const solver = new BlackjackSolver(rules);

const hand = parseRanks('T 6');
const upcard = parseRank('T');

const shoe = Shoe.fresh(rules.decks);   // the cards nobody has seen:
shoe.removeAll(hand);                   //   the player's cards are out,
shoe.remove(upcard);                    //   the upcard is out, the hole card is not

const decision = solver.evaluate(hand, upcard, shoe);
// decision.evByAction -> { stand: -0.5410, hit: -0.5347, double: -1.0689, surrender: -0.5 }
// decision.optimalAction -> 'surrender'

gradeDecision(decision, 'stand');
// { correct: false, evCost: 0.0410, severity: 'minor', ... }
```

Everything is in units of the original wager, so a winning double is `+2` and a
surrender is exactly `-0.5`.

## What is in it

| Module | Spec | What it holds |
| --- | --- | --- |
| `core/cards` | — | 52-card primitives shared with the future UTH modules |
| `blackjack/rules` | §5.1.1 | The rule set as a first-class object, plus the four real-world presets |
| `blackjack/shoe` | §6.2 | Ten-bucket shoe composition with an O(1) memo signature |
| `blackjack/hand` | — | Hand valuation, soft/hard, naturals, pairs |
| `blackjack/actions` | §5.1.2 | Legal-action filtering, so the solver and the game engine cannot disagree |
| `blackjack/dealer` | §6.2 | Exact dealer final-total distribution, honouring the soft-17 and peek rules |
| `blackjack/ev` | §6.2 | Stand / hit / double / split / surrender / insurance EV |
| `blackjack/scenario` | §11 | Canonical `scenarioKey`, the join between play and progress |
| `blackjack/chart` | §6.1, §6.5 | Charts derived from the EV computation, never copied from a website |
| `blackjack/feedback` | §7.2 | EV cost and severity tier — the pure part of the feedback system |

It is **dependency-free**: zero runtime dependencies, and no imports outside the
package. `test/engine-contract.test.ts` enforces that, along with §12's promise
that the engine is pure — no I/O, no clock, no randomness, same inputs and same
outputs every time.

## Running it

Requires Node 22.18+, which strips TypeScript types natively. There is no build
step and no test framework.

```sh
npm test           # 86 tests, ~15s
npm run test:slow  # adds Monte Carlo cross-validation, ~35s
npm run typecheck  # needs devDependencies installed (npm install)
npm run charts     # derives every preset's chart in exact mode into charts/
```

Verified on Linux/Node 22 and Windows/Node 26; the golden charts come out byte
identical on both. The scripts go through `scripts/test.ts` rather than putting
a glob and an environment variable straight into an npm script, because npm runs
scripts under `cmd.exe` on Windows and neither POSIX quoting nor `VAR=1 cmd`
survives that. The runner also refuses to report success when it matched no test
files — an empty suite exits 0 and looks exactly like a passing one, which is
how that bug went unnoticed in the first place.

## How it is validated (§14.1)

A bug here does not crash the app. It silently teaches the user to play badly,
and they may not find out for years. So the distributions and EVs are checked
several independent ways rather than once:

**Dealer distributions** are checked against a second implementation
(`test/helpers/dealer-oracle.ts`) written to be structurally different: it walks
*forward*, pushing probability mass out from the deal, where the solver recurses
*backward*; it keys states on the multiset of drawn cards rather than the
collapsed `(total, soft)` pair; and it re-derives hand values with its own code.
The two agree to floating-point precision (~1e-15) across 1, 2, 6 and 8 decks,
both soft-17 rules, all ten upcards, and on heavily depleted shoes. Under
`EV_ENGINE_SLOW_TESTS=1` they are also checked against four million sampled
hands per upcard.

**Known-value spot checks** cover the two the spec names by hand — standing on 20
against a six (`+0.70283`) and doubling 11 against a six (`+0.68266` holding
5,6) — plus insurance, surrender, splitting, and the §3.2 pair of errors that
have to grade differently. Each was cross-checked against twenty million
independently simulated hands, where the two-sigma band is under 0.001.

**Published cross-validation (§14.2)** is the sharpest test in the suite. The
engine's derived chart is diffed cell-for-cell against published basic strategy
for 6-deck H17 and 6-deck S17. That is 310 discrete verdicts, many decided by a
hundredth of a unit, downstream of every part of the engine — a dealer
probability error large enough to matter shows up here as a flipped cell.

The engine also reproduces, from first principles, deviations it was never told
about: the single-deck 7,7-versus-ten exception, and the no-hole-card game's
refusal to split eights against a ten or aces against an ace. Those are the
evidence that it computes from the rule set rather than reciting a chart (§6.1,
§3.3).

**Golden files (§14.4)** snapshot the full chart for every preset in
`test/golden/`. A change to one fails the suite and needs explicit sign-off.
Regenerate deliberately with `npm run charts:golden`.

**Hand-evaluator verification** — the third bullet of §14.1 — belongs to the
poker evaluator, which is Phase 3 work and is not in this commit. See below.

### What still needs a human (§14.2)

`test/fixtures/published-strategy.ts` holds the published grids the engine is
diffed against. Before release those two grids should be re-checked against at
least two *named* published sources, and any cell where sources genuinely
disagree moved into `KNOWN_MARGINAL` with the disagreement documented rather
than silently overridden. The mechanism is in place; the citations are the
reviewer's to add.

## Known approximations, stated rather than buried

Two, both deliberate, both bounded and measured by tests rather than asserted in
a comment.

**Split hands do not see each other's cards.** The recursion tracks the global
hand budget exactly, so `maxSplitHands`, `resplitAces` and the one-card rule on
split aces are all honoured, and card removal is exact within each resulting
hand. What it does not model is the cards one split hand draws before its sibling
is dealt. This is the standard treatment; a fully exact split calculation is a
research-grade computation. Its effect is on the order of 1e-4 EV, an order of
magnitude below the "negligible" severity floor in §7.2, and it changes no cell
in any preset chart.

**Interactive grading freezes the dealer's distribution.** `evaluate` defaults to
`cardRemoval: 'static-dealer'`, which computes the dealer's distribution once at
the decision point instead of recomputing it against the true shoe at every node
of the player's draw recursion. `'exact'` does the latter and is what generates
the shipped charts.

The measured gap between the two modes is under 0.005 EV per hand — below the
severity floor, so it cannot move a grade across a tier — and both modes produce
*identical* charts for every preset. `test/removal-modes.test.ts` measures this
rather than assuming it; if the gap ever grows, the suite fails and the default
gets reconsidered.

The reason for the default is §13's latency budget. Exact mode costs about a
second on the worst hand in the game (a resplittable pair of deuces against a
deuce); static-dealer mode costs about five milliseconds. Both are far cheaper
than they were before the split recursion was restructured — that one change took
the worst case from 47 seconds to 5 milliseconds.

## What is not here yet

Phase 3 of the roadmap — the whole Ultimate Texas Hold'em side of §6.3 and §6.4,
and with it the exhaustive C(52,7) evaluator check that is §14.1's third bullet:

- a fast 7-card poker evaluator, verified against all 133,784,560 seven-card hands
- the UTH river solver (exact, 990 dealer holdings)
- the UTH flop solver (exact, ~894k outcomes, under the 200 ms target)
- the offline pre-flop EV table (169 hole-card classes) and the Trips tables

The `core/cards` module is already shaped for it. Nothing in the Blackjack side
needs to change to accommodate it.
