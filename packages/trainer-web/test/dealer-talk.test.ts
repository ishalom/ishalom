/**
 * What the dealer says when a hand resolves.
 *
 * She used to restate the verdict — "Stand. That's the play." — directly above
 * a card that said the same thing in more detail, which made her a scoreboard
 * reading itself out rather than someone dealing cards.
 *
 * Now she calls the hand, the way a dealer actually does: what she made, who
 * took it, whether the bet stays up. The rule this protects is §3.1. The grade
 * belongs to the decision and the table talk belongs to the cards, and if the
 * two ever speak in one voice a player starts hearing "you played well" in a
 * hand that merely won.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { t, type Locale } from '../src/i18n.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Lift `tableTalk` out of the client script, so this tests what ships. */
function loadTableTalk(locale: Locale): (view: unknown) => string {
  const source = readFileSync(join(HERE, '..', 'public', 'app.js'), 'utf8');
  const from = source.indexOf('function tableTalk');
  assert.ok(from > 0, 'tableTalk is gone from app.js');
  const end = source.indexOf('\n}\n', from);
  assert.ok(end > from, 'could not find the end of tableTalk');

  return new Function(
    'T',
    `${source.slice(from, end + 3)}\nreturn tableTalk;`,
  )((key: string, params?: Record<string, string | number>) => t(locale, key, params ?? {})) as (
    view: unknown,
  ) => string;
}

const say = loadTableTalk('en');
const sayHe = loadTableTalk('he');

/** A settled table, described only by what the screen would be showing. */
function settled(options: {
  player: number[];
  cards?: number;
  dealer: number | null;
  net: number;
  surrendered?: boolean;
}) {
  return {
    phase: 'settled',
    hands: options.player.map((total) => ({
      total,
      cards: new Array(options.cards ?? (total > 21 ? 3 : 2)).fill({ rank: 'x' }),
      surrendered: Boolean(options.surrendered),
    })),
    dealer: { total: options.dealer },
    netUnits: options.net,
  };
}

test('she calls a bust before anything else', () => {
  assert.equal(say(settled({ player: [24], dealer: null, net: -1 })), 'Too many.');
  // Even when she went on to break as well: the player was already out, and
  // "and I break, yours" would be a lie about who won.
  assert.equal(say(settled({ player: [23], dealer: 25, net: -1 })), 'Too many.');
});

test('she says when she breaks', () => {
  assert.equal(say(settled({ player: [18], dealer: 24, net: 1 })), 'And I break. Yours.');
});

test('a natural is called as one, and only when it is one', () => {
  assert.equal(
    say(settled({ player: [21], cards: 2, dealer: 20, net: 1.5 })),
    'Blackjack. Pays three to two.',
  );
  // Twenty-one made from three cards is not a blackjack, and neither is
  // twenty-one on one half of a split.
  assert.equal(say(settled({ player: [21], cards: 3, dealer: 20, net: 1 })), '21 against my 20. Yours.');
  assert.equal(say(settled({ player: [21, 19], cards: 2, dealer: 20, net: 1 })), 'Those are good. Paying you.');
});

test('the totals she names are the ones on the table', () => {
  assert.equal(say(settled({ player: [20], dealer: 18, net: 1 })), '20 against my 18. Yours.');
  assert.equal(say(settled({ player: [17], dealer: 19, net: -1 })), '19 here. That one is mine.');
});

test('a push and a surrender each get their own line', () => {
  assert.equal(say(settled({ player: [19], dealer: 19, net: 0 })), 'Push — your bet stays up.');
  assert.equal(
    say(settled({ player: [16], dealer: 20, net: -0.5, surrendered: true })),
    'Half back. On to the next.',
  );
});

test('she never mentions whether the play was right', () => {
  /*
   * The whole point of the change. Any of these words in her mouth would put
   * the grade and the result in one voice, which is what §3.1 exists to keep
   * apart — and the card above the buttons is already saying them.
   */
  const forbidden = /correct|right|wrong|mistake|blunder|cost|should|best play|error/i;
  const endings = [
    settled({ player: [24], dealer: null, net: -1 }),
    settled({ player: [18], dealer: 24, net: 1 }),
    settled({ player: [21], cards: 2, dealer: 20, net: 1.5 }),
    settled({ player: [19], dealer: 19, net: 0 }),
    settled({ player: [20], dealer: 18, net: 1 }),
    settled({ player: [17], dealer: 19, net: -1 }),
    settled({ player: [16], dealer: 20, net: -0.5, surrendered: true }),
    settled({ player: [20, 18], dealer: 19, net: -1 }),
  ];
  for (const view of endings) {
    for (const line of [say(view), sayHe(view)]) {
      assert.ok(line.length > 0, 'the dealer said nothing at all');
      assert.doesNotMatch(line, forbidden, `she is grading the play: "${line}"`);
    }
  }
});

test('every ending has a Hebrew line, and it is not the English one', () => {
  const endings = [
    settled({ player: [24], dealer: null, net: -1 }),
    settled({ player: [18], dealer: 24, net: 1 }),
    settled({ player: [21], cards: 2, dealer: 20, net: 1.5 }),
    settled({ player: [19], dealer: 19, net: 0 }),
    settled({ player: [20], dealer: 18, net: 1 }),
    settled({ player: [17], dealer: 19, net: -1 }),
    settled({ player: [16], dealer: 20, net: -0.5, surrendered: true }),
  ];
  for (const view of endings) {
    const he = sayHe(view);
    assert.notEqual(he, say(view), `still English: "${he}"`);
    // The bug that started this: a stray English clause inside a Hebrew line.
    assert.doesNotMatch(he, /[A-Za-z]{3,}/, `English words left in: "${he}"`);
  }
});
