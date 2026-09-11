# Adaptive difficulty: an Elo rating over the strategy chart

**Status: designed and calibrated, not implemented.** Nothing in `packages/`
references any of this yet. It is written down because the calibration cost real
analysis and reproducing it from scratch would be expensive.

Every number below was recomputed against `deriveChart()` output for
6 decks, H17, DAS, no surrender, and reproduces to three significant figures.

## The idea

The player has a rating. Each scenario has a difficulty rating. Every decision is
a match between them: play it right and you beat the hand, play it wrong and it
beats you. The rating then chooses what gets dealt next, so the game tracks the
player instead of dealing uniformly at random.

Three constraints from the spec shape it:

- §3.2 — errors are graded by cost, never binary.
- §16 — no mechanic that pressures a return. No streaks, no absence decay, no
  notifications. The rating may fall; nothing chases the player about it.
- §14.3 — the house-edge simulation must stay reachable only by an unrigged
  shoe, or the best bug detector in the repo quietly stops working.

## Difficulty and importance are opposites

This is the trap, and it is worth stating before any formula.

The **thinnest** cells are hard to know and nearly free to miss: `soft 13 vs 5`
at a margin of 0.0032, `soft 18 vs 2` at 0.0027, `hard 16 vs 10` at 0.0053.
The **widest** are trivial to know and ruinous to miss: `10,10 vs A` at 1.0028,
`10,10 vs 9` at 0.970.

So "how hard is this to get right" and "how much does getting it wrong cost" run
in opposite directions, and no single number is both.

## The shared primitive: expected leak

Neither `margin` nor `evCost` answers "what does not knowing this cell actually
cost", because margin is the cost of the *least bad* error. It rates
`hard 17 vs 6` (margin 0.505) as catastrophically expensive, when nobody on earth
hits a 17 against a six.

So model a noisy player — action choice logit in EV, temperature τ:

```
P(a) = exp(ev_a / τ) / Σ_b exp(ev_b / τ)     over the cell's legal actions
L    = Σ_a P(a) · (optimalEv − ev_a)          expected units given up per encounter
τ    = 0.05
```

`ev_a` is `ChartCell.evByAction[a]`. Nothing new is computed.

τ = 0.05 is tuned: large enough that a 0.005-margin cell is near a coin flip,
small enough that catastrophic actions vanish (P(double 16 v 10) ≈ 1e-5). At
τ = 0.15 the model doubles 16 against a ten 1.4% of the time and `L` is nonsense.

Verified values:

| cell | margin | L |
| --- | --- | --- |
| `hard16:vs10` | 0.0053 | 2.50e-3 |
| `hard12:vs10` | 0.1614 | 6.25e-3 |
| `soft18:vs9` | 0.0842 | 1.66e-2 |
| `pair8:vs10` | 0.0604 | 2.27e-2 |
| `hard17:vs6` | 0.5054 | 2.06e-5 |
| `pair8:vs6` | 0.4984 | 2.34e-5 |
| `pairT:vsA` | 1.0028 | 1.95e-9 |

**L is humped in margin, not monotonic.** It peaks around margin ≈ 0.06 — the
measured maximum over the whole chart is `pair6:vs2` at margin 0.0637. Razor-thin
cells cost nothing to miss; obvious cells are never missed; the money is in the
middle. This single property is what makes the three modes genuinely different
ladders rather than one list reordered.

## The three modes

All three map to Elo with the same shape — log-linear, additive floor, hard
clamp — and differ only in what goes in:

```
Elo = clamp( round5( 1500 + SLOPE · (x − CENTRE) ), 800, 2200 )
```

with `f` = decisions per 1000 hands and `m` = `ChartCell.margin`:

| mode | x | SLOPE | CENTRE | serves |
| --- | --- | --- | --- | --- |
| **Basic** (default) | `log10(L + 3e-4)` | 700 | −2.20 | beginners: the hands where errors cost money |
| **Recall** | `−log10(m + 0.004) − 0.5·log10(f + 0.15)` | 660 | +0.64 | players who know the fundamentals and need the awkward cells |
| **Value** | `log10((L + 3e-4)·(f + 0.15))` | 450 | −2.05 | §9.3 exactly: cost × frequency |

The additive floors are soft clamps at roughly the resolution below which each
quantity stops meaning anything, so `10,10 vs A`'s L of 1e-9 cannot blow the log
scale open.

**Hardcode the constants. Do not z-score against the live chart.** They were
fitted independently on three rule sets and varied under 5%:

| rule set | Basic | Recall | Value |
| --- | --- | --- | --- |
| 6D H17 no surrender | 720 / −2.221 | 670 / +0.638 | 460 / −2.044 |
| 6D H17 late surrender | 700 / −2.117 | 650 / +0.661 | 430 / −2.009 |
| 2D S17 no surrender | 720 / −2.252 | 650 / +0.626 | 440 / −2.098 |

A per-chart z-score would silently redefine what 1700 means the moment the user
switched from S17 to H17.

Worked ratings, showing the three ladders disagreeing on purpose:

| scenario | Basic | Recall | Value |
| --- | --- | --- | --- |
| `hard16:vs10` | 1265 | 1900 | 1980 |
| `hard12:vs10` | 1510 | 1105 | 2100 |
| `soft18:vs9` | 1800 | 1710 | 1715 |
| `pair8:vs6` | 800 | 1335 | 800 |
| `pairT:vsA` | 800 | 835 | 1165 |
| `insurance` | 1700 | 1370 | 2200 |

**Basic has a real ceiling near 1900.** No cell's plausible error costs more than
about 0.023 units. Do not stretch the slope to fake a 2200 — clamp the player's
Basic rating at 1950 and, around 1850, tell them they have stopped making
expensive mistakes and should switch mode. A mode that graduates you is a
feature; 300 points of fabricated headroom is the kind of thing §16 is about.

## The update

Per decision, against the dealt scenario's rating:

```
E  = 1 / (1 + 10^((D − R) / 400))
R' = R + K · (S − E)
```

It is one-sided Elo — item difficulties are fixed, coming from the solver rather
than from other players — which makes it a Rasch ability estimate. Say so in the
code: it licenses fixed difficulties, no rating inflation, and no cold-start
population problem.

**Partial credit, not binary:**

| severity | evCost | S |
| --- | --- | --- |
| optimal | 0 | 1.0 |
| negligible | ≤ 0.005 | 0.5 |
| minor | ≤ 0.03 | 0.25 |
| significant / blunder | > 0.03 | 0.0 |

Severity scales **S, never K**. If it scaled K, the fixed point would depend on
the K schedule and a player's equilibrium rating would change whenever K was
retuned — the rating would stop meaning anything. Scaling S keeps the update a
proper stochastic-approximation step whose fixed point is "the difficulty at
which your expected partial credit is 0.5".

K tapers on rated decisions: **40** under 30, **24** to 149, **16** to 599,
**10** thereafter. Never below 10 — a rating that can only asymptote upward is
the ratchet §16 forbids.

Measured against a synthetic player of known ability: unbiased to within ~5 Elo,
within ~10 Elo of true ability by 100 decisions, steady-state jitter ±23 at
K = 10. Display rounded to the nearest 10 and never advertise more precision
than that.

### The property that makes §3.2 free

Nothing needs bolting on to grade errors by cost. Against a 2200-rated cell a
1642 player gains 23 for a correct play and loses **1** for an error; against a
1050 cell they gain 1 and lose **23**. Cheap mistakes only happen on cells that
are hard by construction, so they cost almost no rating. The Elo maths already
does what §3.2 asks.

## Selection

Sample, never argmax.

```
step 0  with probability 0.15, ignore the rating entirely and deal a hand drawn
        from the natural frequency distribution, unstacked
step 1  D_eff(s) = D_mode(s) + δ(s)              δ is the personal offset, 0 until history exists
step 2  w(s) = w_mode(s) · exp( −(D_eff(s) − R − 50)² / (2σ²) ) · A(s) · W(s)
        σ = 120
step 3  while ESS < 12 and σ < 400:  σ ← 1.5σ    ESS = (Σw)²/Σw²
step 4  weighted random draw
```

`R + 50` targets an expected score near 0.43 — just past the edge of competence,
which is where learning happens and where the estimator is most informative.

Step 3 is what stops Basic mode becoming a seven-hand drill at high ratings: only
about seven cells sit within ±150 of 2000 in Basic, so the band has to widen.

`A(s)` is zero for the last 5 scenarios dealt, for anything whose cards are no
longer in the shoe, and for anything already occupying 5 of the last 100
selections — the last of those is what stops `insurance` (Value 2200, faced every
13 hands) eating a fifth of the session.

Measured over 1000 consecutive deals: 140–218 distinct cells appear, and the ten
most-dealt are 13–24% of the stream. Neither deterministic nor a hardest-cell
drill.

### Personal weakness, once history exists

```
q  = 1 − E(R, D_mode(s))                    model-expected error rate
p̂  = (errors + κ·q) / (attempts + κ)        κ = 8 pseudo-attempts
δ(s) = 173.7 · [ logit(p̂) − logit(q) ]      clamped to ±250
```

**δ feeds selection only, never the update.** If personal difficulty fed the
rating, cells you are bad at would become "hard" and stop costing you rating for
missing them — the rating would be self-referential. This is the single most
important structural rule in the design.

## Cold start

Start at **1200**, not 1500: the median cell is 1500 by construction and a new
player is not median. K = 40 recovers a true 1900 within ~100 decisions anyway,
and the first ten minutes should not be a wall of blunder cards.

- **Hands 1–10:** dealt naturally, no stacking. Establishes an honest frequency
  baseline and produces a valid house-edge figure for §16's onboarding
  disclosure.
- **Hands 11–20:** a placement ladder at 1050 → 2000, sampling uniformly among
  the five cells nearest each rung so two new players do not see the same ten
  hands.
- **After 20:** the sampler above.

Placement accuracy after 20 hands is about ±80 Elo. Show the rating as
provisional until 30 rated decisions.

## Honesty constraints

**Off-grid decisions must not score.** About 15% of real decisions land on
scenario keys with no chart cell — hard 18 through 21, which `allScenarios()`
does not cover but `scenarioKeyForHand` produces constantly. Standing on 19 is
trivially correct, so scoring those would hand every player a stream of free rating.
**Rule: update only when `chart.cells.has(scenarioKey)`.** Grade and display
feedback as normal; just do not rate it.

**Peek aborts are common.** With a stacked ace upcard the dealer has blackjack
about 31% of the time and the hand settles before the player acts; against a
stacked ten it is about 8%. An aborted hand produces no decision, no rating
update, and does not consume the selection — retry up to 3 times, then resample.
Do **not** suppress dealer blackjacks to make drilling smoother; that is teaching
a false game and it would break house-edge agreement.

**Adaptive dealing distorts felt frequency.** After 500 adaptive hands a player
may have seen 8,8 against a six twenty times, where a real 500-hand session shows
it zero or once. Mitigations: the 15% natural mix above; a persistent badge
saying hands are chosen rather than dealt; the true frequency stated in words on
the mastery cell and the feedback card; and a Realistic toggle that disables
selection entirely, which is the mode the house-edge figure is quoted from.

**Keep the selector out of `game-engine`.** `BlackjackTable` must gain no
scenario-selection option. The adaptive layer belongs in a separate package and
should drive the table only through the already-public `shoe.shuffle()` and
`shoe.stack()`. Then `scripts/simulate.ts` — the §14.3 harness — cannot inherit
it, because `game-engine` does not depend on the package that holds it.

**Session stats break under selection.** `effectiveHouseEdgePercent` and
`netUnits` are per-hand and meaningless once hands are chosen. Track them over
naturally-dealt hands only, and suppress the house-edge figure until 50 natural
hands exist. `evLost` and `accuracy` are per-decision and stay valid, but are no
longer comparable to a natural session.

## Data model

Extends §11's `ScenarioStat` with `attemptsNatural`, `attemptsAdaptive`,
`errorsBySeverity`, `evCostTotal`, `confusion` (what was chosen when wrong), and
`lastDifficulty`. The natural/adaptive split matters because selection targets
cells you are bad at, so raw error rate on adaptive attempts is upward-biased.

New, keyed by `(playerId, mode)` and deliberately **not** by rule set — the
difficulties are per-rule-set, the ability is not:

```
PlayerRating { playerId, mode, rating, ratedDecisions, provisional, peak, updatedAt, history[] }
```

A shipped frequency asset is also needed: `{ scenarioKey: decisionsPer1000Hands }`
from a 2,000,000-hand run of the engine's own optimal play (~2 minutes). One
table serves all rule sets — measured per-cell frequency moved less than Monte
Carlo noise between S17 and H17. **Never derive it from the player's own play**,
or adaptive dealing feeds its own distortion back into the rarity term.

## Build order

1. The frequency asset — everything depends on it.
2. `difficulty.ts`: the τ-logit leak, the three rating functions, fixed
   constants, and a golden-file snapshot of all 311 × 3 ratings. That snapshot is
   the contract.
3. `rating.ts`: expected score, partial credit, K schedule, update. Pure.
4. `selector.ts`: sampler, ESS widening, recency and cap filters, δ.
5. The drill dealer: scenario key → cards, shuffle-then-stack, peek-abort retry.
   The only module permitted to call `shoe.stack()`.
6. Wire into the session: natural vs adaptive stat split, the badge, placement.
7. Persistence.

**Prerequisite for all of it:** the session currently discards every
`HandRecord`. Per-scenario history has to exist before any of this can run.
