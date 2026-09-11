/**
 * UTH in plain words (round 5, Part B).
 *
 * Every line tested here must be true for the hand in front of the player and
 * must take its figures from the engine: the pre-flop suit line and the
 * suited-connector line over all 169 starting hands, the river percentages over
 * hundreds of rivers, both final hands at showdown, the starting hand in words,
 * and chips that would otherwise look equal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PREFLOP_TABLE, parseCards, riverOdds } from '@evtrainer/ev-engine/uth';
import type { UthTable } from '@evtrainer/game-engine';

import { catalogue, type Locale } from '../src/i18n.ts';
import { UthSession, wholePercents } from '../src/uth-session.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const RANKS = '23456789TJQKA';

/** Two cards of a class: first spades, second spades if suited, hearts otherwise. */
function cardsOf(label: string): string {
  const hi = label[0]!;
  const lo = label[1]!;
  return `${hi}s ${lo}${label.endsWith('s') ? 's' : 'h'}`;
}

function preflopCard(label: string, locale: Locale = 'en') {
  const session = new UthSession(1);
  session.setLocale(locale);
  (session as unknown as { table: UthTable }).table.stackNextHand(parseCards(cardsOf(label)));
  session.deal();
  return (session.act('check') as any).feedback;
}

// --- Suitedness and suited connectors, over all 169 -----------------------------

test('the suit line appears exactly on suited hands, with the table’s figures, over all 169', () => {
  const en = catalogue('en');
  const flipsStart = en['uth.note.suitFlips']!.slice(0, 24);
  const sameStart = en['uth.note.suitSame']!.slice(0, 12);
  let flips = 0;
  for (const row of Object.values(PREFLOP_TABLE)) {
    const card = preflopCard(row.label);
    const suited = row.label.length === 3 && row.label.endsWith('s');
    const suitLines = card.notes.filter((n: string) => n.startsWith(flipsStart) || n.startsWith(sameStart));
    if (!suited) {
      assert.equal(suitLines.length, 0, `${row.label} is not suited and got a suit line`);
      continue;
    }
    assert.equal(suitLines.length, 1, `${row.label} is suited and has no suit line`);
    const off = PREFLOP_TABLE[`${row.label.slice(0, 2)}o`]!;
    const bestEv = (r: typeof row) => (r.optimalAction === 'raise4x' ? r.ev4x : r.optimalAction === 'raise3x' ? r.ev3x : r.evCheck);
    const fmt = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(3)}`;
    const line = suitLines[0];
    assert.ok(line.includes(fmt(bestEv(row))), `${row.label}: the suited figure is not the table’s: ${line}`);
    assert.ok(line.includes(fmt(bestEv(off))), `${row.label}: the offsuit figure is not the table’s: ${line}`);
    const flipped = row.optimalAction !== off.optimalAction;
    assert.equal(line.startsWith(flipsStart), flipped, `${row.label}: the line says the wrong thing about the decision`);
    if (flipped) flips++;
  }
  assert.equal(flips, 7, 'the table has 7 suited classes whose suit flips the decision');
});

test('K4s: raise 4× at +0.117, where K4o should check at −0.206', () => {
  const [line] = preflopCard('K4s').notes;
  assert.match(line, /raise 4×/);
  assert.match(line, /\+0\.117/);
  assert.match(line, /check/);
  assert.match(line, /−0\.206/);
  assert.match(line, /changes the decision/);
});

test('the suited-connector line appears only on suited connectors the table checks', () => {
  const connector = catalogue('en')['uth.note.connector']!;
  const shown: string[] = [];
  for (const row of Object.values(PREFLOP_TABLE)) {
    const has = preflopCard(row.label).notes.includes(connector);
    const suited = row.label.length === 3 && row.label.endsWith('s');
    const adjacent = RANKS.indexOf(row.label[0]!) - RANKS.indexOf(row.label[1]!) === 1;
    assert.equal(has, suited && adjacent && row.optimalAction === 'check', `${row.label}: connector line wrong`);
    if (has) shown.push(row.label);
  }
  assert.ok(shown.includes('T9s') && shown.includes('87s'));
  assert.ok(!shown.includes('QJs'), 'QJs raises and must not get the line');
  assert.ok(!shown.includes('T8s'), 'a one-gapper is not a connector');
  assert.deepEqual(shown.sort(), ['32s', '43s', '54s', '65s', '76s', '87s', '98s', 'T9s'].sort());
});

test('no note for pairs or for hands in different suits, in Hebrew either', () => {
  for (const label of ['AA', '77', '22', 'AKo', 'T9o', '72o']) {
    assert.deepEqual(preflopCard(label, 'he').notes, [], `${label} got a note`);
  }
  assert.equal(preflopCard('T9s', 'he').notes.length, 2);
});

// --- Plain words for the starting hand ------------------------------------------------

test('no starting hand is shown only as notation, in either language', () => {
  for (const locale of ['en', 'he'] as Locale[]) {
    for (const label of ['62s', 'AKo', '77', 'T9s']) {
      const session = new UthSession(1);
      session.setLocale(locale);
      (session as unknown as { table: UthTable }).table.stackNextHand(parseCards(cardsOf(label)));
      const view = session.deal() as any;
      assert.equal(view.holeClass, label, 'the notation is still there for the tooltip');
      assert.ok(view.holeWords && !/\b[2-9TJQKA]{2}[so]?\b/.test(view.holeWords), `${locale}: "${view.holeWords}"`);
      const card = (session.act('check') as any).feedback;
      assert.doesNotMatch(card.headline, /\b[2-9TJQKA]{2}[so]?\b/, `${locale}: the headline shows notation`);
    }
  }
  const words = (label: string) => {
    const session = new UthSession(1);
    (session as unknown as { table: UthTable }).table.stackNextHand(parseCards(cardsOf(label)));
    return (session.deal() as any).holeWords;
  };
  assert.equal(words('62s'), '6-2, same suit');
  assert.equal(words('AKo'), 'A-K, different suits');
  assert.equal(words('77'), 'a pair of sevens');
  assert.equal(words('T9s'), '10-9, same suit');
});

// --- The river ------------------------------------------------------------------------

test('whole-number percentages always add to exactly 100', () => {
  assert.deepEqual(wholePercents([825, 109, 56]), [83, 11, 6]);
  assert.deepEqual(wholePercents([0, 0, 990]), [0, 0, 100]);
  assert.deepEqual(wholePercents([1, 1, 1]), [34, 33, 33]);
  for (let w = 0; w <= 990; w += 37) {
    for (let t = 0; t <= 990 - w; t += 53) {
      const p = wholePercents([w, t, 990 - w - t]);
      assert.equal(p[0]! + p[1]! + p[2]!, 100);
    }
  }
});

test('on the river: percentages from the same 990 holdings, and the hands that beat you, in both languages', () => {
  for (let seed = 1; seed <= 50; seed++) {
    for (const locale of ['en', 'he'] as Locale[]) {
      const session = new UthSession(seed);
      session.setLocale(locale);
      session.deal();
      session.act('check');
      const river = session.act('check') as any;
      const hole = river.hole.map((c: any) => c.code);
      const board = river.board.map((c: any) => c.code);
      const odds = riverOdds(hole, board);
      const card = (session.act('raise1x') as any).feedback;
      const figures = [...card.sentence.matchAll(/(\d+)%/g)].map((m: RegExpMatchArray) => Number(m[1]));
      assert.equal(figures.length, 3, `${locale}: not three percentages: ${card.sentence}`);
      assert.equal(figures[0]! + figures[1]! + figures[2]!, 100, `${locale}: they do not add to 100`);
      assert.deepEqual(figures, wholePercents([odds.wins, odds.ties, odds.losses]));

      assert.equal(card.notes.length, 1, `${locale}: no line about the hands that beat you`);
      const note = card.notes[0];
      const key = odds.losses === 0 ? 'uth.note.nothingBeats'
        : odds.closest.reduce((s, g) => s + g.count, 0) === odds.losses ? 'uth.note.onlyWith' : 'uth.note.closest';
      const lead = catalogue(locale)[key]!.split('{')[0]!;
      assert.ok(note.startsWith(lead), `${locale}: expected ${key}: ${note}`);
      assert.doesNotMatch(note, /\{\w+\}|uthHand\.|rankName\.|rankPlural\./, `${locale}: ${note}`);
    }
  }
});

test('the closest hands are named in plain words: a pair of eights on K-9-5-3-2 loses first to a pair of nines', () => {
  const session = new UthSession(1);
  (session as unknown as { table: UthTable }).table.stackNextHand(parseCards('8s 8d Ah 7c Kc 5h 2d 9s 3c'));
  session.deal();
  session.act('check');
  session.act('check');
  const card = (session.act('raise1x') as any).feedback;
  assert.match(card.notes[0], /a pair of nines/);
});

test('a list of hands that carry their own commas is separated with semicolons', () => {
  // You hold 4-4-4-A-A; the dealer beats it with three jacks, three aces, or four fours.
  const session = new UthSession(1);
  (session as unknown as { table: UthTable }).table.stackNextHand(parseCards('Ad 9s 7h 2s 4h 4d 4c As Jc'));
  session.deal();
  session.act('check');
  session.act('check');
  const [note] = (session.act('raise1x') as any).feedback.notes;
  assert.equal(
    note,
    'The dealer beats you only with a full house, three jacks and two fours; a full house, three aces and two fours; or four fours.',
  );
});

// --- Showdown -------------------------------------------------------------------------

test('showdown names both hands with their five cards, from the evaluator', () => {
  // The round's example: 4-4-4 on the board with A-J; the player holds an ace.
  const session = new UthSession(1);
  (session as unknown as { table: UthTable }).table.stackNextHand(parseCards('Ad 9s 7h 2s 4h 4d 4c As Jc'));
  session.deal();
  const view = session.act('raise4x') as any;
  const shown = view.showdown;
  assert.ok(shown, 'no showdown on a settled hand');
  assert.match(shown.player.words, /^You: a full house, three fours and two aces \(4-4-4-A-A\)$/);
  assert.match(shown.dealer.words, /^Dealer: three fours \(4-4-4-A-J\)$/);
  const dealt = [...view.hole, ...view.dealerHole, ...view.board].map((c: any) => c.code);
  for (const side of [shown.player, shown.dealer]) {
    assert.equal(side.cards.length, 5);
    for (const code of side.cards) assert.ok(dealt.includes(code));
  }
  // The dealer's five never include the player's hole cards, and vice versa.
  for (const card of view.hole) assert.ok(!shown.dealer.cards.includes(card.code));
  for (const card of view.dealerHole) assert.ok(!shown.player.cards.includes(card.code));
});

test('a fold has no showdown to name', () => {
  const session = new UthSession(1);
  (session as unknown as { table: UthTable }).table.stackNextHand(parseCards('7s 2d As Ad Qs Jh 3d 8c 5s'));
  session.deal();
  session.act('check');
  session.act('check');
  assert.equal((session.act('fold') as any).showdown, null);
});

// --- Equal-looking chips ----------------------------------------------------------------

function lift(file: string, name: string): (evs: number[]) => number[] {
  const source = readFileSync(join(HERE, '..', 'public', file), 'utf8');
  const from = source.indexOf(`function ${name}`);
  assert.ok(from > 0, `${name} is gone from ${file}`);
  const end = source.indexOf('\n}\n', from);
  return new Function(`${source.slice(from, end + 3)}\nreturn ${name};`)() as (evs: number[]) => number[];
}

test('chips that would print the same get a fourth decimal, in both games', () => {
  for (const [file, name] of [['ultimate.js', 'uthChipDigits'], ['app.js', 'chipDigits']] as const) {
    const digits = lift(file, name);
    // K4s: 3× +0.0193 and check +0.0189 both print +0.019.
    assert.deepEqual(digits([0.1170, 0.0193, 0.0189]), [3, 4, 4], `${file}: K4s`);
    assert.deepEqual(digits([-0.3848, -0.3845, -0.2]), [4, 4, 3], `${file}: J5s`);
    // Values that differ at three decimals, or are truly equal, stay at three.
    assert.deepEqual(digits([0.5, 0.4, -1]), [3, 3, 3]);
    assert.deepEqual(digits([0.5, 0.5, -1]), [3, 3, 3]);
  }
});

test('the K4s card actually shows 0.0193 and 0.0189', () => {
  const card = preflopCard('K4s');
  const evs = card.ranked.map((r: { ev: number }) => r.ev);
  const digits = lift('ultimate.js', 'uthChipDigits')(evs);
  const printed = card.ranked.map((r: { ev: number }, i: number) => Math.abs(r.ev).toFixed(digits[i]!));
  assert.ok(printed.includes('0.0193') && printed.includes('0.0189'), printed.join(' '));
});
