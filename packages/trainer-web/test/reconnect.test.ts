/**
 * Back from offline (round 5).
 *
 * The offline line tells a player their record is kept on this device and joins
 * the shared table when the connection is back. This holds the page to it: a
 * hand played while the table cannot be reached reaches the table on the first
 * poll that gets through — not only after the next hand is played.
 *
 * The table is a local stand-in that refuses everything until it is switched
 * on. Nothing here talks to the real one.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';

import { catalogue } from '../src/i18n.ts';
import { loadHosted } from './helpers/hosted-page.ts';

let server: Server;
let port = 0;
let up = false;
let rows: any[] = [];

before(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (c) => chunks.push(c));
    request.on('end', () => {
      if (!up) {
        response.writeHead(503).end();
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (request.method === 'POST') {
        const incoming = raw ? JSON.parse(raw) : null;
        for (const row of Array.isArray(incoming) ? incoming : [incoming]) {
          rows = [...rows.filter((r) => r.id !== row.id), row];
        }
        response.writeHead(201).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('[]');
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

test('a hand played offline reaches the shared table when the connection comes back', async () => {
  // The leaderboard polls every 20 seconds; the test does not wait that long.
  const realTimeout = globalThis.setTimeout;
  (globalThis as any).setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) =>
    realTimeout(fn, ms !== undefined && ms >= 1000 ? 25 : ms, ...rest);
  try {
    const page = loadHosted('#ultimate', [['ev:playerName', 'Dana'], ['ev:playerId', 'dana-row']], {
      url: `http://127.0.0.1:${port}`,
      key: 'anon-key-for-the-test',
    });
    await page.booted;

    // Offline: the leaderboard says so.
    const offline = catalogue('en')['social.offlineNow']!;
    let said = '';
    for (let i = 0; i < 80 && !said.includes(offline); i++) {
      await settle();
      said = page.document.getElementById('panel-table').children.map((c: any) => c.textContent).join(' ');
    }
    assert.ok(said.includes(offline), 'the leaderboard did not say it was offline');

    // One whole hand of Ultimate, played with no table.
    let view = await page.api('/api/uth/deal');
    while (view.legalActions.length > 0) {
      const legal = view.legalActions.map((a: { action: string }) => a.action);
      view = await page.api('/api/uth/act', { action: legal.includes('check') ? 'check' : 'raise1x' });
    }
    await settle(100);
    assert.equal(rows.length, 0, 'nothing can have reached a table that refuses everything');

    // The connection comes back. No further hand is played.
    up = true;
    for (let i = 0; i < 120 && rows.find((r) => r.id === 'dana-row')?.progress?.uth?.hands !== 1; i++) {
      await settle();
    }
    page.stopWatching();
    const row = rows.find((r) => r.id === 'dana-row');
    assert.ok(row, 'the record never reached the table after the connection came back');
    assert.equal(row.progress.uth.hands, 1, 'the hand played offline is not in the record');
  } finally {
    (globalThis as any).setTimeout = realTimeout;
  }
});
