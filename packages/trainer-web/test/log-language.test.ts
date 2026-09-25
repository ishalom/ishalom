/**
 * The hand log speaks one language (round 9).
 *
 * A Blackjack hand used to keep the sentences it was graded with, so a player
 * who played in English and then chose Hebrew read English headlines, English
 * action names and English reasoning inside Hebrew rows. Ultimate already saved
 * its hands as numbers and worded them when shown; Blackjack now does the same.
 *
 * The guard is on what the player reads rather than on how it is built: after
 * playing in one language and switching, no row of either game's log carries a
 * word of the other — on the session, on a record saved by an older build, and
 * on the built page.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TrainerSession } from '../src/session.ts';
import { loadHosted } from './helpers/hosted-page.ts';

/** Words of two or more Latin letters. A card rank is one letter and is not a word. */
const latinWords = (text: string) => text.match(/[A-Za-z]{2,}/g) ?? [];
const hebrewLetters = (text: string) => text.match(/[֐-׿]+/g) ?? [];

/** Every word a Blackjack log row shows for one decision. */
const decisionText = (d: any) => [d.headline, d.chosen, d.optimal, ...d.steps].join(' ');

function play(session: TrainerSession, hands: number): void {
  for (let i = 0; i < hands; i++) {
    session.deal();
    let guard = 0;
    while (guard++ < 30) {
      const phase = (session.view as any).phase;
      // Take insurance on alternate offers, so both of its actions are worded.
      if (phase === 'insurance') session.insurance(i % 2 === 0);
      else if (phase === 'player') session.act(guard === 1 && i % 3 === 0 ? 'hit' : 'stand');
      else break;
    }
  }
}

test('Blackjack: hands played in English read in Hebrew, every word, after the switch', () => {
  const session = new TrainerSession('vegas-strip-6d-s17', 20260914);
  play(session, 30);
  const before = (session.view as any).history as any[];
  assert.ok(before.flatMap((h) => h.decisions).length >= 20, 'too few decisions to be a test');

  session.setLocale('he');
  const offenders = (((session.view as any).history) as any[])
    .flatMap((h) => h.decisions)
    .flatMap((d) => latinWords(decisionText(d)).map((w) => `${w} in "${d.headline}"`));
  assert.deepEqual(offenders, []);

  session.setLocale('en');
  const back = (((session.view as any).history) as any[]).flatMap((h) => h.decisions).flatMap((d) => hebrewLetters(decisionText(d)));
  assert.deepEqual(back, []);
});

test('worded again, a decision reads exactly as the card said it when it was played', () => {
  const session = new TrainerSession('vegas-strip-6d-s17', 20260915);
  session.setLocale('he');
  play(session, 20);
  const saved = (session.progress.history as any[]).flatMap((h) => h.decisions);
  const shown = (((session.view as any).history) as any[]).flatMap((h) => h.decisions);
  assert.ok(saved.length > 0);
  assert.deepEqual(
    shown.map((d) => [d.headline, d.chosen, d.optimal, d.steps]),
    saved.map((d) => [d.headline, d.chosen, d.optimal, d.steps]),
  );
});

test('a hand saved by an older build, with only its English labels, reads in Hebrew too', () => {
  const played = new TrainerSession('vegas-strip-6d-s17', 20260916);
  play(played, 25);
  const progress = structuredClone(played.progress) as any;
  // What an older build saved: labels, and no action ids.
  for (const hand of progress.history) {
    for (const d of hand.decisions) {
      delete d.chosenAction;
      delete d.optimalAction;
    }
  }

  const reopened = new TrainerSession('vegas-strip-6d-s17', 1);
  reopened.restore(progress);
  reopened.setLocale('he');
  const decisions = (((reopened.view as any).history) as any[]).flatMap((h) => h.decisions);
  assert.ok(decisions.length > 0);
  assert.deepEqual(decisions.flatMap((d) => latinWords(decisionText(d))), []);
  // And what it says it chose is what was chosen, not the best play.
  const original = (((played.view as any).history) as any[]).flatMap((h) => h.decisions);
  assert.deepEqual(
    decisions.map((d) => d.chosenAction),
    original.map((d) => d.chosenAction),
  );
});

/** All the text under a stub node: its own, its markup with the tags removed, its children's. */
function textOf(node: any): string {
  if (!node || typeof node !== 'object') return '';
  const own = [node.textContent ?? '', String(node.innerHTML ?? '').replace(/<[^>]*>/g, ' ')];
  return [...own, ...(node.children ?? []).map(textOf)].join(' ');
}

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

test('on the built page, the home log is in one language in every row of both games', async () => {
  const page = loadHosted('#home', [
    ['ev:playerName', 'Dana'],
    ['ev:locale', 'en'],
  ]);
  await page.booted;

  for (let i = 0; i < 12; i++) {
    let view = await page.api('/api/deal');
    let guard = 0;
    while (guard++ < 30) {
      if (view.phase === 'insurance') view = await page.api('/api/insurance', { take: i % 2 === 0 });
      else if (view.phase === 'player') view = await page.api('/api/act', { action: 'stand' });
      else break;
    }
  }
  for (let i = 0; i < 4; i++) {
    let view = await page.api('/api/uth/deal');
    let guard = 0;
    while (view.legalActions.length > 0 && guard++ < 10) {
      const legal = view.legalActions.map((a: { action: string }) => a.action);
      view = await page.api('/api/uth/act', { action: legal.includes('check') ? 'check' : 'raise1x' });
    }
  }
  assert.ok(page.session().view.history.length > 0 && page.uthSession().view.history.length > 0);

  page.setLocale('he');
  await settle();
  const hebrew = textOf(page.document.getElementById('hands'));
  assert.ok(hebrew.length > 200, 'the log did not render');
  assert.deepEqual(latinWords(hebrew), [], 'an English word in the Hebrew log');

  page.setLocale('en');
  await settle();
  const english = textOf(page.document.getElementById('hands'));
  assert.deepEqual(hebrewLetters(english), [], 'a Hebrew word in the English log');
  page.stopWatching();
});

test('on the built page, the home ladder is in one language too (round 11)', async () => {
  /*
   * Found in round 10 while looking at the two ratings: the heading, "one in N
   * hands" and the action names under the Blackjack rating read English inside a
   * Hebrew home screen. Fixed the way the hand log was — worded from ids in the
   * language on screen — and held here the same way.
   */
  const page = loadHosted('#home', [
    ['ev:playerName', 'Dana'],
    ['ev:locale', 'he'],
  ]);
  await page.booted;
  page.go('#table');
  page.go('#home');
  const ladder = page.document.getElementById('ladder');
  for (let i = 0; i < 100 && (ladder.children ?? []).length < 3; i++) await settle(20);
  const hebrew = textOf(ladder);
  assert.ok(ladder.children.length >= 3 && hebrew.length > 40, 'the ladder did not render');
  assert.deepEqual(latinWords(hebrew), [], 'an English word in the Hebrew ladder');

  page.setLocale('en');
  for (let i = 0; i < 50; i++) await settle(10);
  assert.deepEqual(hebrewLetters(textOf(page.document.getElementById('ladder'))), [], 'a Hebrew word in the English ladder');
  page.stopWatching();
});
