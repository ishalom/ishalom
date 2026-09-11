/**
 * The browser build is the same engine, not a copy of it.
 *
 * `scripts/bundle.ts` folds the modules into one scope so a page with no server
 * can run them. That is a real transformation — imports dropped, `export`
 * erased, everything concatenated — and the failure it could produce is the
 * worst kind: a shareable build that plays a slightly different game from the
 * one 194 tests are pointed at.
 *
 * So the bundle is evaluated here and made to answer the same questions as the
 * modules, across every scenario the chart covers. Not a spot check: if any cell
 * disagrees by so much as a float, this fails.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bundle } from '../scripts/bundle.ts';
import {
  BlackjackSolver,
  Shoe,
  allScenarios,
  deriveChart,
  getPreset,
  houseEdge,
  parseRanks,
  parseRank,
  RULE_PRESETS,
} from '@evtrainer/ev-engine';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Evaluate the bundle in its own scope and hand back the names under test. */
function loadBundle(): Record<string, any> {
  const code = bundle([join(SRC, 'session.ts')]);

  // A browser has no module loader and no Node globals. If the bundle reached
  // for either, it would work here and fail on someone's phone.
  for (const forbidden of ['import.meta', 'require(', 'node:fs', 'node:path', '__dirname']) {
    assert.ok(!code.includes(forbidden), `the bundle reaches for ${forbidden}`);
  }

  const factory = new Function(
    `${code}\nreturn { BlackjackSolver, Shoe, deriveChart, houseEdge, getPreset,` +
      ` parseRanks, parseRank, allScenarios, TrainerSession, explain, t, catalogue };`,
  );
  return factory() as Record<string, any>;
}

const B = loadBundle();

test('the bundle exposes what the page needs to run a session', () => {
  for (const name of ['BlackjackSolver', 'TrainerSession', 'explain', 'deriveChart', 't']) {
    assert.equal(typeof B[name], 'function', `${name} did not survive bundling`);
  }
});

test('every chart cell agrees, exactly', () => {
  const preset = getPreset('vegas-strip-6d-s17');
  const mine = deriveChart(preset.rules, { cardRemoval: 'static-dealer' });
  const theirs = B.deriveChart(preset.rules, { cardRemoval: 'static-dealer' });

  assert.equal(theirs.cells.size, mine.cells.size);
  for (const [key, cell] of mine.cells) {
    const other = theirs.cells.get(key);
    assert.ok(other, `${key} is missing from the bundle's chart`);
    assert.equal(other.optimalAction, cell.optimalAction, `${key} plays differently`);
    for (const [action, ev] of Object.entries(cell.evByAction)) {
      assert.equal(other.evByAction[action], ev, `${key} ${action} differs`);
    }
  }
});

test('the exact solver agrees on live hands, card removal and all', () => {
  const rules = getPreset('vegas-strip-6d-s17').rules;
  const mine = new BlackjackSolver(rules, { cardRemoval: 'exact' });
  const theirs = new B.BlackjackSolver(rules, { cardRemoval: 'exact' });

  const hands = ['T 5', 'A A', '8 8', 'A 7', '9 2', 'T T', '7 7', 'A 2', '6 6', '5 4 3'];
  let compared = 0;
  for (const hand of hands) {
    for (const up of ['2', '5', '6', '9', '10', 'A']) {
      const cards = parseRanks(hand);
      const upcard = parseRank(up);

      const a = Shoe.fresh(6);
      a.removeAll(cards);
      a.remove(upcard);
      const b = B.Shoe.fresh(6);
      b.removeAll(B.parseRanks(hand));
      b.remove(B.parseRank(up));

      const one = mine.evaluate(cards, upcard, a);
      const two = theirs.evaluate(B.parseRanks(hand), B.parseRank(up), b);
      assert.equal(two.optimalAction, one.optimalAction, `${hand} vs ${up}`);
      assert.equal(two.optimalEv, one.optimalEv, `${hand} vs ${up} EV`);
      compared++;
    }
  }
  assert.equal(compared, hands.length * 6);
});

test('the house edge comes out the same for every preset', () => {
  for (const preset of RULE_PRESETS) {
    assert.equal(
      B.houseEdge(preset.rules).percent,
      houseEdge(preset.rules).percent,
      `${preset.id} edge differs`,
    );
  }
});

test('the scenario list is the same length it is here', () => {
  assert.equal(B.allScenarios().length, allScenarios().length);
});

test('the language layer came across whole', () => {
  assert.equal(B.t('he', 'ui.deal'), 'חלק');
  assert.ok(Object.keys(B.catalogue('he')).length > 200);
});

test('a whole session runs through the bundle, insurance included', () => {
  /*
   * This is the test that was missing when the bundle first shipped.
   *
   * Every check above compares numbers, and numbers were never the problem: the
   * page threw `Composition is not defined`, because `import { Shoe as
   * Composition }` lost its rename when the imports were stripped. Ordinary
   * hands are graded from the chart and never reach that name, so the bug hid
   * until a dealer showed an ace — and then every button on the screen stopped
   * working at once.
   *
   * So this drives the bundled session the way a player does, until it has
   * actually taken and declined insurance. It exercises the paths a chart lookup
   * skips, which is where a bundling mistake can survive a suite of exact
   * agreement tests.
   */
  const B = loadBundle();
  const session = new B.TrainerSession('vegas-strip-6d-s17', 20260910);

  let insuranceOffered = 0;
  let handsPlayed = 0;

  // Both conditions, not either: insurance has to come up twice, and the walk
  // has to be long enough to reshuffle and to meet every hand shape.
  for (let deal = 0; deal < 900 && (insuranceOffered < 2 || handsPlayed < 150); deal++) {
    session.deal();
    let view = session.view;

    if (view.phase === 'insurance') {
      // Both answers, so neither branch can be the one that is never taken.
      session.insurance(insuranceOffered % 2 === 0);
      insuranceOffered++;
      view = session.view;
    }

    let guard = 0;
    while (view.phase === 'player' && guard++ < 30) {
      const legal = view.legalActions as string[];
      // Prefer the moves that recurse: a split and a double reach code an
      // all-standing walk never touches.
      const action =
        legal.includes('split') ? 'split' : legal.includes('double') ? 'double' : 'stand';
      session.act(action);
      view = session.view;
    }
    handsPlayed++;
  }

  assert.ok(insuranceOffered >= 2, `insurance never came up in 600 deals`);
  assert.ok(handsPlayed > 100, `only ${handsPlayed} hands played`);

  const stats = session.view.stats;
  assert.equal(stats.hands, handsPlayed);
  assert.ok(stats.decisions > 0);
  // The stack is arithmetic over settled hands and must stay exactly that.
  assert.equal(session.view.stack.balance, session.view.stack.start + stats.netUnits);
});

test('the bundler refuses a name nothing declares', () => {
  // The guard that turns the class of bug above into a failed build. Without
  // it, a renamed import silently vanishes and the page throws at runtime.
  assert.throws(
    () => bundle([join(SRC, '..', 'test', 'fixtures', 'dangling.ts')]),
    /refers to names nothing in it declares/,
  );
});
