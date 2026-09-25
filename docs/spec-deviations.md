# Where the code departs from the spec

The specification is [spec.md](spec.md), version 1.0 (draft). This file records
every place the built product knowingly differs from it, and why. Turn numbers
refer to the conversation export the project was reconstructed from.

Nothing here is an accident that was noticed later. Each one was a decision.

---

## Departures from something the spec says

### §2 — leaderboards and social features are out of scope

**The spec says** they are out of scope for v1, listing "Multiplayer,
leaderboards, social features" alongside real-money play and live-dealer video.

**We built** a shared leaderboard and a feed of hands worth showing other
people.

**Why.** The spec scopes a product for one person practising alone. Idan's
actual use is fifteen family members sharing a link, where the social layer is
the reason anyone opens it twice (turn 23). The §3.1 risk — that competition
teaches people to chase results — is handled by *what* is shared rather than by
not sharing: the leaderboard ranks **decision quality**, and the feed carries
expensive mistakes as readily as hard spots played well. Nothing shared is about
money won.

The rating is also honest in the way the spec's own §16 asks for: it falls as
readily as it rises, so it cannot be farmed.

### §9.2 — streaks are deliberately not emphasised

**The spec says** win rate, units won and streaks are "deliberately not
emphasized. Displaying these prominently would undercut §3.1."

**We show** a run of consecutive correct decisions, on the verdict line (turn 42).

**Why.** The spec's objection is to streaks of *outcomes* — a run of won hands
is luck wearing the costume of skill. A run of correct *decisions* is the exact
quantity §3.1 says to measure, and it is the accuracy numerator counted
consecutively, so it says nothing accuracy does not already say.

Three constraints keep it on the right side of the line, and all three are
enforced by tests:

- It is **never persisted** — not to storage, not to the shared table. A run
  that survives closing the tab becomes a chain not to break.
- It **does not escalate**. The fiftieth correct decision looks and sounds
  exactly like the first; milestones add a line of text and never a bigger
  effect.
- Close calls neither extend nor break it, so it cannot be farmed on coin-flips.

Win rate and units won remain de-emphasised as the spec asks: units is the last
of the four session figures and is styled quiet.

### §12 — cross-platform (React Native or Flutter)

**The spec recommends** React Native or Flutter, with the EV engine written once
in a portable form.

**We built** a web client: a local Node server for development, a static page on
GitHub Pages for sharing, and a published artifact (turns 22, 30).

**Why.** Idan needed to play it the same afternoon, and to send a link to
non-technical family who will not install anything. A web page has no install
step and no store review.

**What still holds.** §12's real constraints are met: the EV engine is pure,
deterministic, dependency-free and shipped as a standalone package. §13's
local-first requirement holds exactly — the browser copy of a player's progress
is written unconditionally and the remote copy is additive, so the app is fully
functional with no network.

### §8 — 8,8 against a 6 appears "roughly once in 350 hands"

**The spec says** once in 350, as the argument for building drill-hand
construction.

**The engine measures** once in 2,271.

**Why the difference.** One in 350 is the frequency of a pair of eights against
*any* upcard (about one in 175, halved for the two-card exactness). Against a six
specifically it is one in thirteen of that.

**The engine wins**, per the standing rule. The spec's argument is strengthened
rather than weakened: drilling can depend on chance even less than it thought.
Recorded in the docstring of `DealingShoe.stack()`.

### §5.1.4 — "roughly 310 cells"

**The spec says** roughly 310 scenario cells.

**There are 311.** No deviation of substance — "roughly" was right — but the
exact number is 311 and the code and tests use it.

### §7.1 — the feedback card is shown "immediately after each decision"

**The spec says** the card appears immediately after the decision, before the
hand resolves, listing six contents including the verdict and the EV of every
legal action.

**We gate it** behind a three-step guided reveal: read the dealer, read your
hand, put them together. The verdict and the EV chips arrive together at step
three (turns 10, 11).

**Why.** The spec's §3.4 says the explanation carries the learning. Showing the
verdict first means it is read first and the reasoning skimmed, which inverts
that. All six required contents are present, in the order §7.1 lists them; only
the timing within the card changed.

**The player can opt out.** "Skip to the answer" is one click and is remembered,
which restores the spec's literal behaviour for anyone who wants it.

### §9.2 — decision accuracy

**The spec defines** decision accuracy without qualification.

**We exclude close calls** — spots where the top two plays are within 0.01 units
(turn 10).

**Why.** Idan pointed out that two header metrics contradicted each other. A
"wrong" answer on a hand where two plays differ by a thousandth of a unit is not
a mistake in any sense the player can act on, and counting it makes accuracy a
measure of luck in tie-breaks. The definition is surfaced in the app rather than
hidden: the accuracy panel says how many were set aside and what the figure
would be counting them.

### Spec A §3.8 — a neighbour cannot take your card in the same hand

This one is a correction rather than a trade: spec A contradicted itself, and
§3.8 is the half that was wrong. **The wording below replaces its example.**

**Spec A §3.8 said**, as the line the app would show:

> *If Dani had stood on his 12, your **second card** would have been the 4♦ and
> you would have had 13 instead of 20.*

**That cannot happen, and §3.2 is the reason.** The reservation rule — adopted
so that two people can tap in the same millisecond — puts each seat's card for a
round at a position fixed *before the round begins*. A neighbour cannot reach
into a round you are both in and take your card out of it; that is the entire
point of the rule, and an opening card is the least reachable card there is.

**Measured before it was changed** (round 25 — 600 hands at each table size,
seeds 1 to 60, ten hands a table). How often a neighbour's decision moved a card
of yours **in the hand he made it**:

| seats | hands | ten-hand tables with at least one |
| --- | ---: | ---: |
| 2 | 4 / 600 — 0.7% | 4 / 60 |
| 3 | 7 / 600 — 1.2% | 6 / 60 |
| 6 | 10 / 600 — 1.7% | 8 / 60 |

**What survives the reservation rule is the coupling across hands.** How long he
stays live decides how many cards the hand consumes, so the shoe reaches the
*next* hand somewhere else — same shoe, same seed, still his doing. On the same
600 hands: 55 of 60 two-seat tables had one, 60 of 60 at three seats, 59 of 60 at
six.

**So §3.8 now reads:** the app looks for the same-hand shape first, everywhere,
before it looks for the next-hand shape anywhere — and the two get **different
sentences**, because wording the weaker claim in the stronger one's words would
assert something the rule the whole table rests on makes impossible.

> **Same hand:** *If Dani had stood on his 12, you would have been dealt the 4♦
> instead of the 7♣ — 13 instead of 20.*
>
> **The hand after:** *If Dani had stood on his 12 last hand, the shoe would have
> reached this one somewhere else: you would have been dealt the 4♦ instead of
> the 7♣ — 13 instead of 20.*

Both are dealt rather than modelled: one decision of his is changed and the shoe
is run again from the same seed. And the half of §3.8 that matters more is
unchanged by any of this — **the replay moves the cards and cannot touch the
grade**, because a decision is graded on the player's own cards, the dealer's
upcard and the table's rules, and a neighbour reaches none of the three.

---

## Built, but not in the spec at all

| what | why | turn |
| --- | --- | --- |
| **Elo rating and difficulty ladder** | Idan's idea: difficulty of the next hand driven by a rating, with hand difficulty derived from the EV margin, the expected leak and how often the spot occurs. Designed in `elo-difficulty.md`. | 9 |
| **Hebrew, and the i18n layer** | Idan plays in Hebrew. The dealer's reasoning is *generated*, so this meant translating templates, not strings — each locale owns whole sentences. | 21 |
| **Chip stack and betting circle** | The spec reasons in units of the wager throughout, which is right for the engine and bloodless on screen. The rail is the same number given a table to sit on. | 25 |
| **The dealer's table talk** | A dealer who calls the hand — what she made, who took it — rather than restating the grade. Kept strictly separate from grading, enforced by test. | 39 |
| **Two house restrictions** (no surrender; split like ranks only) | Real tables have them. Both are fed to the solver as rules, so the chart is re-derived and the house edge recomputed — not filtered in the UI. | 22 |
| **Name + 4-digit code identity** | The spec assumes one device and local-first storage. Sharing a link broke that: the same person on a second device was a second player starting at 1200. | this round |
| **Motion and sound** | Not mentioned by the spec either way. Both are restrained by §16 reasoning: no escalation, and money makes no sound. | 42 |

---

## Not built, though the spec asks for it

These are absences, not disagreements. Recorded so the gap is visible.

- **§5.2 Ultimate Texas Hold'em play.** The engine is complete and validated —
  river, flop, and all 169 pre-flop classes agreeing with published strategy —
  but there is no game loop and no UI. The home screen's door is disabled and
  says so.
- **§8 Learning modes.** Drill, Exam, Speed, Guided and Replay are all unbuilt.
  Free play is the only mode.
- **§9.1 Mastery grid.** The per-scenario statistics that would populate it are
  computed and stored; nothing displays them.
- **§9.3 Weakness detection.** Implemented and served at `/api/weak-spots`. No
  page calls it.
- **The adaptive selector.** The rating moves with every decision but does not
  yet choose the next hand, which is the point of §8's drilling. The design is
  written down in `elo-difficulty.md`.
