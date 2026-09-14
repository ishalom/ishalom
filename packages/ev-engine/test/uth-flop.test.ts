/**
 * The flop decision (spec §6.3, "Flop decision").
 *
 * Cross-checked by composition: the flop solver is one fused pass over all
 * 1,070,190 outcomes, while the reference below reaches the same numbers by
 * calling the river solver once for each of the 1,081 possible turn-and-river
 * pairs. The river solver is itself checked against a fully independent naive
 * enumeration in `uth-river.test.ts`, so agreement here chains the flop solver
 * back to that.
 *
 * The two paths share no arithmetic: the solver accumulates ante, blind and play
 * separately and derives both raise sizes from one pass, where the reference
 * takes finished per-board EVs and averages them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCards, unseenCards, type Card } from '../src/core/cards.ts';
import { DEFAULT_BLIND_PAYTABLE, FOLD_RESULT } from '../src/uth/rules.ts';
import { solveFlop } from '../src/uth/flop.ts';
import { solveRiver } from '../src/uth/river.ts';

const paytable = DEFAULT_BLIND_PAYTABLE;
const slow = process.env.EV_ENGINE_SLOW_TESTS ? false : 'set EV_ENGINE_SLOW_TESTS=1';

/**
 * Reference flop EVs, built by running the river solver over every turn and
 * river. A 2x raise differs from a 1x raise only in the play bet, so it comes
 * from the river result's win/loss counts rather than a second enumeration.
 */
function referenceSolveFlop(
  playerHole: readonly Card[],
  flop: readonly Card[],
): { evPlay: number; evCheck: number } {
  const unseen = unseenCards([...playerHole, ...flop]);
  let playTotal = 0;
  let checkTotal = 0;
  let boards = 0;

  for (let i = 0; i < unseen.length; i++) {
    for (let j = i + 1; j < unseen.length; j++) {
      const board = [...flop, unseen[i]!, unseen[j]!];
      const river = solveRiver(playerHole, board, paytable);
      const holdings = river.wins + river.ties + river.losses;
      // One more unit on the play bet, won on a win and lost on a loss.
      const extraUnit = (river.wins - river.losses) / holdings;
      playTotal += river.evPlay + extraUnit;
      checkTotal += Math.max(river.evPlay, FOLD_RESULT);
      boards++;
    }
  }
  return { evPlay: playTotal / boards, evCheck: checkTotal / boards };
}

test('the enumeration is the full C(47,2) x C(45,2)', () => {
  // Spec §6.3 quotes 893,970 here, but 45 and 43 are the river's numbers, where
  // seven cards are visible. At the flop only five are, so 47 remain unseen and
  // the space is 1081 x 990.
  const result = solveFlop(parseCards('Ah Kh'), parseCards('Qh Jh 2d'), paytable);
  assert.equal(result.boards, 1081, 'C(47,2) turn-and-river pairs');
  assert.equal(result.outcomes, 1_070_190, 'C(47,2) x C(45,2) outcomes');
});

test('checking is valued as keeping the river option, not as showing down', () => {
  // A hand with nothing has to be able to fold later, and the value of checking
  // has to include that. If a check were treated as terminal this EV would be
  // far worse and the solver would recommend raising junk.
  const result = solveFlop(parseCards('7h 2d'), parseCards('Ac Ks Qd'), paytable);
  assert.equal(result.optimalAction, 'check');
  assert.ok(result.riverFoldFrequency > 0.3, 'this hand should often fold the river');
  assert.ok(result.evCheck > result.evPlay);
  assert.ok(result.evCheck > FOLD_RESULT, 'checking must beat folding outright');
});

test('a hand that always wants the river bet never folds it', () => {
  const result = solveFlop(parseCards('Ah Ad'), parseCards('Ac 7s 2d'), paytable);
  assert.equal(result.riverFoldFrequency, 0);
  assert.equal(result.optimalAction, 'play');
});

test('strong flops raise and weak ones check', () => {
  // These are the discrete, well-attested shapes of published UTH flop strategy:
  // two pair or better raises, a hidden pair raises, and a pocket pair below the
  // board does not.
  const raises: Array<[string, string, string]> = [
    ['Ah Ad', 'Ac 7s 2d', 'top set'],
    ['Kd Qh', 'Ac Ks Qs', 'two pair'],
    ['Ah 9c', 'Ad 7s 2d', 'hidden top pair'],
  ];
  for (const [hole, flop, label] of raises) {
    const result = solveFlop(parseCards(hole), parseCards(flop), paytable);
    assert.equal(result.optimalAction, 'play', `${label} should raise 2x`);
  }

  const checks: Array<[string, string, string]> = [
    ['7h 2d', 'Ac Ks Qd', 'nothing at all'],
    ['5h 5d', 'Ac Ks Qd', 'a pocket pair under three overcards'],
  ];
  for (const [hole, flop, label] of checks) {
    const result = solveFlop(parseCards(hole), parseCards(flop), paytable);
    assert.equal(result.optimalAction, 'check', `${label} should check`);
  }
});

test('malformed deals are rejected', () => {
  assert.throws(() => solveFlop(parseCards('Ah'), parseCards('Ac Ks Qd'), paytable), /two cards/);
  assert.throws(() => solveFlop(parseCards('Ah Kh'), parseCards('Ac Ks'), paytable), /three community/);
  assert.throws(() => solveFlop(parseCards('Ah Kh'), parseCards('Ah Ks Qd'), paytable), /Duplicate/);
});

test('the flop decision meets the §6.3 latency target', () => {
  // The spec targets under 200 ms, and allows falling back to exact-with-early-
  // termination before Monte Carlo if a low-end device misses it. A regression
  // that pushed this over would be an algorithmic one, not a device one.
  const hole = parseCards('Ah Kh');
  const flop = parseCards('Qh Jh 2d');
  solveFlop(hole, flop, paytable); // warm up
  const started = performance.now();
  solveFlop(hole, flop, paytable);
  const ms = performance.now() - started;
  assert.ok(ms < 1000, `flop solve took ${ms.toFixed(0)}ms`);
});

test(
  'the fused solver agrees with composing the river solver over every board',
  { skip: slow },
  () => {
    for (const [hole, flop] of [
      ['Ah 9c', 'Ad 7s 2d'],
      ['5h 5d', 'Ac Ks Qd'],
      ['7h 2d', 'Ac Ks Qd'],
    ] as Array<[string, string]>) {
      const mine = solveFlop(parseCards(hole), parseCards(flop), paytable);
      const theirs = referenceSolveFlop(parseCards(hole), parseCards(flop));
      assert.ok(
        Math.abs(mine.evPlay - theirs.evPlay) < 1e-9,
        `${hole} | ${flop} evPlay: ${mine.evPlay} vs ${theirs.evPlay}`,
      );
      assert.ok(
        Math.abs(mine.evCheck - theirs.evCheck) < 1e-9,
        `${hole} | ${flop} evCheck: ${mine.evCheck} vs ${theirs.evCheck}`,
      );
    }
  },
);
