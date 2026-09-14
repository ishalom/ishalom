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

test('the winner line sits with the hands, after the grade, and quieter than it', () => {
  const js = source('ultimate.js');
  const names = js.indexOf("p.className = 'uth-hand-name'");
  const winner = js.indexOf("winner.className = 'uth-winner'");
  const verdict = js.indexOf("verdict.className = 'verdict'");
  assert.ok(verdict > 0 && names > verdict && winner > names, 'the winner line is not after the grade and the hands');
  const css = source('styles.css');
  const size = (rule: RegExp) => Number(/font-size: ([\d.]+)px/.exec(rule.exec(css)![1]!)![1]);
  assert.ok(size(/\.uth-winner \{([^}]*)\}/) < size(/\.quickcard \.verdict \{([^}]*)\}/), 'the winner is as loud as the grade');
});

test('the analysis text on the card is bigger than it was', () => {
  const css = source('styles.css');
  const px = (rule: RegExp) => Number(/font-size: ([\d.]+)px/.exec(rule.exec(css)![1]!)![1]);
  assert.ok(px(/\.uth \.quickcard \.reason \{([^}]*)\}/) >= 15, 'the sentence is still small');
  assert.ok(px(/\.uth-note \{([^}]*)\}/) >= 15, 'the notes are still small');
  assert.ok(px(/\.uth \.uth-result p \{([^}]*)\}/) >= 14, 'the result lines are still small');
});
