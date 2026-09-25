-- 002 — name + four-digit code identity
--
-- Run once, in the Supabase SQL editor, after 001 (schema.sql).
--
-- Why: a player was identified by a random id in one browser's storage, so the
-- same person on a second device became a second player starting again at 1200.
-- A name and a code let someone claim their own record anywhere.
--
-- This adds three columns, merges the duplicate rows that already exist, and
-- puts a unique index on the normalised name so no more can appear.
--
-- NOTHING IS DELETED. Row-level security refuses deletes anyway, and a 204
-- response does not mean a row was removed. Duplicates are merged by *marking*:
-- the losing rows get a `merged_into` pointing at the survivor, and the
-- leaderboard filters them out. Every row and every rating stays recoverable.

-- ---------------------------------------------------------------- columns ---

alter table public.players
  -- The normalised name: trimmed, inner whitespace collapsed, case-folded.
  -- Carries the unique index, so it is what decides "same player".
  add column if not exists name_key text,
  -- SHA-256 of "<id>:<code>". The code itself is never stored.
  --
  -- This is not authentication. The table is readable by anyone with the page,
  -- so every hash here is public, and there are only ten thousand codes. It
  -- stops accidents between family members; it would not stop an attacker, and
  -- it is not meant to.
  add column if not exists pin_hash text,
  -- Set on a duplicate to point at the row that survived. Never deleted.
  add column if not exists merged_into text,
  -- Decisions graded over this player's whole life, across every mode and rule
  -- set. Unlike `decisions`, nothing resets it — which is what makes it safe
  -- for deciding which of two saved copies is further along.
  add column if not exists lifetime_decisions integer not null default 0;

-- Seed the new columns from what is already there.
update public.players
   set name_key = lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
 where name_key is null;

update public.players
   set lifetime_decisions = greatest(coalesce(lifetime_decisions, 0), coalesce(decisions, 0))
 where coalesce(lifetime_decisions, 0) < coalesce(decisions, 0);

-- ----------------------------------------------------------------- merging ---
--
-- For each name held by more than one row, keep the one with the most decisions
-- behind it — the record that would hurt most to lose — and point the others at
-- it. Ties break on the most recently updated.

with ranked as (
  select id,
         name_key,
         row_number() over (
           partition by name_key
           order by coalesce(lifetime_decisions, decisions, 0) desc, updated_at desc, id asc
         ) as rank,
         first_value(id) over (
           partition by name_key
           order by coalesce(lifetime_decisions, decisions, 0) desc, updated_at desc, id asc
         ) as keeper
    from public.players
   where merged_into is null
)
update public.players p
   set merged_into = r.keeper
  from ranked r
 where p.id = r.id
   and r.rank > 1;

-- ------------------------------------------------------------------ index ---
--
-- One live row per name from here on. Merged rows are excluded, so the history
-- they carry can stay in the table without blocking the name.

create unique index if not exists players_one_live_row_per_name
  on public.players (name_key)
  where merged_into is null;

-- Reading the leaderboard skips merged rows; this keeps that cheap.
create index if not exists players_live_by_rating
  on public.players (rating desc)
  where merged_into is null;

-- ------------------------------------------------------------------ check ---
-- Run this afterwards. Every group should show exactly one row with
-- merged_into null, and no rating should have disappeared.
--
--   select name_key,
--          count(*) filter (where merged_into is null) as live,
--          count(*)                                    as total,
--          max(rating)                                 as best_rating
--     from public.players
--    group by name_key
--    order by total desc;
