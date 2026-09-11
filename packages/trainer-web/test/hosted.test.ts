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

after(() => {
  // `fetch` keeps its sockets alive, so a plain close() waits for them and the
  // process never exits. The connections have to go first.
  server.closeAllConnections();
  server.close();
});

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
function loadHosted(
  config: unknown,
  stored?: Array<[string, string]>,
  startHash?: string,
): Record<string, any> {
  const html = readFileSync(join(ROOT, 'docs', 'index.html'), 'utf8');
  // The built page carries whatever backend it was built with. The test
  // supplies its own, so the page's declaration is removed rather than
  // shadowed — two `const BACKEND_CONFIG` in one scope is a syntax error.
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]!)
    .join('\n')
    .replace(/^[ \t]*const BACKEND_CONFIG = .*$/m, '');

  /*
   * Enough DOM to press a button.
   *
   * Queries are memoised so the same selector yields the same node twice, and
   * listeners are kept so a test can fire one. Without both, a handler
   * registered on a queried element is unreachable and screens that are only
   * driven by clicks — the very first one a new player sees — cannot be tested
   * at all.
   */
  const el = (): any => {
    const queries = new Map<string, any>();
    const node: any = {
      style: {}, dataset: {}, children: [], value: '', textContent: '', innerHTML: '',
      hidden: false, lang: '', listeners: {} as Record<string, Function[]>,
      classList: { add() {}, remove() {}, contains: () => false },
      setAttribute() {}, getAttribute: () => null,
      appendChild(c: any) { node.children.push(c); return c; },
      append(...c: any[]) { node.children.push(...c); },
      replaceChildren(...c: any[]) { node.children = c; },
      insertBefore(c: any) { node.children.unshift(c); return c; },
      addEventListener(type: string, fn: Function) {
        (node.listeners[type] ??= []).push(fn);
      },
      fire(type: string, event: any = { preventDefault() {} }) {
        for (const fn of node.listeners[type] ?? []) fn(event);
      },
      getBoundingClientRect: () => ({
        height: 52, width: 320, top: 0, left: 0, right: 320, bottom: 52,
      }),
      focus() {}, remove() {}, showModal() {}, close() {},
      querySelector(selector: string) {
        if (!queries.has(selector)) queries.set(selector, el());
        return queries.get(selector);
      },
      querySelectorAll: () => [],
      get parentElement() { return el(); },
    };
    return node;
  };
  const doc = el();
  const byId = new Map<string, any>();
  doc.getElementById = (id: string) => {
    if (!byId.has(id)) byId.set(id, el());
    return byId.get(id);
  };
  doc.createElement = () => el();
  doc.documentElement = el();
  doc.body = el();
  (globalThis as any).__doc = doc;

  const disk = new Map<string, string>(stored ?? [['ev:playerName', 'Dana']]);
  const g = globalThis as any;
  g.document = doc;
  g.localStorage = {
    getItem: (k: string) => disk.get(k) ?? null,
    setItem: (k: string, v: string) => disk.set(k, String(v)),
  };
  // `crypto` is a real, getter-only global here and already has the one method
  // the page uses, so it is left alone rather than stubbed over.
  /*
   * The page routes screens through the hash and listens for `hashchange`, so a
   * stub window has to carry both. Assigning the hash here notifies the
   * listeners, the way a browser does — which is what lets a test open the page
   * on a shared link rather than only assert that the code exists.
   */
  const windowListeners: Record<string, Function[]> = {};
  g.addEventListener = (type: string, fn: Function) => {
    (windowListeners[type] ??= []).push(fn);
  };
  g.window = globalThis;
  let hash = startHash ?? '';
  g.location = {
    reload() {},
    get hash() {
      return hash;
    },
    set hash(value: string) {
      if (hash === value) return;
      hash = value;
      for (const fn of windowListeners.hashchange ?? []) fn({});
    },
  };
  g.alert = () => {};

  (globalThis as any).__disk = disk;
  const out: Record<string, any> = {};
  new Function(
    '__out',
    '__config',
    `const BACKEND_CONFIG = __config;\n${code}\n` +
      '__out.api = api; __out.session = () => session; __out.booted = booted;' +
      '__out.openBackend = openBackend; __out.leaderboard = () => leaderboard;' +
      '__out.stopWatching = () => stopWatching && stopWatching();' +
      '__out.screen = () => screen; __out.storage = () => __disk;' +
      '__out.go = (h) => { location.hash = h; }; __out.mount = mount;',
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
  await app.booted;
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

test('two writes in flight cannot land out of order', async () => {
  /*
   * Caught by running against a real project rather than by any test here:
   * the table ended a session showing the rating from the hand before last.
   *
   * Publishing is fire-and-forget from the caller's side, so a slow request
   * could be overtaken by the next one. Writes are last-writer-wins, which
   * makes "out of order" mean "wrong" rather than "briefly behind" — the stale
   * value stays until the next hand happens to correct it.
   */
  rows = [];
  seen.length = 0;

  // A server slow enough that the second write is issued while the first is
  // still open, which is the whole condition being tested.
  const slow = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (c) => chunks.push(c));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
      if (request.method === 'POST') {
        setTimeout(() => {
          rows = [...rows.filter((r) => r.id !== body.id), body];
          response.writeHead(201).end();
        }, 120);
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end('[]');
    });
  });
  await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
  const slowPort = (slow.address() as { port: number }).port;

  const app = loadHosted({ url: `http://127.0.0.1:${slowPort}`, key: 'k' });
  await app.booted;

  // Play hands back to back, faster than the writes can complete.
  for (let i = 0; i < 12; i++) {
    let view = await app.api('/api/deal');
    if (view.phase === 'insurance') view = await app.api('/api/insurance', { take: false });
    let guard = 0;
    while (view.phase === 'player' && guard++ < 20) view = await app.api('/api/act', { action: 'stand' });
  }

  await new Promise((r) => setTimeout(r, 600));
  app.stopWatching();
  slow.closeAllConnections();
  slow.close();

  const stored = rows.find((r) => r.id);
  const played = app.session().view;
  assert.ok(stored, 'nothing was written at all');
  assert.equal(stored.hands, played.stats.hands, 'the table is behind the session that wrote it');
  assert.equal(stored.decisions, played.stats.decisions);
  assert.equal(stored.progress.decisions, played.stats.decisions);

  // Twelve hands during slow writes must not mean twelve queued requests: a
  // newer state replaces a pending one rather than joining a queue behind it.
  assert.equal(rows.length, 1, 'more than one player row was created');
});

test('a brand new player can sit down', async () => {
  /*
   * The first screen anyone sees, and for a while the only one they could not
   * get past. The handler behind "Sit down" called a function that had been
   * renamed out from under it, so it threw — after storing the name but before
   * changing screens. The button did nothing, and refreshing walked straight
   * in, because by then the name was already saved.
   *
   * Every other test here starts with a name already in storage, which is
   * exactly how this survived: the path a new player takes was the one path
   * nothing ran.
   */
  const app = loadHosted(undefined, []);
  await app.booted;

  const doc = (globalThis as any).__doc;
  const wrap = doc.getElementById('app').children[0];
  assert.ok(wrap, 'the welcome screen was never mounted');

  const input = wrap.querySelector('#welcome-name');
  const form = wrap.querySelector('#welcome-form');
  assert.ok((form.listeners.submit ?? []).length > 0, 'nothing is listening for the name');

  input.value = '  Yossi  ';
  form.fire('submit');

  assert.equal(app.screen(), 'home', 'the button did not take the player anywhere');
  assert.equal(app.storage().get('ev:playerName'), 'Yossi', 'the name was not kept, or not trimmed');
  assert.ok(app.storage().get('ev:progress'), 'nothing was saved for the new player');

  // And the app is genuinely usable from there, not merely on a different screen.
  const view = await app.api('/api/deal');
  assert.ok(['player', 'insurance', 'settled'].includes(view.phase));
});

test('an empty name does not let anyone in', async () => {
  const app = loadHosted(undefined, []);
  await app.booted;
  const wrap = (globalThis as any).__doc.getElementById('app').children[0];
  wrap.querySelector('#welcome-name').value = '   ';
  wrap.querySelector('#welcome-form').fire('submit');
  assert.notEqual(app.screen(), 'home');
});
