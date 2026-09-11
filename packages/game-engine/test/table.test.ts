/**
 * The Blackjack state machine (spec §5.1.2).
 *
 * A state machine goes wrong in the joins between rules, not in any one rule, so
 * these tests are mostly about interactions: what a dealer natural collects when
 * there is no hole card, whether a split ace can be hit, what surrender pays,
 * whether the hands of a split are played in the order they were created.
 *
 * `stack` lets each case name the exact cards it needs. Spec §8 requires that
 * facility anyway — drilling cannot wait for a pair of eights against a six to
 * turn up once in 350 hands — so the tests use the same one Drill mode will.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatCards, makeRules, parseCards, type BlackjackRules } from '@evtrainer/ev-engine';
import { BlackjackTable } from '../src/table.ts';

/**
 * A table whose next cards are exactly the ones named, in dealing order:
 * player, dealer upcard, player, dealer hole, then whatever is drawn after.
 */
function tableWith(cards: string, rules: Partial<BlackjackRules> = {}): BlackjackTable {
  const table = new BlackjackTable({ rules: makeRules(rules), seed: 1, grading: 'chart' });
  table.shoe.stack(parseCards(cards));
  return table;
}

test('a hand deals player, upcard, player, hole', () => {
  const table = tableWith('9s 6d 7h Kc');
  table.startHand();
  const view = table.view;
  assert.equal(formatCards(view.hands[0]!.cards), '9s 7h');
  assert.equal(formatCards(view.dealerVisible), '6d', 'the hole card stays down');
  assert.equal(view.phase, 'player');
});

test('a player natural is paid at 3:2 and ends the hand', () => {
  const table = tableWith('As 6d Kh 9c');
  table.startHand();
  assert.equal(table.view.phase, 'settled');
  assert.equal(table.handRecord.netUnits, 1.5);
  assert.equal(table.handRecord.decisions.length, 0, 'a natural is paid, not played');
});

test('6:5 pays a natural less, which is the whole point of the rule', () => {
  const table = tableWith('As 6d Kh 9c', { blackjackPayout: '6:5' });
  table.startHand();
  assert.equal(table.handRecord.netUnits, 1.2);
});

test('two naturals push', () => {
  const table = tableWith('As Kd Kh Ac');
  table.startHand();
  assert.equal(table.handRecord.netUnits, 0);
});

test('a dealer natural in a peek game ends the hand before the player acts', () => {
  const table = tableWith('9s Ad 7h Kc');
  table.startHand();
  assert.equal(table.view.phase, 'insurance', 'an ace up offers insurance first');
  table.takeInsurance(false);
  assert.equal(table.view.phase, 'settled');
  assert.equal(table.handRecord.netUnits, -1);
  assert.equal(
    table.handRecord.decisions.filter((d) => d.scenarioKey !== 'bj:insurance').length,
    0,
    'the player never got to act',
  );
});

test('insurance pays 2:1 on half the stake, and is graded as its own decision', () => {
  const table = tableWith('9s Ad 7h Kc');
  table.startHand();
  const decision = table.takeInsurance(true);

  assert.equal(decision.scenarioKey, 'bj:insurance');
  assert.equal(decision.optimalAction, 'declineInsurance', 'insurance loses in a fresh shoe');
  assert.equal(decision.chosenAction, 'takeInsurance');
  assert.ok(decision.evCost > 0);

  // The main bet loses 1 and insurance wins 1, so on this particular hand taking
  // it breaks even — which is exactly why it feels right and is not.
  assert.equal(table.handRecord.netUnits, 0);
});

test('declining insurance against a dealer natural simply loses the bet', () => {
  const table = tableWith('9s Ad 7h Kc');
  table.startHand();
  table.takeInsurance(false);
  assert.equal(table.handRecord.netUnits, -1);
});

test('doubling takes exactly one card and doubles the stake', () => {
  const table = tableWith('5s 6d 6h 9c 9d');
  table.startHand();
  table.act('double');
  assert.equal(table.view.phase, 'settled');
  assert.equal(formatCards(table.view.hands[0]!.cards), '5s 6h 9d', 'one card only');
  assert.equal(table.view.hands[0]!.bet, 2);
});

test('surrender forfeits exactly half the original bet', () => {
  const table = tableWith('Ts 9d 6h 8c', { surrender: 'late' });
  table.startHand();
  table.act('surrender');
  assert.equal(table.view.phase, 'settled');
  assert.equal(table.handRecord.netUnits, -0.5);
});

test('splits are played in the order they were created', () => {
  const table = tableWith('8s 6d 8h 9c 3d 4h');
  table.startHand();
  table.act('split');

  const view = table.view;
  assert.equal(view.hands.length, 2);
  assert.equal(view.activeHandIndex, 0);
  assert.equal(formatCards(view.hands[0]!.cards), '8s 3d', 'the first hand draws first');
  assert.equal(formatCards(view.hands[1]!.cards), '8h', 'the second waits its turn');

  table.act('stand');
  assert.equal(table.view.activeHandIndex, 1);
  assert.equal(formatCards(table.view.hands[1]!.cards), '8h 4h');
});

test('each split hand carries its own bet and its own decisions', () => {
  const table = tableWith('8s 6d 8h 9c 3d 4h 5s');
  table.startHand();
  table.act('split');
  table.act('stand');
  table.act('stand');

  const record = table.handRecord;
  assert.equal(record.playerCards.length, 2);
  assert.equal(record.decisions.filter((d) => d.handIndex === 0).length, 2, 'split, then stand');
  assert.equal(record.decisions.filter((d) => d.handIndex === 1).length, 1);
  assert.ok(Number.isFinite(record.netUnits));
});

test('split aces take one card and stop', () => {
  const table = tableWith('As 6d Ah 9c 5d 7h', { hitSplitAces: false });
  table.startHand();
  table.act('split');
  assert.equal(table.view.phase, 'settled');
  assert.equal(formatCards(table.view.hands[0]!.cards), 'As 5d');
  assert.equal(formatCards(table.view.hands[1]!.cards), 'Ah 7h');
});

test('a split ace making 21 is paid at even money, not as a natural', () => {
  const table = tableWith('As 6d Ah 9c Kd 7h');
  table.startHand();
  table.act('split');
  assert.equal(formatCards(table.view.hands[0]!.cards), 'As Kd');
  assert.notEqual(table.view.hands[0]!.net, 1.5, 'a split hand is never a natural');
});

test('hitting split aces is allowed where the house permits it', () => {
  const table = tableWith('As 6d Ah 9c 5d 7h', { hitSplitAces: true });
  table.startHand();
  table.act('split');
  assert.equal(table.view.phase, 'player', 'the hand is still live');
  assert.ok(table.legalActions().includes('hit'));
});

test('the dealer hits or stands on soft 17 as the rules say', () => {
  const stand = tableWith('Ts 6d 9h Ac', { soft17: 'S17' });
  stand.startHand();
  stand.act('stand');
  assert.equal(formatCards(stand.view.dealerVisible), '6d Ac', 'S17 stands on soft 17');

  // Under H17 the same soft 17 must draw. The four takes it to a soft 21, which
  // stands; a five would leave a hard 12 and the dealer would have to keep going.
  const hit = tableWith('Ts 6d 9h Ac 4s', { soft17: 'H17' });
  hit.startHand();
  hit.act('stand');
  assert.equal(formatCards(hit.view.dealerVisible), '6d Ac 4s', 'H17 draws');
});

test('the dealer does not draw when every hand is already dead', () => {
  const table = tableWith('Ts 6d 9h Ac 5s 8d');
  table.startHand();
  table.act('hit');
  assert.equal(table.view.phase, 'settled');
  assert.equal(table.view.dealerVisible.length, 2, 'the dealer stood pat with the player busted');
  assert.equal(table.handRecord.netUnits, -1);
});

test('with no hole card a dealer natural takes the doubled wager too', () => {
  // Spec §5.1.1: this is what makes the European game different, and why the
  // correct play against a ten or an ace changes under it.
  const peek = tableWith('5s Ad 6h Kc 9d', { peek: true, surrender: 'none' });
  peek.startHand();
  peek.takeInsurance(false);
  assert.equal(peek.handRecord.netUnits, -1, 'a peeked natural takes only the original bet');

  const enhc = tableWith('5s Ad 6h Kc 9d', { peek: false, surrender: 'none' });
  enhc.startHand();
  enhc.takeInsurance(false);
  assert.equal(enhc.view.phase, 'player', 'no peek, so the player acts first');
  enhc.act('double');
  assert.equal(enhc.handRecord.netUnits, -2, 'the natural collects both units');
});

test('illegal actions are refused rather than half-applied', () => {
  const table = tableWith('Ts 9d 6h 8c', { surrender: 'none' });
  table.startHand();
  assert.throws(() => table.act('split'), /not legal/);
  assert.throws(() => table.act('surrender'), /not legal/);
  assert.throws(() => table.takeInsurance(true), /not on offer/);
  assert.equal(table.view.phase, 'player', 'the table is untouched');
});

test('the hand record carries everything Replay mode needs', () => {
  const table = tableWith('8s 6d 8h 9c 3d 4h 5s');
  table.startHand();
  table.act('split');
  table.act('stand');
  table.act('stand');

  const record = table.handRecord;
  assert.equal(record.id, 1);
  assert.ok(record.dealtCards.length >= 6, 'every card dealt, in order');
  assert.equal(record.baseBet, 1);
  assert.deepEqual(
    record.decisions.map((d) => d.sequenceIndex),
    [0, 1, 2],
  );
  for (const decision of record.decisions) {
    assert.ok(decision.evCost >= 0, 'an error never costs a negative amount');
    assert.ok(decision.evByAction[decision.chosenAction] !== undefined);
  }
});

test('the same seed replays the same shoe exactly', () => {
  const play = (): number[] => {
    const table = new BlackjackTable({ rules: makeRules(), seed: 777 });
    const nets: number[] = [];
    for (let i = 0; i < 25; i++) {
      table.startHand();
      for (;;) {
        const phase = table.view.phase;
        if (phase === 'insurance') {
          table.takeInsurance(false);
          continue;
        }
        if (phase !== 'player') break;
        table.act(table.currentEvaluation().optimalAction);
      }
      nets.push(table.handRecord.netUnits);
    }
    return nets;
  };
  assert.deepEqual(play(), play());
});

test('a long session never deals a card that is not in the shoe', () => {
  // The shoe reshuffles at the cut card between hands, never inside one. If that
  // boundary were wrong, a hand would straddle two shuffles and repeat cards.
  const table = new BlackjackTable({ rules: makeRules({ decks: 2 }), seed: 31337 });
  for (let i = 0; i < 400; i++) {
    table.startHand();
    for (;;) {
      const phase = table.view.phase;
      if (phase === 'insurance') {
        table.takeInsurance(false);
        continue;
      }
      if (phase !== 'player') break;
      table.act(table.currentEvaluation().optimalAction);
    }
    const record = table.handRecord;
    // Two decks hold two of each card, so no hand may show three of one.
    const seen = new Map<number, number>();
    for (const card of record.dealtCards) seen.set(card, (seen.get(card) ?? 0) + 1);
    for (const [card, count] of seen) {
      assert.ok(count <= 2, `card ${card} appeared ${count} times in one hand of a two-deck shoe`);
    }
  }
});
