/**
 * What happens to a browser whose player was merged into another.
 *
 * Merging is marking: the losing row stays in the table with `merged_into`
 * pointing at the survivor. That is the right way to merge — nothing is
 * destroyed — but it leaves a live browser somewhere holding the losing id, and
 * the app has to do something sensible when that browser opens.
 *
 * Two things it must never do: read its progress back out of a row that has
 * been retired, and write to that row, which would quietly resurrect a record
 * the merge put to sleep. And the leaderboard must not list a merged row at
 * all, or one person appears twice under one name.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A table with a merged row in it, shaped like the real one. */
let rows: any[] = [];
let server: Server;
let port = 0;
const seen: Array<{ method: string; path: string; body: any }> = [];

function reset() {
  rows = [
    {
      id: 'survivor',
      name: 'Idan',
      name_key: 'idan',
      pin_hash: 'hash',
      merged_into: null,
      rating: 1900,
      peak: 1900,
      provisional: false,
      mode: 'basic',
      hands: 137,
      decisions: 40,
      lifetime_decisions: 246,
      accuracy: 0.94,
      ev_lost_per_100: 0.8,
      progress: { version: 2, decisions: 40, lifetimeDecisions: 246 },
      feed: [],
      updated_at: '2026-09-11T00:00:00Z',
    },
    {
      id: 'retired',
      name: 'Idan',
      name_key: 'idan',
      pin_hash: null,
      merged_into: 'survivor',
      rating: 1493,
      peak: 1493,
      provisional: false,
      mode: 'basic',
      hands: 12,
      decisions: 15,
      lifetime_decisions: 15,
      accuracy: 0.7,
      ev_lost_per_100: 4,
      progress: { version: 2, decisions: 15, lifetimeDecisions: 15 },
      feed: [],
      updated_at: '2026-09-10T16:28:00Z',
    },
  ];
  seen.length = 0;
}

before(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (c) => chunks.push(c));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ method: request.method ?? '', path: request.url ?? '', body });

      if (request.method === 'POST') {
        rows = [...rows.filter((r) => r.id !== body.id), { ...body }];
        response.writeHead(201).end();
        return;
      }

      // Enough PostgREST for the queries the page actually makes.
      const url = new URL(request.url ?? '/', 'http://x');
      let matched = rows;
      const id = url.searchParams.get('id');
      if (id) matched = matched.filter((r) => `eq.${r.id}` === id);
      const merged = url.searchParams.get('merged_into');
      if (merged === 'is.null') matched = matched.filter((r) => r.merged_into === null);
      const key = url.searchParams.get('name_key');
      if (key) matched = matched.filter((r) => `eq.${r.name_key}` === key);

      const columns = (url.searchParams.get('select') ?? '').split(',').filter(Boolean);
      const projected = matched.map((row) =>
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
  server.closeAllConnections();
  server.close();
});

/** The backend adapter, as the page runs it. */
function loadBackends(): Record<string, any> {
  const source = readFileSync(join(HERE, '..', 'artifact', 'backends.js'), 'utf8');
  const out: Record<string, any> = {};
  (globalThis as any).window = globalThis;
  new Function('__out', `${source}\n__out.openBackend = openBackend;`)(out);
  return out;
}

const config = () => ({ url: `http://127.0.0.1:${port}`, key: 'k' });

test('the leaderboard never lists a row that has been merged away', async () => {
  /*
   * The merge marked the losing row and left it in place, which is right. But
   * the leaderboard read every row, so one person appeared twice under one
   * name — once at their real rating and once at a rating they had abandoned.
   */
  reset();
  const backend = await loadBackends().openBackend(config());

  const delivered: any[][] = [];
  const stop = backend.watch((r: any[]) => delivered.push(r));
  await new Promise((r) => setTimeout(r, 250));
  stop();

  assert.ok(delivered.length > 0, 'the watch never delivered');
  const listed = delivered[delivered.length - 1]!;
  const names = listed.map((r) => r.name);
  assert.deepEqual(
    names.filter((n) => n === 'Idan').length,
    1,
    `Idan appears ${names.filter((n) => n === 'Idan').length} times: ${JSON.stringify(names)}`,
  );
  assert.equal(listed[0].id, 'survivor', 'the wrong row survived to the leaderboard');
});

test('loading a merged id reports the row it was merged into', async () => {
  // The caller cannot do the right thing unless the backend tells it that the
  // id it asked for has been retired.
  reset();
  const backend = await loadBackends().openBackend(config());

  const retired = await backend.load('retired');
  assert.ok(retired, 'nothing came back for the merged id');
  assert.equal(retired.mergedInto, 'survivor', 'load did not report the merge');

  const alive = await backend.load('survivor');
  assert.equal(alive.mergedInto, null, 'a live row reported itself as merged');
  assert.equal(alive.progress.lifetimeDecisions, 246);
});

test('a browser holding a merged id ends up on the surviving record', async () => {
  /*
   * The whole point. Such a browser must not read the retired row's session
   * back, and must not write to it — that would resurrect a record the merge
   * put to sleep, and put the abandoned rating back on the leaderboard.
   */
  reset();
  const app = loadPage({ 'ev:playerId': 'retired', 'ev:playerName': 'Idan' });
  await app.booted;

  assert.equal(app.me().id, 'survivor', 'the browser is still holding the retired id');

  // It restored the survivor's record, not the retired one.
  assert.equal((app.session().progress as any).lifetimeDecisions, 246);

  // And nothing was written to the retired row.
  const wroteToRetired = seen.some((r) => r.method === 'POST' && r.body?.id === 'retired');
  assert.equal(wroteToRetired, false, 'the page wrote to a merged row');
  assert.equal(rows.find((r) => r.id === 'retired')!.merged_into, 'survivor', 'the merge was undone');
  app.stopWatching();
});

test('the two saved copies are compared on a counter that never resets', async () => {
  /*
   * A rule change zeroes `decisions` while keeping the rating, so comparing on
   * it can pick a copy with more *session* decisions but an older rating.
   * `lifetimeDecisions` only ever rises, which is why the comparison uses it.
   */
  reset();
  const stale = { version: 2, decisions: 99, lifetimeDecisions: 5, rating: 1200 };
  const app = loadPage({
    'ev:playerId': 'survivor',
    'ev:playerName': 'Idan',
    'ev:progress': JSON.stringify(stale),
  });
  await app.booted;

  // The local copy has more *session* decisions (99 > 40) but far fewer
  // lifetime ones (5 < 246). The remote record is the one further along.
  assert.equal(
    (app.session().progress as any).lifetimeDecisions,
    246,
    'the stale local copy won on a counter that resets',
  );
  app.stopWatching();
});

/** Load the built page against a stubbed browser, with given storage. */
function loadPage(stored: Record<string, string>): Record<string, any> {
  const html = readFileSync(join(HERE, '..', '..', '..', 'docs', 'index.html'), 'utf8');
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]!)
    .join('\n')
    .replace(/^[ \t]*const BACKEND_CONFIG = .*$/m, '');

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
      addEventListener(t: string, fn: Function) { (node.listeners[t] ??= []).push(fn); },
      fire(t: string, e: any = { preventDefault() {} }) { for (const fn of node.listeners[t] ?? []) fn(e); },
      focus() {}, remove() {}, showModal() {}, close() {},
      querySelector(s: string) { if (!queries.has(s)) queries.set(s, el()); return queries.get(s); },
      querySelectorAll: () => [],
      get parentElement() { return el(); },
      style_: null,
    };
    node.style.setProperty = () => {};
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

  const disk = new Map<string, string>(Object.entries(stored));
  const g = globalThis as any;
  g.document = doc;
  g.localStorage = {
    getItem: (k: string) => disk.get(k) ?? null,
    setItem: (k: string, v: string) => disk.set(k, String(v)),
  };
  g.window = globalThis;
  g.location = { reload() {} };
  g.alert = () => {};

  const out: Record<string, any> = {};
  new Function(
    '__out',
    '__config',
    `const BACKEND_CONFIG = __config;\n${code}\n` +
      '__out.booted = booted; __out.me = () => me; __out.session = () => session;' +
      '__out.storage = () => __disk; __out.stopWatching = () => stopWatching && stopWatching();',
  )(out, { url: `http://127.0.0.1:${port}`, key: 'k' });
  (globalThis as any).__disk = disk;
  return out;
}
