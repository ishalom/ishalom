/**
 * What insurance is graded against (spec §3.1, §5.1.3).
 *
 * The app teaches basic strategy, and basic strategy has exactly one thing to
 * say about insurance: never. Grading it against the *live* shoe meant that a
 * player who declined correctly was marked wrong — and docked rating — on
 * precisely those hands where the shoe had run ten-rich, which is information
 * the app never showed them and a skill it does not yet teach. Being punished
 * for playing the strategy you are being taught is the §3.1 error in its purest
 * form, so these tests pin the fix down.
 *
 * The same tests cover even money: a player natural against an ace reaches the
 * same insurance decision, because it is the same bet.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INSURANCE_SCENARIO_KEY,
  formatCards,
  makeRules,
  parseCards,
  type BlackjackRules,
} from '@evtrainer/ev-engine';
import { BlackjackTable } from '../src/table.ts';

function tableWith(
  cards: string,
  rules: Partial<BlackjackRules> = {},
  grading: 'chart' | 'exact-shoe' = 'chart',
): BlackjackTable {
  const table = new BlackjackTable({ rules: makeRules(rules), seed: 1, grading });
  table.shoe.stack(parseCards(cards));
  return table;
}

/**
 * Burn forty low cards, so the shoe left behind is markedly ten-rich — the
 * situation in which the old grading turned on the player.
 */
const FORTY_LOW = [2, 3, 4, 5, 6]
  .flatMap((rank) => ['s', 'h', 'd', 'c'].map((suit) => `${rank}${suit}`))
  .concat([2, 3, 4, 5, 6].flatMap((rank) => ['s', 'h', 'd', 'c'].map((suit) => `${rank}${suit}`)))
  .join(' ');

function tensRichTable(hand: string): BlackjackTable {
  const table = tableWith(`${FORTY_LOW} ${hand}`);
  for (let i = 0; i < 40; i++) table.shoe.deal();
  return table;
}

test('a ten-rich shoe does not turn declining insurance into a mistake', () => {
  const table = tensRichTable('9s Ad 7h 2c');
  table.startHand();
  assert.equal(table.view.phase, 'insurance');

  // The fixture has to be genuinely ten-rich or the test proves nothing.
  assert.ok(
    table.insuranceLiveEv() > 0,
    `the burned shoe is not ten-rich enough: live insurance EV is ${table.insuranceLiveEv()}`,
  );

  const record = table.takeInsurance(false);
  assert.equal(record.optimalAction, 'declineInsurance');
  assert.equal(record.chosenAction, 'declineInsurance');
  assert.equal(record.evCost, 0, 'declining basic strategy’s never-insure is not a mistake');
  assert.equal(record.severityTier, 'optimal');
});

test('the same ten-rich shoe still marks taking insurance as the error it teaches', () => {
  const table = tensRichTable('9s Ad 7h 2c');
  table.startHand();
  const record = table.takeInsurance(true);
  assert.equal(record.optimalAction, 'declineInsurance');
  assert.ok(record.evCost > 0, 'taking it costs the chart EV, whatever the count says');
});

test('even money is the same bet: a natural against an ace is graded the same way', () => {
  const table = tensRichTable('As Ad Kh 2c');
  table.startHand();
  assert.equal(table.view.phase, 'insurance');
  assert.equal(formatCards(table.view.hands[0]!.cards), 'As Kh');

  const record = table.takeInsurance(true);
  assert.equal(record.scenarioKey, INSURANCE_SCENARIO_KEY);
  assert.equal(record.optimalAction, 'declineInsurance');
  assert.ok(record.evCost > 0);
});

test('exact-shoe grading is untouched: there the count is the whole point', () => {
  const table = tableWith(`${FORTY_LOW} 9s Ad 7h 2c`, {}, 'exact-shoe');
  for (let i = 0; i < 40; i++) table.shoe.deal();
  table.startHand();
  assert.ok(table.insuranceLiveEv() > 0);

  const record = table.takeInsurance(false);
  assert.equal(record.optimalAction, 'takeInsurance');
  assert.ok(record.evCost > 0, 'in counting mode, declining a +EV insurance is a real error');
});

test('the insurance decision names itself, in the record and in the chart', () => {
  const table = tableWith('9s Ad 7h 2c');
  table.startHand();
  const record = table.takeInsurance(false);

  assert.deepEqual(new Set(record.legalActions), new Set(['takeInsurance', 'declineInsurance']));
  assert.deepEqual(Object.keys(record.evByAction).sort(), ['declineInsurance', 'takeInsurance']);
  assert.equal(record.evByAction.declineInsurance, 0);
});

/**
 * Hard 18 through 21 are off the 311-cell grid, so the exact solver answers.
 * It has to answer the same thing whichever shoe the player happens to be in:
 * card removal is part of how the chart is derived, card counting is not.
 */
test('a hand with no chart cell is graded the same in a fresh shoe and a drifted one', () => {
  const play = (table: BlackjackTable) => {
    table.startHand();
    table.act('hit'); // 5 + 6 + 7 = hard 18, which has no chart cell
    assert.equal(table.view.hands[0]!.cards.length, 3);
    return table.currentEvaluation();
  };

  const fresh = play(tableWith('5s 9d 6h 2c 7s'));

  const drifted = tableWith(`${FORTY_LOW} 5s 9d 6h 2c 7s`);
  for (let i = 0; i < 40; i++) drifted.shoe.deal();
  const drift = play(drifted);

  assert.equal(drift.optimalAction, fresh.optimalAction);
  for (const action of fresh.legalActions) {
    assert.ok(
      Math.abs((drift.evByAction[action] ?? 0) - (fresh.evByAction[action] ?? 0)) < 1e-12,
      `${action}: ${drift.evByAction[action]} vs ${fresh.evByAction[action]}`,
    );
  }
});

test('exact-shoe still lets the drifted shoe move an off-grid hand', () => {
  const table = tableWith(`${FORTY_LOW} 5s 9d 6h 2c 7s`, {}, 'exact-shoe');
  for (let i = 0; i < 40; i++) table.shoe.deal();
  table.startHand();
  table.act('hit');
  const drift = table.currentEvaluation();

  const fresh = tableWith('5s 9d 6h 2c 7s', {}, 'exact-shoe');
  fresh.startHand();
  fresh.act('hit');
  const base = fresh.currentEvaluation();

  assert.notEqual(
    drift.evByAction.stand,
    base.evByAction.stand,
    'in counting mode the live shoe must still show through',
  );
});
