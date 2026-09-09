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
