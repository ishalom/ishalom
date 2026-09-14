/**
 * Spec §14.1, first bullet: dealer probability distributions.
 *
 * A dealer-distribution bug is the worst kind this codebase can have. It does
 * not crash, it does not look wrong, and it quietly poisons every EV downstream.
 * So the distribution is checked three independent ways:
 *
 *   1. against a second implementation that walks the problem forward instead of
 *      backward and re-derives hand values with its own code (`dealer-oracle`);
 *   2. against structural facts that follow from the rules — a distribution sums
 *      to one, H17 and S17 differ only where a soft 17 is reachable, card
 *      removal moves probabilities in the direction it must;
 *   3. against sampling, under `EV_ENGINE_SLOW_TESTS`, which shares no logic
 *      with either.
 *
 * `test/fixtures/published-strategy.ts` carries the published cross-check the
 * spec asks for in the form the literature is actually reliable in: whole basic
 * strategy grids, which are far more sensitive to a distribution error than any
 * single probability, and which `chart.test.ts` asserts cell for cell.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  conditionNoBlackjack,
  DEALER_17,
  DEALER_21,
  DEALER_BLACKJACK,
  DEALER_BUST,
  DealerSolver,
  describeDistribution,
} from '../src/blackjack/dealer.ts';
import { makeRules } from '../src/blackjack/rules.ts';
import { ACE, parseRank, Shoe, TEN, type BjRank } from '../src/blackjack/shoe.ts';
import { oracleDealerDistribution } from './helpers/dealer-oracle.ts';
import { simulateDealer } from './helpers/simulate.ts';

const UPCARDS: BjRank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
const upLabel = (u: BjRank) => (u === ACE ? 'A' : u === TEN ? '10' : String(u + 1));

function freshMinusUpcard(decks: number, upcard: BjRank): Shoe {
  const shoe = Shoe.fresh(decks);
  shoe.remove(upcard);
  return shoe;
}

test('matches an independently written oracle to floating-point precision', () => {
  for (const decks of [1, 2, 6, 8]) {
    for (const soft17 of ['S17', 'H17'] as const) {
      const solver = new DealerSolver(makeRules({ decks, soft17 }));
      for (const upcard of UPCARDS) {
        const shoe = freshMinusUpcard(decks, upcard);
        const mine = describeDistribution(solver.distribution(upcard, shoe));
        const theirs = oracleDealerDistribution(
          upcard,
          Array.from(shoe.counts),
          soft17 === 'H17',
        );
        for (const key of ['bust', 17, 18, 19, 20, 21, 'blackjack'] as const) {
          const a = mine[key as keyof typeof mine]!;
          const b = theirs[key as keyof typeof theirs];
          assert.ok(
            Math.abs(a - b) < 1e-12,
            `${decks}d ${soft17} up=${upLabel(upcard)} ${String(key)}: solver ${a} vs oracle ${b}`,
          );
        }
      }
    }
  }
});

test('the oracle still agrees once the shoe is heavily depleted', () => {
  // A full shoe is the easy case. Card removal is where the two implementations
  // could plausibly drift apart.
  const decks = 2;
  const solver = new DealerSolver(makeRules({ decks, soft17: 'H17' }));
  const upcard = parseRank('6');
  const shoe = freshMinusUpcard(decks, upcard);
  shoe.removeAll([TEN, TEN, TEN, TEN, TEN, ACE, ACE, 4, 4, 4, 8, 8]);

  const mine = describeDistribution(solver.distribution(upcard, shoe));
  const theirs = oracleDealerDistribution(upcard, Array.from(shoe.counts), true);
  for (const key of ['bust', 17, 18, 19, 20, 21] as const) {
    const a = mine[key as keyof typeof mine]!;
    const b = theirs[key as keyof typeof theirs];
    assert.ok(Math.abs(a - b) < 1e-12, `depleted shoe disagreed on ${String(key)}`);
  }
});

test('every distribution is a probability distribution', () => {
  for (const decks of [1, 6]) {
    for (const soft17 of ['S17', 'H17'] as const) {
      const solver = new DealerSolver(makeRules({ decks, soft17 }));
      for (const upcard of UPCARDS) {
        const dist = solver.distribution(upcard, freshMinusUpcard(decks, upcard));
        let sum = 0;
        for (const p of dist) {
          assert.ok(p >= 0 && p <= 1, 'probabilities stay in range');
          sum += p;
        }
        assert.ok(Math.abs(sum - 1) < 1e-12, `up=${upLabel(upcard)} summed to ${sum}`);
      }
    }
  }
});

test('a natural is possible exactly when the upcard can make one', () => {
  const solver = new DealerSolver(makeRules({ decks: 6 }));
  for (const upcard of UPCARDS) {
    const dist = solver.distribution(upcard, freshMinusUpcard(6, upcard));
    const p = dist[DEALER_BLACKJACK]!;
    if (upcard === ACE || upcard === TEN) assert.ok(p > 0, `up=${upLabel(upcard)} should allow a natural`);
    else assert.equal(p, 0, `up=${upLabel(upcard)} cannot make a natural`);
  }

  // A dealer ace makes a natural whenever the hole card is a ten: 96 tens among
  // the 311 cards the player cannot see.
  const dist = solver.distribution(ACE, freshMinusUpcard(6, ACE));
  assert.ok(Math.abs(dist[DEALER_BLACKJACK]! - 96 / 311) < 1e-12);
});

test('conditioning on no natural renormalises and leaves the shape alone', () => {
  const solver = new DealerSolver(makeRules({ decks: 6 }));
  const raw = solver.distribution(TEN, freshMinusUpcard(6, TEN));
  const conditioned = conditionNoBlackjack(raw);

  assert.equal(conditioned[DEALER_BLACKJACK], 0);
  let sum = 0;
  for (const p of conditioned) sum += p;
  assert.ok(Math.abs(sum - 1) < 1e-12);

  const scale = 1 / (1 - raw[DEALER_BLACKJACK]!);
  for (let i = DEALER_BUST; i <= DEALER_21; i++) {
    assert.ok(Math.abs(conditioned[i]! - raw[i]! * scale) < 1e-15);
  }
  assert.ok(conditioned[DEALER_BUST]! > raw[DEALER_BUST]!, 'removing natural mass lifts the rest');
});

test('H17 and S17 differ only where a soft 17 is reachable', () => {
  const s17 = new DealerSolver(makeRules({ decks: 6, soft17: 'S17' }));
  const h17 = new DealerSolver(makeRules({ decks: 6, soft17: 'H17' }));

  for (const upcard of UPCARDS) {
    const a = s17.distribution(upcard, freshMinusUpcard(6, upcard));
    const b = h17.distribution(upcard, freshMinusUpcard(6, upcard));
    // An upcard of 7, 8, 9 or 10 cannot reach a soft 17: the dealer would need an
    // ace plus that card, which is already 18 or more (or a natural).
    const softSeventeenReachable = upcard <= 5 || upcard === ACE;
    const identical = a.every((p, i) => Math.abs(p - b[i]!) < 1e-12);
    assert.equal(
      identical,
      !softSeventeenReachable,
      `up=${upLabel(upcard)} soft-17 reachability disagrees with the distributions`,
    );
  }

  // Where it does bite, hitting soft 17 must trade 17s for everything else.
  const a = s17.distribution(ACE, freshMinusUpcard(6, ACE));
  const b = h17.distribution(ACE, freshMinusUpcard(6, ACE));
  assert.ok(b[DEALER_17]! < a[DEALER_17]!, 'H17 makes fewer 17s');
  assert.ok(b[DEALER_BUST]! > a[DEALER_BUST]!, 'H17 busts more often');
});

test('card removal moves the distribution in the direction it must', () => {
  const solver = new DealerSolver(makeRules({ decks: 6, soft17: 'S17' }));
  const upcard = parseRank('6');

  const base = freshMinusUpcard(6, upcard);
  const baseline = solver.distribution(upcard, base)[DEALER_BUST]!;

  // Strip small cards: the dealer's stiff hand has fewer safe outs, so it busts
  // more. Strip tens: it busts less.
  const fewSmall = freshMinusUpcard(6, upcard);
  fewSmall.removeAll([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]);
  assert.ok(solver.distribution(upcard, fewSmall)[DEALER_BUST]! > baseline);

  const fewTens = freshMinusUpcard(6, upcard);
  for (let i = 0; i < 16; i++) fewTens.remove(TEN);
  assert.ok(solver.distribution(upcard, fewTens)[DEALER_BUST]! < baseline);
});

test('the solver leaves the shoe exactly as it found it', () => {
  const solver = new DealerSolver(makeRules({ decks: 6, soft17: 'H17' }));
  const shoe = freshMinusUpcard(6, ACE);
  const before = { key: shoe.key(), sig: shoe.sig, total: shoe.total };
  solver.distribution(ACE, shoe);
  assert.deepEqual({ key: shoe.key(), sig: shoe.sig, total: shoe.total }, before);
});

test('the memo cache does not change the answer', () => {
  const rules = makeRules({ decks: 6, soft17: 'H17' });
  const warm = new DealerSolver(rules);
  for (const upcard of UPCARDS) warm.distribution(upcard, freshMinusUpcard(6, upcard));

  for (const upcard of UPCARDS) {
    const cold = new DealerSolver(rules).distribution(upcard, freshMinusUpcard(6, upcard));
    const hot = warm.distribution(upcard, freshMinusUpcard(6, upcard));
    for (let i = 0; i < cold.length; i++) assert.equal(cold[i], hot[i]);
  }
});

test(
  'matches sampling',
  { skip: process.env.EV_ENGINE_SLOW_TESTS ? false : 'set EV_ENGINE_SLOW_TESTS=1' },
  () => {
    const decks = 6;
    const hands = 4_000_000;
    for (const soft17 of ['S17', 'H17'] as const) {
      const solver = new DealerSolver(makeRules({ decks, soft17 }));
      for (const upcard of UPCARDS) {
        const exact = solver.distribution(upcard, freshMinusUpcard(decks, upcard));
        const sampled = simulateDealer(upcard, decks, soft17 === 'H17', hands, 0x9e3779b9 + upcard);
        for (let i = 0; i < exact.length; i++) {
          const p = exact[i]!;
          // Four standard errors, plus a floor so that near-zero cells do not
          // fail on a single stray sample.
          const tolerance = 4 * Math.sqrt(Math.max(p * (1 - p), 1e-6) / hands);
          assert.ok(
            Math.abs(sampled[i]! - p) < tolerance,
            `${soft17} up=${upLabel(upcard)} bucket ${i}: exact ${p}, sampled ${sampled[i]}`,
          );
        }
      }
    }
  },
);
