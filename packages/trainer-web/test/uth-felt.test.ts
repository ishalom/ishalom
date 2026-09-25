/**
 * Ultimate's felt and card, from Idan's notes of 2026-09-13 (round 7).
 *
 *   1. No class label beside "You": the card's analysis says the suits instead
 *      (the suit line itself is tested over all 169 in uth-explain.test.ts).
 *   2. Both final hands marked with equal weight, and a board card in both hands
 *      carrying both marks at once.
 *   3. One line naming the winner by the cards, with the two hands, quieter than
 *      the grade.
 *   4. The analysis text bigger.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCards } from '@evtrainer/ev-engine/uth';
import type { UthTable } from '@evtrainer/game-engine';

import { UthSession } from '../src/uth-session.ts';
import { loadHosted } from './helpers/hosted-page.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (file: string) => readFileSync(join(HERE, '..', 'public', file), 'utf8');

function showdown(cards: string, locale: 'en' | 'he' = 'en'): any {
  const session = new UthSession(1);
  session.setLocale(locale);
  (session as unknown as { table: UthTable }).table.stackNextHand(parseCards(cards));
  session.deal();
  return session.act('raise4x') as any;
}

// --- Who won, by the cards ------------------------------------------------------------------

test('the winner is named by the cards: you, the dealer, the kicker, or a tie', () => {
  // You 4-4-4-A-A against the dealer's 4-4-4-A-J.
  assert.equal(showdown('Ad 9s 7h 2s 4h 4d 4c As Jc').showdown.winner, 'You win: a full house, three fours and two aces against three fours');
  // The dealer's pair of aces against your jack high.
  assert.equal(showdown('Js 2d As Ad Kc Qh 9s 4d 3c').showdown.winner, 'The dealer wins: a pair of aces against king high');
  // A pair of kings each: your nine beats the dealer's eight.
  assert.equal(showdown('Kc 9d Kh 8s Ks Qd 7c 4h 2s').showdown.winner, 'You win on the kicker: a pair of kings each');
  // The board plays for both: a royal flush each.
  assert.equal(showdown('2c 3d 4h 5c As Ks Qs Js Ts').showdown.winner, 'A tie: a royal flush each');
});

test('the winner line agrees with what the Play bet was paid, on every showdown of a long run', () => {
  const session = new UthSession(20260913);
  for (let hand = 0; hand < 300; hand++) {
    session.deal();
    const view = session.act('raise4x') as any;
    const winner: string = view.showdown.winner;
    const play = view.settlement ? (session as any).table.view.settlement.play : 0;
    if (play > 0) assert.match(winner, /^You win/, `paid the Play, but: ${winner}`);
    if (play < 0) assert.match(winner, /^The dealer wins/, `took the Play, but: ${winner}`);
    if (play === 0) assert.match(winner, /^A tie/, `pushed the Play, but: ${winner}`);
  }
});

test('in Hebrew the winner line reads as Cowork’s example, and the log keeps it', () => {
  const view = showdown('Js 2d As Ad Kc Qh 9s 4d 3c', 'he');
  assert.match(view.showdown.winner, /^הדילר מנצח: /);
  assert.ok(view.history[0].showdown.includes(view.showdown.winner), 'the hand log lost the winner line');
});

// --- The felt and the card, on the page -------------------------------------------------------

test('no class label beside You, on the felt or in a tooltip', () => {
  assert.doesNotMatch(source('ultimate.html'), /id="uth-class"/);
  assert.doesNotMatch(source('ultimate.js'), /uth-class|holeWords|holeClass/);
});

test('both hands are marked with equal weight, and a shared card carries both halves', () => {
  const css = source('styles.css');
  const ring = /\.uth \.card\.best-you::after,\s*\.uth \.card\.best-dealer::before \{([^}]*)\}/.exec(css);
  assert.ok(ring, 'the two rings are not one rule');
  assert.match(ring![1]!, /border: 3px solid/);
  assert.match(css, /\.uth \.card\.best-you\.best-dealer::before \{ clip-path: inset\(0 0 50% 0\); \}/, 'no dealer half on top');
  assert.match(css, /\.uth \.card\.best-you\.best-dealer::after \{ clip-path: inset\(50% 0 0 0\); \}/, 'no player half below');
  assert.doesNotMatch(css, /\.best-dealer \{ box-shadow/, 'the dealer is still marked more weakly');
});

/** The declarations of the first rule whose selector list names `selector`. */
function declarations(css: string, selector: string): string {
  const at = css.indexOf(selector);
  assert.ok(at > 0, `no rule for ${selector}`);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

const fontSize = (css: string, selector: string) =>
  Number(/font-size: ([\d.]+)px/.exec(declarations(css, selector))![1]);

test('Ultimate follows Blackjack’s model: commentary below the table, the grade with the buttons (round 12)', () => {
  const html = source('ultimate.html');
  const table = html.indexOf('</main>');
  const commentary = html.indexOf('id="uth-feedback"');
  const dock = html.indexOf('class="dock"');
  const card = html.indexOf('id="uth-card"');
  const buttons = html.indexOf('id="uth-actions"');
  assert.ok(table > 0 && commentary > table, 'the commentary is not below the table');
  assert.ok(dock > commentary && card > dock && buttons > card, 'the dock no longer holds the grade and the buttons');

  // The same shape as Blackjack's screen, which is the reference.
  const bj = source('table.html');
  assert.ok(bj.indexOf('id="feedback"') > bj.indexOf('</main>'));
  assert.ok(bj.indexOf('id="quickcard"') > bj.indexOf('class="dock"'));

  // The dock card carries the grade and what the player chose; the reasoning,
  // the notes and the result carry on below the table.
  const js = source('ultimate.js');
  const cardFn = js.slice(js.indexOf('function uthRenderCard('), js.indexOf('function uthRenderActions('));
  const commentaryFn = js.slice(js.indexOf('function uthRenderCommentary('), js.indexOf('function uthRenderCard('));
  for (const inCard of ["verdict.className = 'verdict'", "className = 'did'", "window.EVReturns.block("]) {
    assert.ok(cardFn.includes(inCard), `the dock card lost ${inCard}`);
  }
  for (const below of ["sentence.className = 'reason'", "uth-note", "result.className = 'uth-result uth-late'", "net.className = 'uth-net'"]) {
    assert.ok(commentaryFn.includes(below), `the commentary lost ${below}`);
    assert.ok(!cardFn.includes(below), `${below} is still in the dock`);
  }
});

test('the winner line follows the grade, and is quieter than it', () => {
  const js = source('ultimate.js');
  const commentary = js.slice(js.indexOf('function uthRenderCommentary('), js.indexOf('function uthRenderCard('));
  assert.ok(commentary.indexOf("winner.className = 'uth-winner'") > 0, 'the winner line is gone');
  /*
   * Round 19 moved the two hands themselves into the seat headers, where each
   * sits beside the cards it is made of, so the commentary no longer prints
   * them: the same sentence twice on one screen was what it was.
   */
  assert.ok(!commentary.includes("'uth-hand-name'"), 'the commentary repeats the hands the headers carry');
  // The grade is in the dock, which the page lays out above the buttons and
  // after the commentary; the winner is quieter than it.
  const css = source('styles.css');
  assert.ok(fontSize(css, '.uth-winner {') < fontSize(css, '.quickcard .verdict {'), 'the winner is as loud as the grade');
});

test('the analysis text is bigger than it was, wherever it now lives', () => {
  const css = source('styles.css');
  // Round 7's size, kept when round 12 moved the sentence below the table.
  assert.ok(fontSize(css, '.uth .feedback .reason') >= 15, 'the sentence is small below the table');
  assert.ok(fontSize(css, '.uth .quickcard .reason') >= 15, 'the sentence is small on the card');
  assert.ok(fontSize(css, '.uth-note {') >= 15, 'the notes are still small');
  assert.ok(fontSize(css, '.uth .uth-result p {') >= 14, 'the result lines are still small');
});

/** Everything under a stub node: its own text, its markup stripped of tags, its children's. */
function textOf(node: any): string {
  if (!node || typeof node !== 'object') return '';
  const own = [node.textContent ?? '', String(node.innerHTML ?? '').replace(/<[^>]*>/g, ' ')];
  return [...own, ...(node.children ?? [])].map((part) => (typeof part === 'string' ? part : textOf(part))).join(' ');
}

test('on the built page, the played hand’s words are below the table and the grade is in the dock', async () => {
  const page = loadHosted('#ultimate', [['ev:playerName', 'Dana'], ['ev:locale', 'en']]);
  await page.booted;
  page.uthSession().table.stackNextHand(page.parseCards('7s 2d As Ad Qs Jh 3d 8c 5s'));
  let view: any = await page.api('/api/uth/deal');
  while (view.legalActions.length > 0) {
    const legal = view.legalActions.map((a: { action: string }) => a.action);
    view = await page.api('/api/uth/act', { action: legal.includes('check') ? 'check' : 'raise1x' });
  }
  // The hand was played through the page's routes; mounting the screen again is
  // what draws it, exactly as arriving at the table does.
  page.go('#home');
  page.go('#ultimate');
  for (let i = 0; i < 80; i++) await new Promise((r) => setTimeout(r, 20));

  // The bolded figures are their own nodes, so the words are compared with
  // runs of whitespace collapsed rather than character for character.
  const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
  const card = flat(textOf(page.document.getElementById('uth-card')));
  const commentary = flat(textOf(page.document.getElementById('uth-feedback')));
  const feedback = view.feedback;
  const sentence = flat(feedback.sentence.replace(/\*\*/g, ''));

  // The grade, and what it was for, ride with the buttons.
  assert.ok(card.includes(flat(feedback.verdict)), `the dock card lost the grade: ${card.slice(0, 120)}`);
  assert.ok(card.includes(feedback.headline.split(' → ')[0]!), 'the dock card lost the spot');
  // The reasoning and what the cards did are below the table.
  assert.ok(commentary.includes(sentence), `the reasoning is not below the table: ${commentary.slice(0, 160)}`);
  assert.ok(commentary.includes(flat(view.settlement.net)), 'the hand’s result is not below the table');
  // And neither is in the other place.
  assert.ok(!card.includes(sentence), 'the reasoning is still in the dock');
  assert.ok(!commentary.includes(flat(feedback.verdict)), 'the grade is repeated below the table');
  page.stopWatching();
});
