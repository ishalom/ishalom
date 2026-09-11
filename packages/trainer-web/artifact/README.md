# The shareable builds

`scripts/build-artifact.ts` produces two pages from one source:

| output | where it runs | shared table |
| --- | --- | --- |
| `build/artifact.html` | published on claude.ai | the artifact's own document store |
| `docs/index.html` | any static host (GitHub Pages) | the HTTP backend in `backend.json` |

Both carry the same engine and the same screens. The only difference is the
document around them and where the shared table lives, which is what
`artifact/backends.js` exists to hide from the rest of the app.

## Setting up the shared table

1. Create a project at supabase.com. The free tier is well beyond what fifteen
   players need.
2. Open the SQL editor and run `schema.sql` from this directory. It creates one
   table and its policies, and explains in comments exactly who can write to it.
3. Copy `backend.example.json` to `backend.json` and fill in the project URL and
   the **publishable anon key** — Project settings → API keys. That key belongs
   in the page: it names the project, not a person, and the table's policies
   decide what it may do.
4. `npm run build:artifact`. The console line says which project the hosted page
   was built against, or `not configured` if it found none.

Built with no `backend.json`, the hosted page still works — every player simply
keeps their own record in their own browser and there is no leaderboard.

## What the table is, honestly

There are no accounts, so anyone who can open the page can read the table and
write a row in it. For a family sharing a link that is the right trade against
making everybody sign in, and nothing private goes in it: a chosen name, a
rating, and hands of blackjack. `DELETE` has no policy and is refused, so no one
can destroy what is there.

A project that sits idle pauses on the free tier. The first person to open the
page after that waits a moment while it wakes; the poll simply retries, and the
game is unaffected throughout.

## Players, and a forgotten code

A player is a name and a four-digit code. The name is the handle; the code is
how someone proves, on a second device, that they are the same person as last
time. Without it the same name typed on a phone would be a second player
starting again at 1200, which is what made the rating worthless the first time
this was shared.

**Say plainly what it is not.** It is not authentication. The table is readable
by anyone who has the page, so every `pin_hash` in it is public, and there are
only ten thousand codes. It stops two family members colliding by accident, and
stops one person becoming three by using three browsers. It would not stop
somebody who wanted to take a name, and it is not meant to.

### If someone forgets their code

There is no reset inside the app, deliberately — a self-service reset with no
second factor is just a way of taking someone's name, so it would give away the
little the code buys.

Clear it by hand in the Supabase dashboard instead:

1. **Table editor → `players`**, and find the row by `name`.
2. Set **`pin_hash` to `NULL`**. Change nothing else — not `id`, not `name_key`,
   and never delete the row: the rating, the saved session and the hand history
   all live in it.
3. The next person to type that name at the door sets a new code and takes the
   row, with everything in it intact. That is the same path every player who
   predates codes goes through once.

`merged_into` must stay `NULL` on the row being recovered. A row that points at
another has been merged and will not answer for its name — clearing its
`pin_hash` does nothing.
