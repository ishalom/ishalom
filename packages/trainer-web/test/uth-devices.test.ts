/**
 * Close the tab, reopen; pick up another device — Ultimate, on the built page.
 *
 * `uth-progress.test.ts` holds the sessions to an exact save and restore. This
 * file holds the page to actually doing it, both ways a player meets it:
 *
 *   - with no shared table, where the record lives in the browser alone. That
 *     path restored Blackjack and not UTH until this test was written against it;
 *   - with a shared table, where a second device holding the same player picks
 *     up the stack and the stats the first one left.
 *
 * The shared table is a stand-in speaking enough PostgREST to be honest about,
 * on localhost. The real one is never touched.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';

import { loadHosted, type HostedPage } from './helpers/hosted-page.ts';

let server: Server;
let port = 0;
let rows: any[] = [];

before(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (c) => chunks.push(c));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (request.method === 'POST') {
        const incoming = raw ? JSON.parse(raw) : null;
        const list = Array.isArray(incoming) ? incoming : [incoming];
        for (const row of list) rows = [...rows.filter((r) => r.id !== row.id), row];
        response.writeHead(201).end();
        return;
      }
      if (request.method === 'PATCH') {
        response.writeHead(204).end();
        return;
      }
      const url = new URL(request.url ?? '/', 'http://x');
      const id = url.searchParams.get('id');
      const wanted = id ? rows.filter((r) => `eq.${r.id}` === id) : rows;
      const columns = (url.searchParams.get('select') ?? '').split(',').filter(Boolean);
      const projected = wanted.map((row) =>
        columns.length === 0 ? row : Object.fromEntries(columns.map((c) => [c, row[c] ?? null])),
      );
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(projected));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

/** Play whole UTH hands through the page's own routes. */
async function playUth(page: HostedPage, hands: number): Promise<any> {
  let view: any = null;
  for (let i = 0; i < hands; i++) {
    view = await page.api('/api/uth/deal');
    // Check to the river, then raise 1×: every decision point, every hand.
    while (view.legalActions.length > 0) {
      const legal = view.legalActions.map((a: { action: string }) => a.action);
      view = await page.api('/api/uth/act', { action: legal.includes('check') ? 'check' : 'raise1x' });
    }
  }
  return view;
}

test('with no shared table: close the tab, reopen, and the UTH stack and stats are where they were', async () => {
  const first = loadHosted('#ultimate', [['ev:playerName', 'Dana']]);
  await first.booted;
  const played = await playUth(first, 4);
  first.stopWatching();

  assert.equal(played.stats.hands, 4);
  const saved = JSON.parse(first.storage().get('ev:progress') ?? 'null');
  assert.ok(saved, 'nothing was saved to this browser');
  assert.equal(saved.version, 3);
  assert.equal(saved.uth.hands, 4, 'the UTH part of the saved record is missing its hands');

  // A new page on the same browser storage: the tab reopened.
  const reopened = loadHosted('#ultimate', [...first.storage().entries()]);
  await reopened.booted;
  const state = await reopened.api('/api/uth/state');
  assert.equal(state.stack.balance, played.stack.balance, 'the stack did not survive closing the tab');
  assert.deepEqual(state.stats, played.stats, 'the stats did not survive closing the tab');
  assert.equal(state.history.length, 4, 'the hand log did not survive closing the tab');
  reopened.stopWatching();
});

test('with a shared table: a second device with the same player sees the UTH stack and stats', async () => {
  rows = [];
  const config = { url: `http://127.0.0.1:${port}`, key: 'anon-key-for-the-test' };

  // Device A: a player who has sat down, playing Ultimate.
  const deviceA = loadHosted('#ultimate', [['ev:playerName', 'Dana'], ['ev:playerId', 'dana-row']], config);
  await deviceA.booted;
  const played = await playUth(deviceA, 5);
  // Publishing is fire-and-forget; wait for the last write to land.
  for (let i = 0; i < 100 && rows.find((r) => r.id === 'dana-row')?.progress?.uth?.hands !== 5; i++) {
    await settle();
  }
  deviceA.stopWatching();
  const row = rows.find((r) => r.id === 'dana-row');
  assert.ok(row, 'device A never reached the shared table');
  assert.equal(row.progress.uth.hands, 5, 'the shared record does not hold the UTH hands');

  /*
   * Device B: the same player on a fresh browser. The door has matched name and
   * code and set the row id — that flow is tested in identity and hosted tests —
   * so this starts from the moment it hands over: an id, a name, nothing stored.
   */
  const deviceB = loadHosted('#ultimate', [['ev:playerName', 'Dana'], ['ev:playerId', 'dana-row']], config);
  await deviceB.booted;
  for (let i = 0; i < 5; i++) await tick();
  const state = await deviceB.api('/api/uth/state');
  assert.equal(state.stack.balance, played.stack.balance, 'device B does not see the stack device A left');
  assert.deepEqual(state.stats, played.stats, 'device B does not see the stats device A left');
  assert.equal(state.history.length, 5);

  // And the Blackjack record came across untouched: nothing was played there.
  assert.equal(deviceB.session().stats.hands, 0);
  deviceB.stopWatching();
});

test('a copy with more UTH decisions wins, even when its Blackjack count has not moved', async () => {
  const page = loadHosted('', [['ev:playerName', 'Dana']]);
  await page.booted;
  const blackjackOnly = { version: 3, lifetimeDecisions: 40, decisions: 40 };
  const withUth = { version: 3, lifetimeDecisions: 40, decisions: 40, uth: { version: 1, lifetimeDecisions: 12 } };
  assert.ok(
    page.lifetimeOf(withUth) > page.lifetimeOf(blackjackOnly),
    'an evening of UTH would lose to an older copy with the same Blackjack count',
  );
  assert.equal(page.lifetimeOf(withUth), 52);
  assert.equal(page.lifetimeOf({ version: 2, lifetimeDecisions: 7 }), 7, 'an old save is counted as before');
  page.stopWatching();
});
