/**
 * English left inside Hebrew — the places the round 11 sweep found (round 11).
 *
 * The sweep walked every screen and every dialog of the built page in Hebrew,
 * in real Chrome, and read everything a player can see or hear. What it found
 * was fixed the way round 9 fixed the hand log — ids from the sessions, words
 * from the catalogue — and each place is held here, so the next one fails a
 * test rather than waiting to be noticed:
 *
 *   - the rules bar: the rule set's name, its badge and its note;
 *   - the settings dialog's list of rule sets;
 *   - a card as a screen reader hears it, the face-down card, and the Space key.
 *
 * The rule codes — 6D, S17, H17, DAS — are codes in both languages, as the felt
 * prints them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULE_PRESETS } from '@evtrainer/ev-engine';

import { catalogue } from '../src/i18n.ts';
import { TrainerSession } from '../src/session.ts';
import { loadHosted, type HostedPage } from './helpers/hosted-page.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CODE = /^(?:S17|H17|DAS|\d+D)$/;
/** Latin words that are not a rule code. */
const english = (text: string) => (text.match(/[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*/g) ?? []).filter((word) => !CODE.test(word));

test('the rules bar reads Hebrew for every rule set, and with each restriction', () => {
  const sittings: Array<[string, { noSurrender: boolean; likeRanksOnly: boolean }]> = [
    ...RULE_PRESETS.map((p): [string, { noSurrender: boolean; likeRanksOnly: boolean }] => [p.id, { noSurrender: false, likeRanksOnly: false }]),
    ['vegas-strip-6d-s17', { noSurrender: true, likeRanksOnly: true }],
  ];
  for (const [id, restrictions] of sittings) {
    const session = new TrainerSession(id, 1, restrictions);
    session.setLocale('he');
    const { name, badge, note } = session.ruleSet;
    assert.deepEqual(english([name, badge, note ?? ''].join(' ')), [], `${id} ${JSON.stringify(restrictions)}: ${name} | ${badge} | ${note}`);
    session.setLocale('en');
    assert.equal(session.ruleSet.name, RULE_PRESETS.find((p) => p.id === id)!.name, 'the English name changed');
  }
});

test('on the built page, the settings dialog lists the rule sets in Hebrew', async () => {
  const page = loadHosted('#table', [
    ['ev:playerName', 'Dana'],
    ['ev:locale', 'he'],
  ]);
  await page.booted;
  const presets = await page.api('/api/presets');
  assert.equal(presets.length, RULE_PRESETS.length);
  for (const preset of presets) {
    assert.deepEqual(english(`${preset.name} ${preset.note ?? ''}`), [], `${preset.id}: ${preset.name} ${preset.note ?? ''}`);
  }
  page.stopWatching();
});

test('a card is heard in Hebrew: every rank, every suit, the face-down card and the Space key', () => {
  const he = catalogue('he');
  const words = [
    he['card.label']!,
    ...['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'].map((rank) => he[`card.rank.${rank}`]!),
    ...['clubs', 'diamonds', 'hearts', 'spades'].map((suit) => he[`card.suit.${suit}`]!),
    he['card.faceDown']!,
    he['key.space']!,
  ];
  assert.ok(words.every(Boolean), 'a card word is missing from the Hebrew catalogue');
  assert.deepEqual(english(words.join(' ').replace(/\{\w+\}/g, '')), []);
});

test('no page script speaks English it did not get from the catalogue', () => {
  const offenders: string[] = [];
  for (const [dir, file] of [
    ...readdirSync(join(HERE, '..', 'public')).filter((f) => f.endsWith('.js')).map((f) => ['public', f]),
    ...readdirSync(join(HERE, '..', 'artifact')).filter((f) => f.endsWith('.js')).map((f) => ['artifact', f]),
  ]) {
    const code = readFileSync(join(HERE, '..', dir!, file!), 'utf8');
    for (const m of code.matchAll(/setAttribute\('(?:aria-label|title|placeholder)', '([^']*[A-Za-z]{2,}[^']*)'\)/g)) {
      offenders.push(`${file}: a literal "${m[1]}"`);
    }
    for (const m of code.matchAll(/class="key">([A-Za-z]{2,})</g)) offenders.push(`${file}: a literal key "${m[1]}"`);
    if (/aria-label', card\.label\)|card: card\.label\b/.test(code)) offenders.push(`${file}: a card spoken by its English label`);
  }
  assert.deepEqual(offenders, []);
});

/** Press one of the dock's buttons the way a tap reaches it. */
async function tap(page: HostedPage, action: string): Promise<boolean> {
  const box = page.document.getElementById('actions');
  const node = (box.children as any[])
    .flatMap((row: any) => row.children ?? [])
    .find((b: any) => b.dataset?.action === action);
  if (!node) return false;
  for (const handler of node.listeners.click ?? []) handler({ preventDefault() {} });
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
  return true;
}

test('the felt reads Hebrew when the dealer breaks — the word comes from the catalogue', async () => {
  /*
   * Found by round 12's sweep: the dealer's total read "23 bust" inside a Hebrew
   * page, because that one word was written into the page rather than taken from
   * the catalogue. The player's own total never had the bug, which is why only
   * the dealer's side went unnoticed.
   */
  const page = loadHosted('#table', [
    ['ev:playerName', 'בודק'],
    ['ev:locale', 'he'],
    ['ev:showAll', '1'],
  ]);
  await page.booted;
  const dock = (globalThis as { EVDock?: { useClock: (fn: () => number) => void } }).EVDock;
  let clock = 0;
  dock?.useClock(() => clock);
  for (let i = 0; i < 100; i++) await new Promise((r) => setTimeout(r, 5));

  // The player stands on 16; the dealer draws to 23.
  page.session().table.shoe.stack(page.parseCards('9s 6h 7d 8c 9d'));
  clock += 600;
  assert.ok(await tap(page, 'deal'), 'the table never offered Deal');
  clock += 600;
  assert.ok(await tap(page, 'stand'), 'the table never offered Stand');
  for (let i = 0; i < 100; i++) await new Promise((r) => setTimeout(r, 5));

  const dealerTotal = String(page.document.getElementById('dealer-total').textContent);
  assert.match(dealerTotal, /23/, `the dealer did not break: ${dealerTotal}`);
  assert.deepEqual(english(dealerTotal), [], `English on the felt: ${dealerTotal}`);
  assert.ok(dealerTotal.includes(catalogue('he')['ui.bust']!), `the dealer's break is unworded: ${dealerTotal}`);
  page.stopWatching();
});
