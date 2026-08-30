---
name: weekly-planning
description: Read next week from the calendar, propose home and office days, and write the confirmed days back as all-day calendar events.
---

# weekly-planning

Runs Saturday at 20:00. It decides nothing on its own for long: whatever comes out of
it is written to Google Calendar as all-day events, because the calendar owns the
schedule. Nothing is stored here. Changing a day later means editing the calendar.

## Step 1 — Read the coming week

`get-current-time`, then `list-events` for the seven days starting tomorrow (Sunday
through Saturday). Classify every event with `event_rules` from `config.yaml`, exactly
as `morning-brief` does.

Note for each day:

- whether it already carries an all-day marker matching a `home_day` or `office_day`
  keyword,
- whether it carries a `spend` event (poker, a show, a party, a wedding, a birthday),
- any `workout` or `friends_dinner`.

## Step 2 — Propose

Heuristics, in order:

1. A day that already carries a marker keeps it. Never overwrite a decision the user
   already made.
2. The day **after** a `spend` event defaults to a home day.
3. A day with a `friends_dinner` defaults to a home day.
4. Everything else that is a weekday (Sunday–Thursday) defaults to an office day.
5. Friday and Saturday get no marker at all.

These heuristics are deliberately crude and are meant to be re-tuned after two weeks of
real use.

## Step 3 — Show the proposal

Print the week in Hebrew, one line per day, marking which days are already decided and
which are your proposal:

```
א׳ 31.8  משרד            (הצעה)
ב׳ 1.9   בית · בישול חברים (הצעה)
ג׳ 2.9   משרד            (כבר ביומן)
```

## Step 4 — Write it to the calendar

For every day where you are proposing a marker and none exists, create an all-day event
on the primary calendar with `create-event`:

- title `בית` for a home day, `משרד` for an office day,
- all-day: `start` is that date, `end` is the next date (Google treats the end date as
  exclusive),
- no description, no guests, no reminders.

Rules:

- **Never delete or edit an event you did not create in this step.** If a day already
  has a marker, leave it alone even when your heuristic disagrees.
- Create at most one marker per day. Before creating, re-check the events you read in
  step 1 for that date so a re-run does not duplicate markers.
- If `create-event` fails for a day, keep going with the remaining days and report the
  failure.

## Step 5 — Report

Reply in English with: the days you wrote, the days you left alone and why, and any
write that failed. If the calendar was unavailable, say so plainly and write nothing —
a half-written week is worse than none.
