/**
 * Spec §14.1, second bullet: known-value spot checks.
 *
 * The spec names two by hand — standing on 20 against a six, and doubling 11
 * against a six — and asks for others like them. Each value asserted here was
 * cross-checked against an independent simulation (`test/helpers/simulate.ts`,
 * which shares no code with the solver) at twenty million hands, where the
 * two-sigma band is under 0.001. The slow variant of this file re-runs that
 * simulation; the fast variant pins the numbers so a regression cannot slip
 * through on a day nobody runs the slow suite.
 *
 * All values are 6 decks, S17, peek, in units of the original wager.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BlackjackSolver, insuranceEv } from '../src/blackjack/ev.ts';
import { makeRules } from '../src/blackjack/rules.ts';
import { ACE, parseRank, parseRanks, Shoe, TEN } from '../src/blackjack/shoe.ts';
import { simulateFixedAction } from './helpers/simulate.ts';

const RULES = makeRules({ decks: 6, soft17: 'S17', surrender: 'none', das: true });

function evaluate(hand: string, upcard: string) {
  const cards = parseRanks(hand);
  const up = parseRank(upcard);
  const shoe = Shoe.fresh(RULES.decks);
  shoe.removeAll(cards);
  shoe.remove(up);
  return new BlackjackSolver(RULES, { cardRemoval: 'exact' }).evaluate(cards, up, shoe);
}

/** Tight enough to catch a real error, loose enough to survive a compiler's FMA. */
const TOL = 5e-4;

test('standing on 20 against a six', () => {
  // The spec's own example. Twenty is a 70-cent hand and the engine had better
  // know it: a dealer showing a six busts about 42% of the time and beats twenty
  // only by making 21.
  const { evByAction } = evaluate('T T', '6');
  assert.ok(Math.abs(evByAction.stand! - 0.70283) < TOL, `stand=${evByAction.stand}`);
  assert.ok(evByAction.hit! < -0.8, 'hitting a twenty is a disaster');
  assert.ok(evByAction.double! < -1.7, 'doubling a twenty is twice the disaster');
});

test('doubling 11 against a six', () => {
  // The spec's other named example. Composition matters here — holding the five
  // and six takes two of the dealer's outs — so both common compositions are
  // pinned rather than an average that hides them.
  const fiveSix = evaluate('5 6', '6').evByAction;
  assert.ok(Math.abs(fiveSix.double! - 0.68266) < TOL, `5,6 double=${fiveSix.double}`);
  assert.equal(evaluate('5 6', '6').optimalAction, 'double');

  const twoNine = evaluate('2 9', '6').evByAction;
  assert.ok(Math.abs(twoNine.double! - 0.67130) < TOL, `2,9 double=${twoNine.double}`);

  assert.ok(
    fiveSix.double! > twoNine.double!,
    'removing a five and a six from the shoe hurts the dealer more than removing a two and a nine',
  );
});

test('sixteen against a ten is a losing hand either way', () => {
  // The §7.1 example feedback card. Both actions are deep underwater and the gap
  // between them is small, which is exactly why it is graded as negligible
  // rather than as a blunder.
  const { evByAction, optimalAction } = evaluate('T 6', 'T');
  assert.equal(optimalAction, 'hit');
  assert.ok(Math.abs(evByAction.stand! - -0.54095) < TOL, `stand=${evByAction.stand}`);
  assert.ok(Math.abs(evByAction.hit! - -0.53471) < TOL, `hit=${evByAction.hit}`);
  assert.ok(evByAction.hit! - evByAction.stand! < 0.01, 'the two are close');
});

test('twelve against a ten is not the same mistake', () => {
  // Spec §3.2: standing on 16 against a ten costs almost nothing, standing on 12
  // against a ten costs a tenth of a unit. The severity tiers depend on this
  // being true in the numbers, not just in the prose.
  const sixteen = evaluate('T 6', 'T').evByAction;
  const twelve = evaluate('T 2', 'T').evByAction;

  const sixteenCost = sixteen.hit! - sixteen.stand!;
  const twelveCost = twelve.hit! - twelve.stand!;
  assert.ok(sixteenCost < 0.01, `standing on 16 v 10 costs ${sixteenCost}`);
  assert.ok(twelveCost > 0.1, `standing on 12 v 10 costs ${twelveCost}`);
});

test('surrender is worth exactly half a unit, and beats sixteen against a ten', () => {
  const rules = makeRules({ decks: 6, soft17: 'S17', surrender: 'late' });
  const cards = parseRanks('T 6');
  const up = parseRank('T');
  const shoe = Shoe.fresh(6);
  shoe.removeAll(cards);
  shoe.remove(up);

  const result = new BlackjackSolver(rules, { cardRemoval: 'exact' }).evaluate(cards, up, shoe);
  assert.equal(result.evByAction.surrender, -0.5);
  assert.equal(result.optimalAction, 'surrender');
});

test('splitting eights against a ten loses less than playing sixteen', () => {
  const { evByAction, optimalAction } = evaluate('8 8', 'T');
  assert.equal(optimalAction, 'split');
  assert.ok(Math.abs(evByAction.split! - -0.47503) < 2e-3, `split=${evByAction.split}`);
  assert.ok(evByAction.split! > evByAction.hit!);
  assert.ok(evByAction.split! > evByAction.stand!);
});

test('splitting aces is the best hand in the game', () => {
  const { evByAction, optimalAction } = evaluate('A A', '6');
  assert.equal(optimalAction, 'split');
  assert.ok(evByAction.split! > 0.6, `split=${evByAction.split}`);
  assert.ok(evByAction.split! > 3 * evByAction.stand! + 1, 'and it is not close');
});

test('soft eighteen against a nine is a hit, not the stand everyone makes', () => {
  const { evByAction, optimalAction } = evaluate('A 7', '9');
  assert.equal(optimalAction, 'hit');
  assert.ok(Math.abs(evByAction.stand! - -0.18264) < TOL, `stand=${evByAction.stand}`);
  assert.ok(Math.abs(evByAction.hit! - -0.09847) < TOL, `hit=${evByAction.hit}`);
});

test('insurance is a losing bet in every standard shoe', () => {
  // Spec §5.1.3 and the §16 honesty requirement. The player's own hand never
  // enters it: it is a bet on the hole card and nothing else.
  for (const [decks, expected] of [
    [1, -0.029412],
    [2, -0.033981],
    [6, -0.036977],
    [8, -0.037349],
  ] as const) {
    const shoe = Shoe.fresh(decks);
    shoe.remove(ACE);
    const ev = insuranceEv(shoe);
    assert.ok(Math.abs(ev - expected) < 1e-6, `${decks} decks: ${ev}`);
    assert.ok(ev < 0);
  }

  // It only turns positive once more than a third of the shoe is tens, which is
  // the counting lesson and is out of scope for v1 — but the arithmetic should
  // already be right.
  const rich = Shoe.fromCounts([0, 0, 0, 0, 0, 0, 0, 0, 0, 10]);
  assert.ok(insuranceEv(rich) > 0);
  const exactlyOneThird = Shoe.fromCounts([2, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  assert.ok(Math.abs(insuranceEv(exactlyOneThird)) < 1e-15, 'one ten in three is the break-even point');
});

test('a natural is resolved on the deal, not graded as a decision', () => {
  const shoe = Shoe.fresh(6);
  shoe.removeAll([ACE, TEN]);
  shoe.remove(parseRank('6'));
  const solver = new BlackjackSolver(RULES);
  assert.throws(() => solver.evaluate([ACE, TEN], parseRank('6'), shoe), /natural/);
});

test(
  'the pinned values reproduce under independent simulation',
  { skip: process.env.EV_ENGINE_SLOW_TESTS ? false : 'set EV_ENGINE_SLOW_TESTS=1' },
  () => {
    const hands = 20_000_000;
    const checks = [
      { hand: 'T T', up: '6', action: 'stand' as const, seed: 88172645 },
      { hand: '5 6', up: '6', action: 'double' as const, seed: 12345 },
      { hand: '2 9', up: '6', action: 'double' as const, seed: 777111 },
      { hand: 'T 6', up: 'T', action: 'stand' as const, seed: 999331 },
      { hand: 'A 7', up: '9', action: 'stand' as const, seed: 4242 },
    ];

    for (const { hand, up, action, seed } of checks) {
      const cards = parseRanks(hand);
      const upcard = parseRank(up);
      const shoe = Shoe.fresh(6);
      shoe.removeAll(cards);
      shoe.remove(upcard);
      const solver = new BlackjackSolver(RULES, { cardRemoval: 'exact' });
      const exact =
        action === 'stand'
          ? solver.evaluate(cards, upcard, shoe).evByAction.stand!
          : solver.evaluate(cards, upcard, shoe).evByAction.double!;

      const sampled = simulateFixedAction(cards, upcard, action, 6, false, hands, seed);
      const band = 4 * sampled.standardError;
      assert.ok(
        Math.abs(sampled.ev - exact) < band,
        `${hand} vs ${up} ${action}: exact ${exact}, sampled ${sampled.ev} ± ${band} (n=${sampled.samples})`,
      );
    }
  },
);
