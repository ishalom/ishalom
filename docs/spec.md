# EV Trainer — Feature Specification Document

> **Version 1.0 (draft).** Recovered 2026-09-10 from the session transcript.
> The original PDF (`a2905d1a-strategytrainerspec.pdf`, 253,281 bytes) is lost —
> it lived on the sandbox where this project started.
>
> This is the specification's own text. The only changes are mechanical:
> ligatures restored to letters (`ﬂop` → `flop`), the extractor's page markers
> removed, wrapped lines reflowed, and markdown punctuation added for headings,
> lists and the EV formulas. **No word has been changed, added or removed.**
> That is checked, not asserted:
>
> ```
> node packages/trainer-web/scripts/verify-spec.js <recovered.txt>
> MATCH — 3598 words, identical in sequence.
> ```
>
> **One known imprecision.** The extractor dropped the bullet glyphs, so where a
> list item begins is inferred from the PDF's wrap width. Around the wrap point
> that signal runs out, and a few bullets will sit one line early or late. The
> words are in the right order regardless; only the grouping is affected.
>
> Lines the extractor duplicated are kept and marked `[extraction artefact]` in
> place rather than silently repaired.
>
> Where the code departs from this document, see [spec-deviations.md](spec-deviations.md).

---

**EV Trainer — Feature Specification Document**

**Product:** A practice app that deals real hands of Blackjack and Ultimate Texas Hold'em, lets the user decide, then grades each decision against the expected-value-maximizing play.
**Version:** 1.0 (draft)
**Status:** For review

## 1. Problem and Goal

Most people who play Blackjack or Ultimate Texas Hold'em (UTH) play by instinct. Both games have a mathematically correct decision for every situation, and deviating from it costs money over time. The gap between an average player and a perfect-strategy player is roughly 1.5–2% of action in Blackjack and around 1.5% in UTH.

- The goal of this app is to close that gap through repetition with immediate, quantified feedback.
- Primary objective: A user who completes the training program should play both games at or near optimal strategy from memory, without a chart.
- Success metrics:
- Decision accuracy above 99% in Blackjack, above 97% in UTH, sustained over 500 hands
- Average EV lost per 100 hands trending toward zero
- Every scenario in the mastery grid marked "mastered" (defined in §9)
Explicit non-goal: This app does not make either game profitable. Perfect Blackjack basic strategy still faces a house edge of roughly 0.4–0.6% depending on rules. Perfect UTH strategy still faces roughly 2.2% of the ante. The app teaches users to lose less, and this framing is stated in-product rather than buried.

## 2. Scope

- In scope (v1)
- Blackjack: full hand play with configurable rule sets, basic-strategy grading
- Ultimate Texas Hold'em: full hand play with all three decision points, EV grading
- Per-decision feedback with severity grading and plain-language explanation
- Targeted drilling weighted toward the user's weak scenarios
- Progress tracking, mastery grid, session analytics Local-first data storage
- Out of scope (v1)
- Card counting / true count deviations (planned for v2, see §15)
- Real-money play or any wagering integration
- Multiplayer, leaderboards, social features
- Other table games (Three Card Poker, Mississippi Stud, Baccarat)
- Live-dealer video

## 3. Core Pedagogical Principles

These constrain every design decision downstream and should not be traded away for engagement.

### 3.1 Decision quality is separated from outcome

The single most common learning failure in gambling is confusing "I won" with "I played well." A player who hits 12 against a dealer 6 and draws a 9 got a good outcome from a bad decision, and will learn the wrong lesson.

Requirement: Feedback is delivered on the decision, and the grade is shown before or independently of the hand's result. The result is displayed afterward and visually de-emphasized. Session stats lead with EV accuracy, not win/loss.

### 3.2 Errors are graded by cost, not treated as binary

- Standing on 16 vs dealer 10 instead of hitting costs about 0.004 in EV. Standing on 12 vs dealer 10 costs about 0.10. Treating these identically wastes the user's attention.
- Requirement: Every error is tagged with its EV cost and bucketed into severity tiers (§7.2). Drill weighting is proportional to cost × frequency, not to raw error count.

### 3.3 Correctness is rule-dependent, and the app says so

The right play changes with the rule set. Doubling 11 against a dealer Ace is correct when the dealer hits soft 17 and wrong when the dealer stands. A trainer that teaches one chart as universal truth teaches a bug.

- Requirement: The active rule set is always visible during play. Any strategy answer that flips under a different common rule set is flagged in the explanation.

### 3.4 The explanation carries the learning

- "Wrong, you should have hit" teaches nothing. The reason has to be legible.
- Requirement: Every feedback card includes the EV of each available action and a one-sentence causal explanation.

## 4. Users

- Persona Description Primary need
- The chart memorizer
- Knows basic strategy exists, has seen a chart, cannot recall it under pressure
- Repetition until recall is automatic
- The confident intuitive
- Plays regularly, believes they play well, has 5–
- 10 systematic leaks
- Diagnosis — showing them which specific spots cost money
- Persona Description Primary need
- The complete beginner
- New to UTH especially, does not know the decision points
- Guided rules- first onboarding, then play

## 5. Game Modules

### 5.1 Blackjack

- 5.1.1 Configurable rules
- The rule set is a first-class object. It drives both the game engine and the strategy engine.
- Rule Options Default
- Number of decks
- 1, 2, 4, 6, 8 6
- Dealer on soft
- 17
- Hits (H17) / Stands (S17) H17
- Double allowed on
- Any two cards / 9–
- 11 only / 10–11 only
- Any two
- Rule Options Default
- Double after split (DAS)
- Allowed / Not allowed
- Allowed
- Surrender None / Late / Early Late
- Resplit pairs Up to 2/3/4 hands 4 hands
- Resplit aces Allowed / Not allowed
- Not allowed
- Hit split aces Allowed / Not allowed
- Not allowed
- Blackjack payout 3:2 / 6:5 3:2
- Dealer peek for blackjack
- Peek / No peek (ENHC)
- Peek
- Preset bundles ship for common real-world games:
- Vegas Strip 6-deck S17, Downtown H17, Single Deck 6:5, European No-Hole-Card.
- The 6:5 preset carries an in-app note that this rule alone adds roughly 1.4% to the house edge — a rule choice that costs more than every strategy error a typical player makes combined.
- 5.1.2 Hand flow
1. User places a notional bet (units, not currency) 2. Deal two player cards, one dealer upcard
3. Insurance decision if dealer shows an Ace
4. If dealer has blackjack (peek games), resolve immediately
5. Player action loop: Hit / Stand / Double / Split / Surrender, filtered to legal actions
6. Split hands are played sequentially, each generating its own decision events
7. Dealer plays out per rule set
8. Resolve, display outcome
- 5.1.3 Decision points graded
- Insurance (take / decline)
- Primary action on every player turn
- Each split hand independently
- 5.1.4 Scenario space
- The mastery grid covers:
- Hard totals 5–17 vs upcards 2–A → 130 cells
- Soft totals A2–A9 vs upcards 2–A → 80 cells
- Pairs 2,2 through A,A vs upcards 2–A → 100 cells Insurance → 1 cell
- Roughly 310 trainable scenarios per rule set.

### 5.2 Ultimate Texas Hold'em

- 5.2.1 Rules implemented
- Player posts Ante and Blind, equal and mandatory Optional Trips side bet
- Player and dealer each receive 2 hole cards; 5 community cards community cards
- Three decision points, each terminal-or-continue:
- Pre-flop: check, or make Play bet at 4× ante (3× also offered; see §5.2.3)
- After flop (only if checked pre-flop): check, or Play bet at 2× ante
- After river (only if checked twice): Play bet at 1× ante, or fold
- Folding forfeits Ante and Blind
- Dealer qualifies with a pair or better. If dealer does not qualify, the Ante pushes
- Play bet pays 1:1 on a win, pushes on a tie, loses on a loss
- Blind pays only on a player win with a straight or better
- 5.2.2 Blind paytable (default, configurable)
- Player hand Payout
- Royal flush 500:1
- Straight flush 50:1
- Four of a kind 10:1
- Full house 3:1
- Flush 3:2
- Straight 1:1
- Less than straight Push
- Trips paytables vary by casino; ship 2–3 common variants as selectable options, since the Trips EV (and whether the bet is worth making at all) depends entirely on which one is in play.
- 5.2.3 The 3× trap
Where a casino offers a 3× pre-flop raise alongside 4×, raising 3× is never correct — any hand strong enough to raise pre-flop is strong enough to raise the maximum. This is a discrete, teachable lesson and is surfaced as its own micro-drill.

- 5.2.4 Decision points graded
- Trips side bet (make / skip) — graded against the active paytable
- Pre-flop: 4× / 3× / check
- Flop: 2× / check
- River: 1× / fold

## 6. Strategy and EV Engine

This is the core of the product. If this component is wrong, the app actively teaches errors, so it gets the heaviest validation burden.

### 6.1 Design principle

The app does not hardcode a strategy chart copied from a website. It computes EV from first principles, then derives charts from the computation. Published charts are used only as a cross-check (§14.2). This means the engine correctly handles arbitrary rule combinations rather than only the ones someone happened to publish.

### 6.2 Blackjack EV computation

- Exact, not simulated. For a given player hand, dealer upcard, and remaining shoe composition:
Dealer distribution. Recursively compute the probability of each dealer final outcome (17, 18, 19, 20, 21, blackjack, bust) given the upcard and the depleted shoe, following the configured soft-17 rule.

- Stand EV.

```text
EV(stand) = P(dealer busts) + P(dealer
```

total < player total)

```text
          − P(dealer total > player total)
```

Hit EV. Sum over every possible next card, weighted by its probability in the current shoe:

```text
EV(hit) = Σ_c P(c) × [ bust ? −1 :
```

- max(EV(stand | hand+c), EV(hit | hand+c)) ]
- Recursion terminates on bust or on totals where hitting is impossible.
- Double EV.

```text
EV(double) = 2 × Σ_c P(c) × EV(stand |
```

- hand+c)
- Split EV. Recursive, respecting DAS, resplit limits, and split-aces restrictions. Computed as the sum of the EVs of the resulting hands with correct card removal between them.
- Surrender EV. Constant −0.5, compared against the best of the above.
- The recommended action is the argmax. The EV of every action is retained, since the feedback layer needs the full vector, not just the winner.
Performance. Exact computation for a single decision on a 6-deck shoe is well within interactive latency on a modern device. Split-heavy positions are the expensive case; memoize on (hand composition, upcard, shoe signature).

### 6.3 UTH EV computation

- The three decision points differ enormously in cost, and each needs a different approach.
- River decision (1× vs fold). Trivially exact. 45 unseen cards, so C(45,2) = 990 possible dealer holdings.
- Enumerate all, evaluate the 7-card showdown for each, compute EV of betting versus the −2 units of folding. Sub-millisecond.
- Flop decision (2× vs check). Two community cards still to come from 45 unseen, and dealer holds 2 of the remaining 43:
- C(45,2) × C(43,2) = 990 × 903 ≈ 893,970 outcomes
Exact enumeration is feasible with a fast 7-card evaluator and bit-parallel evaluation. Target under 200 ms. If the target is missed on low-end devices, fall back to exact-with-early-termination before considering Monte Carlo.

- Pre-flop decision (4× vs check). Fully exact requires:
- C(50,5) × C(45,2) = 2,118,760 × 990 ≈ 2.1 billion outcomes
Not viable at runtime. Solution: offline precomputation. Compute the full pre-flop EV table once as a build step and ship it as a lookup asset. The table is keyed on the equivalence class of the player's two hole cards — rank pair plus suitedness — giving 169 classes, each storing EV(4×) and EV(check).

- Runtime lookup is O(1).
- The offline job is a one-time cost of hours on a single machine and is re-run only if paytables or rules change.
Trips side bet. Depends only on the player's 7-card hand and the active paytable. Precompute the full distribution of final hand ranks and the resulting EV per paytable variant. For most common paytables this bet is negative-EV, and the app should say so rather than presenting "make the Trips bet" as a live strategic choice with a defensible upside.

### 6.4 Hand evaluator

Both UTH modules depend on a fast 7-card poker evaluator. Use a standard perfect-hash or lookup-table evaluator returning a comparable integer rank. This is a solved problem; do not write a naive one, as it will dominate runtime.

### 6.5 Precomputed asset summary

- Asset Size (approx) Regenerate when
- UTH pre-flop EV table (169 classes) < 10 KB
- Blind paytable changes
- Trips EV table per paytable < 5 KB each New paytable added
- Poker evaluator lookup tables ~10–130 MB depending on scheme
- Never
- Blackjack charts (derived, cached per rule set) < 5 KB each
- Rule set added

## 7. Feedback System

### 7.1 Feedback card contents

- Shown immediately after each decision, before the hand resolves:
1. Verdict — optimal, or the severity tier
2. What you did and what maximizes EV
3. EV of every legal action, sorted, in units
4. Cost of the error, if any
5. One-sentence explanation of the underlying reason
6. Rule-sensitivity flag, where applicable
- Example, Blackjack:
- Correct — Hit
- Hit: −0.212 · Stand: −0.540 · Surrender: −0.500 Sixteen against a ten is a losing hand either way.
- Hitting loses less than standing because the dealer makes 17 or better about 77% of the time.
- Under late surrender, surrender is the better play here at −0.500. Your current rule set has surrender enabled — see note.
- Example, UTH:
- Error — cost 0.31 units
- You checked. Optimal: raise 4×.
- Raise 4×: +0.42 · Check: +0.11
- With a pair this strong, the equity gained from betting four units outweighs the risk. Checking here gives up value on a hand that is well ahead of a random dealer holding.

### 7.2 Severity tiers

- Tier
- EV cost (units) Treatment
- Optimal 0 Green, brief
- Negligible
- 0 < cost ≤ 0.005
- Grey, noted but not penalized in drill weighting
- Minor
- 0.005 < cost ≤
- 0.03
- Yellow
- Significant
- 0.03 < cost ≤
- 0.10
- Orange, added to drill queue
- Blunder > 0.10
- Red, added to drill queue at high weight, triggers immediate replay offer

### 7.3 Feedback modes

- Immediate (default) — card after every decision End of hand — batched, for users who find per- decision interruption disruptive
- Silent — no feedback until end of session; used by Exam mode

## 8. Learning Modes

- Mode Description
- Free play
- Random hands, immediate feedback. The default surface.
- Drill
Non-random dealing. The engine constructs hands targeting a chosen category (e.g. "soft doubles", "UTH river decisions") or, in Weakness mode, targets scenarios where the user's historical accuracy is lowest.

- Exam
- 100 hands, no feedback until the end, produces a score and a full breakdown. produces a score and a full breakdown. <!-- [extraction artefact] the extractor emitted this sentence twice -->
- Used to certify mastery.
- Speed
- Timed decisions, 5 seconds each, to force recall rather than reasoning. Casino conditions.
- Guided For beginners. Chart visible, hints on request, no scoring.
- Mode Description
- Replay Re-play any past hand from the point of error.
- Drill hand construction: the engine must be able to deal a specific scenario (e.g. "player has A,7 vs dealer 9") rather than waiting for it to occur naturally.
- Naturally-dealt pairs of 8s vs a 6 appear roughly once in 350 hands; drilling cannot depend on chance.

## 9. Progress Tracking

### 9.1 Mastery grid

A visual heatmap of the full scenario space, one cell per scenario, colored by accuracy. This is the app's signature screen — it turns "I'm bad at blackjack" into "I'm bad at soft 18 against 9, 10, and A."

- A cell is mastered at 5 consecutive correct decisions with no error in the last 10 attempts. Mastery decays after 30 days without a correct attempt, returning the cell to the drill pool.

### 9.2 Metrics tracked

- Per session: hands played, decision accuracy %, total EV lost, EV lost per 100 hands, error breakdown by severity.
- Lifetime: per-scenario accuracy and attempt count, error trend over time, effective house edge (optimal house edge + user's EV leak, expressed as a single number), mastery percentage.
- Deliberately not emphasized: win rate, units won, streaks. Displaying these prominently would undercut §3.1.

### 9.3 Weakness detection

- Rank scenarios by (error rate) × (real-world frequency) × (average EV cost) . A rare, cheap mistake matters less than a common, expensive one.
- The top 10 feed the Weakness drill.

## 10. Screens

1. Home — resume session, mode selection, mastery summary, current rule set
2. Table — the play surface; cards, chips, action buttons, persistent rule-set badge
3. Feedback card — overlay or inline panel per §7.1 4. Mastery grid — heatmap, tappable to drill any single cell
5. Session summary — post-session breakdown
6. Analytics — trends, error history, effective house edge over time
7. Reference — the derived strategy chart for the active rule set, browsable
8. Settings — rule sets, paytables, feedback mode, table speed

### 10.1 Interaction notes

- Actions must be reachable one-handed on mobile; primary actions along the bottom edge
- Speed mode requires no confirmation taps
- The rule-set badge is always visible on the table screen, non-dismissible
- Card dealing animation must be skippable and default to fast; this is a drilling tool, not a casino simulator

## 11. Data Model

- RuleSet id, game, name, parameters{}, isPreset
- Session id, ruleSetId, mode, startedAt, endedAt, handCount, decisionCount, totalEvLost
- Hand id, sessionId, game, dealSeed, initialState{}, finalState{}, outcome, netUnits
- Decision id, handId, sequenceIndex, scenarioKey, legalActions[], evByAction{}, optimalAction, chosenAction, evCost, severityTier, decidedAt, timeToDecideMs
ScenarioStat scenarioKey, ruleSetId, attempts, correct, lastAttemptAt, consecutiveCorrect, masteredAt scenarioKey is the join between play and progress; it must be a stable, canonical string. Examples: bj:hard16:vs10 , bj:pairA:vs6 , uth:preflop:AKs , uth:river:twopair:board_XXXXX .

UTH flop and river scenarios need a defensible abstraction — grouping by made-hand category plus board texture rather than exact cards, or the scenario space becomes too sparse to produce meaningful statistics.

## 12. Technical Architecture

<!-- [extraction artefact] the PDF wrapped every row of this drawing in
     half; it is reproduced as extracted rather than guessed back together. -->
```text
┌───────────────────────────────────
──────┐
│   UI layer
│
│   screens, animation, input
│
└──────────────┬────────────────────
──────┘
               │
┌──────────────▼────────────────────
──────┐
│   Session controller
│
│   mode logic, drill selection, routing
│
└──────┬───────────────────────┬────
──────┘
       │                        │
┌──────▼──────────┐
┌────────▼──────────┐
│   Game engines   │    │   Feedback layer
│
│   BJ state m/c   │    │   grading,
│
│   UTH state m/c  │    │   explanations
│
└──────┬──────────┘
└────────┬──────────┘
       │                        │
       └───────┬───────────────┘
               │
┌──────────────▼────────────────────
──────┐
│   Strategy / EV engine
│
│   BJ exact solver · UTH solver ·
│
│   hand evaluator · precomputed tables
│
└──────────────┬────────────────────
──────┘
               │
┌──────────────▼────────────────────
──────┐
│   Persistence (local-first)
│
└───────────────────────────────────
──────┘
```

- Key constraints:
- The EV engine is pure and deterministic — same inputs, same outputs, no I/O. This makes it exhaustively testable.
- The EV engine has no dependency on the UI or persistence layers and should be shippable as a standalone library.
- Heavy computation runs off the main thread.
- Local-first: the app is fully functional offline. Any sync is additive.
- Platform recommendation: cross-platform (React Native or Flutter) with the EV engine written once in a portable form. The precomputed tables are platform- agnostic assets.

## 13. Non-Functional Requirements

- Requirement Target
- Decision-to- feedback latency < 100 ms typical, < 300 ms worst case (UTH flop)
- Cold start < 2 s
- Offline Fully functional, no network required
- App size < 150 MB including evaluator tables
- Battery
- Sustained drilling should not exceed typical game-app drain
- Accessibility
- Card ranks/suits legible without color dependence; screen- reader labels on all actions
- Data
- All user data local by default; export as JSON

## 14. Validation and Testing

The correctness burden here is unusual. A bug in the EV engine does not crash the app — it silently teaches the user to play badly, and they may not find out for years.

### 14.1 Unit testing

- Dealer probability distributions verified against published tables for standard shoes
- Known-value spot checks: EV of standing on 20 vs dealer 6, EV of a double on 11 vs 6, etc.
- Hand evaluator verified against an exhaustive enumeration of all C(52,7) = 133,784,560 seven-card hands, checking rank ordering consistency

### 14.2 Cross-validation

Generate the full strategy chart from the engine for each preset rule set and diff against at least two independent published sources. Any disagreement blocks release until resolved and documented. Some cells are genuinely close and sources differ on rounding — those are documented as known- marginal, not silently overridden.

### 14.3 Simulation validation

Run 10⁸ simulated hands playing the engine's recommended action. The realized house edge must converge to the analytically expected value for that rule set within confidence bounds. This catches state- machine bugs that unit tests miss.

### 14.4 Golden-file regression

Snapshot the complete generated chart for every preset. Any change to these files in a diff requires explicit sign-off.

## 15. Roadmap

- Phase 1 — Blackjack core. Game engine, exact EV solver, feedback layer, free play, mastery grid. Ships alone as a useful product.
- Phase 2 — Drilling and analytics. Drill modes, weakness detection, exam mode, session analytics, replay.
- Phase 3 — Ultimate Texas Hold'em. Hand evaluator, UTH solver, precomputed pre-flop table, UTH scenario abstraction, Trips analysis.
- Phase 4 — Depth.
- Card counting: running/true count display,
- Illustrious 18 and Fab 4 deviations, counting drills, deck-estimation practice
- Bankroll and variance education — showing users the distribution of outcomes, not just the mean, which is where most gambling misconceptions actually live
- Additional games (Mississippi Stud, Three Card Poker) reusing the evaluator

## 16. Responsible-Use Requirements

- Not optional, and not a legal fig leaf — they follow directly from the product being honest about what it teaches.
- The onboarding flow states the residual house edge for each game in plain numbers
- Session summaries express results in units, never currency
- The app never projects winnings or implies a path to profitability
- Variance is shown honestly: a perfect player still has losing sessions constantly, and hiding this produces users who conclude they must be playing wrong
- A one-tap link to problem-gambling resources in settings
- No mechanics designed to extend session length against the user's intent — no daily-streak pressure, no loss-chasing loops

## 17. Open Questions

1. UTH scenario abstraction. How coarse should flop/river scenario grouping be? Too fine and no cell accumulates enough data for meaningful stats; too coarse and the mastery grid stops being actionable. Needs prototyping against real usage data.
2. Trips presentation. If the bet is negative-EV under every shipped paytable, is it a graded decision or purely an educational note? Grading a choice where one answer is always correct may be wasted attention.
3. Rule-set switching and progress. Does mastery transfer across rule sets? Most cells are identical between S17 and H17; a naive per-rule-set model makes users re-earn mastery they already have.
- Proposal: track mastery per scenario, and mark only the cells that actually differ as rule-specific.
4. Precomputation delivery. Ship the pre-flop table as a bundled asset, or generate on first launch? Bundling costs app size; generating costs an unacceptable first-run wait. Leaning bundled.
5. Evaluator table size. The choice of evaluator scheme trades app size against speed. Needs benchmarking on target low-end devices before committing.
