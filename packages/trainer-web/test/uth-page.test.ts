/**
 * Ultimate Texas Hold'em on the built page.
 *
 * `uth-session.test.ts` tests the session with its language set by the test.
 * That hid a bug a player hit on the first click: the built page told the
 * Blackjack session the language at boot and never told the UTH session, so a
 * Hebrew player opened Ultimate onto English buttons and an English card. It
 * was found by looking at a screenshot. This file runs the shipped page, boots
 * it the way a browser that remembers Hebrew would, and reads what comes back.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadHosted } from './helpers/hosted-page.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

test('a browser that remembers Hebrew opens Ultimate in Hebrew', async () => {
  const page = loadHosted('#ultimate', [
    ['ev:playerName', 'Idan'],
    ['ev:locale', 'he'],
  ]);
  await page.booted;
  assert.equal(page.screen(), 'ultimate');

  const dealt = await page.api('/api/uth/deal');
  const labels = dealt.legalActions.map((a: { label: string }) => a.label).join(' ');
  assert.doesNotMatch(labels, /[A-Za-z]{2,}/, `the buttons are in English: ${labels}`);

  const graded = await page.api('/api/uth/act', { action: 'raise3x' });
  const card = graded.feedback;
  const shown = [card.headline, card.verdict, card.youChose ?? '', card.sentence]
    .join(' ')
    .replace(/\b[2-9TJQKA]{2}[so]?\b/g, ''); // hole-class notation is the same in every language
  assert.doesNotMatch(shown, /[A-Za-z]{2,}/, `the card is in English: ${shown}`);
  page.stopWatching();
});

test('a browser that remembers English opens Ultimate in English', async () => {
  const page = loadHosted('#ultimate', [
    ['ev:playerName', 'Dana'],
    ['ev:locale', 'en'],
  ]);
  await page.booted;
  const dealt = await page.api('/api/uth/deal');
  assert.deepEqual(
    dealt.legalActions.map((a: { action: string }) => a.action),
    ['raise4x', 'raise3x', 'check'],
  );
  assert.match(dealt.legalActions[0].label, /Raise/);
  page.stopWatching();
});

test('the page draws no decision button as the primary one', () => {
  /*
   * The first screenshot showed "Raise 2×" in the green primary style, beside a
   * grey "Check" — the page quietly suggesting an answer to the decision it was
   * about to grade. Only Deal and Next hand may be primary.
   */
  const source = readFileSync(join(HERE, '..', 'public', 'ultimate.js'), 'utf8');
  const from = source.indexOf('function uthRenderActions');
  assert.ok(from > 0, 'uthRenderActions is gone from ultimate.js');
  const body = source.slice(from, source.indexOf('\n}\n', from));

  // Since round 4b the buttons are drawn in rows. Every decision button still
  // passes false for primary; only the deal button may pass true.
  const primaries = [...body.matchAll(/,\s*(true|false),\s*'?(\w+)'?\)/g)].map((m) => [m[1], m[2]]);
  assert.ok(primaries.length >= 2, 'the button calls were not found');
  for (const [primary, action] of primaries) {
    if (action !== 'deal') assert.equal(primary, 'false', `${action} is drawn as primary`);
  }
  assert.doesNotMatch(body, /index === 0/, 'the first decision button is singled out');
});
