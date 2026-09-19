/**
 * The felt's dead space (round 16).
 *
 * Idan, with a screenshot: the vertical gap between the dealer's row and the
 * player's is the tallest thing on the table and shows nothing. Cowork's note
 * on top of it: that same space is what pushes the reasoning below the fold,
 * which is why round 14 had to invent an arrow to point at it.
 *
 * What was actually spending the height turned out to be the betting rail — a
 * stacked column of chip art, 188px of it, saying two numbers that cannot
 * change while a hand is in play. So the rail is a betting rail between hands
 * and a readout during one, and the paddings around the rows come in.
 *
 * The floor is the cards themselves, at the size Idan asked for, and this file
 * holds the change to that: tighten the space, never the cards.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadHosted, type HostedPage } from './helpers/hosted-page.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (file: string) => readFileSync(join(HERE, '..', 'public', file), 'utf8');

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

const classes = (node: any) => String(node?.className ?? '').split(' ').filter(Boolean);

test('the rail is a betting rail between hands and a readout during one', async () => {
  const page = loadHosted('#table', [
    ['ev:playerName', 'Dana'],
    ['ev:showAll', '1'],
    ['ev:introSeen', '1'],
    ['ev:level', 'intermediate'],
  ]);
  await page.booted;
  const rail = page.document.getElementById('rail');

  // Before a hand: the chips are placed here, so it keeps its room.
  for (let i = 0; i < 40; i++) await settle();
  assert.ok(!classes(rail).includes('playing'), 'the rail was compact while the bet was being built');

  page.session().table.shoe.stack(page.parseCards('Ts Td 6h 7c'));
  await press(page, 'deal');
  // While the cards are out, the bet cannot change and the rail says so.
  assert.ok(classes(rail).includes('playing'), 'the rail kept its betting layout during a hand');

  await press(page, 'stand');
  for (let i = 0; i < 40; i++) await settle();
  assert.ok(!classes(rail).includes('playing'), 'the rail stayed compact once the hand was over');
  page.stopWatching();
});

test('a hand that grows, and a hand that splits, say so to the stylesheet', async () => {
  const page = loadHosted('#table', [
    ['ev:playerName', 'Dana'],
    ['ev:showAll', '1'],
    ['ev:introSeen', '1'],
  ]);
  await page.booted;
  // 2-2 against a six: split, and then each hand can be drawn out.
  page.session().table.shoe.stack(page.parseCards('2s 6d 2h 7c'));
  await press(page, 'deal');
  await press(page, 'split');
  for (let i = 0; i < 40; i++) await settle();
  assert.ok(classes(page.document.getElementById('player-hands')).includes('split'), 'two hands did not say so');

  // And a hand of five cards is a long one, which is what steps the cards down
  // on a narrow phone.
  const hands = page.document.getElementById('player-hands');
  for (let i = 0; i < 6; i++) {
    const view = page.session().view as any;
    if (view.phase !== 'player') break;
    const playing = view.hands.find((hand: any) => hand.active);
    if (playing && playing.cards.length >= 5) break;
    await press(page, 'hit');
  }
  const long = walk(hands).filter((node) => classes(node).includes('long'));
  const grown = (page.session().view as any).hands.some((hand: any) => hand.cards.length >= 5);
  assert.equal(long.length > 0, grown, 'a long hand is not marked, or a short one is');
  page.stopWatching();
});

test('what the rail drops during a hand, and what it never drops', () => {
  const css = source('styles.css');
  const rule = css.slice(css.indexOf('.rail.playing {'), css.indexOf('.rail.playing .rail-label'));
  assert.match(rule, /grid-template-columns: repeat\(2/, 'the rail is still a column during a hand');
  // The chip art and the table limits are what it drops; the figures stay.
  assert.match(css, /\.rail\.playing \.chips \{ display: none; \}/);
  assert.match(css, /\.rail\.playing \.table-limits \{ display: none; \}/);
  assert.doesNotMatch(css, /\.rail\.playing \.rail-value \{ display: none/, 'the rail stopped showing the bet');
});

test('the cards keep the size Idan asked for; only the space around them moved', () => {
  const css = source('styles.css');
  // Round 8's phone size, untouched.
  assert.match(css, /@media \(max-width: 560px\) \{\s*\.card \{ width: 60px; height: 86px; \}/);
  // What round 16 tightened is padding, and it is padding on the felt only.
  const tightened = css.slice(css.indexOf('/* --- The felt, tightened (round 16)'));
  assert.match(tightened, /\.felt \.cards \{ padding-bottom: 4px; \}/);
  assert.match(tightened, /\.felt \.seat \{ padding: 2px 8px; \}/);
  // The only card sizes round 16 writes are the step-down for a hand that grew
  // or split, on the narrowest phone — the case that was ending under the dock.
  for (const rule of tightened.matchAll(/([^{}]*)\{[^}]*width: \d+px[^}]*\}/g)) {
    const selector = rule[1]!.trim().split(String.fromCharCode(10)).pop()!.trim();
    if (!selector.includes('.card')) continue;
    assert.match(selector, /\.long|\.split/, `${selector} changes the size of every card`);
  }
});
