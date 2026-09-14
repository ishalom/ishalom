/**
 * Figures on screen (round 8).
 *
 * Idan's strip read +1.4000000000000004 after a 6:5 blackjack, and the long
 * figure pushed its cell off the strip. Results add up in binary — 1.2 − 1 is
 * 0.19999999999999996 — so every units and chips figure a player reads now goes
 * through one rule: at most two decimals, trailing zeros dropped. The arithmetic
 * underneath is untouched; only how a figure is shown.
 *
 *   - the rule itself, on the remainders a real session produces;
 *   - the page's version and the sessions' version agree;
 *   - on the built page, the same hand reads the same on the strip, the track
 *     and the log, and the strip reads the same as the home Stats tab;
 *   - no page writes a figure without the rule;
 *   - the strip holds its cells whatever the figure.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCards } from '@evtrainer/ev-engine/uth';
import type { UthTable } from '@evtrainer/game-engine';

import { displayFigure } from '../src/figure.ts';
import { UthSession } from '../src/uth-session.ts';
import { loadHosted, type HostedPage } from './helpers/hosted-page.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');
const source = (file: string) => readFileSync(join(PUBLIC, file), 'utf8');

function pageFigure(rtl = false) {
  const win: any = {};
  const doc = { documentElement: { getAttribute: (name: string) => (name === 'dir' && rtl ? 'rtl' : null) } };
  new Function('window', 'document', source('figure.js'))(win, doc);
  return win.EVFigure as { round(v: number): number; plain(v: number, s?: boolean): string; units(v: number, s?: boolean): string };
}

// --- The rule ----------------------------------------------------------------------------------

test('a figure is short and exact: the binary remainder goes, halves and tenths stay', () => {
  const f = pageFigure();
  // The remainders a real session produces.
  assert.equal(1.2 + -1, 0.19999999999999996);
  assert.equal(f.units(1.2 + -1, true), '+0.2');
  assert.equal(f.units(1.2 + 1 + 1.2, true), '+3.4');
  assert.equal(f.units(1.2 + -0.5 + -1, true), '−0.3');
  assert.equal(f.units(1.4000000000000004, true), '+1.4', 'the figure Idan saw');
  // What a player really won stays as it is.
  assert.equal(f.units(1.2, true), '+1.2');
  assert.equal(f.units(-0.5, true), '−0.5');
  assert.equal(f.units(1.5, true), '+1.5');
  assert.equal(f.units(37.5, true), '+37.5');
  assert.equal(f.units(-65, true), '−65');
  assert.equal(f.units(0, true), '0');
  assert.equal(f.units(200.2), '200.2', 'a stack is not signed');
  assert.equal(f.units(-0.001, true), '0', 'nothing prints as minus zero');
  // One left-to-right piece in Hebrew.
  assert.equal(pageFigure(true).units(-0.30000000000000004, true), '⁦−0.3⁩');
});

test('the page and the sessions write every figure the same way', () => {
  const f = pageFigure();
  const values: number[] = [];
  const results = [1.2, -1, 1, -0.5, 1.5, 2, -2, 0, 3, -6, 10, 0.5];
  for (const a of results) for (const b of results) for (const c of results) values.push(a + b + c, (a + b) * 7, a * 25);
  for (let cents = -30000; cents <= 30000; cents += 7) values.push(cents / 100);
  for (const value of values) {
    assert.equal(f.plain(value, true), displayFigure(value, true), `signed ${value}`);
    assert.equal(f.plain(value), displayFigure(value), `unsigned ${value}`);
    const shown = f.plain(value, true);
    assert.doesNotMatch(shown, /\.\d{3,}/, `${value} shows ${shown}`);
  }
});

test('the Ultimate settlement lines use the same rule', () => {
  // A flush for you, the dealer king high and not qualifying: the Blind pays 3:2
  // on the Ante of 3. (A straight pays the Blind 1:1, which is a whole figure.)
  const session = new UthSession(1);
  session.placeBet('clear');
  session.placeBet('add', 1);
  session.placeBet('add', 1);
  session.placeBet('add', 1);
  (session as unknown as { table: UthTable }).table.stackNextHand(parseCards('9h 2h 4d 7c Kh 8h 3h Jd 5s'));
  session.deal();
  const view = session.act('raise4x') as any;
  const blind = view.settlement.lines.find((line: string) => line.startsWith('Blind pays'));
  assert.ok(blind, view.settlement.lines.join(' / '));
  assert.match(blind, /\+4\.5\b/, 'a 3:2 Blind on an Ante of 3 pays 4.5 chips');
  assert.doesNotMatch(view.settlement.lines.join(' '), /\.\d{3,}/);
});

// --- On the built page -------------------------------------------------------------------------------

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const PAST_HOLD = 520;

function dockButtons(page: HostedPage): any[] {
  return page.document.getElementById('actions').children.flatMap((row: any) => row.children ?? []);
}

async function press(page: HostedPage, action: string) {
  for (let i = 0; i < 200 && !dockButtons(page).some((b) => b.dataset?.action === action); i++) await settle(5);
  await settle(PAST_HOLD);
  const node = dockButtons(page).find((b) => b.dataset?.action === action);
  assert.ok(node, `no ${action}`);
  for (const handler of node.listeners.click ?? []) handler({ preventDefault() {} });
  for (let i = 0; i < 20; i++) await settle();
}

test('on the built page, a 6:5 blackjack and a loss read the same on the strip, the track, the log and Stats', async () => {
  const page = loadHosted('#table', [
    ['ev:playerName', 'Dana'],
    ['ev:preset', 'single-deck-6-5'],
    ['ev:showAll', '1'],
  ]);
  await page.booted;
  // You A-K against a nine and a seven: a 6:5 blackjack, +1.2.
  page.session().table.shoe.stack(page.parseCards('As 9d Kh 7c'));
  await press(page, 'deal');
  // You 10-7 against a nine and a ten: stand and lose, −1.
  page.session().table.shoe.stack(page.parseCards('Ts 9h 7h Tc'));
  await press(page, 'deal');
  await press(page, 'stand');

  const stats = page.session().stats;
  assert.equal(stats.netUnits, 0.19999999999999996, 'the session no longer produces the remainder this test is about');
  assert.equal(page.document.getElementById('stat-units').textContent, '+0.2', 'the strip');

  // The track: newest first, the loss then the blackjack.
  const track = page.document.getElementById('bj-track').children[1].children.map((row: any) => row.children[1].textContent);
  assert.deepEqual(track, ['−1', '+1.2']);

  page.go('#home');
  for (let i = 0; i < 40; i++) await settle();
  const logged = page.document.getElementById('hands').children
    .filter((n: any) => n.className === 'log-row')
    .map((row: any) => /class="log-net[^"]*">([^<]*)</.exec(String(row.innerHTML))?.[1]);
  assert.deepEqual(logged, track, 'the log reads differently from the track');
  const units = page.document.getElementById('stats').children
    .map((n: any) => String(n.innerHTML))
    .find((html: string) => html.includes('figure-value quiet'));
  assert.ok(units && units.includes('>+0.2<'), `the Stats tab reads differently from the strip: ${units}`);
  page.stopWatching();
});

// --- The whole surface --------------------------------------------------------------------------------------

test('no page writes a units or chips figure without the one rule', () => {
  for (const file of ['app.js', 'ultimate.js', 'home.js', 'track.js', 'chips.js']) {
    const code = source(file);
    assert.doesNotMatch(
      code,
      /\$\{\s*(?:s|stats|hand|view\.stack|stack|row)\.(?:netUnits|net|balance|lastNet)\s*\}/,
      `${file} interpolates a raw figure`,
    );
    assert.doesNotMatch(code, /Math\.abs\(\s*(?:s|stats|hand)\.(?:netUnits|net)\s*\)/, `${file} prints an unrounded figure`);
    assert.doesNotMatch(code, /toFixed\(2\)\)\}`/, `${file} keeps its own rounding rule`);
  }
  assert.doesNotMatch(readFileSync(join(HERE, '..', 'src', 'uth-session.ts'), 'utf8'), /toFixed\(1\)/, 'the settlement lines keep their own rule');
  for (const page of ['home.html', 'table.html', 'ultimate.html']) {
    const html = source(page);
    assert.ok(html.indexOf('src="/figure.js"') > 0 && html.indexOf('src="/figure.js"') < html.indexOf('src="/track.js"'), `${page} does not load the rule first`);
  }
});

test('the strip holds its four cells whatever the figure', () => {
  const css = source('styles.css');
  const from = css.indexOf('/* --- The stat strip holds its four cells');
  assert.ok(from > 0, 'the guard is gone');
  const rules = css.slice(from).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(rules, /\.stats \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/);
  const value = /\.stat-value \{([^}]*)\}/.exec(rules)![1]!;
  for (const rule of ['max-width: 100%', 'overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap', 'direction: ltr']) {
    assert.ok(value.includes(rule), `.stat-value is missing ${rule}`);
  }
});
