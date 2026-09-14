import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INSURANCE_SCENARIO_KEY,
  parseScenarioKey,
  scenarioForHand,
  scenarioKey,
  scenarioKeyForHand,
  upcardLabel,
} from '../src/blackjack/scenario.ts';
import { allScenarios } from '../src/blackjack/chart.ts';
import { ACE, parseRank, parseRanks, TEN } from '../src/blackjack/shoe.ts';

test('keys use the format the spec gives', () => {
  assert.equal(scenarioKey({ kind: 'hard', total: 16, upcard: TEN }), 'bj:hard16:vs10');
  assert.equal(scenarioKey({ kind: 'pair', pairRank: ACE, upcard: parseRank('6') }), 'bj:pairA:vs6');
  assert.equal(scenarioKey({ kind: 'soft', total: 18, upcard: parseRank('9') }), 'bj:soft18:vs9');
  assert.equal(scenarioKey({ kind: 'insurance' }), INSURANCE_SCENARIO_KEY);
});

test('upcard labels are stable', () => {
  assert.equal(upcardLabel(ACE), 'A');
  assert.equal(upcardLabel(TEN), '10');
  assert.equal(upcardLabel(parseRank('7')), '7');
});

test('every scenario key round-trips through the parser', () => {
  for (const scenario of allScenarios()) {
    const key = scenarioKey(scenario);
    assert.deepEqual(parseScenarioKey(key), scenario, key);
  }
});

test('all 311 keys are distinct', () => {
  const keys = allScenarios().map(scenarioKey);
  assert.equal(keys.length, 311);
  assert.equal(new Set(keys).size, 311);
});

test('a pair maps to its pair row only while splitting is available', () => {
  const upcard = parseRank('6');
  const eights = parseRanks('8 8');
  assert.equal(scenarioKeyForHand(eights, upcard, true), 'bj:pair8:vs6');
  assert.equal(
    scenarioKeyForHand(eights, upcard, false),
    'bj:hard16:vs6',
    'out of splits, the player is facing a plain sixteen and should be drilled as such',
  );
});

test('soft and hard hands land in the right rows', () => {
  const upcard = parseRank('9');
  assert.deepEqual(scenarioForHand(parseRanks('A 7'), upcard, false), {
    kind: 'soft',
    total: 18,
    upcard,
  });
  assert.deepEqual(scenarioForHand(parseRanks('A 7 5'), upcard, false), {
    kind: 'hard',
    total: 13,
    upcard,
  });
  assert.deepEqual(scenarioForHand(parseRanks('K Q'), upcard, false), {
    kind: 'hard',
    total: 20,
    upcard,
  });
});

test('nonsense keys are rejected rather than silently accepted', () => {
  for (const bad of ['', 'bj:hard16', 'bj:hard16:vs1', 'uth:preflop:AKs', 'bj:weird9:vs6']) {
    assert.throws(() => parseScenarioKey(bad), `${JSON.stringify(bad)} should not parse`);
  }
});
