/**
 * The Ultimate Texas Hold'em state machine (spec §5.2.1, §5.2.4).
 *
 * As with Blackjack, a state machine goes wrong in the joins rather than in any
 * one rule: whether a check really moves to the next street, whether a raise
 * really ends the decisions, whether a fold forfeits exactly the Ante and the
 * Blind and shows nothing it should not. And one join here matters more than
 * the rest — that the three settlement lines the player is shown add up to the
 * one figure `settle()` computes, so the breakdown can never become a second
 * rule that quietly disagrees with the first.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PREFLOP_TABLE,
  evaluate7,
  formatCards,
  parseCards,
  preflopRow,
  settle,
  solveFlop,
  solveRiver,
  DEFAULT_BLIND_PAYTABLE,
} from '@evtrainer/ev-engine/uth';
import { UthTable, type UthAction } from '../src/uth-table.ts';

/** A table whose next hand is exactly these cards: P P D D  F F F T R. */
function tableWith(cards: string, seed = 1): UthTable {
  const table = new UthTable({ seed });
  table.stackNextHand(parseCards(cards));
  table.startHand();
  return table;
}

// --- Dealing ----------------------------------------------------------------

test('a hand deals two to the player, two face down to the dealer, five face down', () => {
  const table = tableWith('As Kd 2c 7h Qs Jh 3d 9c 4s');
  const view = table.view;
  assert.equal(view.phase, 'preflop');
  assert.equal(formatCards(view.hole), 'As Kd');
  assert.deepEqual(view.dealerHole, [], 'the dealer is showing cards before showdown');
  assert.equal(view.dealerRevealed, false);
  assert.deepEqual(view.board, [], 'community cards are face up before the flop');
  assert.equal(view.ante, 1);
  assert.equal(view.blind, 1);
  assert.equal(view.playBet, 0);
});

test('the same seed deals the same hands, every time', () => {
  const play = (seed: number) => {
    const table = new UthTable({ seed });
    const hands: string[] = [];
    for (let i = 0; i < 25; i++) {
      table.startHand();
      // A pre-flop raise is a table lookup; checking would solve the flop 25
      // times to test a property of the shuffle.
      table.act('raise4x');
      hands.push(formatCards(table.handRecord.dealtCards));
    }
    return hands;
  };
  assert.deepEqual(play(42), play(42));
  assert.notDeepEqual(play(42), play(43));
});

test('no card is ever dealt twice in a hand', () => {
  const table = new UthTable({ seed: 7 });
  for (let i = 0; i < 500; i++) {
    table.startHand();
    table.act('raise4x');
    const dealt = table.handRecord.dealtCards;
    assert.equal(dealt.length, 9);
    assert.equal(new Set(dealt).size, 9, `hand ${i + 1} dealt a card twice`);
  }
});

// --- The three decision points ------------------------------------------------

test('pre-flop offers 4x, 3x and check; the flop 2x and check; the river 1x and fold', () => {
  const table = tableWith('7s 2d 9c 4h Qs Jh 3d 8c 5s');
  assert.deepEqual(table.legalActions(), ['raise4x', 'raise3x', 'check']);
  table.act('check');
  assert.equal(table.view.phase, 'flop');
  assert.equal(formatCards(table.view.board), 'Qs Jh 3d');
  assert.deepEqual(table.legalActions(), ['raise2x', 'check']);
  table.act('check');
  assert.equal(table.view.phase, 'river');
  assert.equal(formatCards(table.view.board), 'Qs Jh 3d 8c 5s');
  assert.deepEqual(table.legalActions(), ['raise1x', 'fold']);
});

test('illegal actions are refused rather than half-applied', () => {
  const table = tableWith('7s 2d 9c 4h Qs Jh 3d 8c 5s');
  assert.throws(() => table.act('fold'), /not legal/);
  assert.throws(() => table.act('raise2x'), /not legal/);
  assert.equal(table.view.phase, 'preflop', 'a refused action moved the hand');
  table.act('check');
  assert.throws(() => table.act('raise4x'), /not legal/);
});

for (const [action, bet] of [['raise4x', 4], ['raise3x', 3]] as const) {
  test(`a pre-flop ${action} ends the decisions and runs the board out`, () => {
    const table = tableWith('As Ad 9c 4h Qs Jh 3d 8c 5s');
    table.act(action);
    const view = table.view;
    assert.equal(view.phase, 'settled');
    assert.equal(view.playBet, bet);
    assert.equal(view.board.length, 5, 'the board did not run out');
    assert.equal(view.dealerRevealed, true);
    assert.deepEqual(view.legalActions, []);
  });
}

test('a flop raise is 2x and ends the decisions', () => {
  const table = tableWith('As Ad 9c 4h Qs Jh 3d 8c 5s');
  table.act('check');
  table.act('raise2x');
  assert.equal(table.view.phase, 'settled');
  assert.equal(table.view.playBet, 2);
  assert.equal(table.view.board.length, 5);
});

test('a river raise is 1x', () => {
  const table = tableWith('As Ad 9c 4h Qs Jh 3d 8c 5s');
  table.act('check');
  table.act('check');
  table.act('raise1x');
  assert.equal(table.view.playBet, 1);
  assert.equal(table.view.phase, 'settled');
});

// --- Folding ----------------------------------------------------------------

test('a fold forfeits exactly the Ante and the Blind, and turns nothing over', () => {
  const table = tableWith('7s 2d As Ad Qs Jh 3d 8c 5s');
  table.act('check');
  table.act('check');
  table.act('fold');
  const view = table.view;
  assert.equal(view.phase, 'settled');
  assert.equal(view.netUnits, -2);
  assert.equal(view.settlement!.ante, -1);
  assert.equal(view.settlement!.blind, -1);
  assert.equal(view.settlement!.play, 0);
  assert.equal(view.settlement!.folded, true);
  // The player gave the hand up. Showing them the dealer's cards now would be
  // showing them the result of a decision they did not make.
  assert.equal(view.dealerRevealed, false);
  assert.deepEqual(view.dealerHole, []);
});

// --- Settlement ---------------------------------------------------------------

test('every settlement breakdown adds up to what settle() pays, over thousands of hands', () => {
  /*
   * The breakdown is three lines on the player's screen; `settle()` is the rule.
   * If the lines were ever re-derived differently, the screen would explain a
   * payout the stack did not receive. The table throws on a mismatch; this
   * drives enough hands, down every path, to make that throw likely to fire if
   * it ever could.
   */
  const table = new UthTable({ seed: 2026 });
  /*
   * Every settlement branch is reachable from a pre-flop raise, because the
   * board runs out to a full showdown either way. So the sweep raises pre-flop,
   * which grades by table lookup, and leaves the flop and river paths to the
   * small test below — 4,000 flop solves would be 90 seconds spent re-testing
   * the solver, not the settlement.
   */
  const paths: UthAction[][] = [['raise4x'], ['raise3x']];
  let hands = 0;
  const seen = { qualified: 0, unqualified: 0, ties: 0, blindPaid: 0, blindPushed: 0 };
  for (let i = 0; i < 4000; i++) {
    table.startHand();
    for (const action of paths[i % paths.length]!) table.act(action);
    const record = table.handRecord;
    const s = record.settlement;
    const player = evaluate7([...record.hole, ...record.board]);
    const dealer = evaluate7([...record.dealerHole, ...record.board]);
    assert.equal(s.net, settle(player, dealer, s.playBet, DEFAULT_BLIND_PAYTABLE));
    assert.equal(s.ante + s.play + s.blind, s.net);
    if (player === dealer) seen.ties++;
    else if (s.dealerQualified) seen.qualified++;
    else seen.unqualified++;
    if (s.blind > 0) seen.blindPaid++;
    if (s.blindPushed) seen.blindPushed++;
    hands++;
  }
  assert.equal(hands, 4000);
  // The sweep has to have actually reached each branch it claims to cover.
  for (const [branch, count] of Object.entries(seen)) {
    assert.ok(count > 0, `no hand reached the ${branch} branch in 4000`);
  }
});

test('the later raises settle through the same rule as the pre-flop ones', () => {
  const table = new UthTable({ seed: 314 });
  const paths: UthAction[][] = [['check', 'raise2x'], ['check', 'check', 'raise1x']];
  for (let i = 0; i < 12; i++) {
    table.startHand();
    for (const action of paths[i % paths.length]!) table.act(action);
    const record = table.handRecord;
    const player = evaluate7([...record.hole, ...record.board]);
    const dealer = evaluate7([...record.dealerHole, ...record.board]);
    assert.equal(
      record.settlement.net,
      settle(player, dealer, record.settlement.playBet, DEFAULT_BLIND_PAYTABLE),
    );
  }
});

test('a dealer who does not qualify pushes the Ante, and never touches Play or Blind', () => {
  // Player: straight 9-K. Dealer: king high, no pair — does not qualify.
  const table = tableWith('9s Th 2c 4d Jd Qc Kh 7s 3h');
  table.act('raise4x');
  const s = table.view.settlement!;
  assert.equal(s.dealerQualified, false);
  assert.equal(s.ante, 0, 'the Ante did not push against a non-qualifying dealer');
  assert.equal(s.play, 4, 'Play ignores qualification');
  assert.equal(s.blind, 1, 'a straight pays 1:1 on the Blind');
  assert.equal(s.net, 5);
});

test('a win below a straight pushes the Blind', () => {
  // Player: pair of aces. Dealer: pair of twos — qualifies, loses.
  const table = tableWith('As Ad 2c 2d Kh 9s 5c 7h 3d');
  table.act('raise4x');
  const s = table.view.settlement!;
  assert.equal(s.dealerQualified, true);
  assert.equal(s.ante, 1);
  assert.equal(s.play, 4);
  assert.equal(s.blind, 0);
  assert.equal(s.blindPushed, true);
  assert.equal(s.net, 5);
});

test('a loss costs the Ante, the Play and the Blind', () => {
  // Player: seven high. Dealer: pair of aces.
  const table = tableWith('7s 2d As Ad Kh 9s 5c 4h 3d');
  table.act('check');
  table.act('check');
  table.act('raise1x');
  const s = table.view.settlement!;
  assert.equal(s.ante, -1);
  assert.equal(s.play, -1);
  assert.equal(s.blind, -1);
  assert.equal(s.net, -3);
});

// --- Grading ----------------------------------------------------------------

test('pre-flop is graded from the solved table for the hole class', () => {
  const table = tableWith('As Kd 2c 7h Qs Jh 3d 9c 4s');
  assert.equal(table.holeClass, 'AKo');
  const row = preflopRow('AKo');
  const record = table.act('check');
  assert.deepEqual(record.evByAction, { raise4x: row.ev4x, raise3x: row.ev3x, check: row.evCheck });
  assert.equal(record.optimalAction, 'raise4x');
  assert.equal(record.scenarioKey, 'uth:preflop');
  assert.ok(Math.abs(record.evCost - (row.ev4x - row.evCheck)) < 1e-12);
  assert.notEqual(record.severityTier, 'optimal');
});

test('3x is graded an error on every one of the 169 classes', () => {
  /*
   * §5.2.3 as something the grader enforces rather than something the spec
   * says. One representative per class, raised 3x, and not one of them may come
   * back optimal.
   */
  let graded = 0;
  for (const row of Object.values(PREFLOP_TABLE)) {
    const table = new UthTable({ seed: graded + 1 });
    // Build two cards of this class.
    const hi = row.label[0]!;
    const lo = row.label[1]!;
    const suited = row.label.endsWith('s');
    const first = `${hi}s`;
    const second = hi === lo ? `${lo}h` : suited ? `${lo}s` : `${lo}h`;
    table.stackNextHand(parseCards(`${first} ${second}`));
    table.startHand();
    assert.equal(table.holeClass, row.label);
    const record = table.act('raise3x');
    assert.notEqual(record.optimalAction, 'raise3x', `${row.label}: 3x graded optimal`);
    assert.ok(record.evCost > 0, `${row.label}: 3x cost nothing`);
    graded++;
  }
  assert.equal(graded, 169);
});

test('the flop is graded by solving the actual cards on the table', () => {
  const table = tableWith('As Kd 2c 7h Qs Jh 3d 9c 4s');
  table.act('check');
  const solved = solveFlop(parseCards('As Kd'), parseCards('Qs Jh 3d'), DEFAULT_BLIND_PAYTABLE);
  const record = table.act('check');
  assert.equal(record.evByAction.raise2x, solved.evPlay);
  assert.equal(record.evByAction.check, solved.evCheck);
  assert.equal(record.optimalAction, solved.optimalAction === 'play' ? 'raise2x' : 'check');
  assert.equal(record.scenarioKey, 'uth:flop');
});

test('the river is graded by solving the actual cards, and folding is exactly -2', () => {
  const table = tableWith('7s 2d As Ad Qs Jh 3d 8c 5s');
  table.act('check');
  table.act('check');
  const solved = solveRiver(
    parseCards('7s 2d'),
    parseCards('Qs Jh 3d 8c 5s'),
    DEFAULT_BLIND_PAYTABLE,
  );
  const record = table.act('fold');
  assert.equal(record.evByAction.raise1x, solved.evPlay);
  assert.equal(record.evByAction.fold, -2);
  assert.equal(record.scenarioKey, 'uth:river');
});

test('a correct decision costs nothing, and a cost is never negative', () => {
  const table = new UthTable({ seed: 99 });
  for (let i = 0; i < 20; i++) {
    table.startHand();
    const best = table.evaluate().optimalAction;
    const record = table.act(best);
    assert.equal(record.evCost, 0);
    assert.equal(record.severityTier, 'optimal');
    while (table.legalActions().length > 0) {
      const next = table.act(table.legalActions()[0]!);
      assert.ok(next.evCost >= 0);
    }
  }
});

test('the record has the Blackjack shape, so the card and the stats need no new code', () => {
  const table = tableWith('As Kd 2c 7h Qs Jh 3d 9c 4s');
  const record = table.act('raise3x');
  for (const field of [
    'sequenceIndex', 'handIndex', 'scenarioKey', 'legalActions', 'evByAction',
    'optimalAction', 'chosenAction', 'evCost', 'severityTier', 'timeToDecideMs',
  ]) {
    assert.ok(field in record, `the record has no ${field}`);
  }
  assert.equal(record.handIndex, 0);
  assert.equal(record.sequenceIndex, 0);
});
