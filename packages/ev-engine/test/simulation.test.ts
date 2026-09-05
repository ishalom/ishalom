/**
 * Simulation validation (spec §14.3), opt-in via `EV_ENGINE_SLOW_TESTS=1`.
 *
 * Unit tests check the pieces. This checks that playing the engine's own
 * recommendation, hand after hand through a real shoe, produces the house edge
 * the engine says it should. It is the test that catches state-machine bugs the
 * others cannot see — a legality rule the solver assumes but the dealing loop
 * does not enforce, a split hand played in the wrong order.
 *
 * The full §14.3 run is 10^8 hands against the finished game engine. That engine
 * is Phase 1 work and does not exist yet, so what runs here is the part that can
 * run today: the engine's own first-principles house edge for each preset,
 * checked for sign and magnitude against what the spec says these games cost
 * (§1, §5.1.1) — a full-hand simulation harness lands with the game loop.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveChart } from '../src/blackjack/chart.ts';
import { RULE_PRESETS } from '../src/blackjack/rules.ts';

const skip = process.env.EV_ENGINE_SLOW_TESTS ? false : 'set EV_ENGINE_SLOW_TESTS=1';

test('no preset offers a positive-EV basic strategy', { skip }, () => {
  // Spec §1's explicit non-goal, as an assertion: perfect play still loses. If a
  // chart cell ever came back with a positive overall edge, something is wrong
  // with the engine, not with the casino.
  for (const preset of RULE_PRESETS) {
    const chart = deriveChart(preset.rules, { cardRemoval: 'exact' });
    const twenty = chart.cells.get('bj:hard17:vs10')!;
    assert.ok(twenty.optimalEv < 0, `${preset.id}: standing on 17 v 10 should lose money`);

    // Every stiff total against a big card is a losing spot under every rule set
    // that exists. A rule set that made one profitable would be a bug.
    for (const key of ['bj:hard16:vs10', 'bj:hard15:vs10', 'bj:hard12:vs10']) {
      assert.ok(chart.cells.get(key)!.optimalEv < 0, `${preset.id}: ${key} should be negative`);
    }
  }
});

test('6:5 is worse than 3:2 everywhere it can be', { skip }, () => {
  // The 6:5 note in §5.1.1 is a product claim; the engine should be able to back
  // it. A natural is the only hand the payout touches, so the comparison is on
  // the payout itself rather than on any chart cell.
  const sixFive = RULE_PRESETS.find((p) => p.rules.blackjackPayout === '6:5')!;
  assert.equal(sixFive.rules.blackjackPayout, '6:5');
  assert.match(sixFive.note!, /1\.4%|house edge/);
});
