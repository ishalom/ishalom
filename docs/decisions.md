# Decisions

Choices that shaped the code and are not obvious from reading it. Each would be
easy to undo by accident, and several look like arbitrary detail until the
reason is known.

Where the code departs from the specification, see
[spec-deviations.md](spec-deviations.md).

---

## The engine wins over the copy

Where a proposed wording contradicts what the strategy engine computes, the
wording changes. This is a standing instruction from Idan, and it has fired more
than once:

- A reviewed dealer-bust table was **unconditioned**, where the engine conditions
  on the dealer not having blackjack. Against a ten that is 23% rather than 21%;
  against an ace, 17% rather than 11.5%. The engine's figures shipped.
- The spec's "once in 350 hands" for a pair of eights against a six is one in
  2,271 by measurement.
- A test was once written asserting that a liberal single-deck game favours the
  house. It does not — it is +0.17% for the player. The test was wrong, not the
  engine, and was rewritten to assert the real fact.

The corollary matters as much: when a number in the product looks surprising,
check it against the engine before changing it.

## §3.1 is the hinge the whole product turns on

The grade attaches to the **decision**, never to the outcome. Everything below
follows from that one rule, and none of it is obvious from the code alone:

- The hand's result — the dealer's remaining cards, the money, the per-hand net
  — stays hidden until the three-step reveal completes.
- The rating change is shown **even when the hand lost**. A green gain sitting
  above a red loss, in one frame, argues the point better than any sentence.
- The dealer never says whether the play was right. A test forbids the
  vocabulary of grading in her mouth, in both languages.
- Money makes no sound. A test asserts no sound call appears anywhere in the
  functions that draw the outcome.
- Nothing that celebrates may key off a win.

## No escalation, ever

The fiftieth correct decision looks and sounds exactly like the first.
Milestones add a line of text and never a bigger effect.

Escalating celebration on a variable schedule is the slot-machine mechanism, and
it is more insidious attached to a learning signal than to money because it is
harder to notice. Deliberately rejected, each for this reason: confetti, coin
sounds, screen shake, XP, levels, badges, daily or lifetime streaks, streak
leaderboards, streak repair, and randomised rewards.

The rating is the only score, it is honest, and it goes down. A second currency
that only rises would be exactly the ratchet this rules out.

## The streak is not persisted

Not to browser storage, not to the shared table, not into the saved progress
shape. A run that survives closing the tab stops being an observation and
becomes a chain not to break.

Best-of-session is a fact about the last twenty minutes. Best-of-all-time is a
leash.

## Close calls are invisible to accuracy and to the streak

A spot where the top two plays differ by under 0.01 units is excluded from the
accuracy denominator, and neither extends nor breaks a streak.

Excluding them in **both** directions is what makes the streak definable in one
sentence a player can check by hand: *the accuracy numerator, run
consecutively*. Letting a close call extend a run would grow it on coin-flips;
letting one break a run would kill a thirty-hand streak on a hand the accuracy
panel explicitly says does not count.

## Restrictions are rules, not filters

"No surrender" and "split like ranks only" go into the rule set the solver
memoises on. The chart is re-derived, the house edge recomputed, and every
recursive sub-decision inside a split or a double is answered under the same
restriction. Changing one restarts the session, exactly as changing the preset
does.

Greying out a button would have graded the player against a game nobody was
dealing.

Verified: turning surrender off moves the Vegas Strip edge from 0.334% to
0.406%, and flips 15 v 10, 16 v 10 and 16 v 9 from surrender to hit.

## "Split like ranks only" changes no correct answer

It removes `split` from the ten rows and nothing else. Splitting tens is never
the best play, so taking the option away cannot change a single answer — it only
removes a wrong move.

This is proved by a test across all 311 cells rather than asserted, because it
reads as though it should matter. It is also what licenses the solver's
shortcut: inside the split recursion there is no card identity to work from, so
unlike tens are assumed, and since the branch is never selected the assumption
costs nothing.

## The solver cannot see card identity, so the table tells it

Everything downstream of the deal works in ten-buckets, where a king and a jack
are the same card. Under a house that splits identical ranks only, whether a
particular ten-pair is splittable is a fact only the table that dealt it knows,
so it travels in as `HandContext.unlikeTens`. An unstated ten-pair is assumed
unlike, which is what it is twelve times in sixteen.

## One engine, never two

The published page runs the same code the tests run. `scripts/bundle.ts` folds
the modules into one scope using the same type-stripper Node runs them with,
rather than anyone hand-porting the solver to the browser.

Three assumptions make that safe and all three are **checked, not assumed**: no
runtime dependencies, fully erasable TypeScript syntax, and no two modules
declaring the same top-level name. The bundler also refuses to emit a bundle
referring to a name nothing declares — a guard added after a renamed import
silently vanished and broke every button on the screen the first time a dealer
showed an ace.

`test/bundle.test.ts` holds the bundle to exact agreement with the modules
across all 311 chart cells, sixty live hands under exact card removal, and every
preset's house edge.

## Storage is behind one adapter, and always optional

`artifact/backends.js` wraps two stores — the artifact's own document store and
any PostgREST table — behind `load`, `save`, `watch`. The app is handed whichever
answers and never learns which.

A backend is optional at every moment: absent because the page came from a file,
because the store was declined, or because the network dropped mid-hand. None of
those change the game. You play, you are graded, your record is kept in the
browser, and you are simply not on the leaderboard. A trainer that refuses to
deal because a database is unreachable would have its priorities backwards.

## Nothing may be keyed per hand

The artifact database caps at 5,000 documents for the whole artifact. So the
schema is keyed by **player**: one profile, one rolling history, one feed entry
each. Fifteen people playing for a year come to about forty-five documents.

One document per hand reaches the cap in an evening and then starts refusing to
save anything at all.

## The shared table is open, on purpose

There are no accounts, so there is no identity a database policy could check.
Anyone who can open the page can read the table and write a row in it.

For a family sharing a link that is the right trade against making everybody
sign in, and nothing private goes in it: a chosen name, a rating, and hands of
blackjack. `DELETE` is deliberately given no policy and is therefore refused, so
the worst a stranger who finds the page can do is add noise — nobody can destroy
what is there.

The publishable key is in the page **by design**. It names the project, not a
person, and the table's policies decide what it may do. The `service_role` key
must never appear there.

## A shared-table decision is rated by the same function as a private one

There is exactly one place in this app where a decision becomes a rating
movement: `rateOneDecision` in `src/difficulty.ts`. It finds the decision's cell
of the difficulty grid, turns what the decision cost into a severity tier, and
moves the rating.

Until round 25 those three steps were written out inline at the one place that
needed them, inside the private session's `absorb`. Then the shared table needed
the same three, and three lines is exactly the amount of code somebody copies
without thinking. Two copies is how two tables quietly start grading
differently — and a rating that means one thing at the private table and
another at the shared one is worth nothing at all.

Two consequences worth stating, because both look like details:

- **The grid comes from the table's rules, the ladder from the player's mode.**
  How hard a spot is depends on the game it was dealt in, and at a shared table
  the table's rules win over the joiner's (spec A §3.11). Which ladder measures
  him is his own, wherever he plays.
- **Off-grid decisions score nothing, and the rule lives in that one function
  rather than in each caller.** Hard 18 through 21 have no cell and turn up
  constantly; rating them would hand every player a stream of free points.

`test/grading-unchanged.test.ts` is what makes changing this safe: sixty
recorded hands, replayed decision by decision, holding the rating to the digit.

## A shared table is absorbed by a mark, not a flag

Spec A §3.11 says a table is absorbed into a record once — *one seed, one
score*. The obvious reading is a boolean: this table has been scored, or it has
not.

It is a count instead: `table_seats.rated_decisions`, how far down this seat's
own list of decisions its owner's rating has read. A table is played for an
evening, and a rating that arrived only when somebody finally closed the tab
would usually never arrive at all.

It is still once. The decisions sit in a fixed order — the order the shoe dealt
them, which is a property of the record rather than of when a phone read it — so
"the first N have been rated" means the same thing on both of a player's devices
and tomorrow as it does now, and the mark only ever moves forward.

The mark is written *after* the rating has moved. If that write fails the same
decisions are offered again, which costs a retry; the other order would lose a
decision on every dropped request.

## A forfeit costs the worst action at the spot, which scales with the player

Idan's rule for a drop (round 27): *"הדירוג שהיה יורד אילו היה בוחר בטעות
החמורה ביותר בתור שבו הופעל הוויתור."* The rating falls by what it would have
fallen by had he chosen the worst action available at the turn the clock ran
out — a real EV cost off a real spot, through `rateOneDecision` like every other
decision, rather than a constant somebody picked.

**The consequence, which is the point and is easy to be surprised by.** Because
the movement is Elo's, the sting scales with the player. On hard 16 against a
ten:

| his rating | what a forfeit there costs him |
| --- | ---: |
| 1,200 | about **−0.1** |
| 2,000 | about **−3.8** |

A weak player forfeiting a hard spot loses almost nothing, because the rating
never expected him to get it right; a strong player loses real points on the
same spot. A flat "15 points" would have done the opposite. Measured over 600
forced drops, 82% price and rate, 7.5% land on a turn that was already answered
and cost nothing, and 11% sit off the difficulty grid and are declined exactly
as the same spot played properly would be.

## A gesture earned at a shared table is owed, and paid later

Round 20 made *"you used to get this wrong"* fire on the **fifth** consecutive
correct answer exactly. Round 26 gave shared-table decisions a place in the
mastery grid, which created a hole: a run completed at a shared table earns the
gesture where it cannot be shown — the shared table shows none — and by the
player's next private decision the run is past five, so the rule will never fire
for it again.

**Idan's answer (round 27): the gesture is owed.** It is queued when it is
earned and paid at the first private settlement that has no gesture of its own,
one a hand, oldest first. Round 20's `=== IMPROVED_RUN` rule is untouched — the
owed state is an explicit fact in the saved record, not a loosening to `>=`.

It lives in `progress.owed`, beside the mastery grid, because it is the same
kind of fact: something true about this player that outlives the sitting. A
record saved before this owes nothing, which is right.

## A run at a shared table is not a personal best

Round 27, Idan: **no.** The personal streak record stays driven by the private
table alone. The shared table keeps its own best run in its own measures
(spec A §3.6), which is what it has always had.

The question was real rather than rhetorical — shared decisions count towards
the rating and the mastery grid, so why not the record — and the answer is that
a *record* is a different kind of claim from a *count*. A run is a continuous
thing, and a run interrupted by moving between two tables is not obviously one
run. Rather than define that, the record simply stays where it was earned.

## Merging is marking, never deleting

Duplicate player rows are merged by pointing them at a surviving row, never by
removing them. Row-level security refuses deletes anyway — and a `204` response
does **not** mean a row was removed, which is the trap worth knowing about.

## Hosting is GitHub Pages because artifacts cannot be public here

Artifacts created on Team or Enterprise accounts can only be shared inside the
organisation. That is a plan-level restriction and no setting changes it, so the
artifact could never reach family outside the organisation. Hence a static page
and a portable backend.

## Hebrew card notation stays Latin

`8,8 מול 2`, not `ח,ח`. It is how Israeli players write it, and it keeps the
headline agreeing with the prose beneath it. The gambling vocabulary around it
is what people actually say at a table — נשרף for a bust, תיקו for a push, דילר
for the dealer — rather than stricter coinages nobody uses.

## Two voices that must not blur

The three-step reveal is **narration**: it appears under a numbered heading, not
in a speech bubble, and names the dealer in the third person. Her speech bubble
is **hers** and uses "I".

Tests enforce the split in both directions: no first person in the narration
keys, and no grading vocabulary in her lines.

## Stillness is the default

Every animated rule lives inside `@media (prefers-reduced-motion:
no-preference)`. Built that way round so that *forgetting* produces a still page
rather than an unguarded one, and so nothing needs an override to undo. A test
fails if anything animates outside that guard, or if any duration exceeds 400ms.

## The starting stack is 200 units

Chosen so an ordinary bad run moves it visibly without emptying it, which is the
only thing the figure has to do.

Two pieces of arithmetic that must stay true: the balance counts **settled hands
only** — a wager still on the felt has not been lost yet — and the wager is
swept the moment a hand settles, because by then it has already moved into the
balance and leaving it out there would show the same chips in two places.

Now that each chip carries its denomination, the row must sum to the figure
beside it, so the chip breakdown is exact by construction and tested across
every reachable balance.

## The shared Ultimate table deals by seat, not by arrival (round 32)

Every card of an Ultimate hand is laid out at the shuffle, at a position fixed
by seat index: seat k holds `deck[2k]`, `deck[2k+1]`, the dealer `deck[12..13]`,
the board `deck[14..18]`. Nobody draws after the deal, so no neighbour's choice,
arrival or departure can move a card anybody else holds. *Rejected:* dealing in
live-seat order, as Blackjack does, which would let a drop mid-hand re-deal
everyone's cards.

- **The game is the preset.** An Ultimate table is `preset_id = 'uth-standard'`;
  no column, no migration.
- **One grading path.** Each seat plays on its own `UthTable`, stacked with its
  nine cards; the card a player reads is `UthSession.explainDecision`, which is
  the private table's `compose()`. Tested by comparison, card for card.
- **A solve memo (`UthTableOptions.solved`).** The table is re-derived on every
  poll; without it every flop (~60 ms) was re-solved each read. Keyed by
  paytable, street, hole cards and visible board; figures unchanged.
  *Rejected:* storing grades in the seats' rows, which would stop the table
  being derived.
- **Neighbours' two cards stay face down until the hand is over**, as at a real
  table. The grade never counts them, so showing them would show a player
  something the grade then ignores.
- **Everybody folding keeps the dealer's cards down**, as the private table does.
- **No "he took my card" and no shared spots in Ultimate**: no choice moves a
  card, and two hole-card pairs are not one spot.
- **Shared Ultimate decisions move only the Ultimate rating and its lifetime
  count** (`UthSession.absorbRated`), as Blackjack's move only its own.

## A crown is a state on the current run, not a remark (round 33)

Small from 7 right in a row, medium from 14, large from 21; a mistake ends the
run and the crown goes with it, unannounced. `crownFor(run)` reads it off the
run, and `advanceRun` is the one run rule for both games and both tables
(`advanceStreak` now calls it). At the shared table each seat's crown is
counted from the decisions that screen may see, so it cannot leak a
neighbour's grade early; a forfeit ends the run, leaving does not.

- **Rebuilt from `claude/crowns-r31`, not merged.** The branch fired a crown
  once at the decision that reached 7/14/21; the rule is now a state, so only
  the thresholds and the run rules carried over.
- **The streak lines at 10 and 25 stay.** The branch had dropped them to avoid
  a remark on top of a crown; a crown says nothing, so there is nothing to
  collide with. *Rejected:* removing them without being asked.
- **No new strings.** The crown's label is the existing `fb.streak`
  ("{n} correct in a row").

## A claimed name says so (round 33)

`claim` (a live row with no code) now leaves a one-line notice on the first
home screen: the name is yours, the code is set, the history came with it.
Stored as `ev:claimed` and emptied once shown.

## Working practice

- **Git is run without asking.** Commit and push on
  `claude/ev-engine-standalone-lkmyqe`. Nothing has been merged to `master`;
  PR #3 is open.
- **Restart the dev server after any change under `src/`.** Node loads server
  modules once at startup, so the browser gets fresh page files against a stale
  server and the mismatch is confusing rather than obviously broken.
- **Rebuild before running the test suite.** `test/hosted.test.ts` reads the
  committed `docs/index.html`; skipping the build exercises stale code and
  passes for the wrong reason.
- **Every user-facing string exists in both `en` and `he`**, through `i18n.ts`.
  Tests check parity and that the pages never name a key the catalogue lacks.
