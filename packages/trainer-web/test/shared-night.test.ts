/**
 * The first real night at the shared table, replayed (round 30).
 *
 * Idan and נירו played 97 hands on two phones on 2026-09-22. The fixture is
 * that table, anonymised — the seed, the rules and the moves, nothing else —
 * and these tests hold what round 30 changed to what the two of them actually
 * saw:
 *
 *   - **the ticker kept saying they were right.** 94 lines in 97 hands, 85 of
 *     them praise, none about any of the 37 mistakes — the bug Idan reported as
 *     *"זה נראה כאילו אתה צודק כל הזמן"*. The solo game's rarity now applies;
 *   - **a neighbour's bar moved the instant he acted**, before the other player
 *     had played, and an insurance nobody was offered counted as a right
 *     decision for everybody under an ace;
 *   - what each seat played, each hand of a split with its own result, and the
 *     hand's analysis staying up while the next hand is dealt.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PER_SITTING, RECORD_FLOOR } from '../src/gestures.ts';
import { sharedScreen } from '../src/shared-screen.ts';
import { deriveTable, seatRatable, wasAsked, type TableRecord } from '../src/shared-table.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const night = (): TableRecord =>
  JSON.parse(readFileSync(join(HERE, 'fixtures', 'shared-night-r30.json'), 'utf8')) as TableRecord;

/** The night cut short: every move before hand `hand`, plus the ones `keep` lets through at it. */
function cut(hand: number, keep: (seat: number, round: number) => boolean): TableRecord {
  const record = night();
  for (const seat of record.seats) {
    seat.moves = seat.moves.filter((move) => move.hand < hand || (move.hand === hand && keep(seat.seat, move.round)));
    seat.hands = hand + 1;
    seat.events = (seat.events ?? []).filter((event) => event.hand <= hand);
  }
  return record;
}

test('the ticker keeps the solo game’s rarity: two remarks a player a sitting, and none about a hand still in play', () => {
  const record = night();
  const ticker = sharedScreen(record, 1).ticker;
  const praise = ticker.filter((item) => item.kind === 'gesture' || item.kind === 'record');
  /* Round 29's page: 85 of these over the night. */
  for (const seat of [0, 1]) {
    const mine = praise.filter((item) => item.seat === seat);
    assert.ok(mine.length <= PER_SITTING, `seat ${seat} was praised ${mine.length} times in one sitting`);
    const rightAndLost = mine.filter((item) => item.kind === 'gesture');
    assert.ok(rightAndLost.length <= 1, `"played it right and lost" said ${rightAndLost.length} times to seat ${seat}`);
  }

  /*
   * "The best at this table so far" is true when it is said: the run named
   * passes the longest run any seat had put together before it.
   */
  const table = deriveTable(record);
  const run = new Map<number, number>();
  let best = 0;
  const bestBefore = new Map<number, number>();
  for (const hand of table.hands) {
    bestBefore.set(hand.hand, best);
    for (const decision of hand.decisions) {
      if (decision.round < 0) continue;
      const now = decision.evCost > 0 ? 0 : (run.get(decision.seat) ?? 0) + 1;
      run.set(decision.seat, now);
      best = Math.max(best, now);
    }
  }
  for (const item of praise) {
    if (item.kind !== 'record') continue;
    assert.ok(item.streak >= RECORD_FLOOR, 'a record below the floor was announced');
    assert.ok(item.streak > bestBefore.get(item.hand)!, `a run of ${item.streak} was called the table's best when it was not`);
  }

  /* Nothing about a hand still being played. */
  const midHand = cut(40, (seat) => seat === 0);
  const live = sharedScreen(midHand, 1).ticker.filter((item) => item.kind === 'gesture' || item.kind === 'record');
  assert.ok(live.every((item) => item.hand < 40), 'the ticker spoke about the hand still in play');
});

test('a neighbour’s bar does not move until I have played my own hand', () => {
  /* Hand 4: seat 0 surrendered an 18 (a mistake); seat 1 has not acted yet. */
  const before = cut(4, (seat) => seat === 0);
  const mineView = sharedScreen(before, 0).seats.find((seat) => seat.seat === 0)!;
  const theirView = sharedScreen(before, 1).seats.find((seat) => seat.seat === 0)!;
  assert.equal(mineView.decisions, theirView.decisions + 1, 'the neighbour saw the decision before playing his own');
  assert.deepEqual(theirView.actions, [], 'the neighbour saw what was played before playing his own');
  assert.deepEqual(mineView.actions, ['surrender'], 'my own action is not shown to me as it happens');

  /* Once seat 1 has acted, both see it — and the hand's actions with it. */
  const after = cut(4, () => true);
  const now = sharedScreen(after, 1).seats.find((seat) => seat.seat === 0)!;
  assert.equal(now.decisions, mineView.decisions, 'after playing my own, the neighbour’s decision is still hidden');
  assert.deepEqual(now.actions, ['surrender']);
});

test('an insurance nobody was offered is not counted as a right decision', () => {
  const record = night();
  const table = deriveTable(record);
  const unasked = table.hands.flatMap((hand) => hand.decisions.filter((decision) => decision.round === -1));
  assert.ok(unasked.length >= 6, 'the fixture no longer has an ace up');
  const screen = sharedScreen(record, 0);
  for (const seat of screen.seats) {
    const graded = table.hands.flatMap((hand) =>
      hand.decisions.filter((decision) => decision.seat === seat.seat && decision.round >= 0),
    );
    assert.equal(seat.decisions, graded.length, `seat ${seat.seat}'s bar counts ${seat.decisions - graded.length} it never made`);
  }
});

test('a split shows both hands, which one is being decided, and how each one ended', () => {
  /* Hand 0: seat 0 split, stood on the first hand, and is deciding the second. */
  const deciding = cut(0, (seat, round) => seat === 1 || round <= 2);
  const mid = sharedScreen(deciding, 0).seats.find((seat) => seat.seat === 0)!;
  assert.equal(mid.split.length, 2, 'a split seat does not show two hands');
  assert.deepEqual(
    mid.split.map((hand) => hand.active),
    [false, true],
    'the hand being decided is not the one marked',
  );
  assert.ok(mid.split.every((hand) => hand.net === null), 'a result is shown before the dealer has turned');

  const done = cut(0, () => true);
  const end = sharedScreen(done, 1).seats.find((seat) => seat.seat === 0)!;
  assert.equal(end.split.length, 2);
  assert.ok(end.split.every((hand) => hand.net !== null), 'a split hand has no result of its own');
  assert.ok(end.split.every((hand) => !hand.active), 'a settled hand is still marked as being decided');
  assert.equal(
    end.split.reduce((sum, hand) => sum + (hand.net ?? 0), 0),
    end.net,
    'the two results do not add up to what the seat won or lost',
  );
  assert.deepEqual(end.actions, ['split', 'stand', 'hit', 'stand']);
});

test('the hand’s analysis is mine, and stays up while the next hand is dealt', () => {
  /* Hand 10 finished, hand 11 dealt and nobody has acted in it yet. */
  const record = cut(11, () => false);
  const screen = sharedScreen(record, 0, 'he');
  assert.ok(screen.analysis.length > 0, 'the analysis vanished when the next hand was dealt');
  assert.ok(screen.analysis.every((decision) => decision.hand === 10), 'the analysis is not of my latest hand');
  const table = deriveTable(record);
  const mine = table.hands[10]!.decisions.filter((decision) => decision.seat === 0 && decision.round >= 0);
  assert.equal(screen.analysis.length, mine.length, 'the analysis carries decisions that are not mine');
  for (const decision of screen.analysis) {
    assert.ok(decision.headline.length > 0, 'the analysis has no headline');
    assert.equal(decision.steps.length, 3, 'the analysis does not carry the private card’s three steps');
    assert.match(decision.steps.join(' '), /[א-ת]/, 'the analysis is not in the player’s language');
    assert.equal(decision.correct, decision.evCost <= 0);
  }
});

test('a mistake’s remark is the player’s own: the ticker has no kind for one', () => {
  const kinds = new Set(sharedScreen(night(), 1).ticker.map((item) => item.kind));
  for (const kind of kinds) {
    assert.ok(['reaction', 'gesture', 'record', 'arrived', 'left'].includes(kind), `the ticker says "${kind}"`);
  }
  const strings = readFileSync(join(HERE, '..', 'src', 'i18n.ts'), 'utf8');
  for (const tier of ['minor', 'significant', 'blunder']) {
    const both = strings.match(new RegExp(`'shared\\.oops\\.${tier}'`, 'g')) ?? [];
    assert.equal(both.length, 2, `the ${tier} remark is not in both languages`);
  }
  const screen = readFileSync(join(HERE, '..', 'public', 'shared.js'), 'utf8');
  const remark = screen.slice(screen.indexOf('function mistakeLine('), screen.indexOf('function mistakeLine(') + 600);
  assert.doesNotMatch(remark, /ticker|react/, 'the remark reaches something other players see');
});

test('nothing the shared table says tells a player to deal: the next hand deals itself', () => {
  /*
   * Found by the live walk after round 30 was deployed: on a hand with no
   * decision in it (a natural) the dock fell back to "The hand is over. Deal
   * when you are ready." — a button that no longer exists.
   */
  const screen = readFileSync(join(HERE, '..', 'public', 'shared.js'), 'utf8');
  const keys = new Set([...screen.matchAll(/T\('(shared\.[A-Za-z.]+)'/g)].map((match) => match[1]!));
  const strings = readFileSync(join(HERE, '..', 'src', 'i18n.ts'), 'utf8');
  for (const key of keys) {
    for (const line of strings.split('\n').filter((row) => row.includes(`'${key}':`))) {
      assert.doesNotMatch(line, /Deal when|חלקו כש/, `${key} still tells a player to deal`);
    }
  }
  assert.ok(keys.has('shared.handOver'), 'the scan found none of the dock’s strings');
});

test('an insurance nobody was asked never reaches the rating, and the mark still passes it (round 31)', () => {
  /*
   * Round 30 took these out of the bars and left them in the rating: each of
   * the two players absorbed six "right" declines of an insurance the shared
   * table never offers. The list the mark counts along keeps them, so a table
   * rated under the old build hands nothing over twice.
   */
  const record = night();
  for (const seat of [0, 1]) {
    const all = seatRatable(record, seat);
    const rated = all.filter((decision) => wasAsked(record, seat, decision));
    assert.equal(all.length - rated.length, 6, `seat ${seat}: unasked insurances`);
    assert.ok(rated.every((decision) => decision.round !== -1), `seat ${seat} is rated on an insurance`);
  }

  const shell = readFileSync(join(HERE, '..', 'artifact', 'shell.js'), 'utf8');
  const absorb = shell.slice(shell.indexOf('async function absorbSharedRating'), shell.indexOf('function saveProgressLocally'));
  assert.match(absorb, /absorbRated\([^;]*wasAsked/, 'the shell rates every listed decision again');
  assert.match(absorb, /sharedMarkRated\(owed\.length\)/, 'the mark no longer passes the whole list');
});
