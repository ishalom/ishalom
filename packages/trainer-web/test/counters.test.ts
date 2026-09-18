/**
 * Which explanations get opened (round 15).
 *
 * Idan asked to see what people press and what nobody ever touches. Cowork's
 * shape for it, and the one built here, is **counters, not logs**: a dozen
 * cumulative numbers per player, riding in the record the day count already
 * rides in.
 *
 * What this file holds the feature to is mostly what it must *not* be able to
 * do. There is no order in it and no clock, so it can say that nobody opens the
 * strategy chart and it cannot say what anybody did on Tuesday evening. And
 * because the shared table is open to anyone with the app's address, the page
 * that shows these says so.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalogue } from '../src/i18n.ts';
import { loadHosted, type HostedPage } from './helpers/hosted-page.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (file: string) => readFileSync(join(HERE, '..', 'public', file), 'utf8');
const artifact = (file: string) => readFileSync(join(HERE, '..', 'artifact', file), 'utf8');

/** The counter rule, run the way the browser runs it. */
function counters(stored?: Record<string, number>) {
  const store = new Map<string, string>(stored ? [['ev:counts', JSON.stringify(stored)]] : []);
  const win: any = {};
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
  new Function('window', 'localStorage', source('count.js'))(win, storage);
  return { count: win.EVCount, store };
}

// --- What it keeps, and what it cannot ------------------------------------------------

test('a press of a known control is counted; anything else is ignored', () => {
  const { count, store } = counters();
  count.bump('help');
  count.bump('help');
  count.bump('primer');
  count.bump('not-a-control');
  count.bump(undefined);
  assert.deepEqual(count.all(), { help: 2, primer: 1 });
  assert.deepEqual(JSON.parse(store.get('ev:counts')!), { help: 2, primer: 1 });
});

test('what is kept is a number per control — no order, no clock, nothing else', () => {
  const { count, store } = counters();
  for (const id of count.IDS) count.bump(id);
  const kept = JSON.parse(store.get('ev:counts')!);
  assert.deepEqual(Object.keys(kept).sort(), [...count.IDS].sort());
  for (const [id, value] of Object.entries(kept)) {
    assert.equal(typeof value, 'number', `${id} is kept as something other than a count`);
  }
  // Not a trail: the file has no clock in it at all, so no reading of it can
  // say when anything happened or in what order.
  const code = source('count.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /Date|now\(|performance|timestamp/i, 'the counters keep more than counts');
  assert.ok(count.IDS.length >= 10 && count.IDS.length <= 14, `${count.IDS.length} counters is not "about ten"`);
});

test('two devices are merged by the larger of each pair, never the sum', () => {
  const { count } = counters({ help: 5, chart: 1 });
  assert.deepEqual(count.all(), { help: 5, chart: 1 });
  // The same device's record is written and read back constantly; adding would
  // inflate every count by however often it synced.
  count.restore({ help: 3, primer: 7 });
  assert.deepEqual(count.all(), { help: 5, chart: 1, primer: 7 });
  // Junk in a record — a later build's key, a negative, a string — is dropped.
  count.restore({ help: 'many', nonsense: 4, chart: -3 } as never);
  assert.deepEqual(count.all(), { help: 5, chart: 1, primer: 7 });
  assert.deepEqual(count.merge({ a: 1 } as never, { help: 2 }), { help: 2 });
});

// --- Where they ride ------------------------------------------------------------------

test('they ride in the saved record beside the day count, and need no migration', () => {
  const shell = artifact('shell.js');
  const full = shell.slice(shell.indexOf('function fullProgress()'), shell.indexOf('function readLocalProgress()'));
  assert.match(full, /counters/, 'the record does not carry them');
  // Merged on the way in, from this device's own store and from the table.
  assert.match(shell, /EVCount\.restore\(local\.counters\)/);
  assert.match(shell, /EVCount\.restore\(remote\.progress\.counters\)/);
  // Read out of the record that already exists: no column, no migration.
  const backends = artifact('backends.js');
  assert.match(backends, /counters:progress->counters/, 'the usage query does not ask for them');
  assert.doesNotMatch(backends, /alter table|add column/i);
});

test('the page that shows them says who else can read them', () => {
  const usage = artifact('usage.js');
  assert.match(usage, /usage\.opened/);
  assert.match(usage, /usage\.public/);
  for (const locale of ['en', 'he'] as const) {
    const note = catalogue(locale)['usage.public']!;
    assert.ok(note.length > 40, `${locale} says too little about who can read this`);
    assert.match(catalogue(locale)['usage.openedNote']!, locale === 'en' ? /no order|no times/i : /בלי סדר/);
  }
  // Every counted control is named on the page, in both languages.
  const ids = /const USAGE_COUNTED = \[([^\]]*)\]/.exec(usage)![1]!.match(/'([\w]+)'/g)!.map((s) => s.slice(1, -1));
  assert.ok(ids.length >= 10);
  for (const id of ids) {
    for (const locale of ['en', 'he'] as const) {
      assert.ok(catalogue(locale)[`usage.open.${id}`], `${locale} has no name for ${id}`);
    }
  }
});

// --- On the built page -----------------------------------------------------------------

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function dockButtons(page: HostedPage): any[] {
  return page.document.getElementById('actions').children.flatMap((row: any) => row.children ?? []);
}

async function press(page: HostedPage, action: string) {
  for (let i = 0; i < 200 && !dockButtons(page).some((b) => b.dataset?.action === action); i++) await settle(5);
  await settle(520);
  const node = dockButtons(page).find((b) => b.dataset?.action === action);
  assert.ok(node, `no ${action}`);
  for (const handler of node.listeners.click ?? []) handler({ preventDefault() {} });
  for (let i = 0; i < 20; i++) await settle();
}

function walk(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  return [node, ...(node.children ?? []).flatMap((child: any) => walk(child))];
}

const withClass = (node: any, name: string) =>
  walk(node).filter((n) => String(n.className ?? '').split(' ').includes(name));

const stored = (page: HostedPage) => JSON.parse(page.storage().get('ev:counts') ?? '{}');

test('on the built page, opening and closing the explanation is what gets counted', async () => {
  const page = loadHosted('#table', [
    ['ev:playerName', 'Dana'],
    ['ev:showAll', '1'],
    ['ev:introSeen', '1'],
    ['ev:level', 'new'],
  ]);
  await page.booted;
  page.session().table.shoe.stack(page.parseCards('Ts Td 6h 7c'));
  await press(page, 'deal');
  await press(page, 'stand');
  assert.deepEqual(stored(page), {}, 'something was counted that nobody pressed');

  const why = withClass(page.document.getElementById('quickcard'), 'returns-why')[0];
  const click = () => {
    for (const handler of why.listeners.click ?? []) handler({ preventDefault() {} });
  };
  click(); // it opens by default, so the first press closes it
  assert.deepEqual(stored(page), { helpShut: 1 });
  click();
  assert.deepEqual(stored(page), { helpShut: 1, help: 1 });

  // How the game works, from the felt, where a beginner is.
  for (const handler of page.document.getElementById('primer-open').listeners.click ?? []) handler({ preventDefault() {} });
  assert.equal(stored(page).primer, 1);
  // The level itself, changed.
  const options = page.document.getElementById('level-settings').children;
  for (const handler of options[2].listeners.click ?? []) handler({ preventDefault() {} });
  assert.equal(stored(page).level, 1);
  page.stopWatching();
});

test('and they go out with the record, as counts and nothing more', async () => {
  const page = loadHosted('#table', [
    ['ev:playerName', 'Dana'],
    ['ev:introSeen', '1'],
    ['ev:counts', JSON.stringify({ help: 3, chart: 2 })],
  ]);
  await page.booted;
  // A finished hand is what writes the record.
  page.session().table.shoe.stack(page.parseCards('Ts Td 6h 7c'));
  await press(page, 'deal');
  await press(page, 'stand');
  for (let i = 0; i < 60; i++) await settle();
  const saved = JSON.parse(page.storage().get('ev:progress') ?? '{}');
  assert.deepEqual(saved.counters, { help: 3, chart: 2 }, 'the record does not carry what this device counted');
  // Nothing about the player beyond which control was opened how many times.
  for (const value of Object.values(saved.counters as Record<string, unknown>)) {
    assert.equal(typeof value, 'number');
  }
  page.stopWatching();
});
