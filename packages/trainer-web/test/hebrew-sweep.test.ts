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
import { loadHosted } from './helpers/hosted-page.ts';

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
