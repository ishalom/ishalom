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
