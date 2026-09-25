/**
 * The Blackjack leaderboard comes through the Ultimate rating unchanged
 * (round 10).
 *
 * Written against the round 9 build before any leaderboard code was touched,
 * and left in place afterwards: the same rows from the same table must give the
 * same question to the table and the same list on the screen — same players,
 * same order, same figures, same line under each name.
 *
 * The shared table is a local stand-in. Nothing here talks to the real one.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';

import { catalogue } from '../src/i18n.ts';
import { loadHosted } from './helpers/hosted-page.ts';

const EN = catalogue('en');

let server: Server;
let port = 0;
const gets: string[] = [];
const posts: any[] = [];
/** How the stand-in answers the Ultimate side: rows, or a status for a table without migration 003. */
let uthAnswer: any[] | number = [];
/** Refuse any save naming the Ultimate columns, as a table without migration 003 does. */
let refuseUthColumns = false;

/** Rows as the table sends them for the Blackjack list, already in rating order. */
const ROWS = [
  // Every decision made at a shared table: rated, and no private-table figure (round 31).
  { id: 's', name: 'Shared only', rating: 1948, peak: 1959, provisional: false, mode: 'basic', hands: 0, decisions: 0, lifetime_decisions: 182, accuracy: 1, ev_lost_per_100: 0, feed: [], updated_at: '2026-09-22T22:13:00Z' },
  { id: 'a', name: 'Maya', rating: 1640, peak: 1660, provisional: false, mode: 'basic', hands: 412, decisions: 398, lifetime_decisions: 900, accuracy: 0.9412, ev_lost_per_100: 0.83, feed: [], updated_at: '2026-09-13T10:00:00Z' },
  { id: 'me', name: 'Dana', rating: 1310, peak: 1320, provisional: true, mode: 'basic', hands: 25, decisions: 22, lifetime_decisions: 22, accuracy: 0.8, ev_lost_per_100: 2.5, feed: [], updated_at: '2026-09-14T10:00:00Z' },
  { id: 'b', name: 'Opened only', rating: 0, peak: 1200, provisional: true, mode: 'basic', hands: 0, decisions: 0, lifetime_decisions: 0, accuracy: 0, ev_lost_per_100: 0, feed: [], updated_at: '2026-09-14T11:00:00Z' },
  { id: 'c', name: 'Uth only', rating: 0, peak: 1200, provisional: true, mode: 'basic', hands: 3, decisions: 3, lifetime_decisions: 3, accuracy: 1, ev_lost_per_100: 0, feed: [], updated_at: '2026-09-14T12:00:00Z' },
];

before(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (c) => chunks.push(c));
    request.on('end', () => {
      const url = decodeURIComponent(request.url ?? '');
      if (request.method !== 'GET') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
        posts.push(body);
        if (refuseUthColumns && body && 'uth_rating' in body) {
          response.writeHead(400, { 'content-type': 'application/json' });
          return void response.end(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'uth_provisional' column of 'players' in the schema cache" }));
        }
        return void response.writeHead(201).end();
      }
      gets.push(url);
      if (url.includes('order=uth_rating.desc')) {
        if (typeof uthAnswer === 'number') return void response.writeHead(uthAnswer).end('{"code":"42703"}');
        response.writeHead(200, { 'content-type': 'application/json' });
        return void response.end(JSON.stringify(uthAnswer));
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(url.includes('order=rating.desc') ? ROWS : []));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

test('the Blackjack leaderboard: the same question to the table, and the same rows in the same order', async () => {
  const page = loadHosted('#home', [
    ['ev:playerName', 'Dana'],
    ['ev:playerId', 'me'],
    ['ev:locale', 'en'],
  ], { url: `http://127.0.0.1:${port}`, key: 'k' });
  await page.booted;

  const panel = page.document.getElementById('panel-table');
  let list: any = null;
  for (let i = 0; i < 100 && !list; i++) {
    await settle();
    list = (panel.children as any[]).find((c) => c.className === 'ladder board') ?? null;
  }
  assert.ok(list, 'the Blackjack list never rendered');

  const question = gets.find((u) => u.includes('order=rating.desc'))!;
  assert.equal(
    question.replace(/^.*\?/, ''),
    'select=id,name,rating,peak,provisional,mode,hands,decisions,lifetime_decisions,accuracy,ev_lost_per_100,feed,updated_at' +
      '&merged_into=is.null&order=rating.desc&limit=60',
  );

  const strip = (text: unknown) => String(text).replace(/[⁦-⁩]/g, '');
  const rows = (list.children as any[]).map((row) => ({
    me: row.className.includes('is-me'),
    cells: (row.children as any[]).map((cell) => strip(cell.textContent)),
  }));
  const line = (accuracy: string, hands: number) =>
    EN['social.playerLine']!.replace('{accuracy}', accuracy).replace('{hands}', String(hands));
  assert.deepEqual(rows, [
    { me: false, cells: ['1', 'Shared only', '1948', EN['social.playerLineAll']!.replace('{decisions}', '182')] },
    { me: false, cells: ['2', 'Maya', '1640', line('94.1', 412)] },
    { me: true, cells: ['3', 'Dana', '1310', line('80.0', 25)] },
    { me: false, cells: ['4', 'Uth only', '—', line('100.0', 3)] },
  ]);
  /* The figure beside a rating says which table it is from (round 31). */
  assert.match(EN['social.playerLine']!, /private table/);
  page.stopWatching();
});

// --- The Ultimate side (round 10) ----------------------------------------------------------

async function openBoard(game: 'bj' | 'uth') {
  const page = loadHosted('#home', [
    ['ev:playerName', 'Dana'],
    ['ev:playerId', 'me'],
    ['ev:locale', 'en'],
    ['ev:board', game],
  ], { url: `http://127.0.0.1:${port}`, key: 'k' });
  await page.booted;
  return page;
}

const textOfChildren = (node: any) => (node.children as any[]).map((c) => String(c.textContent).replace(/[⁦-⁩]/g, ''));

test('the switch names both games, and the Ultimate side ranks by the Ultimate rating only', async () => {
  uthAnswer = [
    { id: 'c', name: 'Uth only', uth_rating: 1385, uth_provisional: true, uth_decisions: '31' },
    { id: 'me', name: 'Dana', uth_rating: 1240, uth_provisional: false, uth_decisions: '212' },
  ];
  const page = await openBoard('uth');
  const panel = page.document.getElementById('panel-table');
  let list: any = null;
  for (let i = 0; i < 100 && !list; i++) {
    await settle();
    list = (panel.children as any[]).find((c) => c.className === 'ladder board') ?? null;
  }
  assert.ok(list, 'the Ultimate list never rendered');

  const [bar, caption] = panel.children;
  assert.deepEqual(textOfChildren(bar), [EN['ui.blackjack'], EN['ui.ultimate']]);
  assert.equal(caption.textContent, EN['social.byUltimate']);

  const question = gets.filter((u) => u.includes('order=uth_rating.desc')).at(-1)!;
  assert.match(question, /merged_into=is\.null/);
  assert.match(question, /uth_rating=not\.is\.null/, 'players never rated in Ultimate must not be asked for');

  const rows = (list.children as any[]).map((row) => textOfChildren(row));
  assert.deepEqual(rows, [
    ['1', 'Uth only', '1385', EN['social.uthPlayerLine']!.replace('{decisions}', '31')],
    ['2', 'Dana', '1240', EN['social.uthPlayerLine']!.replace('{decisions}', '212')],
  ]);
  page.stopWatching();
});

test('a table without migration 003 keeps saving, and the Ultimate side says it is waiting', async () => {
  uthAnswer = 400;
  refuseUthColumns = true;
  posts.length = 0;
  const page = await openBoard('uth');
  const panel = page.document.getElementById('panel-table');
  const pending = EN['social.uthPending'];
  for (let i = 0; i < 100 && !textOfChildren(panel).includes(pending!); i++) await settle();
  assert.ok(textOfChildren(panel).includes(pending!), 'the Ultimate side did not say it was waiting');

  // The save that opening the page makes: refused once for naming the columns, then kept without them.
  for (let i = 0; i < 100 && posts.length < 2; i++) await settle();
  assert.ok('uth_rating' in posts[0], 'the first save did not carry the Ultimate columns');
  assert.ok(!('uth_rating' in posts[1]) && !('uth_provisional' in posts[1]));
  assert.equal(posts[1].name, 'Dana');
  refuseUthColumns = false;
  page.stopWatching();
});

test('a player never rated in Ultimate is written as not rated there', async () => {
  uthAnswer = [];
  posts.length = 0;
  const page = await openBoard('bj');
  for (let i = 0; i < 100 && posts.length < 1; i++) await settle();
  assert.equal(posts[0].uth_rating, null);
  assert.equal(posts[0].uth_provisional, true);
  page.stopWatching();
});
