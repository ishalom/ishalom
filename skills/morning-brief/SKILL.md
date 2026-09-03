---
name: morning-brief
description: Read the week from the calendar, derive preparations and money, and render the Hebrew brief for the TV.
---

# morning-brief

Runs at 07:00 and refreshes at 12:00 and 18:00. It produces one thing: the file
`out/brief.html`, which the TV shows full-screen.

The goal is not "how much money is left". It is a habit: look at the week, prepare
for it, and see what is left before spending. Read the schedule first and money
second — money only exists here because an event costs something.

## Principles

- **The default daily budget is zero.** A day that spends nothing says
  `אין הוצאות מתוכננות היום.` and shows no balances at all. That is the correct
  output, not a failure.
- **What is not in the calendar does not exist.** Remaining events, home days and
  workouts are counted from the calendar and nowhere else.
- **Preparation beats arithmetic.** A reminder that prevents a purchase (snack in the
  bag, cook tonight) is worth more than any number on the screen.
- **Never invent.** Every figure comes from a tool response in this run. If a source
  failed, its section says so.

---

## Step 1 — Fetch

Call these in whatever order is convenient; they do not depend on each other.

| Source | Server | Call |
|---|---|---|
| Schedule | `google-calendar` | `get-current-time`, then `list-events` from today 00:00 through the end of `brief.calendar_days_ahead` days. Then a second `list-events` from today through the last day of the current month — needed for "remaining spend events this month". Use the primary calendar unless `list-calendars` shows only one other. |
| Money | `riseup` | `get_budget` with `date: "current"`. |
| Eating-out trend | `riseup` | `get_transactions` with `cashflowMonth` for the current month (and the previous month too if this week crosses the 1st). |
| Weather | `weather` | `get_weather` with `location` from `home.location`. |
| Robot | `roborock` | `get_status`. |

A source that is missing from the runtime list, or that errors, degrades only its own
section. Never retry a failing tool more than once.

## Step 2 — Classify

Every event gets a `kind` from `event_rules`: match the rule whose `match` list has a
keyword contained in the event title (case-insensitive, Hebrew and English both).
First matching rule wins. An event that matches nothing appears in the schedule lines
but affects neither money nor preparations.

All-day events titled with a `home_day` or `office_day` keyword are the day markers
written by `weekly-planning`.

## Step 3 — Preparations

Apply `prep_rules` against the classified week. The `when` field is a short condition
in English; read it literally:

- `workout tomorrow` — a `workout` event exists on tomorrow's date. Note the timing:
  the bag is packed the night before, so this fires the **day before** the workout and
  never on the day itself. A workout today appears in the schedule line and nowhere
  else — by 07:00 the reminder would be useless.
- `office_day tomorrow` — tomorrow is marked as an office day.
- `office_days in next 7 days >= 2` — count office days in the window.
- `friends_dinner in 2 days` — a `friends_dinner` event exactly two days out.

Reminders repeat every day while the condition holds; there is no "seen" state.
`once_per_week: true` means show it on at most one day per calendar week — pick the
earliest day in the week on which the condition holds.

Order the list so that reminders which prevent a purchase come first. Show at most
four; the screen does not scroll.

## Step 4 — Money

**Balance per envelope.** `balance = originalAmount - balancedAmount`.

Before using any of them, sanity-check the sign convention on this response: early in
the month a `daily` envelope should come out positive and no larger than
`|originalAmount|`. If every envelope lands negative, the API is returning expenses as
negative numbers — recompute using absolute values. If you cannot make the numbers
sane, write `לא זמין` for the money section rather than a figure you do not trust, and
say one sentence about why in your console summary.

Format amounts as whole shekels with a thousands separator and a trailing `₪`
(`1,000 ₪`). Never show agorot.

**Balances follow the day's expenses.** An envelope's balance is on screen to be read
**before** the purchase it belongs to, so it appears only on a day with a `spend` event
that points at it. Everything else is off:

| Today | Headline | `.envelopes` line |
|---|---|---|
| no `spend` event | `אין הוצאות מתוכננות היום.` | omitted entirely — not empty, absent |
| one or more `spend` events | the event and its amount, e.g. `פוקר הערב – מותר עד 250 ₪, תיהנה` | the envelopes those events spend from |

A day with nothing planned shows no numbers at all. Resist adding them back "for
reference": a wall of balances every morning is the "how much money do I have" screen
this brief exists to avoid.

`brief.show_daily_balances: always` overrides the third column and lists every `daily`
envelope every day. It does not change the headline.

**Recommended amount** for each `spend` event today:

- `per_event` is a number → that is the amount.
- `per_event: null` → the envelope's remaining balance ÷ the number of remaining
  `spend` events this month that point at the same envelope, counted from the calendar
  only (today's event included), rounded down to the nearest 10 ₪.

**Envelope roles** (`config.yaml` → `envelopes`, keyed by RiseUp envelope id):

- `daily` — can appear, on the terms above.
- `track` — shown only when the balance is negative, or below
  `brief.track_threshold_pct` of `originalAmount`. A warning, not a budget, so it
  appears regardless of what today spends.
- `hidden` — never shown, and never counted into any total.

**Eating-out trend.** Count transactions in the eating-out envelope for the last seven
days and for the seven days before that, from `get_transactions`. Report both counts
and an arrow: `↓` when this week is lower (good), `↑` when higher, `=` when equal. If
the transactions cannot be attributed to the envelope, write
`אוכל בחוץ: המגמה לא זמינה` — do not estimate it from balance movement.

**Expired token.** If `get_budget` returns 401 / an authentication error, replace the
whole money section with:
`הטוקן של RiseUp פג – חדש ב-input.riseup.co.il/developer/tokens`
and carry on with the rest of the brief.

## Step 5 — Phrase it (Hebrew)

Short lines. No lecturing, no coaching voice, no exclamation marks. Tone comes from the
envelope's `tone`:

- `encourage` (experiences) — permission, not pressure: `מותר עד 250 ₪, תיהנה`.
- `quiet` (durables, groceries, LIME) — the number and nothing else. Never suggest
  spending what is left.
- `reduce` (eating out) — the trend, stated flatly. No praise, no scolding.

Dates as `יום ראשון, 30.8`. Weekday letters in the week line: `א׳ ב׳ ג׳ ד׳ ה׳ ו׳ ש׳`.
Times as `09:00`. A section with no content says `לא זמין` (source failed) or an
honest empty line (nothing to say) — never a blank section.

## Step 6 — Render `out/brief.html`

Write the file with the Write tool, exactly this skeleton, in this order. No inline
styles, no inline scripts, no other files.

```html
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="300">
<title>מורנינג בריף</title>
<link rel="stylesheet" href="/brief.css">
</head>
<body>
<main class="brief">
  <header class="topbar">
    <div class="date">יום ראשון, 30.8</div>
    <div class="weather">☀ 31° / 24°</div>
  </header>

  <section class="section" id="today">
    <h2>היום</h2>
    <p class="schedule">09:00 משרד · 18:30 אימון</p>
  </section>

  <section class="section" id="prep">
    <h2>להיום</h2>
    <ul class="prep">
      <li>שים חטיף / משקה חלבון בתיק – אימון מחר</li>
      <li>להכין אוכל למחר (משרד)</li>
    </ul>
  </section>

  <section class="section" id="money">
    <h2>כסף</h2>
    <p class="headline">אין הוצאות מתוכננות היום.</p>
    <p class="trend">אוכל בחוץ: 2 הזמנות השבוע (שבוע שעבר 5) ↓</p>
  </section>

  <section class="section" id="week">
    <h2>השבוע</h2>
    <p class="week">ב׳ בישול חברים · ה׳ פוקר · ו׳ בית</p>
  </section>

  <section class="section" id="robot">
    <p class="robot-status">🤖 רובורוק: 84%, ניקוי אחרון לפני 2 ימים</p>
    <button class="action" data-action="clean">התחל ניקוי</button>
  </section>
</main>
<script src="/brief.js"></script>
</body>
</html>
```

Rules for filling it in:

- `refresh` stays at `brief.refresh_seconds`.
- The weather line is `<icon> <max>° / <min>°`; add `גשם` when rain is forecast and
  `רוח חזקה` above 30 km/h. If weather failed, leave the div empty.
- `#today .schedule` — today's timed events, `HH:MM כותרת`, joined with ` · `. Nothing
  today: `<p class="empty">אין אירועים היום</p>`.
- `#money` — the headline; then, only if today spends from them, one `.envelopes` line
  for those envelopes joined with ` · `; then `track` envelopes that crossed the
  threshold on their own line with `class="low"` (or `class="negative"` when below
  zero); then the `.trend` line. Omit the `.envelopes` line entirely on a day with
  nothing planned — do not emit it empty. Wrap an `encourage` amount in
  `<span class="encourage">…</span>`. The renew-token notice goes in a single
  `<p class="notice">`.
- `#week` — the rest of the lookahead window (tomorrow through day
  `brief.calendar_days_ahead`, never only "until Saturday"), one entry per day that
  carries something worth naming, as `א׳ כותרת`, joined with ` · `. Today is not
  repeated here. Past six entries, keep the ones that cost money or need preparation.
- `#robot` — only when `roborock` answered. Include the battery, how long ago the last
  clean was, and any error. When today is an office day and the last clean was more
  than `roborock.suggest_clean_after_days` days ago, make the line the suggestion:
  `אתה בחוץ היום, להפעיל שאיבה?`. Drop the whole `<section id="robot">` when the robot
  is unavailable. The button markup never changes — `/brief.js` wires it.
- A section whose source failed keeps its heading and gets
  `<p class="unavailable">לא זמין</p>`.
- Escape `&`, `<` and `>` inside any text that came from a calendar title.

Everything must fit one 1080p screen: at most four preparation lines, one line each for
the schedule, envelopes, trend and week.

## Step 7 — Report

After writing the file, reply with a short English summary for the console: what each
section ended up saying, which sources failed, and anything that looked wrong in the
data (for example a sign convention you had to flip). This is the only English output.

## Failure behaviour

| Condition | What the brief does |
|---|---|
| RiseUp 401 | Money section replaced by the renew-token notice |
| RiseUp 429 or down | Money section says `לא זמין`; the local server keeps showing the last brief marked `נתונים מאתמול` if this run writes nothing at all |
| Calendar unavailable | `#today`, `#prep` and `#week` say `לא זמין` |
| Weather unavailable | Header weather div left empty |
| Roborock unavailable | `#robot` omitted entirely |

Never abort the run because one source failed. A brief with three working sections is
the product; an empty screen is not.
