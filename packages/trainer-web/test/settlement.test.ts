/**
 * Every way a hand can end, and what the dealer says about it.
 *
 * Round 2 found one of these wrong by accident: two naturals is a push, and she
 * announced a three-to-two payout. That was reason enough to walk the rest, and
 * walking them found three more — a promised payout that the 6:5 table does not
 * make, "and I break, yours" on a split where the player was level, and a line
 * that could only ever have printed "I make ?.".
 *
 * So every branch is exercised here from a **real settled table**, in both
 * languages. Hand-built view fixtures are how a message drifts out of step with
 * the engine that produces the situation it describes; these cannot, because
 * the engine produces them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCards } from '@evtrainer/ev-engine';
import type { BlackjackTable } from '@evtrainer/game-engine';

import { catalogue, t, type Locale } from '../src/i18n.ts';
import { TrainerSession } from '../src/session.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES: Locale[] = ['en', 'he'];

/** Lift `tableTalk` and its helper out of the page script. */
function loadTableTalk(locale: Locale): (view: unknown) => string {
  const source = readFileSync(join(HERE, '..', 'public', 'app.js'), 'utf8');
  const slice = (name: string) => {
    const from = source.indexOf(`function ${name}`);
    assert.ok(from > 0, `${name} is gone from app.js`);
    const end = source.indexOf('\n}\n', from);
    assert.ok(end > from, `could not find the end of ${name}`);
    return source.slice(from, end + 3);
  };
  return new Function(
    'T',
    `${slice('dealerNatural')}\n${slice('tableTalk')}\nreturn tableTalk;`,
  )((key: string, params?: Record<string, string | number>) => t(locale, key, params ?? {})) as (
    view: unknown,
  ) => string;
}

interface Settled {
  view: {
    phase: string;
    netUnits: number;
    hands: Array<{ total: number; cards: unknown[]; surrendered: boolean }>;
    dealer: { total: number | null; cards: unknown[]; hidden: boolean };
    ruleSet: { blackjackPayout: string };
  };
}

/**
 * Deal the named cards, play the named actions, and hand back the settled view
 * the page would be drawing.
 */
function settle(
  cards: string,
  actions: string[] = [],
  preset = 'vegas-strip-6d-s17',
): Settled['view'] {
  const session = new TrainerSession(preset, 11);
  const table = (session as unknown as { table: BlackjackTable }).table;
  table.shoe.stack(parseCards(cards));
  session.deal();
  const phase = () => (session.view as { phase: string }).phase;
  if (phase() === 'insurance') session.insurance(false);
  for (const action of actions) {
    if (phase() !== 'player') break;
    session.act(action as never);
  }
  const view = session.view as Settled['view'];
  assert.equal(view.phase, 'settled', `the hand did not settle: ${cards} ${actions.join(',')}`);
  return view;
}

/**
 * The eleven endings, each with the cards that produce it and what the line has
 * to be true of. `check` is given the settled view, so a message that contradicts
 * the table fails here rather than on Idan's screen.
 */
const ENDINGS: Array<{
  key: string;
  what: string;
  view: () => Settled['view'];
  check?: (view: Settled['view']) => void;
}> = [
  {
    key: 'dealer.surrendered',
    what: 'the player surrendered',
    view: () => settle('7s Th 6d 8c', ['surrender']),
    check: (v) => assert.equal(v.netUnits, -0.5, 'surrender did not pay half'),
  },
  {
    key: 'dealer.bothNaturals',
    what: 'both sides hold a natural',
    view: () => settle('As Ad Kh Kc'),
    check: (v) => assert.equal(v.netUnits, 0, 'two naturals did not push'),
  },
  {
    key: 'dealer.dealerNatural',
    what: 'the dealer holds a natural and the player does not',
    view: () => settle('5s Ad Kh Kc'),
    check: (v) => {
      assert.equal(v.dealer.total, 21);
      assert.equal(v.dealer.cards.length, 2);
      assert.ok(v.netUnits < 0);
    },
  },
  {
    key: 'dealer.blackjack',
    what: 'the player holds a natural',
    view: () => settle('As 6d Kh 9c'),
    check: (v) => assert.equal(v.netUnits, 1.5, 'a natural did not pay 3:2'),
  },
  {
    key: 'dealer.youBust',
    what: 'every player hand is over twenty-one',
    view: () => settle('Ts 6d 6h 9c 9s', ['hit']),
    check: (v) => assert.ok(v.hands.every((h) => h.total > 21)),
  },
  {
    key: 'dealer.iBust',
    what: 'one hand, and the dealer broke',
    view: () => settle('Ts 6d 9h 8c 9s', ['stand']),
    check: (v) => {
      assert.equal(v.hands.length, 1);
      assert.ok((v.dealer.total ?? 0) > 21, `the dealer made ${v.dealer.total}`);
      assert.ok(v.netUnits > 0);
    },
  },
  {
    key: 'dealer.push',
    what: 'the money comes back',
    view: () => settle('Ts 9d 9h Tc', ['stand']),
    check: (v) => assert.equal(v.netUnits, 0),
  },
  {
    key: 'dealer.youWin',
    what: 'one hand beat the dealer',
    view: () => settle('Ts 9d 9h 8c', ['stand']),
    check: (v) => {
      assert.equal(v.hands.length, 1);
      assert.ok(v.netUnits > 0);
    },
  },
  {
    key: 'dealer.iWin',
    what: 'one hand lost to the dealer',
    view: () => settle('Ts 9d 7h 9c', ['stand']),
    check: (v) => {
      assert.equal(v.hands.length, 1);
      assert.ok(v.netUnits < 0);
    },
  },
  {
    key: 'dealer.youWinPlain',
    what: 'a split, and the player is up on it',
    view: () => settle('9s 6d 9h 8c Th Td', ['split', 'stand', 'stand']),
    check: (v) => {
      assert.ok(v.hands.length > 1, 'the split did not happen');
      assert.ok(v.netUnits > 0);
    },
  },
  {
    key: 'dealer.iWinPlain',
    what: 'a split, and the player is down on it',
    view: () => settle('9s Td 9h 9c 8h 8d', ['split', 'stand', 'stand']),
    check: (v) => {
      assert.ok(v.hands.length > 1, 'the split did not happen');
      assert.ok(v.netUnits < 0);
    },
  },
];

for (const ending of ENDINGS) {
  test(`settlement: ${ending.what}`, () => {
    const view = ending.view();
    ending.check?.(view);
    for (const locale of LOCALES) {
      const said = loadTableTalk(locale)(view);
      const expected = t(locale, ending.key, {
        player: view.hands[0]?.total ?? 0,
        dealer: view.dealer.total ?? 0,
        pays: t(locale, view.ruleSet.blackjackPayout === '6:5' ? 'dealer.pays65' : 'dealer.pays32'),
      });
      assert.equal(said, expected, `${locale}: expected ${ending.key}`);
      assert.ok(said.trim().length > 0, `${locale}: she said nothing`);
    }
    // The two languages must not be the same string.
    assert.notEqual(loadTableTalk('he')(view), loadTableTalk('en')(view));
  });
}

test('all eleven endings are covered, and none is left unreachable', () => {
  const source = readFileSync(join(HERE, '..', 'public', 'app.js'), 'utf8');
  const from = source.indexOf('function tableTalk');
  const body = source.slice(from, source.indexOf('\n}\n', from));
  const spoken = new Set([...body.matchAll(/T\('(dealer\.[A-Za-z0-9]+)'/g)].map((m) => m[1]!));
  // `pays32`/`pays65` are the payout's name, not an ending, so they are folded
  // into the ending that quotes them.
  spoken.delete('dealer.pays32');
  spoken.delete('dealer.pays65');

  const covered = new Set(ENDINGS.map((e) => e.key));
  // The two plain lines double as the unreachable-dealer guard, so every key
  // the function can say is one of the eleven this file drives.
  assert.deepEqual(
    [...spoken].filter((key) => !covered.has(key)).sort(),
    [],
    'a settlement message exists that no test reaches',
  );
  assert.equal(covered.size, 11, `${covered.size} endings, expected 11`);
});

test('a 6:5 table is not promised three to two', () => {
  /*
   * The app ships `single-deck-6-5` and its own note calls the rule expensive.
   * The dealer used to announce "Pays three to two" on it — the one sentence in
   * the app that was about money and wrong about it.
   */
  const view = settle('As 6d Kh 9c', [], 'single-deck-6-5');
  assert.equal(view.ruleSet.blackjackPayout, '6:5');
  assert.equal(view.netUnits, 1.2, 'the engine did not pay 6:5');

  assert.match(loadTableTalk('en')(view), /six to five/);
  assert.doesNotMatch(loadTableTalk('en')(view), /three to two/);
  assert.ok(loadTableTalk('he')(view).includes('6 ל-5'));

  const normal = settle('As 6d Kh 9c');
  assert.match(loadTableTalk('en')(normal), /three to two/);
});

test('a split where the dealer broke but the player is level is called a push', () => {
  /*
   * One hand busts, the other stands, the dealer breaks: the player is level,
   * and "And I break. Yours." was neither a push nor true.
   */
  const view = settle('8s 6d 8h 9c 9h 9d 5s', ['split', 'hit', 'stand']);
  assert.equal(view.hands.length, 2, 'the split did not happen');
  assert.ok(view.hands.some((hand) => hand.total > 21), 'no hand busted');
  assert.ok(view.hands.some((hand) => hand.total <= 21), 'every hand busted');
  assert.ok((view.dealer.total ?? 0) > 21, `the dealer made ${view.dealer.total}`);
  assert.equal(view.netUnits, 0, 'the fixture no longer produces a level split');

  for (const locale of LOCALES) {
    assert.equal(loadTableTalk(locale)(view), t(locale, 'dealer.push'));
  }
});

test('every settlement key exists in both languages', () => {
  const keys = [...ENDINGS.map((e) => e.key), 'dealer.pays32', 'dealer.pays65'];
  for (const locale of LOCALES) {
    for (const key of keys) assert.ok(catalogue(locale)[key], `${locale} has no ${key}`);
  }
  // The dead one is gone: it could only ever have printed "I make ?.".
  for (const locale of LOCALES) {
    assert.equal(catalogue(locale)['dealer.dealerHas'], undefined);
  }
});
