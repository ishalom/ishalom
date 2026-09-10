-- The shared table, for the copy of EV Trainer served as a plain web page.
--
-- Paste this whole file into the Supabase SQL editor and run it once. Nothing
-- here is specific to Supabase beyond the `anon` role name; any PostgREST
-- server would take it.
--
-- One row per player. The leaderboard is a query over the summary columns; a
-- player's saved session and their few showable hands ride in the same row and
-- are only read back by that player. Fifteen people come to fifteen rows.

create table if not exists public.players (
  -- Client-generated, and it stays in that player's browser. There are no
  -- accounts here: this identifies a stack of chips, not a person.
  id              text primary key,
  name            text        not null check (char_length(name) between 1 and 24),

  -- What the leaderboard shows.
  rating          integer     not null default 0,
  peak            integer     not null default 1200,
  provisional     boolean     not null default true,
  mode            text        not null default 'basic',
  hands           integer     not null default 0,
  decisions       integer     not null default 0,
  accuracy        double precision not null default 0,
  ev_lost_per_100 double precision not null default 0,

  -- The saved session, so a player picks up where they left off, and the few
  -- hands worth showing other people.
  progress        jsonb,
  feed            jsonb       not null default '[]'::jsonb,

  updated_at      timestamptz not null default now()
);

-- Ranked reads are the only query this table serves to everyone.
create index if not exists players_by_rating on public.players (rating desc);

alter table public.players enable row level security;

-- Be plain about what this is.
--
-- There are no accounts, so there is no identity to check a policy against:
-- anyone who can open the page can read the table and write a row in it. For a
-- family sharing a link that is the right trade against making everybody sign
-- in, and nothing private is ever put here — a name someone chose, a rating,
-- and hands of blackjack.
--
-- What is deliberately withheld is DELETE. There is no policy for it, so it is
-- refused: the worst a stranger who finds the page can do is add a row or
-- overwrite one. Nobody can destroy the table's history.

drop policy if exists "anyone may read the table" on public.players;
create policy "anyone may read the table"
  on public.players for select
  to anon, authenticated
  using (true);

drop policy if exists "anyone may join the table" on public.players;
create policy "anyone may join the table"
  on public.players for insert
  to anon, authenticated
  with check (true);

drop policy if exists "anyone may update their row" on public.players;
create policy "anyone may update their row"
  on public.players for update
  to anon, authenticated
  using (true)
  with check (true);
