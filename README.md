# Morning Brief

A personal assistant that runs on the home PC, reads the week ahead, and puts a
Hebrew brief on the living-room TV every morning.

The point isn't "how much money is left". It's the habit: look at the week, prepare
for it, and see what's left before spending.

```
┌─────────────────────────────────────────────┐
│  יום ראשון, 30.8    ☀ 31° / 24°              │
├─────────────────────────────────────────────┤
│  היום                                       │
│  09:00 משרד · 18:30 אימון                   │
│                                             │
│  להיום                                      │
│  ▸ שים חטיף בתיק – אימון היום               │
│  ▸ להכין אוכל למחר (משרד)                   │
│                                             │
│  כסף                                        │
│  אין הוצאות מתוכננות היום.                  │
│  חוויות 1,000 ₪ · סופר 620 ₪ · LIME 90 ₪    │
│  אוכל בחוץ: 2 הזמנות השבוע (שבוע שעבר 5) ↓  │
│                                             │
│  השבוע                                      │
│  ב׳ בישול חברים · ה׳ פוקר · ו׳ בית          │
│                                             │
│  🤖 רובורוק: 84%, ניקוי אחרון לפני 2 ימים   │
│     [התחל ניקוי]                            │
└─────────────────────────────────────────────┘
```

## How it is built

Two rules shape everything here.

**MCP is king.** Every data source is an MCP server. Where a system ships one, we use
it; where it doesn't, we wrap it. No application code calls anybody's API.

**The assistant knows nothing the source apps don't.** The calendar owns the schedule,
RiseUp owns the budget, Roborock owns the robot. Decisions — which days are home days —
are written *back* to the calendar. Delete this repo tomorrow and the original apps
still show the complete picture. The only local state is `.env` (secrets) and
`out/cache/last-brief.html` (a disposable copy for when a source is down).

```
Task Scheduler ──► agent host (Claude Agent SDK)
   07:00/12:00/18:00     │  loads skills/morning-brief/SKILL.md
   Sat 20:00             │  applies config.yaml
                         ├── MCP riseup           @riseup-oss/mcp          read
                         ├── MCP google-calendar  @cocal/google-calendar-mcp  read + write
                         ├── MCP weather          open-meteo-mcp           read
                         └── MCP roborock         built here (python-roborock)
                         ▼
                    out/brief.html ──► localhost:8080 ──► kiosk browser on the TV
                                          /action/clean → agent → roborock MCP
```

The agent is the brain: it fetches through the MCP servers, applies `config.yaml`,
phrases the brief in Hebrew and writes the HTML itself. There is no hand-written
fetch-and-calculate code outside the MCP servers — on purpose. The parts you iterate on
are `config.yaml` (the rules) and `skills/*/SKILL.md` (the instructions).

| Path | What it is |
|---|---|
| `config.yaml` | Envelopes, event keywords, preparation rules, MCP wiring. Rules only, no data. |
| `skills/morning-brief/SKILL.md` | What to fetch, how to compute, tone, layout. |
| `skills/weekly-planning/SKILL.md` | How next week's home days are proposed and written back. |
| `src/` | The agent host, the local server, the CLIs. Thin by design. |
| `mcp-servers/roborock/` | The one MCP server built here. |
| `public/brief.css`, `public/brief.js` | Every visual decision, and the one button. |
| `out/` | Generated. Safe to delete. |

## Setup

Node 20+ and Python 3.11+ on the machine, then:

```bash
npm install
python -m pip install -r mcp-servers/roborock/requirements.txt
cp .env.example .env      # then fill it in
```

### 1. Secrets

| Variable | Where it comes from |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `RISEUP_PAT` | input.riseup.co.il/developer/tokens, scope `budget:read`. **Expires after 30 days.** |
| `GOOGLE_OAUTH_CREDENTIALS` | Path to the OAuth client JSON from Google Cloud (Calendar API enabled, your address added as a test user). |
| `ROBOROCK_USERNAME` / `ROBOROCK_PASSWORD` | Your Roborock app account. Leave blank to hide the robot section. |

Google Calendar needs one interactive authorization before the first scheduled run:

```bash
npx @cocal/google-calendar-mcp auth
```

Check everything is wired without spending a token:

```bash
npm run doctor
```

### 2. Map the envelopes (one-time)

RiseUp returns envelopes keyed by id. Print them and paste the block it gives you over
the `envelopes:` section of `config.yaml`:

```bash
npm run envelopes
```

This is the only manual setup step. The brief will render before you do it, but the
money section won't match your budget.

### 3. Run it

```bash
npm run brief     # renders out/brief.html
npm run serve     # serves it on http://localhost:8080
npm run weekly    # proposes next week's home days and writes them to the calendar
```

The page is reachable from any browser on the home network, not just the TV.

### 4. Schedule it (Windows)

From an elevated PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\install-tasks.ps1
```

That registers four tasks: the brief at 07:00 / 12:00 / 18:00, weekly planning on
Saturday at 20:00, the server at logon, and the kiosk browser a minute later.
`uninstall-tasks.ps1` removes them. Logs land in `out/*.log`.

## Using it

Put `משרד` or `בית` in a calendar event title and the brief treats that day
accordingly — the keyword lists live in `config.yaml` under `event_rules`, and adding a
category means adding a line there, not changing code. Same for reminders
(`prep_rules`) and for how each envelope is spoken about (`tone`).

Tones are deliberate: experiences encourage ("מותר עד X, תיהנה"), durables are stated
quietly and never suggested, eating out gets a trend and nothing else.

## When something breaks

| What happened | What you see |
|---|---|
| RiseUp token expired (401) | The money section becomes `הטוקן של RiseUp פג – חדש ב-input.riseup.co.il/developer/tokens` |
| RiseUp rate-limited or down | The last good brief, banner-marked `נתונים מאתמול` |
| Calendar unavailable | Schedule, preparations and week sections say `לא זמין` |
| Weather unavailable | The header temperature is empty |
| Roborock unavailable | The robot section disappears |

One broken source never takes down the brief. `npm run doctor` tells you which servers
are wired and which are missing a secret.

## Not in phase 1

Monday-dinner settlement (Splitwise), TV power control over HDMI-CEC, "seen"
acknowledgements on reminders, and free-text chat from the TV. `POST /chat` answers 501
until then.
