/**
 * The hosted copy, and the backend it talks to.
 *
 * The published artifact gets its store from the viewer. A page served from
 * anywhere else has to fetch one over HTTP, and that path has no equivalent of
 * the artifact runtime to catch a mistake — a wrong header or a mis-shaped row
 * just means an empty leaderboard and no explanation.
 *
 * So the HTTP backend is exercised against a real server here rather than a
 * stubbed `fetch`: it has to produce requests a PostgREST table would actually
 * accept, and read back what one would actually return.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

/** Requests the stand-in server saw, so the shape of each can be asserted. */
interface Seen {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

let server: Server;
let port = 0;
const seen: Seen[] = [];
let rows: any[] = [];

before(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (c) => chunks.push(c));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      seen.push({
        method: request.method ?? '',
        path: request.url ?? '',
        headers: request.headers,
        body: raw ? JSON.parse(raw) : null,
      });

      // Enough PostgREST to be honest about: upsert by primary key, filter by
      // id, and column selection.
      if (request.method === 'POST') {
        const incoming = seen[seen.length - 1]!.body;
        rows = [...rows.filter((r) => r.id !== incoming.id), incoming];
        response.writeHead(201).end();
        return;
      }
      const url = new URL(request.url ?? '/', 'http://x');
      const filter = url.searchParams.get('id');
      const wanted = filter ? rows.filter((r) => `eq.${r.id}` === filter) : rows;
      const columns = (url.searchParams.get('select') ?? '').split(',').filter(Boolean);
      const projected = wanted.map((row) =>
        columns.length === 0
          ? row
          : Object.fromEntries(columns.map((c) => [c, row[c] ?? null])),
      );
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(projected));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

after(() => server.close());

/**
 * The backend module on its own.
 *
 * Loading the whole page would boot it, and a booted page starts a polling
 * watch that keeps the process alive forever. The adapters are the unit under
 * test here, so they are evaluated by themselves.
 */
function loadBackends(): Record<string, any> {
  const source = readFileSync(join(HERE, '..', 'artifact', 'backends.js'), 'utf8');
  const out: Record<string, any> = {};
  (globalThis as any).window = globalThis;
  new Function('__out', `${source}
__out.openBackend = openBackend;`)(out);
  return out;
}

/** Load the hosted page's scripts against a DOM stub and a real backend. */
function loadHosted(config: unknown): Record<string, any> {
  const html = readFileSync(join(ROOT, 'docs', 'index.html'), 'utf8');
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]!)
    .join('\n');

  const el = (): any => ({
    style: {}, dataset: {}, children: [], value: '', textContent: '', innerHTML: '',
    hidden: false, lang: '',
    classList: { add() {}, remove() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null,
    appendChild: (c: unknown) => c, append() {}, replaceChildren() {},
    insertBefore: (c: unknown) => c, addEventListener() {}, focus() {}, remove() {},
    showModal() {}, close() {},
    querySelector: () => el(), querySelectorAll: () => [],
    get parentElement() { return el(); },
  });
  const doc = el();
  doc.getElementById = () => el();
  doc.createElement = () => el();
  doc.documentElement = el();
  doc.body = el();

  const disk = new Map<string, string>([['ev:playerName', 'Dana']]);
  const g = globalThis as any;
  g.document = doc;
  g.localStorage = {
    getItem: (k: string) => disk.get(k) ?? null,
    setItem: (k: string, v: string) => disk.set(k, String(v)),
  };
  // `crypto` is a real, getter-only global here and already has the one method
  // the page uses, so it is left alone rather than stubbed over.
  g.window = globalThis;
  g.location = { reload() {} };
  g.alert = () => {};

  const out: Record<string, any> = {};
  new Function(
    '__out',
    '__config',
    `const BACKEND_CONFIG = __config;\n${code}\n` +
      '__out.api = api; __out.session = () => session; __out.connect = connect;' +
      '__out.openBackend = openBackend; __out.leaderboard = () => leaderboard;',
  )(out, config);
  return out;
}

test('the hosted page is a complete document that names itself', () => {
  const html = readFileSync(join(ROOT, 'docs', 'index.html'), 'utf8');
  assert.ok(html.startsWith('<!doctype html>'), 'not a standalone document');
  assert.ok(html.includes('<title>EV Trainer</title>'));
  assert.ok(html.includes('<div id="app">'));
  // The artifact viewer supplies a document; a plain host does not, so the two
  // outputs are genuinely different files and this is what tells them apart.
  const fragment = readFileSync(
    join(ROOT, 'packages', 'trainer-web', 'build', 'artifact.html'),
    'utf8',
  );
  assert.ok(!fragment.includes('<!doctype html>'), 'the artifact must stay a fragment');
});

test('with no shared table configured, the page still plays', async () => {
  const app = loadHosted(undefined);
  await app.connect();
  const view = await app.api('/api/deal');
  assert.ok(['player', 'insurance', 'settled'].includes(view.phase));
  assert.equal(app.leaderboard().length, 0);
});

test('the HTTP backend saves and reads back a real player', async () => {
  rows = [];
  seen.length = 0;
  const config = { url: `http://127.0.0.1:${port}`, key: 'anon-key-for-the-test' };
  const backend = await loadBackends().openBackend(config);
  assert.ok(backend, 'no backend was opened');

  await backend.save('player-1', {
    name: 'Dana',
    rating: 1642,
    peak: 1655,
    provisional: false,
    mode: 'basic',
    hands: 412,
    decisions: 398,
    accuracy: 0.941,
    evLostPer100: 0.83,
    at: Date.now(),
    progress: { version: 1, decisions: 398 },
    feed: [{ at: 1, headline: '8,8 vs 6 → Split', correct: true }],
  });

  const write = seen.find((r) => r.method === 'POST')!;
  // PostgREST needs this header to treat the insert as an upsert; without it a
  // returning player gets a duplicate-key error and silently stops appearing.
  assert.match(String(write.headers.prefer), /resolution=merge-duplicates/);
  assert.equal(write.headers.apikey, 'anon-key-for-the-test');
  assert.equal(write.headers.authorization, 'Bearer anon-key-for-the-test');
  assert.equal(write.body.id, 'player-1');
  assert.equal(write.body.ev_lost_per_100, 0.83, 'the column is snake_case in the table');
  assert.equal(write.body.progress.decisions, 398);

  const loaded = await backend.load('player-1');
  assert.equal(loaded.progress.decisions, 398);
  assert.equal(loaded.feed.length, 1);

  assert.equal(await backend.load('nobody'), null);
});

test('the leaderboard query leaves the saved sessions behind', async () => {
  rows = [];
  seen.length = 0;
  const config = { url: `http://127.0.0.1:${port}`, key: 'k' };
  const backend = await loadBackends().openBackend(config);

  await backend.save('a', {
    name: 'Dana', rating: 1600, peak: 1600, provisional: false, mode: 'basic',
    hands: 100, decisions: 90, accuracy: 0.9, evLostPer100: 1, at: Date.now(),
    progress: { version: 1, decisions: 90, history: new Array(40).fill({ big: 'x' }) },
    feed: [{ at: 2, headline: 'A,A vs 6 → Split', correct: true }],
  });

  const rowsSeen: any[][] = [];
  const stop = backend.watch((r: any[]) => rowsSeen.push(r));
  await new Promise((r) => setTimeout(r, 250));
  stop();

  assert.ok(rowsSeen.length > 0, 'the watch never delivered');
  const list = rowsSeen[rowsSeen.length - 1]!;
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Dana');
  assert.equal(list[0].evLostPer100, 1, 'snake_case did not come back mapped');
  assert.equal(list[0].feed.length, 1, 'the feed rides along with the row');

  // Every viewer polls this, and a saved session is by far the largest column.
  const read = seen.find((r) => r.method === 'GET' && r.path.includes('order=rating.desc'))!;
  assert.ok(!read.path.includes('progress'), 'the list query is dragging saved sessions along');
});
