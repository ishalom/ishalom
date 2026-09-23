/**
 * The shared table's own screen, drawn — the test round 29 was missing.
 *
 * Seven rounds built the shared table, and 740 tests held its derivation, its
 * routes, its votes and its race. None of them asked the one question two
 * people on two phones asked first: does the screen draw anything? It did not.
 * The built page wraps `public/shared.js` in a function called `initShared`,
 * and the file's own `initShared` was declared inside that wrapper and called
 * by nobody — so the door, the seat picker, the link and the table never drew,
 * on any device, from round 22 on. Under it, a hidden felt and a hidden clock
 * were drawn anyway, because their classes set `display` and beat the
 * browser's own rule for `hidden`.
 *
 * So this opens the page GitHub serves, on the route Idan and נירו took —
 * home, the door, 2, make a table, a friend sits down — against a store that
 * answers the way PostgREST does, and at every step asks what is on screen.
 *
 * Why it would have failed on round 28's page, step by step:
 *   - the door: no seat-picker buttons at all (the screen never started);
 *   - after "make a table": the link hidden and a two-seat felt shown instead,
 *     because the screen counted `seat.playerId`, which a seat panel does not
 *     carry, so every empty chair read as taken;
 *   - the stylesheet: no rule making `hidden` win over a class's `display`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadHosted } from './helpers/hosted-page.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for the screen to reach a state, up to a few polls of the table, then let the assertion say why not. */
async function until(done: () => boolean, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline) await settle(50);
}

/** Enough PostgREST for a table: rows, `eq.` and `is.null` filters, PATCH returning what it changed. */
function fakeRest() {
  const tables: Record<string, unknown>[] = [];
  const seats: Record<string, unknown>[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const rows = url.pathname.endsWith('/tables')
      ? tables
      : url.pathname.endsWith('/table_seats')
        ? seats
        : null;
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk as Buffer));
    request.on('end', () => {
      // The players table is not what this test is about: accept and forget.
      if (rows === null) {
        response.writeHead(request.method === 'GET' ? 200 : 201, { 'content-type': 'application/json' });
        response.end('[]');
        return;
      }
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      const matches = (row: Record<string, unknown>) => {
        for (const [column, test] of url.searchParams) {
          if (column === 'select' || column === 'order') continue;
          if (test === 'is.null') {
            if (row[column] !== null && row[column] !== undefined) return false;
          } else if (test.startsWith('eq.')) {
            if (String(row[column]) !== decodeURIComponent(test.slice(3))) return false;
          }
        }
        return true;
      };
      if (request.method === 'POST') {
        const added = Array.isArray(body) ? body : [body];
        rows.push(...(added as Record<string, unknown>[]));
        response.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify(added));
        return;
      }
      if (request.method === 'PATCH') {
        const changed = rows.filter(matches);
        for (const row of changed) Object.assign(row, body);
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(changed));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(rows.filter(matches)));
    });
  });
  return { server, tables, seats };
}

/** Every node under `node`, the stub DOM's children walked by hand. */
function walk(node: any, out: any[] = []): any[] {
  for (const child of node?.children ?? []) {
    out.push(child);
    walk(child, out);
  }
  return out;
}

/**
 * Every control the screen drew into `ids` carries words a person can read.
 *
 * Not empty, and not a catalogue key that fell through — `shared.deal` on a
 * button is as empty to a player as nothing is.
 */
function assertControlsSpeak(doc: any, ids: string[], where: string) {
  for (const id of ids) {
    for (const node of walk(doc.getElementById(id))) {
      if (!String(node.className ?? '').includes('action') && node.type !== 'button') continue;
      const text = String(node.textContent ?? '').trim();
      assert.ok(text.length > 0, `${where}: a control in #${id} has no text`);
      assert.doesNotMatch(text, /^[a-z]+(\.[a-zA-Z]+)+$/, `${where}: #${id} shows a raw key "${text}"`);
    }
  }
}

test('the shared screen draws on the route two phones took: door, link, then a table with both seats', async () => {
  const { server, seats } = fakeRest();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  // The page polls; every timer it starts is stopped at the end, or the test never exits.
  const timers: any[] = [];
  const realInterval = globalThis.setInterval;
  (globalThis as any).setInterval = (fn: any, ms: number, ...rest: any[]) => {
    const handle = realInterval(fn, ms, ...rest);
    timers.push(handle);
    return handle;
  };

  let page: ReturnType<typeof loadHosted> | null = null;
  try {
    page = loadHosted(
      '#shared',
      [['ev:playerName', 'Idan'], ['ev:playerId', 'idan-row'], ['ev:locale', 'he']],
      { url: origin, key: 'k' },
    );
    await page.booted;
    await settle();
    const doc = page.document;
    const el = (id: string) => doc.getElementById(id);

    assert.equal(page.screen(), 'shared', 'the door did not open the shared screen');

    // 1. The door: how many of you, and a way to make the table.
    const picks = el('shared-seats-row').children;
    assert.deepEqual(
      picks.map((pick: any) => pick.textContent),
      ['2', '3', '4', '5', '6'],
      'the door drew no seat picker — the screen never started',
    );
    assert.equal(el('shared-door').hidden, false, 'the door is hidden with no table to show');
    assert.equal(el('shared-table').hidden, true, 'a felt is shown before there is a table');

    // 2. Make a table for two. Alone at it, the link is the screen.
    picks[0].listeners.click[0]();
    for (const make of el('shared-make').listeners.click) make();
    await until(() => seats.length === 2 && el('shared-invite').hidden === false);
    assert.equal(seats.length, 2, 'making the table did not write its two seats');
    assert.equal(el('shared-invite').hidden, false, 'alone at a new table, the link to send is not shown');
    assert.match(el('shared-link').textContent, /#shared=[a-z0-9]{10}$/, 'the link does not name the table');
    assert.equal(el('shared-table').hidden, true, 'alone at a new table, an empty felt is shown instead');
    assert.equal(el('shared-reactions').hidden, true, 'the six things to say are offered to an empty room');

    // 3. His friend sits down — from his own phone, through the store.
    const friend = seats.find((row) => row.seat === 1)!;
    Object.assign(friend, {
      player_id: 'niro-row',
      name: 'נירו',
      events: [{ kind: 'join', seat: 1, hand: 0 }],
    });
    await until(() => el('shared-table').hidden === false); // the next poll

    assert.equal(el('shared-invite').hidden, true, 'the link is still the screen after the friend sat down');
    assert.equal(el('shared-table').hidden, false, 'with two seated, the felt is not shown');
    const drawn = el('shared-seats').children;
    assert.equal(drawn.length, 2, `the felt draws ${drawn.length} seats, not the two who are sitting`);
    const names = drawn.map((seat: any) => seat.children[0].children[0].textContent);
    assert.ok(names.every((name: string) => name.trim().length > 0), 'a seat is drawn without a name');
    assert.ok(names.includes('נירו'), 'the friend is not at the table');

    /*
     * 4. Round 30, item 1: nothing to press between hands. The dock holds words
     * — the countdown to the first hand — and neither Deal nor Leave.
     */
    const pressable = () =>
      el('shared-actions').children.filter((node: any) => node.type === 'button').map((b: any) => b.id || b.dataset.action);
    assert.deepEqual(pressable(), [], `between hands the dock offers ${pressable()}`);
    const words = () => walk(el('shared-actions')).map((node: any) => String(node.textContent ?? '')).join(' ');
    assert.match(words(), /[0-9]/, 'the dock does not say when the first hand comes');
    assertControlsSpeak(doc, ['shared-actions', 'shared-reactions', 'shared-seats-row'], 'before the first hand');

    // The bars are on the felt, beside each name (item 4).
    const seatBars = walk(el('shared-seats')).filter((node: any) => String(node.className).includes('shared-seat-bar'));
    assert.equal(seatBars.length, 2, 'the bars are not on the felt beside the seats');
    assert.ok(seatBars.every((bar: any) => String(bar.textContent).trim().length > 0), 'a seat bar says nothing');

    // 5. The first hand deals itself.
    const offered = () =>
      el('shared-actions').children.map((button: any) => button.dataset.action).filter(Boolean);
    await until(() => Number(seats[0]!.hands) >= 1 && offered().length > 0, 8000);
    assert.equal(Number(seats[0]!.hands) >= 1, true, 'the first hand was never dealt');
    const cards = walk(el('shared-seats')).filter((node: any) => String(node.className).includes('card'));
    assert.ok(cards.length >= 4, `after the deal the felt shows ${cards.length} cards for two seats`);
    assertControlsSpeak(doc, ['shared-actions', 'shared-reactions', 'shared-clock'], 'in a hand');

    // 6. I decide, and the analysis appears under the felt: the verdict and the rows (item 5).
    if (offered().includes('stand')) {
      const stand = el('shared-actions').children.find((button: any) => button.dataset.action === 'stand');
      await settle(500); // the dock's settle-in hold
      stand.listeners.click[0]();
      const analysis = () =>
        walk(el('shared-measures')).find((node: any) => String(node.className).includes('shared-analysis'));
      await until(() => Boolean(analysis()));
      assert.ok(analysis(), 'after a decision there is no analysis under the felt');
      const verdict = walk(analysis()).find((node: any) => node.className === 'verdict');
      assert.ok(verdict && String(verdict.textContent).trim().length > 0, 'the analysis has no verdict');
      assert.deepEqual(
        pressable().filter((id: string) => id === 'shared-deal' || id === 'shared-leave'),
        [],
        'Deal or Leave came back after a decision',
      );
    }
  } finally {
    page?.stopWatching();
    for (const handle of timers) clearInterval(handle);
    (globalThis as any).setInterval = realInterval;
    server.closeAllConnections();
    server.close();
  }
});

test('a link to a table that is not there opens the door and says so, rather than a blank page', async () => {
  const { server } = fakeRest();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const timers: any[] = [];
  const realInterval = globalThis.setInterval;
  (globalThis as any).setInterval = (fn: any, ms: number, ...rest: any[]) => {
    const handle = realInterval(fn, ms, ...rest);
    timers.push(handle);
    return handle;
  };
  let page: ReturnType<typeof loadHosted> | null = null;
  try {
    page = loadHosted('#shared=nosuchtabl', [['ev:playerName', 'Niro'], ['ev:playerId', 'niro-row']], {
      url: origin,
      key: 'k',
    });
    await page.booted;
    const el = (id: string) => page!.document.getElementById(id);
    await until(() => el('shared-door').hidden === false);
    assert.equal(el('shared-door').hidden, false, 'a dead link draws nothing at all');
    assert.equal(el('shared-door-note').hidden, false, 'the door does not say why it is showing');
    assert.ok(el('shared-door-note').textContent.trim().length > 0, 'the door says nothing about the link');
    assert.equal(el('shared-seats-row').children.length, 5, 'the door offers no way to make a new table');
  } finally {
    page?.stopWatching();
    for (const handle of timers) clearInterval(handle);
    (globalThis as any).setInterval = realInterval;
    server.closeAllConnections();
    server.close();
  }
});

test('hidden means hidden: no class can draw an element the screen has hidden', () => {
  // The felt (`.table`, flex) and the clock (`.shared-clock`, flex) were both
  // marked hidden on round 28's page and both were drawn — the browser's own
  // `[hidden]` rule loses to any class that sets `display`.
  const rule = /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/;
  const styles = readFileSync(join(HERE, '..', 'public', 'styles.css'), 'utf8');
  assert.match(styles, rule, 'styles.css lets a class override `hidden`');
  const built = readFileSync(join(ROOT, 'docs', 'index.html'), 'utf8');
  assert.match(built, rule, 'the page GitHub serves lets a class override `hidden`');
});

test('the shared screen is started by its own file, not by a function nobody calls', () => {
  // The build wraps each screen script in a function of the screen's name.
  // A function of that same name inside the file is a dead declaration.
  const source = readFileSync(join(HERE, '..', 'public', 'shared.js'), 'utf8');
  assert.doesNotMatch(source, /\nfunction initShared\(/, 'shared.js declares an initShared the wrapper shadows');
  assert.match(source, /\nwindow\.EV\.ready\.then\(openShared\);\s*$/, 'shared.js does not start its own screen');
});

test('a poll that lands after the player has left draws nothing (round 31)', () => {
  /*
   * Found on the live site, not here: this DOM invents any element it is asked
   * for, so it cannot show one missing. A request in flight when the phone went
   * home finished afterwards, called render(), and threw on the door that was
   * no longer there. The guard is the first thing render does.
   */
  const source = readFileSync(join(HERE, '..', 'public', 'shared.js'), 'utf8');
  const body = source.slice(source.indexOf('function render() {'));
  const firstStatement = body.split('\n').slice(1).find((line) => /^\s+[^\s/*]/.test(line)) ?? '';
  assert.match(firstStatement, /if \(!el\('shared-door'\)\) return;/, 'render draws before checking the screen is still there');
});
