# Mockups

Static design mockups for the EV Trainer. **Nothing here ships**, and nothing is
wired to the engines at runtime — this is a thing to react to before the real
build.

Open any of them by double-clicking. No server, no build, no install:

```
home.html        name, rating, stats, the two games
blackjack.html   the table, the dealer-teacher, the feedback card, the hand log
ultimate.html    UTH preview: what the solvers say, with nothing wagered
```

They are deliberately classic scripts rather than ES modules, because browsers
refuse module imports over `file://` and these pages have to open on a
double-click.

## The numbers are real

`canned.js` is **generated from the engines**, not invented:

```sh
node mockup/generate-canned.mjs
```

Real EVs, real chart margins, real dealer odds, real explanation sentences, real
rule-sensitivity flags, real UTH solver output. The pages are not wired, but they
are not lying about what the app can say — and when this gets rebuilt live, the
wiring is a substitution rather than a rewrite.

Some things you can check against the spec while looking at it:

- Sixteen against a ten quotes the dealer making 17 or better **77%** of the
  time, which is the figure §7.1's own worked example uses.
- Playing that hand flags **"hit without late surrender"** — the rule-sensitivity
  requirement of §7.1 item 6, found by deriving the other rule set's chart rather
  than from a list of exceptions.
- The stats strip leads with accuracy and ends with units, greyed, per §3.1 and
  §9.2.
- Nothing counts down, nothing streaks, nothing asks you to come back
  tomorrow (§16).

## The difficulty ladder

The home screen shows real cells at their computed difficulty rating, which is
the clearest way to see whether the Elo idea is calibrated sensibly:

| Cell | Difficulty | Why |
| --- | --- | --- |
| `10,10 vs 9` | 1050 | Never split tens. Common, and the margin is 0.97 of a unit. |
| `12 vs 10` | 1327 | Common, and a wide 0.16 margin. |
| `8,8 vs 6` | 1327 | Wide margin, but you meet it once in 2,271 hands. |
| `16 vs 10` | 1569 | The canonical awkward spot. |
| `A,7 vs 9` | 1611 | Soft eighteen, which almost everyone stands. |
| `15 vs 10` | 1972 | Margin 0.0032 — surrender or hit, and it barely matters. |
| `A,2 vs 5` | 2200 | Margin 0.0018. Nobody knows this one. |

Difficulty is **how likely a competent player is to get it wrong** — thin margin
plus rarity. It is not how expensive the mistake is; those are opposites, and
conflating them would rate "never split tens" as the hardest hand in the game.
What varies by mode is which hands get *dealt*, not what difficulty means.

The Elo maths then handles error cost on its own, with nothing bolted on: against
`A,2 vs 5` a 1642-rated player gains 23 for getting it right and loses 1 for
getting it wrong; against `10,10 vs 9` they gain 1 and lose 23. Cheap mistakes
happen on cells that are hard by construction, so they cost little rating —
which is exactly what §3.2 asks for.

## What this reveals we have to build

Nothing is currently recorded. `TrainerSession` keeps running totals and throws
away every `HandRecord` — dealt cards, every `DecisionRecord`, the full EV
vectors — on the next deal. The hand log, the mastery grid, weakness detection
and the rating all need the same small change first: keep the records.
