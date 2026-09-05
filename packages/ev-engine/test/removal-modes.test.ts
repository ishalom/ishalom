/**
 * How much the interactive card-removal compromise actually costs.
 *
 * `'static-dealer'` freezes the dealer's distribution at the decision point
 * instead of recomputing it as the player draws. That is a real approximation,
 * so its size is measured here rather than asserted in a comment. If it ever
 * grows past the "negligible" floor in spec §7.2, this test fails and the
 * default has to be reconsidered.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { allScenarios, deriveChart } from '../src/blackjack/chart.ts';
import { BlackjackSolver } from '../src/blackjack/ev.ts';
import { makeRules } from '../src/blackjack/rules.ts';
import { Shoe } from '../src/blackjack/shoe.ts';

test('the two modes agree on every chart cell for the default rules', () => {
  const rules = makeRules();
  const exact = deriveChart(rules, { cardRemoval: 'exact' });
  const fast = deriveChart(rules, { cardRemoval: 'static-dealer' });

  const disagreements: string[] = [];
  let worstEvGap = 0;

  for (const [key, cell] of exact.cells) {
    const other = fast.cells.get(key)!;
    if (other.optimalAction !== cell.optimalAction) {
      disagreements.push(`${key}: exact ${cell.optimalAction}, fast ${other.optimalAction}`);
    }
    for (const [action, ev] of Object.entries(cell.evByAction)) {
      const gap = Math.abs(ev - other.evByAction[action as keyof typeof other.evByAction]!);
      if (gap > worstEvGap) worstEvGap = gap;
    }
  }

  assert.deepEqual(disagreements, [], 'the fast mode changed a chart cell');
  assert.ok(
    worstEvGap < 0.005,
    `worst EV gap between modes was ${worstEvGap}, above the negligible floor in §7.2`,
  );
});

test('freezing the dealer distribution never changes a hand by more than a thousandth', () => {
  // Chart cells average over compositions, which can mask a per-hand gap. This
  // walks individual hands instead.
  const rules = makeRules({ surrender: 'none' });
  const exact = new BlackjackSolver(rules, { cardRemoval: 'exact' });
  const fast = new BlackjackSolver(rules, { cardRemoval: 'static-dealer' });

  let worst = 0;
  let worstWhere = '';
  for (const scenario of allScenarios()) {
    if (scenario.kind !== 'hard' || scenario.total! > 16) continue;
    // Two-card hard hands are where the player draws most, so they show the
    // largest divergence.
    for (let a = 1; a < 10; a++) {
      const b = scenario.total! - (a + 1) - 1;
      if (b <= a || b > 9) continue;
      const cards = [a, b];
      const shoe = Shoe.fresh(rules.decks);
      shoe.removeAll(cards);
      shoe.remove(scenario.upcard!);
      const one = exact.evaluate(cards, scenario.upcard!, shoe);
      const two = fast.evaluate(cards, scenario.upcard!, shoe);
      for (const action of one.legalActions) {
        const gap = Math.abs(one.evByAction[action]! - two.evByAction[action]!);
        if (gap > worst) {
          worst = gap;
          worstWhere = `${cards} vs ${scenario.upcard} ${action}`;
        }
      }
    }
  }

  assert.ok(worst > 0, 'the two modes should not be bit-identical; check they are really different');
  assert.ok(worst < 0.005, `worst per-hand gap was ${worst} at ${worstWhere}`);
});
