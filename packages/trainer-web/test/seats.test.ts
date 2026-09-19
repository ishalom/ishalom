/**
 * One header per seat, and the total lives in it (round 17).
 *
 * Idan, playing on his phone: after standing, his own total was nowhere. The
 * dealer's seat read "Dealer · 26 · bust" and his read "You". The big number
 * inside his box was there while he decided and gone the moment he wanted it —
 * *"what did I win with, especially if I hit?"*
 *
 * So both seats read the same way, in both phases, and the total has one home.
 * The hard constraint is the obvious one: **the total shown must be the total
 * the engine graded** — on soft hands, on split hands and on busts — because a
 * header that says twenty where the engine graded ten is worse than no header.
 *
 * §3.1 holds: the header states the total and what became of the hand, and says
 * nothing about whether the decision was any good.
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
const EN = catalogue('en');

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

function table(stored: Array<[string, string]> = []) {
  return loadHosted('#table', [
    ['ev:playerName', 'Dana'],
    ['ev:showAll', '1'],
    ['ev:introSeen', '1'],
    ['ev:level', 'intermediate'],
    ...stored,
  ]);
}

const heads = (page: HostedPage) => ({
  dealer: String(page.document.getElementById('dealer-total').textContent ?? ''),
  player: String(page.document.getElementById('player-total').textContent ?? ''),
  hands: withClass(page.document.getElementById('player-hands'), 'hand-head').map((n: any) => String(n.textContent)),
});

// --- The total is there, in both phases ---------------------------------------------------

test('the player’s own total is in his header while he decides and after he stands', async () => {
  const page = table();
  await page.booted;
  // 10-6 against a ten: a decision, then a showdown.
  page.session().table.shoe.stack(page.parseCards('Ts Td 6h 7c'));
  await press(page, 'deal');

  // Deciding: his total is there; the dealer's is not, because the hole card is
  // not turned yet (§3.1).
  assert.match(heads(page).player, /· 16/, 'the player has no total while deciding');
  assert.equal(heads(page).dealer, '', 'the dealer’s total is out before his card is');

  await press(page, 'stand');
  for (let i = 0; i < 40; i++) await settle();
  const after = heads(page);
  // Showdown: both seats, same shape, both totals.
  assert.match(after.player, /· 16/, 'the player’s total vanished at exactly the moment he wanted it');
  assert.match(after.dealer, /· \d+/, 'the dealer has no total at showdown');
  const outcome = [EN['hand.won'], EN['hand.lost'], EN['hand.push'], EN['ui.bust']];
  assert.ok(outcome.some((word) => after.player.includes(word!)), `the header does not say what happened: ${after.player}`);
  page.stopWatching();
});

test('the header shows the path when the hand drew, and just the total when it did not', async () => {
  const page = table();
  await page.booted;
  // 5-6 and then a 5: twelve becomes sixteen, which is the case Idan named.
  page.session().table.shoe.stack(page.parseCards('5s Td 6h 7c 5d'));
  await press(page, 'deal');
  assert.match(heads(page).player, /· 11$/, 'a two-card hand should be one number');
  await press(page, 'hit');
  for (let i = 0; i < 20; i++) await settle();
  assert.match(heads(page).player, /· 11 → 16/, 'the draw is not shown as a path');
  page.stopWatching();
});

test('a bust says so in the header, the way the dealer’s already did', async () => {
  const page = table();
  await page.booted;
  page.session().table.shoe.stack(page.parseCards('Ts Td 6h 7c Js'));
  await press(page, 'deal');
  await press(page, 'hit');
  for (let i = 0; i < 40; i++) await settle();
  const head = heads(page).player;
  assert.match(head, /· 16 → 26/);
  assert.ok(head.includes(EN['ui.bust']!), `a bust hand does not say so: ${head}`);
  page.stopWatching();
});

// --- The total is the engine's -----------------------------------------------------------

test('every header the page draws is the total the engine graded — soft, hard, drawn and bust', async () => {
  const page = table();
  await page.booted;
  let checked = 0;
  for (let hand = 0; hand < 25; hand++) {
    await press(page, 'deal');
    let view = page.session().view as any;
    if (view.phase === 'insurance') {
      await press(page, 'declineInsurance');
      view = page.session().view as any;
    }
    let guard = 0;
    while ((page.session().view as any).phase === 'player' && guard++ < 4) {
      const live = (page.session().view as any).hands.find((h: any) => h.active);
      const shown = heads(page);
      const header = shown.hands.length > 0 ? shown.hands[0]! : shown.player;
      // The last number in the header is the hand's total.
      const numbers = [...header.matchAll(/\d+/g)].map((m) => Number(m[0]));
      assert.equal(numbers[numbers.length - 1], live.total, `the header says ${header} for a hand of ${live.total}`);
      if (live.startTotal !== null) {
        assert.equal(numbers[numbers.length - 2], live.startTotal, `the path is wrong in ${header}`);
      }
      checked++;
      await press(page, guard === 1 && live.total < 12 ? 'hit' : 'stand');
      for (let i = 0; i < 10; i++) await settle();
    }
    for (let i = 0; i < 20; i++) await settle();
  }
  assert.ok(checked > 20, `only ${checked} headers were checked`);
  page.stopWatching();
});

// --- Splits ------------------------------------------------------------------------------

test('a split shows two headers with two totals, and the seat header steps back', async () => {
  const page = table();
  await page.booted;
  page.session().table.shoe.stack(page.parseCards('8s 6d 8h 7c'));
  await press(page, 'deal');
  await press(page, 'split');
  for (let i = 0; i < 40; i++) await settle();

  const shown = heads(page);
  assert.equal(shown.hands.length, 2, 'a split did not give each hand a header');
  for (const head of shown.hands) assert.match(head, /· \d+/, `${head} carries no total`);
  assert.equal(shown.player, '', 'the seat header is competing with the hands’ own');
  // Each header is that hand's own total.
  const totals = (page.session().view as any).hands.map((h: any) => h.total);
  shown.hands.forEach((head, index) => {
    assert.ok(head.includes(String(totals[index])), `${head} is not hand ${index + 1}’s total`);
  });
  page.stopWatching();
});

// --- What the change removed --------------------------------------------------------------

test('the giant number inside the box is gone, and the frame with it for a single hand', async () => {
  const page = table();
  await page.booted;
  page.session().table.shoe.stack(page.parseCards('Ts Td 6h 7c'));
  await press(page, 'deal');
  assert.equal(withClass(page.document.getElementById('player-hands'), 'hand-total').length, 0, 'the giant total is still drawn');
  page.stopWatching();

  const app = source('app.js');
  assert.doesNotMatch(app, /className = 'hand-total'/, 'app.js still builds it');
  const css = source('styles.css');
  assert.doesNotMatch(css, /^\.hand-total \{/m, 'the stylesheet still sizes it');
  // The frame around a hand is what says which of two is live, so it belongs to
  // a split and nowhere else.
  assert.match(css, /#player-hands\.split \.hand\.active \{ border-color/);
  assert.match(css, /^\.hand \{ padding: 0;/m, 'a single hand is still boxed');
});

test('§3.1: the header says what happened, never how well it was played', () => {
  const app = source('app.js');
  const header = app
    .slice(app.indexOf('function seatHeader('), app.indexOf('function renderHands('))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  // The words it can print are totals and outcomes. Nothing about the decision.
  assert.doesNotMatch(header, /correct|blunder|severity|evCost|optimal|grade/i, 'the header talks about the decision');
  // And the outcome only once the grade is out.
  assert.match(header, /revealComplete\(\)/);
  for (const locale of ['en', 'he'] as const) {
    for (const key of ['hand.won', 'hand.lost', 'hand.push', 'hand.nth']) {
      assert.ok(catalogue(locale)[key], `${locale} has no word for ${key}`);
    }
  }
});

// --- The height above the felt --------------------------------------------------------------

test('nothing above the felt is a setting a player changes once', () => {
  const html = source('table.html');
  // The language picker moved into the rule panel; the felt has no bar for it.
  assert.match(html, /<div class="lang-slot" id="lang-slot"><\/div>/);
  const panel = html.slice(html.indexOf('<dialog id="settings">'));
  assert.ok(panel.includes('id="lang-slot"'), 'the language control is not in the panel');
  assert.ok(panel.includes('id="rules-badge"'), 'the badge is not in the panel');
  // And the bar on the felt is one line: the name of the rule set.
  const bar = html.slice(html.indexOf('<header class="rules"'), html.indexOf('</header>'));
  assert.ok(bar.includes('id="rules-name"'), 'the felt does not name the rule set');
  assert.ok(!bar.includes('rules-badge'), 'the felt still prints the code string');
  assert.ok(!bar.includes('rules-sub'), 'the rules bar is still two lines');

  // Both language bars know to use the slot where a screen offers one.
  assert.match(readFileSync(join(HERE, '..', 'artifact', 'ui.js'), 'utf8'), /querySelector\('#lang-slot'\)/);
  assert.match(source('fontswitch.js'), /getElementById\('lang-slot'\)/);
});

test('the explanation scrolls, so a row of the block is never cut in half', () => {
  const css = source('styles.css');
  const help = css.slice(css.indexOf('.returns-help {'), css.indexOf('}', css.indexOf('.returns-help {')));
  assert.match(help, /max-height: \d+vh/, 'the explanation has no ceiling of its own');
  assert.match(help, /overflow-y: auto/);
  const card = css.slice(css.indexOf('.quickcard {'), css.indexOf('}', css.indexOf('.quickcard {')));
  const cap = /max-height: (\d+)dvh/.exec(card);
  assert.ok(cap && Number(cap[1]) <= 30, `the card is capped at ${cap?.[1]}dvh, which pushes the reasoning further down`);
  // The rows come before the explanation in the card, so a ceiling on the
  // explanation is what keeps them whole.
  const block = source('returns.js');
  assert.ok(
    block.indexOf('section.appendChild(grid)') < block.indexOf('section.appendChild(help)'),
    'the explanation is appended before the rows, so the rows are what gets cut',
  );
});
