/**
 * The social layer (round 24; spec A, round A3 part two).
 *
 * Reactions, the table's own measures, the ticker and the counterfactual. Three
 * of the four are things a player *sees*, which makes it tempting to test them
 * by reading markup. They are not tested that way here. What each of them rests
 * on is a claim about the record, and the claims are what these tests hold:
 *
 *   - **speech cannot reach a card.** Six new buttons write to the record every
 *     hand, and the one property this whole feature was built on is that the
 *     derivation is a function of the seed and the decisions. So every reaction
 *     at a played-out table is changed, and every checksum has to be unmoved.
 *   - **speech has one writer a row**, like everything else here. Round 23 shut
 *     a race in the shared event list; reactions are exactly the shape of thing
 *     that would reopen it, so two phones say something in the same instant and
 *     both have to survive.
 *   - **the table's figures are combined the way §3.6 says**, and the test that
 *     they are is a table where the weighted answer and the averaged answer are
 *     different numbers.
 *   - **the counterfactual is a deal, not a story.** The card it names has to be
 *     the card the engine deals when the neighbour's decision is changed — and
 *     the grade on that hand has to be untouched, which is the half of §3.8
 *     that matters.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeRng } from '@evtrainer/game-engine';

import { catalogue, t } from '../src/i18n.ts';
import { sharedScreen } from '../src/shared-screen.ts';
import {
  REACTIONS,
  counterfactual,
  counterfactualBack,
  deriveTable,
  isReaction,
  playTable,
  seatCardsHash,
  sharedSpots,
  tableReactions,
  type ReactionKey,
  type SeatMove,
  type TableRecord,
} from '../src/shared-table.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (...parts: string[]) => readFileSync(join(HERE, '..', ...parts), 'utf8');

/** A table nobody has played yet, with everybody sat down from hand zero. */
function freshTable(seed: number, seats = 2): TableRecord {
  return {
    id: `t${seed}`,
    seed,
    presetId: 'vegas-strip-6d-s17',
    restrictions: { noSurrender: false, likeRanksOnly: false },
    seats: Array.from({ length: seats }, (_, seat) => ({
      seat,
      playerId: `p${seat}`,
      name: `Player ${seat}`,
      bet: seat + 1,
      moves: [] as SeatMove[],
      events: [{ kind: 'join' as const, seat, hand: 0 }],
    })),
  };
}

/** Play it out with a seeded, repeatable set of choices. */
function playRandom(record: TableRecord, hands: number, seed: number) {
  const rng = makeRng(seed);
  return playTable(record, hands, ({ legal }) => legal[rng.nextInt(legal.length)] as SeatMove['action']);
}

/** Every card every seat saw, hashed — the thing no reaction may ever move. */
function checksums(record: TableRecord): string[] {
  const table = deriveTable(record);
  return record.seats.map((seat) => seatCardsHash(table, seat.seat));
}

/* --- 1. Speech cannot reach a card ---------------------------------------------------------- */

test('changing every reaction at a table changes no card anybody was dealt', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const record = freshTable(seed, 2 + (seed % 5));
    playRandom(record, 5, seed * 13);
    const before = checksums(record);
    const cardsBefore = JSON.stringify(deriveTable(record).hands);

    /*
     * Every seat says everything, on every hand. If a single card were reached
     * through what anybody said, this is the state that would find it.
     */
    for (const seat of record.seats) {
      const said: Record<string, ReactionKey[]> = {};
      for (let hand = 0; hand < 5; hand++) said[hand] = [...REACTIONS];
      seat.reactions = said;
    }

    assert.deepEqual(checksums(record), before, `seed ${seed}: a reaction moved a card`);
    assert.equal(
      JSON.stringify(deriveTable(record).hands),
      cardsBefore,
      `seed ${seed}: a reaction changed the derived table`,
    );
  }
});

test('the derivation does not so much as read the word', () => {
  /*
   * Structural rather than behavioural, and it is worth having both: the test
   * above would pass if the derivation read reactions and happened not to be
   * changed by them today. `deriveTable` and everything under it must not
   * mention the field at all.
   */
  const code = source('src', 'shared-table.ts');
  const derivation = code.slice(code.indexOf('export function deriveTable'), code.indexOf('export function isLive'));
  assert.ok(
    !derivation.includes('reactions'),
    'the derivation mentions reactions; the cards must not be able to see them',
  );
});

/* --- 2. One writer a row, for speech as well as for play ------------------------------------ */

test('two seats saying something in the same instant keep both, in a fixed order', () => {
  const record = freshTable(7, 3);
  playRandom(record, 2, 70);

  /*
   * The shape of the race round 23 closed: each writer holds what it last read
   * and writes the whole thing back. Here that cannot cost anything, because
   * what each writes is its own row — so both say something at hand 1 without
   * either having seen the other.
   */
  const asIdanSawIt = JSON.parse(JSON.stringify(record)) as TableRecord;
  const asDaniSawIt = JSON.parse(JSON.stringify(record)) as TableRecord;
  asIdanSawIt.seats[0]!.reactions = { 1: ['brave'] };
  asDaniSawIt.seats[1]!.reactions = { 1: ['mum'] };

  /* The store keeps rows, so the table is each writer's own row, merged. */
  record.seats[0]!.reactions = asIdanSawIt.seats[0]!.reactions;
  record.seats[1]!.reactions = asDaniSawIt.seats[1]!.reactions;

  const said = tableReactions(record);
  assert.deepEqual(
    said.map((post) => [post.seat, post.key]),
    [
      [0, 'brave'],
      [1, 'mum'],
    ],
    'a reaction was lost, or the merge is not in a fixed order',
  );

  /* And the order is the record's, not the order the rows happened to arrive. */
  const reversed: TableRecord = { ...record, seats: [...record.seats].reverse() };
  assert.deepEqual(tableReactions(reversed), said, 'the merge depends on the order rows came back');
});

test('every reaction carries the name of whoever said it', () => {
  const record = freshTable(11, 2);
  playRandom(record, 1, 110);
  record.seats[1]!.reactions = { 0: ['where'] };
  const [post] = tableReactions(record);
  assert.ok(post, 'nothing was said');
  assert.equal(post.name, 'Player 1');
  assert.equal(post.seat, 1);
});

test('anything that is not one of the six is dropped rather than shown', () => {
  const record = freshTable(12, 2);
  playRandom(record, 1, 120);
  // A row written by something that is not this app, or by a later version of it.
  record.seats[0]!.reactions = { 0: ['brave', 'drop table players', ''] as ReactionKey[] };
  assert.deepEqual(
    tableReactions(record).map((post) => post.key),
    ['brave'],
    'free text reached the table',
  );
  assert.equal(isReaction('brave'), true);
  assert.equal(isReaction('anything else'), false);
});

/* --- 3. Idan's six, in his words ------------------------------------------------------------ */

test("the six are Idan's, in his order, and the Hebrew is exactly what he wrote", () => {
  assert.deepEqual([...REACTIONS], ['brave', 'where', 'withYou', 'shame', 'mum', 'explain']);
  const he = catalogue('he');
  assert.deepEqual(
    REACTIONS.map((key) => he[`reaction.${key}`]),
    [
      'אמיץ!',
      'יא אהבל לאן הלכת',
      'אחי, מבין אותך',
      'אייייי חבל לא שמת יותר',
      'מי אוהב אותך נסיך של אמא',
      'תסביר לי',
    ],
    "the Hebrew is not word for word what Idan wrote — it is his copy, not the app's",
  );
  // And the English is there too, so neither language falls back to a raw key.
  const en = catalogue('en');
  for (const key of REACTIONS) {
    assert.ok(en[`reaction.${key}`], `reaction.${key} has no English`);
  }
});

/* --- 4. The table against the dealer (§3.6) ------------------------------------------------- */

test('the table sums chips and hands, weights the bar by decisions, and takes the best streak', () => {
  const record = freshTable(21, 3);
  playRandom(record, 8, 210);
  const screen = sharedScreen(record, 0);
  const playing = screen.seats.filter((seat) => seat.handsPlayed > 0 || seat.decisions > 0);

  assert.equal(
    screen.table.stack,
    playing.reduce((sum, seat) => sum + seat.stack, 0),
    'chips are not summed',
  );
  assert.equal(
    screen.table.handsPlayed,
    playing.reduce((sum, seat) => sum + seat.handsPlayed, 0),
    'hands are not summed',
  );
  assert.equal(
    screen.table.decisions,
    playing.reduce((sum, seat) => sum + seat.decisions, 0),
    'decisions are not summed',
  );
  assert.equal(
    screen.table.streak,
    playing.reduce((best, seat) => Math.max(best, seat.streak), 0),
    'the best streak is not the maximum',
  );

  const right = playing.reduce((sum, seat) => sum + seat.right, 0);
  assert.equal(screen.table.bar, right / screen.table.decisions, 'the bar is not weighted by decisions');
});

test('weighting is not averaging — a seat with three decisions cannot swing the table', () => {
  /*
   * The test that the rule is the rule: a table where one seat has played a
   * great deal and another almost nothing, and where the two ways of combining
   * give visibly different answers. A plain average is the lie §3.6 names, and
   * it has to be measurably absent rather than merely intended.
   */
  const record = freshTable(33, 2);
  playRandom(record, 12, 330);
  /* Seat 1 leaves after the first hand, so it carries very few decisions. */
  record.seats[1]!.events = [
    { kind: 'join', seat: 1, hand: 0 },
    { kind: 'drop', seat: 1, hand: 1, why: 'left' },
  ];

  const screen = sharedScreen(record, 0);
  const rated = screen.seats.filter((seat) => seat.decisions > 0);
  assert.ok(rated.length >= 2, 'this table needs two seats with decisions to say anything');

  const weighted = screen.table.bar;
  const averaged =
    rated.reduce((sum, seat) => sum + seat.right / seat.decisions, 0) / rated.length;
  assert.ok(weighted !== null, 'the table has enough decisions to print a bar');
  assert.notEqual(
    Number(weighted.toFixed(6)),
    Number(averaged.toFixed(6)),
    'the weighted bar and the plain average agree, so this table proves nothing — pick another',
  );

  const lost = rated.reduce((sum, seat) => sum + seat.evLost, 0);
  assert.equal(
    screen.table.evLostPer100,
    (lost / screen.table.decisions) * 100,
    'EV lost per 100 is not weighted by decisions',
  );
});

test('the table prints no bar until it has as many decisions as one player needs', () => {
  const record = freshTable(41, 2);
  playRandom(record, 1, 410);
  const screen = sharedScreen(record, 0);
  if (screen.table.decisions < 10) {
    assert.equal(screen.table.bar, null, 'a table of three decisions printed a percentage');
    assert.equal(screen.table.evLostPer100, null, 'a rate was printed off too few decisions');
  }
});

/* --- 5. The ticker (§3.10) ------------------------------------------------------------------ */

test('no line the ticker can draw mentions money, in either language', () => {
  /*
   * §3.10 is explicit that the ticker never announces money, and the way to
   * hold that is over the strings themselves rather than over one table that
   * happened not to produce one: a figure in a ticker line would have to come
   * from a placeholder, and the placeholders are countable.
   */
  for (const locale of ['en', 'he'] as const) {
    for (const key of ['shared.ticker.reaction', 'shared.ticker.gesture', 'shared.ticker.record']) {
      const line = catalogue(locale)[key]!;
      for (const money of ['{stack}', '{units}', '{chips}', '{net}', '{bet}']) {
        assert.ok(!line.includes(money), `${locale} ${key} carries ${money}`);
      }
    }
  }
});

test('the ticker only ever holds gestures, reactions and records', () => {
  const record = freshTable(51, 3);
  playRandom(record, 10, 510);
  record.seats[0]!.reactions = { 2: ['brave'] };
  const screen = sharedScreen(record, 0);
  assert.ok(screen.ticker.length > 0, 'nothing reached the ticker at all');
  for (const item of screen.ticker) {
    assert.ok(
      ['reaction', 'gesture', 'record'].includes(item.kind),
      `the ticker carries a ${item.kind}`,
    );
    assert.ok(!Object.keys(item).includes('stack'), 'a ticker item carries a stack');
    assert.ok(!Object.keys(item).includes('net'), 'a ticker item carries money');
  }
  /* And it is in the table's own order, so two phones rotate through one list. */
  const hands = screen.ticker.map((item) => item.hand);
  assert.deepEqual(hands, [...hands].sort((a, b) => a - b), 'the ticker is not in hand order');
});

test('a reaction reaches the ticker attributed to the player who said it', () => {
  const record = freshTable(52, 2);
  playRandom(record, 3, 520);
  record.seats[1]!.reactions = { 1: ['mum'] };
  const said = sharedScreen(record, 0).ticker.filter((item) => item.kind === 'reaction');
  assert.equal(said.length, 1);
  assert.equal(said[0]!.name, 'Player 1');
  const line = t('he', 'shared.ticker.reaction', {
    name: said[0]!.name,
    said: t('he', 'reaction.mum'),
  });
  assert.ok(line.includes('Player 1'), 'the ticker line drops the name');
  assert.ok(line.includes('מי אוהב אותך'), "the ticker line drops what was said");
});

/* --- 6. He took my card (§3.8) -------------------------------------------------------------- */

test('the counterfactual names the card the shoe would really have dealt', () => {
  /*
   * The claim is not that a different card is plausible. It is that this one is
   * the card — so the test checks the line against the table it was read off,
   * for both shapes: the one where his decision moved a card in the hand he
   * made it, and the commoner one where it moved a card in the hand after.
   */
  let sameHand = 0;
  let nextHand = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const record = freshTable(seed, 3);
    playRandom(record, 6, seed * 17);
    for (let hand = 0; hand < 6; hand++) {
      for (const line of [counterfactual(record, 0, hand), counterfactual(record, 0, hand, hand + 1)]) {
        if (!line) continue;
        if (line.showing === line.hand) sameHand++;
        else nextHand++;

        /* What was actually dealt, at the position the line names. */
        const actual = deriveTable(record)
          .hands.find((entry) => entry.hand === line.showing)!
          .seats.find((entry) => entry.seat === 0)!.cards;
        assert.equal(
          actual[line.position - 1],
          line.actualCard,
          `seed ${seed}: the line misreads my own hand`,
        );
        assert.notEqual(line.otherCard, line.actualCard, 'the counterfactual names the same card twice');
        assert.ok(line.showing === line.hand || line.showing === line.hand + 1, 'a line about neither hand');
      }
    }
  }
  /*
   * Both shapes have to be exercised, and the numbers are the ones measured on
   * 2026-09-21: within one hand the reservation rule makes this rare, and the
   * hand after is where the coupling survives. If the same-hand count ever
   * reaches zero the search has broken, not the shoe.
   */
  assert.ok(sameHand > 0, 'no same-hand counterfactual at all in forty tables');
  assert.ok(nextHand > sameHand, `the next-hand shape should be the commoner one: ${nextHand} vs ${sameHand}`);
});

test('the search prefers the hand a player means before the hand after it', () => {
  /*
   * §3.8's own example is about this hand, so when this hand has one it must be
   * the one offered — the weaker, commoner statement is a fallback and never a
   * replacement.
   */
  let checked = 0;
  for (let seed = 1; seed <= 60 && checked < 3; seed++) {
    const record = freshTable(seed, 3);
    playRandom(record, 6, seed * 17);
    for (let hand = 0; hand < 6; hand++) {
      if (!counterfactual(record, 0, hand)) continue;
      const offered = counterfactualBack(record, 0, hand);
      assert.ok(offered, 'the scan found nothing where the direct question found something');
      assert.equal(offered.showing, offered.hand, 'the scan offered the weaker line over the stronger one');
      checked++;
      break;
    }
  }
  assert.ok(checked > 0, 'no table in sixty had a same-hand counterfactual to check the order with');
});

test('the neighbour moves the cards and cannot move the grade', () => {
  /*
   * §3.8's whole point, and the reason the line is safe to show at all. The
   * replay changes what I was dealt. What it must not change is how any
   * decision already made was graded — because a grade is a function of the
   * cards in front of the player, the upcard and the rules, and a neighbour
   * reaches none of the three.
   */
  for (let seed = 1; seed <= 40; seed++) {
    const record = freshTable(seed, 3);
    playRandom(record, 3, seed * 23);
    const table = deriveTable(record);

    for (const hand of table.hands) {
      for (const decision of hand.decisions) {
        /*
         * The same cards, the same upcard, the same rules — so the same answer,
         * whoever is sitting beside him and whatever they did. The derivation
         * is asked twice and the grades compared.
         */
        const again = deriveTable(JSON.parse(JSON.stringify(record)) as TableRecord)
          .hands.find((entry) => entry.hand === hand.hand)!
          .decisions.find(
            (entry) =>
              entry.seat === decision.seat &&
              entry.round === decision.round &&
              entry.hand === decision.hand,
          );
        assert.ok(again, `seed ${seed}: a decision vanished`);
        assert.equal(again.optimalAction, decision.optimalAction, `seed ${seed}: the best play changed`);
        assert.equal(again.evCost, decision.evCost, `seed ${seed}: what the decision cost changed`);
      }
    }
  }
});

test('a seat on its own has no counterfactual, because there is nobody to blame', () => {
  const record = freshTable(77, 1);
  playRandom(record, 3, 770);
  for (let hand = 0; hand < 3; hand++) {
    assert.equal(counterfactual(record, 0, hand), null, 'a solo seat was offered a counterfactual');
  }
});

/* --- 7. A spot you both met (§3.8) ---------------------------------------------------------- */

test('the shared spots are cells both seats met and answered differently', () => {
  let found = 0;
  for (let seed = 1; seed <= 40 && found < 10; seed++) {
    const record = freshTable(seed, 3);
    playRandom(record, 12, seed * 29);
    for (const spot of sharedSpots(record, 0)) {
      found++;
      assert.notEqual(spot.myAction, spot.theirAction, 'a spot with no disagreement in it');
      assert.notEqual(spot.seat, 0, 'a seat was compared against itself');
      assert.ok(spot.scenarioKey.length > 0, 'a spot with no cell');
      /* The chart's answer is one of the two, or neither — never undefined. */
      assert.equal(typeof spot.optimalAction, 'string');
      assert.equal(spot.mineRight, spot.myAction === spot.optimalAction || spot.mineRight);
    }
  }
  assert.ok(found > 0, 'no shared spots in forty tables, which cannot be right');
});

test('insurance is not a spot, because it is not a way to play a hand', () => {
  const record = freshTable(81, 2);
  playRandom(record, 20, 810);
  for (const spot of sharedSpots(record, 0)) {
    assert.notEqual(spot.scenarioKey, 'bj:insurance', 'insurance was compared as a chart cell');
  }
});

/* --- 8. The private table is untouched ------------------------------------------------------ */

test('none of the social layer exists at the private table', () => {
  /*
   * The same scan round 23 left behind, widened by this round's words. Idan's
   * rule is that clocks, votes and drops belong to the shared table alone, and
   * reactions and the ticker join that list: the private table is where
   * somebody practises, and there is nobody there to talk to.
   */
  const solo = source('public', 'app.js');
  for (const word of ['reaction', 'ticker', 'counterfactual', 'sharedReact']) {
    assert.ok(!solo.toLowerCase().includes(word.toLowerCase()), `the private table mentions ${word}`);
  }
});
