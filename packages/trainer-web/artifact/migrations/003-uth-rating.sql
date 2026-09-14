-- 003 — the Ultimate rating on the leaderboard
--
-- Run once, in the Supabase SQL editor, after 002. Paste the whole file and
-- press Run. It takes a moment.
--
-- Why: round 10 gives Ultimate a rating of its own, and the leaderboard gains a
-- Blackjack | Ultimate switch. To rank players by their Ultimate rating, the
-- table needs that rating as a column it can sort by. The rating already lives
-- inside each player's saved record; this adds two columns and copies it out.
--
-- NOTHING IS DELETED OR RESET. Two columns are added. No existing column,
-- row or rating changes — the Blackjack rating is not touched. 002's merge
-- markings and its one-live-row-per-name index stay exactly as they are.
--
-- Safe before or after the app update:
--   - The app from before round 10 does not know these columns and never sends
--     them, so it keeps working after this runs.
--   - The round 10 app, meeting a table without them, saves everything else
--     exactly as before, and the Ultimate side of the board says it is waiting
--     for the table to be updated. Once this has run, the board fills in.

-- ---------------------------------------------------------------- columns ---

alter table public.players
  -- The Ultimate rating, a whole number on the same 800–2200 scale as
  -- Blackjack's but its own ladder: the two are never added together.
  -- Empty (null) for anyone who has never had an Ultimate decision rated, which
  -- is what keeps them off the Ultimate board.
  add column if not exists uth_rating integer,
  -- True until 30 of the player's Ultimate decisions have been rated.
  add column if not exists uth_provisional boolean not null default true;

-- ------------------------------------------------------------------- fill ---
--
-- Copy the rating out of the saved record for everyone who already has one,
-- so the board is right straight away rather than after each player's next
-- hand. Rows without one stay empty.

update public.players
   set uth_rating = round((progress->'uth'->'rating'->>'rating')::numeric)::integer,
       uth_provisional = coalesce((progress->'uth'->'rating'->>'ratedDecisions')::numeric, 0) < 30
 where uth_rating is null
   and coalesce((progress->'uth'->'rating'->>'ratedDecisions')::numeric, 0) > 0;

-- ------------------------------------------------------------------ index ---
--
-- The Ultimate side reads live, rated rows by this column; this keeps that cheap.

create index if not exists players_live_by_uth_rating
  on public.players (uth_rating desc)
  where merged_into is null and uth_rating is not null;

-- ------------------------------------------------------------------ check ---
-- Run this afterwards:
--
--   select count(*)                                          as rows,
--          count(*) filter (where merged_into is null)       as live,
--          count(*) filter (where rating > 0)                as rated_in_blackjack,
--          count(*) filter (where uth_rating is not null)    as rated_in_ultimate
--     from public.players;
--
-- `rows`, `live` and `rated_in_blackjack` must be the same numbers as before you
-- ran this file (run the same query first if you want to compare).
-- `rated_in_ultimate` is how many players have had an Ultimate decision rated:
-- 0 if nobody has played Ultimate since round 10 went live, then growing.
