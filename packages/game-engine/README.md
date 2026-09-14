# @evtrainer/game-engine

The Blackjack game engine from spec §12: the state machine that deals hands,
enforces the rules, plays the dealer out and settles the money, handing every
decision to the EV engine to be graded.

It sits above [`@evtrainer/ev-engine`](../ev-engine) and below the session
controller. It makes no strategy judgements of its own and knows nothing about
screens, storage or drill selection.

## Why it is a separate package

The EV engine is pure — no I/O, no clock, no randomness — and a test enforces
that. A game engine cannot be: it has to shuffle. Keeping them apart means the
EV engine stays exhaustively testable and separately shippable, which was the
point of building it in isolation first.

The impurity here is confined to one thing, and it is seeded. The same seed
replays the same shoe exactly, which is what Replay mode (§8) needs and what
lets a disagreeing simulation be re-run to find out why.

```ts
import { makeRules } from '@evtrainer/ev-engine';
import { BlackjackTable } from '@evtrainer/game-engine';

const table = new BlackjackTable({ rules: makeRules(), seed: 20260909 });
table.startHand(1);

while (table.view.phase === 'player' || table.view.phase === 'insurance') {
  if (table.view.phase === 'insurance') {
    table.takeInsurance(false);
    continue;
  }
  const decision = table.act('hit');
  // decision is the feedback card in §7.1: what was played, what maximises EV,
  // the EV of every legal action, the cost of the error and its severity tier.
}

table.handRecord; // the §11 Hand record, including every graded Decision
```

## What it does

| Module | Spec | What it holds |
| --- | --- | --- |
| `rng` | §11 | Seeded xoshiro128\*\*, and the only shuffle in the codebase |
| `shoe` | §5.1.2 | The physical shoe: order, the cut card, and card stacking for drills |
| `table` | §5.1.2 | The hand flow, from the deal through settlement |
| `types` | §11 | The Hand and Decision records the app persists |

The hand flow is §5.1.2 step for step: bet, deal, insurance if the dealer shows
an ace, resolve a natural immediately, then the action loop, split hands played
in the order they were created, the dealer out, and settlement.

### Grading

A decision is graded against the derived chart for the active rule set, not
against the exact remaining shoe. That is deliberate. The app teaches basic
strategy, and basic strategy is a total-dependent chart; grading against live
composition would occasionally mark a chart-correct play as an error because the
count had drifted, which is a lesson from §15's card-counting phase and not this
one. `grading: 'exact-shoe'` switches over for when that phase arrives.

### The hole card

In a no-hole-card game the dealer's second card is dealt anyway and simply never
peeked at. Drawing an unknown card now and drawing it after the player acts are
the same random card from the same shoe, so this keeps one dealing path and
leaves the rule difference where it belongs: in what the dealer's natural is
allowed to collect. Under ENHC that includes the doubled and split wagers, which
is what makes the rule expensive and what changes the correct play against a ten
or an ace.

## Validation

`npm test` runs 45 tests in about 20 seconds. The state-machine tests use the
same card-stacking facility Drill mode will, so each case names the exact cards
it needs rather than waiting for them.

**Simulation validation (§14.3)** is the one that matters. The spec asks for
10^8 hands played on the engine's own recommendation, with the realized house
edge converging to the analytic expectation — "this catches state-machine bugs
that unit tests miss."

The two sides are genuinely independent. The analytic figure comes from the EV
engine enumerating every opening deal and weighting it; the realized figure comes
from this package shuffling, dealing, acting, playing the dealer out and paying.
They share no code path, so a settlement that mis-pays a natural, a split played
out of order, or a dealer that stands on the wrong total shows up as divergence
and nowhere else.

```sh
npm run simulate -- --hands 10000000 --seed 42
npm run simulate -- --hands 1000000 --rules european-nhc
```

A 200,000-hand version runs in the default suite, and a two-million-hand version
under `EV_ENGINE_SLOW_TESTS=1`.

### House edge

`houseEdge(rules)` lives in the EV engine, because §16 makes it a product
requirement rather than a statistic: "the onboarding flow states the residual
house edge for each game in plain numbers." Computing it from the same engine
that grades the play means the figure shown to the user and the figure used to
grade them cannot drift apart.

It reproduces the published numbers, and two of the spec's own claims fall out of
it. The 6:5 payout adds **1.36%** to the house edge, against the "roughly 1.4%"
§5.1.1 puts in front of the user. And a liberal single deck — DAS, doubling on
any two, dealer standing on soft 17 — comes out **positive for the player** by
about a sixth of a per cent, which is exactly why nobody deals that game and why
the shipped single-deck preset pays 6:5 instead. The engine rediscovers the
reason for the rule from EV alone.

## What is not here yet

The session controller above this layer: modes (§8), drill selection and weakness
detection (§9.3), the mastery grid's decay rules (§9.1), and session analytics.
The pieces those need — graded decisions carrying scenario keys, hand records
carrying their deal — are already produced here.
