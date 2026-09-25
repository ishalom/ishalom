# @evtrainer/trainer-web

A local web client for the EV Trainer — enough of the §10 screens to actually
play Blackjack and see the engines working.

This is a test harness and a working prototype, not the shipping client. Spec
§12 puts that in React Native or Flutter with the engine compiled in; nothing
here knows that, and nothing the engines do depends on this package.

```sh
npm start --workspace @evtrainer/trainer-web
# then open http://localhost:5173
```

Zero dependencies, like everything else. The engines are TypeScript that Node
strips at load, so they run on the server and the browser gets plain JavaScript
with no build step. One HTTP server, three static files.

## What it does

**Table.** Deal, play, split, double, surrender, insurance. Keyboard shortcuts
throughout — `h` `s` `d` `p` `r`, space to deal, `y`/`n` for insurance — because
Speed mode (§8) times decisions at five seconds and that rules out hunting for a
button. Actions sit along the bottom edge, reachable one-handed (§10.1).

**The feedback card (§7.1).** After every decision, before the hand resolves:

```
Minor error — cost 0.024 units
You chose double. Best is hit.
hit +0.146 · double +0.122 · surrender −0.500 · stand −0.664
11 cannot win by standing, and an ace only busts 17% of the time.
Rule-sensitive: double if the dealer hit soft 17.
```

All five parts the spec asks for: the verdict and its severity tier, what you
played against what maximises EV, the EV of every legal action sorted, the cost,
and a one-sentence reason. §3.4 makes that last part the requirement — "wrong,
you should have hit" teaches nothing — so every sentence carries a number the
player can check, computed from the same dealer distribution the grade came from.

**Rule-sensitivity flags (§7.1 item 6, §3.3).** The line above is the spec's own
example: doubling 11 against an ace is right when the dealer hits soft 17 and
wrong when it stands. Rather than keeping a list of famous exceptions, the flag
derives the other rule set's chart and reads the cell — the same reason the
engine derives charts at all.

**Session stats (§9.2).** Decision accuracy first, then EV lost per 100 hands,
then your effective house edge — what the game costs plus what you cost
yourself. Units won is present, last, and deliberately quiet: §3.1 is explicit
that confusing "I won" with "I played well" is the central learning failure, and
a stats bar that leads with the bankroll teaches exactly that.

**Rule set (§3.3, §10.1).** The badge is pinned to the top and cannot be
dismissed. Switching presets starts a new session, because the correct play
changes with the rules — which is the point.

**Reference chart (§10, screen 7).** The derived chart for the active rules,
generated from EV rather than transcribed.

## What is not here yet

The screens that need the session controller rather than the game engine: the
mastery grid and its decay rules (§9.1), drill and weakness selection (§9.3),
Exam and Speed modes (§8), and session history. The data those need — graded
decisions carrying scenario keys, hand records carrying their deal — is already
produced and thrown away here.

Ultimate Texas Hold'em has no client at all yet; its solvers are done and its
pre-flop table is still computing.
