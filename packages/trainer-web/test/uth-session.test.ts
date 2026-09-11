/**
 * Ultimate Texas Hold'em, as the player sees it (round 4a).
 *
 * `UthTable` is tested for the rules in game-engine. This file tests what the
 * session makes of them — the stack, the card, the sentence, the three
 * settlement lines — in both languages, and one thing no UTH test elsewhere can
 * reach: that playing it leaves the Blackjack record exactly as it was.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCards } from '@evtrainer/ev-engine/uth';
import type { UthTable } from '@evtrainer/game-engine';

import { catalogue, type Locale } from '../src/i18n.ts';
import { TrainerSession } from '../src/session.ts';
import { UthSession } from '../src/uth-session.ts';

const LOCALES: Locale[] = ['en', 'he'];

interface View {
  phase: string;
  hole: unknown[];
  dealerHole: unknown[];
  dealerRevealed: boolean;
  board: unknown[];
  boardHidden: number;
  holeClass: string | null;
  stake: { ante: number; blind: number; play: number; total: number };
  stack: { balance: number; lastNet: number | null; memoryOnly: boolean };
  legalActions: Array<{ action: string; label: string; key: string; code: string }>;
  needsPrepare: boolean;
  feedback: null | {
    phase: string;
    headline: string;
    correct: boolean;
    severity: string;
    verdict: string;
    youChose: string | null;
    chosen: string;
    optimal: string;
    evCost: number;
    ranked: Array<{ action: string; label: string; ev: number }>;
    sentence: string;
    solveMs: number;
  };
  settlement: null | { lines: string[]; net: string; folded: boolean };
}

/** A session whose next hand is exactly these cards: P P D D  F F F T R. */
function sessionWith(cards: string, locale: Locale = 'en'): UthSession {
  const session = new UthSession(1);
  session.setLocale(locale);
  (session as unknown as { table: UthTable }).table.stackNextHand(parseCards(cards));
  return session;
}

const act = (session: UthSession, action: string) => session.act(action as never) as View;

// --- The deal and the stack ---------------------------------------------------

test('a hand deals two, two face down, five face down, and the stack goes 200 then 198', () => {
  const session = sessionWith('As Kd 2c 7h Qs Jh 3d 9c 4s');
  const before = session.view as View;
  assert.equal(before.phase, 'idle');
  assert.equal(before.stack.balance, 200);

  const view = session.deal() as View;
  assert.equal(view.hole.length, 2);
  assert.equal(view.dealerHole.length, 0, 'the dealer is showing cards');
  assert.equal(view.board.length, 0);
  assert.equal(view.boardHidden, 5);
  assert.equal(view.stake.ante, 1);
  assert.equal(view.stake.blind, 1);
  assert.equal(view.stack.balance, 198);
  assert.equal(view.stack.memoryOnly, true, 'the page would present the stack as saved');
});

test('the stack moves by exactly what the hand paid', () => {
  const session = new UthSession(11);
  let expected = 200;
  for (let i = 0; i < 40; i++) {
    session.deal();
    let view = session.view as View;
    // Always the first legal action: a mix of raises, checks and river folds.
    while (view.legalActions.length > 0) {
      const action = view.legalActions[i % view.legalActions.length]!.action;
      view = act(session, action === 'check' && view.phase === 'preflop' ? 'raise4x' : action);
    }
    const net = view.stack.lastNet!;
    expected += net;
    assert.equal(view.stack.balance, expected, `hand ${i + 1}: stack drifted from the payouts`);
  }
});

// --- Pre-flop -----------------------------------------------------------------

test('pre-flop offers 4x, 3x and check, each with its own key', () => {
  const session = sessionWith('As Kd 2c 7h Qs Jh 3d 9c 4s');
  const view = session.deal() as View;
  assert.deepEqual(
    view.legalActions.map((a) => [a.action, a.key, a.code]),
    [['raise4x', '4', 'Digit4'], ['raise3x', '3', 'Digit3'], ['check', 'C', 'KeyC']],
  );
  // Physical keys, so a Hebrew keyboard layout plays the same shortcuts.
  for (const entry of view.legalActions) assert.doesNotMatch(entry.code, /Space|Enter/);
});

test('choosing grades it: a verdict, a severity, the EV of all three, and one sentence', () => {
  const session = sessionWith('As Kd 2c 7h Qs Jh 3d 9c 4s');
  session.deal();
  const view = act(session, 'check');
  const card = view.feedback!;
  assert.equal(card.phase, 'preflop');
  assert.equal(card.correct, false, 'checking AKo was graded correct');
  assert.notEqual(card.severity, 'optimal');
  assert.equal(card.ranked.length, 3);
  assert.deepEqual(new Set(card.ranked.map((r) => r.action)), new Set(['raise4x', 'raise3x', 'check']));
  assert.ok(card.ranked[0]!.ev >= card.ranked[1]!.ev && card.ranked[1]!.ev >= card.ranked[2]!.ev);
  assert.ok(card.sentence.length > 20);
  assert.match(card.verdict, /cost \d\.\d{3}/);
  assert.ok(card.youChose);
});

test('3x is always graded an error, and the card says why, with the cost', () => {
  for (const locale of LOCALES) {
    for (const hand of ['As Ad 2c 7h Qs Jh 3d 9c 4s', '7s 2d 9c 4h Qs Jh 3d 8c 5s', 'Ks Qs 2c 7h 3s Jh 4d 9c 5s']) {
      const session = sessionWith(hand, locale);
      session.deal();
      const card = act(session, 'raise3x').feedback!;
      assert.equal(card.correct, false, `${locale} ${hand}: 3x graded correct`);
      assert.ok(card.evCost > 0);
      assert.match(card.sentence, /169/, `${locale}: the card does not give the 169 fact`);
      assert.ok(
        card.sentence.includes(card.evCost.toFixed(3)),
        `${locale}: the sentence quotes a different cost from the verdict: ${card.sentence}`,
      );
    }
  }
});

// --- The flop and the river ---------------------------------------------------

test('checking reveals the flop and offers 2x or check; a raise runs the board out', () => {
  const session = sessionWith('As Ad 9c 4h Qs Jh 3d 8c 5s');
  session.deal();
  let view = act(session, 'check');
  assert.equal(view.phase, 'flop');
  assert.equal(view.board.length, 3);
  assert.equal(view.boardHidden, 2);
  assert.equal(view.needsPrepare, true, 'the page would not know to solve the flop early');
  assert.deepEqual(view.legalActions.map((a) => a.action), ['raise2x', 'check']);

  const prepared = session.prepare();
  assert.equal(prepared.phase, 'flop');
  assert.ok(prepared.solveMs > 0, 'no solve happened');

  view = act(session, 'raise2x');
  assert.equal(view.phase, 'settled');
  assert.equal(view.board.length, 5, 'a raise did not run the board out');
  assert.equal(view.dealerRevealed, true);
  // The card for the flop used the solve done during prepare, not a second one.
  assert.equal(view.feedback!.solveMs, prepared.solveMs);
});

test('checking twice offers 1x or fold; folding shows −2 and says Ante and Blind are forfeit', () => {
  for (const locale of LOCALES) {
    const session = sessionWith('7s 2d As Ad Qs Jh 3d 8c 5s', locale);
    session.deal();
    act(session, 'check');
    let view = act(session, 'check');
    assert.equal(view.phase, 'river');
    assert.deepEqual(view.legalActions.map((a) => a.action), ['raise1x', 'fold']);
    view = act(session, 'fold');
    assert.equal(view.stack.lastNet, -2);
    assert.equal(view.stack.balance, 198);
    assert.equal(view.settlement!.folded, true);
    assert.equal(view.settlement!.lines.length, 3);
    const forfeit = catalogue(locale)['uth.line.forfeit']!;
    assert.ok(view.settlement!.lines.includes(forfeit), `${locale}: no forfeit line`);
    assert.match(view.settlement!.net, /−2/);
    assert.equal(view.dealerRevealed, false, 'a fold turned the dealer over');
  }
});

// --- Showdown -----------------------------------------------------------------

test('showdown shows three separate lines: the dealer and the Ante, the Play, the Blind', () => {
  // Player straight 9-K; dealer king high, no pair: does not qualify.
  const session = sessionWith('9s Th 2c 4d Jd Qc Kh 7s 3h');
  session.deal();
  const view = act(session, 'raise4x');
  const lines = view.settlement!.lines;
  assert.equal(lines.length, 3);
  assert.equal(lines[0], catalogue('en')['uth.line.dealerNotQualified']);
  assert.match(lines[1]!, /Play 4× wins \+4/);
  assert.match(lines[2]!, /Blind pays \+1/);
  assert.match(view.settlement!.net, /\+5/);
});

test('the result arrives with the grade and is marked to be drawn after it', () => {
  // The session composes both; the page is what staggers them. The contract the
  // page relies on is that a settled view carries the card and the lines apart.
  const session = sessionWith('As Ad 2c 2d Kh 9s 5c 7h 3d');
  session.deal();
  const view = act(session, 'raise4x');
  assert.ok(view.feedback, 'no grade on a settled hand');
  assert.ok(view.settlement, 'no result on a settled hand');
  assert.ok(!view.feedback!.sentence.includes(view.settlement!.lines[1]!));
});

// --- Language -----------------------------------------------------------------

/** Play a spread of hands down every path and collect every string shown. */
function everythingShown(locale: Locale): string[] {
  const shown: string[] = [];
  const session = new UthSession(2026);
  session.setLocale(locale);
  const paths = [['raise4x'], ['raise3x'], ['check', 'raise2x'], ['check', 'check', 'raise1x'], ['check', 'check', 'fold'], ['check', 'check']];
  for (let i = 0; i < 18; i++) {
    session.deal();
    for (const action of paths[i % paths.length]!) {
      const view = session.view as View;
      if (view.legalActions.length === 0) break;
      const legal = view.legalActions.map((a) => a.action);
      const next = act(session, legal.includes(action) ? action : legal[legal.length - 1]!);
      for (const entry of next.legalActions) shown.push(entry.label);
      if (next.feedback) {
        const f = next.feedback;
        shown.push(f.headline, f.verdict, f.sentence, ...(f.youChose ? [f.youChose] : []));
        shown.push(...f.ranked.map((r) => r.label));
      }
      if (next.settlement) shown.push(...next.settlement.lines, next.settlement.net);
    }
    // Finish whatever the path left open. The view is re-read every time round:
    // a view captured once goes stale the moment the hand settles.
    let rest = session.view as View;
    while (rest.legalActions.length > 0) rest = act(session, rest.legalActions[0]!.action);
  }
  return shown;
}

test('nothing in Hebrew mode is written in English', () => {
  const words = everythingShown('he')
    .join(' ')
    // Hole-class labels (AKo, 72o) are card notation, the same in any language.
    .replace(/\b[2-9TJQKA]{2}[so]?\b/g, '')
    .match(/[A-Za-z]{2,}/g) ?? [];
  assert.deepEqual([...new Set(words)], [], 'English words reached the Hebrew UTH screen');
});

test('no raw i18n key reaches the UTH screen, in either language', () => {
  const prefixes = [...new Set(Object.keys(catalogue('en')).map((k) => k.split('.')[0]!))];
  const rawKey = new RegExp(`\\b(?:${prefixes.join('|')})\\.[A-Za-z0-9]`);
  for (const locale of LOCALES) {
    for (const line of everythingShown(locale)) {
      assert.doesNotMatch(line, rawKey, `${locale}: ${line}`);
      assert.doesNotMatch(line, /\{\w+\}/, `${locale}: an unfilled parameter in "${line}"`);
    }
  }
});

test('in Hebrew every signed figure and raise size is kept in one piece', () => {
  /*
   * The live page, in Hebrew, drew "אנטה 1−" for a lost Ante and "העלאה ×1" on
   * the raise button: a sign or a × beside right-to-left words belongs, to the
   * bidirectional algorithm, to whichever side it touches. Each figure is now a
   * left-to-right isolate (U+2066 … U+2069), which it cannot split. This checks
   * the composed strings, because the visual result is only as good as they are.
   */
  const LRI = '\u2066';
  const PDI = '\u2069';
  // A sign is + or U+2212, or an ASCII hyphen that does not follow a Hebrew
  // letter: "ב-32%" and "מ-169" use the Hebrew prefix hyphen, which is not a
  // minus and draws correctly without help.
  const figure = /(?:[+\u2212]|(?<![\u0590-\u05FF])-)?\d+(?:\.\d+)?×?/g;

  for (const line of everythingShown('he')) {
    // Strip everything already isolated; what remains must hold no signed
    // figure and no raise size.
    const outside = line.replace(new RegExp(`${LRI}[^${PDI}]*${PDI}`, 'g'), '');
    for (const match of outside.match(figure) ?? []) {
      assert.ok(
        !/^[+\u2212-]/.test(match) && !match.endsWith('×'),
        `a figure is not isolated in "${line}": ${match}`,
      );
    }
  }

  // English needs no isolates and must not carry invisible characters.
  for (const line of everythingShown('en')) {
    assert.ok(!line.includes(LRI) && !line.includes(PDI), `English carries an isolate: ${line}`);
  }
});

test('every UTH key the session uses exists in both languages', () => {
  const en = Object.keys(catalogue('en')).filter((k) => k.startsWith('uth.'));
  const he = new Set(Object.keys(catalogue('he')).filter((k) => k.startsWith('uth.')));
  for (const key of en) assert.ok(he.has(key), `he has no ${key}`);
});

// --- Blackjack is untouched ---------------------------------------------------

test('a UTH session leaves the Blackjack rating, stats, history and progress exactly as they were', () => {
  const blackjack = new TrainerSession('vegas-strip-6d-s17', 5);
  // Some real Blackjack first, so there is something to disturb.
  for (let i = 0; i < 15; i++) {
    blackjack.deal();
    let view = blackjack.view as { phase: string; legalActions: string[] };
    if (view.phase === 'insurance') blackjack.insurance(false);
    view = blackjack.view as { phase: string; legalActions: string[] };
    let guard = 0;
    while (view.phase === 'player' && guard++ < 10) {
      blackjack.act('stand');
      view = blackjack.view as { phase: string; legalActions: string[] };
    }
  }
  const before = JSON.stringify({
    stats: blackjack.stats,
    progress: blackjack.progress,
    rating: (blackjack.view as { rating: unknown }).rating,
    history: (blackjack.view as { history: unknown }).history,
  });

  const uth = new UthSession(9);
  for (let i = 0; i < 25; i++) {
    uth.deal();
    let view = uth.view as View;
    while (view.legalActions.length > 0) view = act(uth, view.legalActions[i % view.legalActions.length]!.action);
  }

  const after = JSON.stringify({
    stats: blackjack.stats,
    progress: blackjack.progress,
    rating: (blackjack.view as { rating: unknown }).rating,
    history: (blackjack.view as { history: unknown }).history,
  });
  assert.equal(after, before, 'playing UTH changed the Blackjack record');
});
