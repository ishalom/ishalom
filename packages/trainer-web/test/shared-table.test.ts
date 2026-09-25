/**
 * The shared table's shoe, seats and record (round 21; spec A, round A1).
 *
 * A round with no screen is where quality quietly slips, because nothing looks
 * wrong. So the tests are the deliverable, and these are the five the spec said
 * would have to hold before anything is built on top of them:
 *
 *   1. the same seed and the same decisions give the same cards, over hundreds
 *      of random tables;
 *   2. two seats acting in the same instant take **different** cards — checked
 *      as the property that matters: changing what one seat does cannot change
 *      what its neighbour was already looking at;
 *   3. a seat's grade is the grade the same cards get away from this table;
 *   4. a drop and a return are read from the log and never from a clock, and a
 *      table with a drop in it replays to the same cards;
 *   5. the conditional join refuses the second comer — against a stand-in for
 *      PostgREST, because the mechanism being tested is the request.
 *
 * And one that belongs to the other table: the private game has no clock, no
 * vote and no drop, and never will.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bjRankOfCard } from '@evtrainer/ev-engine';
import { makeRng } from '@evtrainer/game-engine';

import { analyse } from '../src/analyse.ts';
import {
  cardsHash,
  deriveTable,
  forgetLastDerivation,
  isLive,
  playTable,
  seatCardsHash,
  seatsAgree,
  type Reservation,
  type SeatMove,
  type TableRecord,
} from '../src/shared-table.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (...parts: string[]) => readFileSync(join(HERE, '..', ...parts), 'utf8');

/** A table nobody has played yet. */
function freshTable(seed: number, seats = 2, presetId = 'vegas-strip-6d-s17'): TableRecord {
  return {
    id: `t${seed}`,
    seed,
    presetId,
    restrictions: { noSurrender: false, likeRanksOnly: false },
    // Each seat's own join, in its own row — round 23 moved the log there so
    // that no row at this table has two writers.
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

/** Play a table out with a seeded, repeatable set of choices. */
function playRandom(record: TableRecord, hands: number, seed: number) {
  const rng = makeRng(seed);
  return playTable(record, hands, ({ legal }) => legal[rng.nextInt(legal.length)] as SeatMove['action']);
}

const cardsOf = (table: ReturnType<typeof deriveTable>) =>
  table.hands.map((hand) => ({
    dealer: hand.dealer,
    burned: hand.burned,
    seats: hand.seats.map((seat) => ({ seat: seat.seat, cards: seat.cards, net: seat.net })),
  }));

// --- 1. The same seed and the same decisions give the same cards -------------------------------

test('a table derives to the same cards every time, over hundreds of them', () => {
  let decisions = 0;
  let splits = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const played = freshTable(seed, 2 + (seed % 5));
    const first = playRandom(played, 4, seed * 7);
    // The record now holds the moves. Deriving it again must produce the table.
    const second = deriveTable(played);
    assert.deepEqual(cardsOf(second), cardsOf(first), `seed ${seed} derived differently the second time`);
    // And a third derivation on a *copy* of the record, as another device would —
    // worked out afresh, not handed the last one `deriveTable` kept (round 34's memo).
    forgetLastDerivation();
    const elsewhere = deriveTable(JSON.parse(JSON.stringify(played)) as TableRecord);
    assert.deepEqual(cardsOf(elsewhere), cardsOf(first), `seed ${seed} derived differently elsewhere`);
    for (const hand of first.hands) {
      decisions += hand.decisions.length;
      splits += hand.decisions.filter((d) => d.action === 'split').length;
    }
  }
  assert.ok(decisions > 2000, `only ${decisions} decisions were played`);
  assert.ok(splits > 20, `only ${splits} splits came up, so the two-card reservation is untested`);
});

test('six seats, hundreds of shoes: the same events give the same cards, and every seat agrees', () => {
  /*
   * The full table (round 23). Six seats is where the reservation rule has the
   * most to get wrong — six hands to put a card aside for every round, splits
   * among them, and a seat's own cards sitting at a position fixed before
   * anybody acted. Over two hundred shoes it must come out the same twice, and
   * all six seats must agree about every card that was dealt.
   */
  let decisions = 0;
  let splits = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const played = freshTable(seed, 6);
    const first = playRandom(played, 3, seed * 13);
    const again = deriveTable(played);
    assert.deepEqual(cardsOf(again), cardsOf(first), `seed ${seed} derived differently the second time`);

    /*
     * And the checksum, which is the thing two phones actually compare. Each
     * seat hashes what it saw; if six seats ever hashed six different tables,
     * this is where it would show.
     */
    const hashes = played.seats.map((seat) => seatCardsHash(again, seat.seat));
    const elsewhere = deriveTable(JSON.parse(JSON.stringify(played)) as TableRecord);
    for (const seat of played.seats) {
      assert.equal(
        seatCardsHash(elsewhere, seat.seat),
        hashes[seat.seat],
        `seed ${seed}: seat ${seat.seat} hashed a different table on the second device`,
      );
      seat.cardsHash = hashes[seat.seat];
    }
    assert.ok(seatsAgree(played, elsewhere), `seed ${seed}: six seats did not agree`);

    for (const hand of first.hands) {
      decisions += hand.decisions.length;
      splits += hand.decisions.filter((d) => d.action === 'split').length;
    }
  }
  assert.ok(decisions > 3000, `only ${decisions} decisions over six-seat tables`);
  assert.ok(splits > 30, `only ${splits} splits, so the six-seat reservation is barely tested`);
});

test('a different seed is a different table, and the same seed with different play is too', () => {
  const a = cardsOf(playRandom(freshTable(11), 4, 5));
  const b = cardsOf(playRandom(freshTable(12), 4, 5));
  assert.notDeepEqual(a, b, 'two seeds dealt the same cards');
  // The neighbour's choices move what comes out afterwards — which is the whole
  // reason Idan chose this shape over the one where everybody gets the same cards.
  const c = cardsOf(playRandom(freshTable(11), 4, 6));
  assert.notDeepEqual(a, c, 'the same shoe played differently produced the same cards');
});

// --- 2. Two seats acting at once take different cards ------------------------------------------

test('changing what one seat does cannot change what its neighbour already saw', () => {
  /*
   * The property the reservation rule exists for, tested as a player would feel
   * it: seat 1 taps Hit and seat 0 taps Stand in the same instant. Whichever
   * order the writes arrive in, seat 0's card for that round was reserved
   * before either of them acted, so it cannot move.
   */
  let checked = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const original = freshTable(seed, 3);
    const played = playRandom(original, 3, seed * 3);

    for (const hand of played.hands) {
      const swing = hand.decisions.find(
        (decision) => decision.seat > 0 && decision.round === 0 && decision.action !== 'stand',
      );
      if (!swing) continue;
      const changed = JSON.parse(JSON.stringify(original)) as TableRecord;
      const seat = changed.seats.find((entry) => entry.seat === swing.seat)!;
      const move = seat.moves.find((entry) => entry.hand === swing.hand && entry.round === 0)!;
      if (!legalAlternative(swing)) continue;
      move.action = 'stand';
      // Everything that seat did afterwards in this hand goes with it.
      seat.moves = seat.moves.filter((entry) => entry.hand !== swing.hand || entry.round <= 0);
      const after = deriveTable(changed);
      const before = played.hands.find((entry) => entry.hand === swing.hand)!;
      const now = after.hands.find((entry) => entry.hand === swing.hand);
      if (!now) continue;
      for (const other of before.seats) {
        if (other.seat === swing.seat) continue;
        const mine: { cards: number[] } | undefined = now.seats.find((entry) => entry.seat === other.seat);
        if (!mine) continue;
        /*
         * The two cards dealt before anybody acted cannot move, and neither can
         * what round 0 put aside for this seat — which is the reservation rule
         * itself, and so the thing worth asserting. Its *third card* is not the
         * right thing to look at: a seat that stood in round 0 took no card
         * there, so its third card came from some later round, and later rounds
         * are allowed to move. Idan chose this shape over the one where
         * everybody gets the same cards precisely so that they would.
         */
        assert.deepEqual(
          mine.cards.slice(0, 2),
          other.cards.slice(0, 2),
          `seed ${seed} hand ${swing.hand}: seat ${other.seat} was dealt differently because seat ${swing.seat} changed its mind`,
        );
        const roundZero = (hand: { reserved: Reservation[] }): Reservation[] =>
          hand.reserved.filter((entry) => entry.seat === other.seat && entry.round === 0);
        const reservedNow = roundZero(now);
        const reservedBefore = roundZero(before);
        assert.deepEqual(
          reservedNow,
          reservedBefore,
          `seed ${seed} hand ${swing.hand}: seat ${other.seat}'s round was re-reserved because seat ${swing.seat} changed its mind`,
        );
        checked++;
      }
    }
  }
  assert.ok(checked > 50, `only ${checked} neighbours were checked`);
});

/** Standing is legal wherever anything is, so it is always a valid alternative. */
function legalAlternative(decision: { action: string }): boolean {
  return decision.action !== 'stand' && decision.action !== 'takeInsurance' && decision.action !== 'declineInsurance';
}

test('within one hand, no card is dealt twice', () => {
  /*
   * Positions are not exposed, so this counts instead: across the seats, the
   * dealer and the discard tray, a six-deck shoe can hold at most six of any
   * one card. Two seats being handed the same physical card would show up here
   * as a seventh.
   */
  for (let seed = 1; seed <= 40; seed++) {
    const table = playRandom(freshTable(seed, 4), 3, seed);
    for (const hand of table.hands) {
      const counts = new Map<number, number>();
      const all = [...hand.dealer, ...hand.burned, ...hand.seats.flatMap((seat) => seat.cards)];
      for (const card of all) counts.set(card, (counts.get(card) ?? 0) + 1);
      for (const [card, count] of counts) {
        assert.ok(count <= 6, `seed ${seed} hand ${hand.hand}: card ${card} was dealt ${count} times`);
      }
    }
  }
});

// --- 3. One grading path -----------------------------------------------------------------------

test('a shared-table decision is graded exactly as the same cards are graded away from it', () => {
  /*
   * Compared rather than inspected, and compared against a *different* surface:
   * `analyse()` is round 16's hand analyser, which the solo app also offers and
   * which reaches the engine by its own route. If the shared table ever forks
   * the grading, these two stop agreeing.
   *
   * What is compared: for every decision, the EV of every action the analyser
   * offers, and which action is best — on the same cards, the same upcard and
   * the same rule set.
   */
  /*
   * A card's rank as the analyser names it.
   *
   * Through the engine's own `bjRankOfCard`, and not by shifting the card two
   * bits: a card's raw rank runs deuce-to-ace, so shifting reads every deuce as
   * an ace and every ace as a ten, and the analyser then answers honestly about
   * a hand nobody held. The engine's blackjack rank is the one that counts tens
   * together and puts the ace first, which is the order these names are in.
   */
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
  const rankOf = (card: number) => RANKS[bjRankOfCard(card)]!;
  let compared = 0;
  /** Split hands, and how many of their figures the fresh-hand answer differs on. */
  let splitHands = 0;
  let splitHandsDiffered = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const table = playRandom(freshTable(seed, 2), 4, seed * 11);
    for (const hand of table.hands) {
      for (const decision of hand.decisions) {
        if (decision.round < 0) continue; // insurance is asked elsewhere
        if (decision.cards.length > 4) continue; // the analyser takes up to four
        /*
         * A hand that came out of a split is worth something different from the
         * same two cards dealt fresh — it cannot be a natural, doubling it may
         * be barred, and how many hands the seat holds decides whether it may
         * split again. The engine is told all of that; the analyser has no way
         * to be told it, because a player naming two cards is naming a fresh
         * hand. So these are counted and checked below rather than compared
         * here: asking the analyser would be asking about a different hand.
         */
        if (decision.fromSplit || decision.handCount > 1) {
          splitHands++;
          const fresh = analyse({
            player: decision.cards.map(rankOf),
            dealer: rankOf(decision.upcard),
            presetId: 'vegas-strip-6d-s17',
            locale: 'en',
          }) as { ok: boolean; ranked?: Array<{ action: string; ev: number }> };
          if (fresh.ok && fresh.ranked) {
            for (const row of fresh.ranked) {
              const mine = decision.evByAction[row.action];
              if (mine !== undefined && Math.abs(mine - row.ev) >= 1e-9) splitHandsDiffered++;
            }
          }
          continue;
        }
        const answer = analyse({
          player: decision.cards.map(rankOf),
          dealer: rankOf(decision.upcard),
          presetId: 'vegas-strip-6d-s17',
          locale: 'en',
        }) as { ok: boolean; ranked?: Array<{ action: string; ev: number }> };
        if (!answer.ok || !answer.ranked) continue;
        for (const row of answer.ranked) {
          const mine = decision.evByAction[row.action];
          if (mine === undefined) continue;
          assert.ok(
            Math.abs(mine - row.ev) < 1e-9,
            `seat ${decision.seat} hand ${decision.hand}: ${row.action} is ${mine} at the shared table and ${row.ev} away from it`,
          );
          compared++;
        }
        assert.equal(
          decision.optimalAction,
          answer.ranked[0]!.action,
          'the shared table and the analyser disagree about the best play',
        );
      }
    }
  }
  assert.ok(compared > 300, `only ${compared} figures were compared`);
  /*
   * And the other half of the same claim: the split context is not quietly
   * dropped on the way to the engine. If it were, a split hand would be graded
   * as a fresh one and these would agree everywhere — so the disagreement is
   * the proof, and its absence would be the bug.
   */
  assert.ok(splitHands > 0, 'no split hands came up, so the split context is untested');
  assert.ok(
    splitHandsDiffered > 0,
    `${splitHands} split hands were graded exactly as fresh hands, so the split context never reached the engine`,
  );
});

// --- 4. Drops and returns are read from the log ------------------------------------------------

test('a seat is live by its events and by nothing else', () => {
  const record = freshTable(5, 2);
  record.seats[1]!.events!.push({ kind: 'drop', seat: 1, hand: 2 }, { kind: 'return', seat: 1, hand: 4 });
  assert.equal(isLive(record, 1, 0), true);
  assert.equal(isLive(record, 1, 1), true);
  assert.equal(isLive(record, 1, 2), false, 'a dropped seat was still live at the hand it was dropped');
  assert.equal(isLive(record, 1, 3), false);
  assert.equal(isLive(record, 1, 4), true, 'a returned seat did not come back');
  assert.equal(isLive(record, 0, 3), true, 'the other seat was dropped too');
});

test('a table with a drop in it replays to the same cards', () => {
  const record = freshTable(909, 3);
  record.seats[1]!.events!.push({ kind: 'drop', seat: 1, hand: 1 }, { kind: 'return', seat: 1, hand: 3 });
  const played = playRandom(record, 4, 909);
  const again = deriveTable(record);
  assert.deepEqual(cardsOf(again), cardsOf(played), 'a table with a drop derived differently the second time');

  // And the dropped seat was dealt nothing while it was away.
  const away = played.hands.filter((hand) => hand.hand === 1 || hand.hand === 2);
  for (const hand of away) {
    assert.ok(
      !hand.seats.some((seat) => seat.seat === 1),
      `seat 1 was dealt cards at hand ${hand.hand}, after being dropped at hand 1`,
    );
  }
  const back = played.hands.find((hand) => hand.hand === 3)!;
  assert.ok(back.seats.some((seat) => seat.seat === 1), 'a returned seat was not dealt back in');
});

test('nothing in the derivation asks what time it is', () => {
  const code = source('src', 'shared-table.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  for (const clock of ['Date.now', 'new Date', 'performance.now', 'setTimeout', 'seenAt', 'seen_at']) {
    assert.ok(!code.includes(clock), `the derivation reads ${clock}`);
  }
});

// --- The checksum ------------------------------------------------------------------------------

test('two seats agree about what was dealt, and a table that disagrees is refused', () => {
  const record = freshTable(77, 2);
  const table = playRandom(record, 3, 77);
  for (const seat of record.seats) seat.cardsHash = seatCardsHash(table, seat.seat);
  assert.equal(seatsAgree(record, table), true, 'two honest seats disagreed');

  // One seat saw something else: the table cannot be shown.
  record.seats[1]!.cardsHash = cardsHash([1, 2, 3]);
  assert.equal(seatsAgree(record, table), false, 'a table whose seats disagree was accepted');

  // A seat that has not written one yet is not a disagreement.
  record.seats[1]!.cardsHash = undefined;
  assert.equal(seatsAgree(record, table), true);
});

test('a seat that wrote before the next deal still agrees; one whose past changed does not (round 29)', () => {
  const record = freshTable(29, 2);
  // Both write with nothing dealt yet — the friend who has just sat down.
  const before = deriveTable(record);
  for (const seat of record.seats) seat.cardsHash = seatCardsHash(before, seat.seat);
  assert.match(record.seats[1]!.cardsHash!, /^0:/, 'a seat with no cards did not write a count of zero');

  // Then the table moves on without them. Round 28 refused it here, on both phones.
  const later = playRandom(record, 3, 29);
  assert.ok((later.seen.get(1) ?? []).length > 0, 'the test dealt nothing');
  assert.equal(seatsAgree(record, later), true, 'the first deal after a join refused the table');

  // Halfway: what a seat had seen then is still a prefix of what it has seen now.
  const seen = later.seen.get(1)!;
  const half = Math.floor(seen.length / 2);
  record.seats[1]!.cardsHash = `${half}:${cardsHash(seen.slice(0, half))}`;
  assert.equal(seatsAgree(record, later), true, 'an honest seat that wrote mid-shoe was refused');

  // But a past that changed is still a refusal...
  const drifted = [...seen.slice(0, half)];
  drifted[0] = drifted[0] === 1 ? 2 : 1;
  record.seats[1]!.cardsHash = `${half}:${cardsHash(drifted)}`;
  assert.equal(seatsAgree(record, later), false, 'a seat whose earlier cards changed was accepted');

  // ...and so is a seat claiming more cards than the table has dealt it.
  record.seats[1]!.cardsHash = `${seen.length + 1}:${cardsHash(seen)}`;
  assert.equal(seatsAgree(record, later), false, 'a seat ahead of the table was accepted');
});

// --- 5. The join, against a stand-in for PostgREST ---------------------------------------------

/**
 * Enough of PostgREST to test the one request that matters.
 *
 * The conditional join is a filter on an UPDATE — `player_id=is.null` — and
 * PostgREST answering with the rows it changed. A stub that understood only
 * "update the seat" would test nothing, so this one applies the filters and
 * returns what it changed, which is where the safety actually lives.
 */
function fakeRest() {
  const tables: Record<string, unknown>[] = [];
  const seats: Record<string, unknown>[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const rows = url.pathname.endsWith('/tables') ? tables : seats;
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk as Buffer));
    request.on('end', () => {
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      const matches = (row: Record<string, unknown>) => {
        for (const [column, test] of url.searchParams) {
          if (column === 'select' || column === 'order') continue;
          if (test === 'is.null') {
            if (row[column] !== null && row[column] !== undefined) return false;
          } else if (test.startsWith('eq.')) {
            if (String(row[column]) !== decodeURIComponent(test.slice(3))) return false;
          }
        }
        return true;
      };
      if (request.method === 'POST') {
        const added = Array.isArray(body) ? body : [body];
        rows.push(...(added as Record<string, unknown>[]));
        response.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify(added));
        return;
      }
      if (request.method === 'PATCH') {
        const changed = rows.filter(matches);
        for (const row of changed) Object.assign(row, body);
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(changed));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(rows.filter(matches)));
    });
  });
  return { server, tables, seats };
}

/** The shared-table half of `httpBackend`, loaded from the file the build ships. */
async function backendUnderTest(origin: string) {
  const code = source('artifact', 'backends.js');
  const from = code.indexOf('function httpBackend(');
  const to = code.indexOf('\nfunction ', from + 10);
  const factory = new Function(
    `${code.slice(from, to > 0 ? to : undefined)}; return httpBackend;`,
  )() as (config: { url: string; key: string }) => SharedTableBackend;
  return factory({ url: origin, key: 'test-key' });
}

/**
 * The four calls the shared table makes of a backend, and nothing else.
 *
 * Written out here rather than imported: `backends.js` is plain JavaScript
 * lifted out of the built artifact and run through `new Function`, so this is
 * the only place the shape is stated, and stating it is what makes the test
 * fail when a call is renamed or loses an argument.
 */
interface SharedTableBackend {
  createTable(table: {
    id: string;
    seed: number;
    presetId: string;
    restrictions: Record<string, unknown>;
    seats: number;
    createdBy: string;
    createdByName: string;
    bet: number;
  }): Promise<string>;
  joinTable(
    tableId: string,
    seat: number,
    player: { id: string; name: string; bet?: number },
  ): Promise<{ seat: number; taken: boolean }>;
  pushSeat(
    tableId: string,
    seat: number,
    seatRecord: {
      playerId: string;
      bet: number;
      moves: SeatMove[];
      hands?: number;
      events?: unknown[];
      cardsHash?: string;
    },
  ): Promise<boolean>;
  readTable(tableId: string): Promise<{
    seed: number;
    presetId: string;
    seats: Array<{ seat: number; playerId: string | null; moves: SeatMove[]; hands: number }>;
  } | null>;
}

test('the conditional join gives the seat to the first comer and tells the second', async () => {
  const { server, seats } = fakeRest();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const backend = await backendUnderTest(origin);
    await backend.createTable({
      id: 'table-1',
      seed: 42,
      presetId: 'vegas-strip-6d-s17',
      restrictions: {},
      seats: 2,
      createdBy: 'idan',
      createdByName: 'Idan',
      bet: 1,
    });
    assert.equal(seats.length, 2, 'the table was made without its seats');
    assert.equal(seats[0]!.player_id, 'idan', 'the maker did not take seat 0');
    assert.equal(seats[1]!.player_id, null, 'seat 1 was not left empty');

    // Two people press at the same instant.
    const [first, second] = await Promise.all([
      backend.joinTable('table-1', 1, { id: 'dani', name: 'Dani' }),
      backend.joinTable('table-1', 1, { id: 'ruti', name: 'Ruti' }),
    ]);
    const answers = [first, second];
    assert.equal(answers.filter((answer) => !answer.taken).length, 1, 'the seat was given to both or to neither');
    assert.equal(answers.filter((answer) => answer.taken).length, 1, 'the second comer was not told');
    assert.equal(seats.filter((seat) => seat.seat === 1).length, 1, 'the table grew a second seat 1');
    assert.ok(['dani', 'ruti'].includes(String(seats[1]!.player_id)));

    // And a third, later, is told the same thing.
    const third = await backend.joinTable('table-1', 1, { id: 'noa', name: 'Noa' });
    assert.equal(third.taken, true, 'a seat that is taken was handed out again');

    // Each seat writes its own row, and reads come back in the shape the
    // derivation wants.
    await backend.pushSeat('table-1', 0, {
      playerId: 'idan',
      bet: 2,
      moves: [{ hand: 0, round: 0, action: 'stand' }],
      cardsHash: 'abcd1234',
    });
    const read = (await backend.readTable('table-1'))!;
    assert.equal(read.seed, 42);
    assert.equal(read.presetId, 'vegas-strip-6d-s17');
    assert.equal(read.seats.length, 2);
    assert.deepEqual(read.seats[0]!.moves, [{ hand: 0, round: 0, action: 'stand' }]);
    assert.equal(read.seats[1]!.moves.length, 0);
  } finally {
    server.close();
  }
});

test('a seat writes its own row and no other', () => {
  const code = source('artifact', 'backends.js');
  const push = code.slice(code.indexOf('async pushSeat('), code.indexOf('async readTable('));
  // The filter names the seat *and* the player: a row belonging to somebody
  // else cannot be reached even by asking for it.
  assert.match(push, /seat=eq\./);
  assert.match(push, /player_id=eq\./);
  const join = code.slice(code.indexOf('async joinTable('), code.indexOf('async pushSeat('));
  assert.match(join, /player_id=is\.null/, 'the join is not conditional');
});

// --- And the other table -----------------------------------------------------------------------

test('the private table has no clock, no vote and no drop, and never will', () => {
  /*
   * Idan's rule: "אלה חוקים שרלוונטים רק לשולחן המשותף. מי שלא ברמה שיתאמן
   * בשולחן הפרטי." A clock that can eject a player is the §3.1 failure, and the
   * solo game is where somebody practises without one.
   */
  const files = [
    ['src', 'session.ts'],
    ['public', 'app.js'],
    ['public', 'table.html'],
    /*
     * And the strip a player sees over the private table while he waits for a
     * friend (round 23). It is the one new thing that appears on that screen,
     * and the whole question about it is whether it is a clock. It is not: it
     * counts nothing down and can eject nobody, and this is where that is held.
     */
    ['artifact', 'waiting.js'],
  ];
  for (const parts of files) {
    const code = source(...parts)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    /*
     * Named as identifiers, not as words. A bare 'suspend' also matches the Web
     * Audio context's own `state === 'suspended'`, which is the browser pausing
     * a sound and has nothing to do with suspending a player — so it failed
     * this for a reason that was never the rule.
     */
    for (const forbidden of [
      'countdown',
      'kickVote',
      'dropSeat',
      'timeLimit',
      'turnTimer',
      'suspendSeat',
      'suspendPlayer',
    ]) {
      assert.ok(!code.includes(forbidden), `${parts.join('/')} has ${forbidden} in it`);
    }
  }
});
