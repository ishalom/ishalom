/**
 * Who is playing (round 9).
 *
 * The page Idan reads his gate from: how many people have played, how much each
 * played, and how many came back on another day. What it rests on is small and
 * is held here:
 *
 *   - an empty table reads as nobody, and a refused question never reads as zero;
 *   - a day is a calendar day, counted once however many hands it holds, and two
 *     devices can undercount it but never count a day twice;
 *   - opening the app is not playing; a player from before the count gets their
 *     earlier day back at their next hand, once;
 *   - what is kept about days is three facts and nothing about anyone's device;
 *   - the page reads live rows only, and only the columns it counts;
 *   - nothing links to it, and it says plainly that it is not private.
 *
 * The shared table is a local stand-in. Nothing here talks to the real one.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalogue } from '../src/i18n.ts';
import { loadHosted, type HostedPage } from './helpers/hosted-page.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACT = join(HERE, '..', 'artifact');
const PUBLIC = join(HERE, '..', 'public');
const EN = catalogue('en');

// --- The stand-in table ----------------------------------------------------------

let server: Server;
let port = 0;
/** What the stand-in answers, per kind of question. */
let answers: { load: any[]; usage: any[] | number } = { load: [], usage: [] };
const writes: any[] = [];
const usageQueries: string[] = [];

before(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (c) => chunks.push(c));
    request.on('end', () => {
      const url = decodeURIComponent(request.url ?? '');
      if (request.method === 'POST') {
        writes.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        response.writeHead(201).end();
        return;
      }
      let body: unknown = [];
      if (url.includes('activity:progress')) {
        usageQueries.push(url);
        if (typeof answers.usage === 'number') {
          response.writeHead(answers.usage).end();
          return;
        }
        body = answers.usage;
      } else if (url.includes('id=eq.')) {
        body = answers.load;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const withTable = (hash: string, stored: Array<[string, string]>) =>
  loadHosted(hash, stored, { url: `http://127.0.0.1:${port}`, key: 'anon-key-for-the-test' });

/** A page with no table, for the pure functions. */
const plain = loadHosted('', [['ev:playerName', 'Dana']]);
const U = plain.usage;
plain.stopWatching();

async function waitFor(check: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries && !check(); i++) await settle(20);
}

// --- Reading the table -------------------------------------------------------------

test('an empty table reads as nobody, and nothing opened', () => {
  const empty = U.summariseUsage([], '2026-09-20');
  const { opened, ...rest } = empty;
  assert.deepEqual(rest, { people: [], played: 0, cameBack: 0, regulars: 0, recent: 0 });
  // Round 15: every counted control is listed at zero rather than missing, so
  // "nobody has ever opened this" is a row on the page rather than a gap.
  assert.deepEqual(Object.values(opened as Record<string, number>).filter((n) => n !== 0), []);
  assert.ok(Object.keys(opened as object).length >= 10, 'the controls are not all listed');
  assert.equal(U.summariseUsage(null, '2026-09-20').played, 0);
});

test('what people open is added up across everyone, and only what is known is shown (round 15)', () => {
  const s = U.summariseUsage(
    [
      { name: 'A', blackjack: 40, ultimate: 0, activity: { firstDay: '2026-09-14', lastDay: '2026-09-18', days: 3 }, counters: { help: 4, chart: 1, nonsense: 99 } },
      { name: 'B', blackjack: 10, ultimate: 0, activity: { firstDay: '2026-09-18', lastDay: '2026-09-18', days: 1 }, counters: { help: 2, primer: 5 } },
      { name: 'C', blackjack: 1, ultimate: 0, activity: null, counters: null },
    ],
    '2026-09-20',
  );
  assert.equal(s.opened.help, 6, 'two people opening the explanation is six opens');
  assert.equal(s.opened.primer, 5);
  assert.equal(s.opened.chart, 1);
  assert.equal(s.opened.howto, 0, 'a control nobody opened is zero, not missing');
  assert.equal((s.opened as Record<string, number>).nonsense, undefined, 'an unknown key reached the page');
});

test('someone with no graded decision has not played; someone with no day count has played and not come back', () => {
  const s = U.summariseUsage(
    [
      { name: 'Opened only', blackjack: 0, ultimate: 0, activity: null, at: Date.parse('2026-09-19T10:00:00Z') },
      { name: 'From before', blackjack: 40, ultimate: 0, activity: null, at: Date.parse('2026-09-10T10:00:00Z') },
    ],
    '2026-09-20',
  );
  assert.equal(s.played, 1);
  assert.equal(s.people[0].name, 'From before');
  assert.equal(s.people[0].counted, false);
  assert.equal(s.cameBack + s.regulars + s.recent, 0);
  assert.equal(s.people[0].lastSeen, '2026-09-10');
});

test('coming back is two different days; a regular is three days and a hundred decisions; recent is seven days', () => {
  const row = (name: string, days: number, decisions: number, lastDay: string) => ({
    name,
    blackjack: decisions,
    ultimate: 0,
    activity: { firstDay: '2026-09-01', lastDay, days },
    at: 0,
  });
  const s = U.summariseUsage(
    [
      row('one day', 1, 500, '2026-09-20'),
      row('two days', 2, 30, '2026-09-14'),
      row('three short', 3, 99, '2026-09-13'),
      row('regular', 3, 100, '2026-09-20'),
    ],
    '2026-09-20',
  );
  const by = Object.fromEntries(s.people.map((p: any) => [p.name, p]));
  assert.deepEqual(
    [by['one day'].cameBack, by['two days'].cameBack, by['three short'].regular, by['regular'].regular],
    [false, true, false, true],
  );
  // 2026-09-14 is six days before the 20th: inside seven days, today included. The 13th is not.
  assert.deepEqual([by['two days'].recent, by['three short'].recent], [true, false]);
  assert.deepEqual([s.played, s.cameBack, s.regulars, s.recent], [4, 3, 1, 3]);
  // Both games count toward how much someone played.
  assert.equal(U.summariseUsage([{ name: 'x', blackjack: 60, ultimate: 40, activity: row('', 3, 0, '2026-09-20').activity }], '2026-09-20').regulars, 1);
});

// --- Counting days -------------------------------------------------------------------

test('a day counts once however many hands it holds, and a clock set back adds nothing', () => {
  const page = loadHosted('', [['ev:playerName', 'Dana']]);
  const u = page.usage;
  u.markPlayed('2026-09-14');
  u.markPlayed('2026-09-14');
  assert.deepEqual(u.activity, { firstDay: '2026-09-14', lastDay: '2026-09-14', days: 1 });
  u.markPlayed('2026-09-15');
  u.markPlayed('2026-09-15');
  u.markPlayed('2026-09-13');
  assert.deepEqual(u.activity, { firstDay: '2026-09-14', lastDay: '2026-09-15', days: 2 });
  page.stopWatching();
});

test('two devices: the larger count wins, never the sum, and two different days are at least two', () => {
  const d = (firstDay: string, lastDay: string, days: number) => ({ firstDay, lastDay, days });
  assert.deepEqual(U.mergeActivity(d('2026-09-14', '2026-09-14', 1), d('2026-09-14', '2026-09-14', 1)), d('2026-09-14', '2026-09-14', 1));
  assert.deepEqual(U.mergeActivity(d('2026-09-13', '2026-09-13', 1), d('2026-09-15', '2026-09-15', 1)), d('2026-09-13', '2026-09-15', 2));
  assert.deepEqual(U.mergeActivity(d('2026-09-10', '2026-09-20', 5), d('2026-09-12', '2026-09-18', 3)), d('2026-09-10', '2026-09-20', 5));
  assert.deepEqual(U.mergeActivity(null, d('2026-09-10', '2026-09-10', 1)), d('2026-09-10', '2026-09-10', 1));
  assert.equal(U.mergeActivity(null, null), null);
});

test('a day from before the count adds one when it is earlier, and folding it in twice adds nothing', () => {
  const counted = { firstDay: '2026-09-14', lastDay: '2026-09-14', days: 1 };
  const once = U.absorbPrior(counted, '2026-09-10');
  assert.deepEqual(once, { firstDay: '2026-09-10', lastDay: '2026-09-14', days: 2 });
  assert.deepEqual(U.absorbPrior(once, '2026-09-10'), once);
  assert.deepEqual(U.absorbPrior(counted, '2026-09-14'), counted);
  assert.equal(U.absorbPrior(null, '2026-09-10'), null);
});

test('a saved count that cannot be read is no count, rather than a guess', () => {
  assert.equal(U.activityOf({ activity: { firstDay: 'yesterday', lastDay: '2026-09-14', days: 2 } }), null);
  assert.equal(U.activityOf({ activity: 'lots' }), null);
  assert.equal(U.activityOf(null), null);
  assert.deepEqual(U.activityOf({ activity: { firstDay: '2026-09-14', lastDay: '2026-09-14', days: -3 } }), {
    firstDay: '2026-09-14',
    lastDay: '2026-09-14',
    days: 1,
  });
});

// --- On the built page, against the stand-in ------------------------------------------------

async function playOneBlackjackHand(page: HostedPage): Promise<void> {
  let view = await page.api('/api/deal');
  let guard = 0;
  while (guard++ < 30) {
    if (view.phase === 'insurance') view = await page.api('/api/insurance', { take: false });
    else if (view.phase === 'player') view = await page.api('/api/act', { action: 'stand' });
    else break;
  }
}

test('opening the app is not playing; the next hand counts, with the day from before the count', async () => {
  // A player from before this build: forty decisions, their row last written on the 10th.
  const old = { ...plain.session().progress, lifetimeDecisions: 40, decisions: 40 };
  answers = {
    load: [{ progress: old, feed: [], merged_into: null, updated_at: '2026-09-10T10:00:00Z' }],
    usage: [],
  };
  writes.length = 0;
  const page = withTable('#home', [
    ['ev:playerName', 'Old Friend'],
    ['ev:playerId', 'old-friend'],
  ]);
  await page.booted;
  await waitFor(() => writes.length > 0);

  // The write that opening the page makes: no day counted, the earlier day kept.
  const opened = writes.at(-1).progress;
  assert.equal(opened.activity, null);
  assert.equal(opened.playedBefore, '2026-09-10');

  await playOneBlackjackHand(page);
  await waitFor(() => writes.at(-1)?.progress?.activity);
  const today = page.usage.localDay();
  const played = writes.at(-1).progress;
  assert.deepEqual(played.activity, { firstDay: '2026-09-10', lastDay: today, days: 2 });
  assert.equal(played.playedBefore, null);

  // Nothing else about days, and nothing about the device, rides along.
  assert.deepEqual(Object.keys(played.activity).sort(), ['days', 'firstDay', 'lastDay']);
  const blob = JSON.stringify(played);
  for (const word of ['userAgent', 'platform', 'timezone', 'timeZone', 'screen', 'language', 'latitude', 'ip']) {
    assert.ok(!blob.includes(`"${word}"`), `the saved record carries ${word}`);
  }
  page.stopWatching();
});

test('a brand-new player has no day from before, and their first hand is day one', async () => {
  answers = { load: [], usage: [] };
  writes.length = 0;
  const page = withTable('#home', [
    ['ev:playerName', 'New Friend'],
    ['ev:playerId', 'new-friend'],
  ]);
  await page.booted;
  await playOneBlackjackHand(page);
  await waitFor(() => writes.at(-1)?.progress?.activity);
  const today = page.usage.localDay();
  assert.deepEqual(writes.at(-1).progress.activity, { firstDay: today, lastDay: today, days: 1 });
  assert.equal(writes.at(-1).progress.playedBefore, null);
  page.stopWatching();
});

test('the page asks for live rows and only what it counts, and shows the four counts and each person', async () => {
  const today = plain.usage.localDay();
  answers = {
    load: [],
    usage: [
      { name: 'Regular', decisions: 20, lifetime_decisions: 90, uth_decisions: '30', updated_at: new Date().toISOString(), activity: { firstDay: '2026-09-01', lastDay: today, days: 4 } },
      { name: 'From before', decisions: 12, lifetime_decisions: 12, uth_decisions: null, updated_at: '2026-09-10T10:00:00Z', activity: null },
      { name: 'Opened only', decisions: 0, lifetime_decisions: 0, uth_decisions: null, updated_at: new Date().toISOString(), activity: null },
    ],
  };
  usageQueries.length = 0;
  const page = withTable('', [
    ['ev:playerName', 'Idan'],
    ['ev:playerId', 'idan-row'],
    ['ev:locale', 'en'],
  ]);
  await page.booted;
  page.go('#usage');
  assert.equal(page.screen(), 'usage');

  const figures = page.document.getElementById('usage-figures');
  await waitFor(() => figures.children.length === 4);
  const query = usageQueries.at(-1)!;
  assert.match(query, /merged_into=is\.null/);
  assert.match(query, /activity:progress->activity/);
  assert.match(query, /uth_decisions:progress->uth->>lifetimeDecisions/);
  assert.doesNotMatch(query, /select=[^&]*(?:^|,)progress(?:,|&|$)/, 'it must not read anyone’s whole saved session');
  assert.doesNotMatch(query, /pin_hash|name_key/);

  const values = figures.children.map((tile: any) => tile.children[0].textContent);
  assert.deepEqual(values, ['2', '1', '1', '1'], 'played, came back, regulars, recent');

  const people = page.document.getElementById('usage-people').children;
  assert.deepEqual(
    people.map((card: any) => card.children[0].children[0].textContent),
    ['Regular', 'From before'],
  );
  const regular = people[0].children.map((c: any) => c.textContent).join(' | ');
  assert.match(regular, /4 days played/);
  assert.match(regular, /Blackjack: 90 decisions · Ultimate: 30 decisions/);
  page.stopWatching();
});

test('a refused question shows its status, and never zero people', async () => {
  answers = { load: [], usage: 400 };
  const page = withTable('', [
    ['ev:playerName', 'Idan'],
    ['ev:playerId', 'idan-row'],
    ['ev:locale', 'en'],
  ]);
  await page.booted;
  page.go('#usage');
  const list = page.document.getElementById('usage-people');
  const refused = EN['usage.refused']!.replace('{status}', '400');
  await waitFor(() => list.children[0]?.textContent === refused);
  assert.equal(list.children[0].textContent, refused);
  assert.equal(page.document.getElementById('usage-figures').children.length, 0);
  page.stopWatching();
});

test('an empty table on the page says nobody has played', async () => {
  answers = { load: [], usage: [] };
  const page = withTable('', [
    ['ev:playerName', 'Idan'],
    ['ev:playerId', 'idan-row'],
    ['ev:locale', 'en'],
  ]);
  await page.booted;
  page.go('#usage');
  const list = page.document.getElementById('usage-people');
  await waitFor(() => list.children[0]?.textContent === EN['usage.nobody']);
  assert.equal(list.children[0].textContent, EN['usage.nobody']);
  page.stopWatching();
});

// --- Who can reach it --------------------------------------------------------------------

test('nothing links to the usage page, and the page says plainly that it is not private', () => {
  const linking: string[] = [];
  for (const [dir, files] of [
    [PUBLIC, readdirSync(PUBLIC).filter((f) => /\.(html|js)$/.test(f))],
    [ARTIFACT, readdirSync(ARTIFACT).filter((f) => f.endsWith('.js') && f !== 'usage.js' && f !== 'ui.js')],
  ] as const) {
    for (const file of files) if (readFileSync(join(dir, file), 'utf8').includes('#usage')) linking.push(file);
  }
  assert.deepEqual(linking, []);

  const usage = readFileSync(join(ARTIFACT, 'usage.js'), 'utf8');
  assert.match(usage, /tr\('usage\.public'\)/);
  for (const code of ['en', 'he'] as const) {
    assert.ok((catalogue(code)['usage.public'] ?? '').length > 60, `${code} does not say who else can read it`);
  }
  assert.match(EN['usage.public']!, /Not private/);
});

test('every word the usage page asks for exists in both languages', () => {
  const usage = readFileSync(join(ARTIFACT, 'usage.js'), 'utf8');
  // Every quoted usage key, whether it goes straight to tr() or through say() and a variable.
  const keys = [...new Set([...usage.matchAll(/'(usage\.[\w.]+)'/g)].map((m) => m[1]!))];
  assert.ok(keys.length >= 20, `only ${keys.length} keys found`);
  for (const code of ['en', 'he'] as const) {
    const table = catalogue(code);
    assert.deepEqual(keys.filter((k) => table[k] === undefined), [], `${code} is missing usage keys`);
  }
});
