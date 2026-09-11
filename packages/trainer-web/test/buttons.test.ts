/**
 * Where the buttons sit, and which keys press them (round 4b).
 *
 * Two changes, both about the hand on the keyboard and the mouse rather than the
 * game. The rows put the "yes" action on the physical left and the "no" action
 * on the physical right, in Hebrew as in English. And Blackjack's shortcuts now
 * match the key pressed rather than the character it types, because on a Hebrew
 * layout H and S type Hebrew letters and none of the shortcuts worked.
 *
 * Neither may change what is legal. The row functions only arrange what they are
 * given; the tests check they never add, drop or duplicate an action.
 *
 * The on-screen positions are measured in a real browser for the report; these
 * tests hold the logic and the stylesheet that produce them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadHosted } from './helpers/hosted-page.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');

function lift<T>(file: string, name: string): T {
  const source = readFileSync(join(PUBLIC, file), 'utf8');
  const from = source.indexOf(`function ${name}`);
  assert.ok(from > 0, `${name} is gone from ${file}`);
  const end = source.indexOf('\n}\n', from);
  return new Function(`${source.slice(from, end + 3)}\nreturn ${name};`)() as T;
}

const blackjackRows = lift<(legal: string[]) => string[][]>('app.js', 'blackjackRows');
const uthRows = lift<(legal: string[]) => string[][]>('ultimate.js', 'uthRows');

const same = (rows: string[][], legal: string[]) =>
  assert.deepEqual([...rows.flat()].sort(), [...legal].sort(), 'the rows changed what is legal');

// --- Blackjack ---------------------------------------------------------------

test('opening a hand: Hit | Stand, then Double | Surrender', () => {
  const legal = ['stand', 'hit', 'double', 'surrender'];
  const rows = blackjackRows(legal);
  assert.deepEqual(rows, [['hit', 'stand'], ['double', 'surrender']]);
  same(rows, legal);
});

test('only one of Double and Surrender: it takes the whole row', () => {
  assert.deepEqual(blackjackRows(['stand', 'hit', 'double']), [['hit', 'stand'], ['double']]);
  assert.deepEqual(blackjackRows(['stand', 'hit', 'surrender']), [['hit', 'stand'], ['surrender']]);
});

test('a pair adds Split as a full-width row', () => {
  const legal = ['stand', 'hit', 'double', 'split', 'surrender'];
  const rows = blackjackRows(legal);
  assert.deepEqual(rows, [['hit', 'stand'], ['double', 'surrender'], ['split']]);
  same(rows, legal);
});

test('later in the hand: one row, Hit | Stand', () => {
  assert.deepEqual(blackjackRows(['stand', 'hit']), [['hit', 'stand']]);
});

test('the engine’s order never decides the layout', () => {
  // Whatever order the legal actions arrive in, Hit is left of Stand.
  for (const legal of [['hit', 'stand'], ['stand', 'hit'], ['surrender', 'double', 'stand', 'hit']]) {
    assert.deepEqual(blackjackRows(legal)[0], ['hit', 'stand']);
  }
});

// --- UTH ------------------------------------------------------------------------

test('UTH before the flop: Raise 4× | Check, then Raise 3× across the row', () => {
  const legal = ['raise4x', 'raise3x', 'check'];
  assert.deepEqual(uthRows(legal), [['raise4x', 'check'], ['raise3x']]);
  same(uthRows(legal), legal);
});

test('UTH on the flop: Raise 2× | Check; on the river: Raise 1× | Fold', () => {
  assert.deepEqual(uthRows(['raise2x', 'check']), [['raise2x', 'check']]);
  assert.deepEqual(uthRows(['fold', 'raise1x']), [['raise1x', 'fold']]);
});

// --- The stylesheet: a row does not mirror ----------------------------------------

test('a row is laid out left to right in both languages; the labels keep their direction', () => {
  const css = readFileSync(join(PUBLIC, 'styles.css'), 'utf8');
  const row = /\.action-row \{([^}]*)\}/.exec(css);
  assert.ok(row, 'there is no .action-row rule');
  assert.match(row[1]!, /direction:\s*ltr/, 'an RTL page would mirror the row');
  assert.match(row[1]!, /repeat\(var\(--cols/, 'a lone button would not fill its row');
  assert.match(css, /\[dir="rtl"\] \.action-row > \.action \{ direction: rtl; \}/, 'Hebrew labels would read left to right');
});

test('no decision button is primary in either game', () => {
  const app = readFileSync(join(PUBLIC, 'app.js'), 'utf8');
  const render = app.slice(app.indexOf('function renderActions'), app.indexOf('\n}\n', app.indexOf('function renderActions')));
  assert.doesNotMatch(render, /'declineInsurance'\),\s*true/, 'Decline insurance is still primary');
  // Only the deal button passes true.
  const primaries = [...render.matchAll(/,\s*true,\s*'(\w+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(primaries, ['deal']);

  const uth = readFileSync(join(PUBLIC, 'ultimate.js'), 'utf8');
  const uthRender = uth.slice(uth.indexOf('function uthRenderActions'), uth.indexOf('\n}\n', uth.indexOf('function uthRenderActions')));
  assert.deepEqual([...uthRender.matchAll(/,\s*true,\s*'(\w+)'\)/g)].map((m) => m[1]), ['deal']);
});

// --- Blackjack keys on a Hebrew layout --------------------------------------------

test('Blackjack shortcuts match the key, not the character', () => {
  const app = readFileSync(join(PUBLIC, 'app.js'), 'utf8');
  const from = app.indexOf("document.addEventListener('keydown'");
  // Code only: the comment explaining the change names `event.key` itself.
  const handler = app
    .slice(from, app.indexOf('\n});\n', from))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(handler, /event\.key\b/, 'the handler still reads the character typed');
  // Named either as a string or as a key of the action map ({ KeyH: 'hit' }).
  for (const code of ['KeyH', 'KeyS', 'KeyD', 'KeyP', 'KeyR', 'KeyY', 'KeyN', 'Space']) {
    assert.ok(
      handler.includes(`'${code}'`) || new RegExp(`\\b${code}:`).test(handler),
      `${code} is not handled`,
    );
  }
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A Hebrew-layout table, ready to take a key.
 *
 * `booted` resolves when the screen mounts, but the table then fetches its first
 * view on a later turn of the event loop, and until it has one the key handler
 * has nothing to act on and returns. So this waits for that too.
 */
async function hebrewTable() {
  const page = loadHosted('#table', [
    ['ev:playerName', 'Idan'],
    ['ev:locale', 'he'],
    ['ev:showAll', '1'],
  ]);
  await page.booted;
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(page.screen(), 'table');
  return page;
}

async function press(page: ReturnType<typeof loadHosted>, code: string, key: string) {
  page.press(code, key);
  for (let i = 0; i < 3; i++) await tick();
}

test('on a Hebrew layout, S stands — the page, pressed the way a browser reports it', async () => {
  const page = await hebrewTable();
  const session = page.session();
  // Nine-seven against a six: a plain hand with a decision to make.
  session.table.shoe.stack(page.parseCards('9s 6d 7h Kc'));

  await press(page, 'Space', ' ');          // deal
  assert.equal(session.view.phase, 'player', 'Space did not deal');

  await press(page, 'KeyS', 'ד');           // S on a Hebrew layout types ד
  assert.equal(session.view.phase, 'settled', 'S on a Hebrew layout did not stand');
  assert.equal(session.progress.decisions, 1);
  page.stopWatching();
});

test('on a Hebrew layout, H hits', async () => {
  const page = await hebrewTable();
  const session = page.session();
  // Five-six against a four, then a two to draw.
  session.table.shoe.stack(page.parseCards('5s 4d 6h 9c 2c'));
  await press(page, 'Space', ' ');
  assert.equal(session.view.phase, 'player', 'Space did not deal');
  await press(page, 'KeyH', 'י');           // H on a Hebrew layout types י
  assert.equal(session.view.hands[0].cards.length, 3, 'H on a Hebrew layout did not hit');
  page.stopWatching();
});

test('on a Hebrew layout, N declines insurance', async () => {
  const page = await hebrewTable();
  const session = page.session();
  // An ace up and a four underneath: insurance offered, no dealer natural.
  session.table.shoe.stack(page.parseCards('9s Ad 7h 4c'));
  await press(page, 'Space', ' ');
  assert.equal(session.view.phase, 'insurance', 'the ace did not offer insurance');
  await press(page, 'KeyN', 'מ');           // N on a Hebrew layout types מ
  assert.notEqual(session.view.phase, 'insurance', 'N on a Hebrew layout did not decline insurance');
  assert.equal(session.progress.decisions, 1, 'declining was not recorded as the decision');
  page.stopWatching();
});
