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
