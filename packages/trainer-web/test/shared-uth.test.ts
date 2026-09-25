/**
 * The shared Ultimate table (round 32).
 *
 * As in round A1, the tests are the deliverable. The round named four, and the
 * shape Idan settled names the rest:
 *
 *   1. the same seed and the same decisions give the same board and the same
 *      cards — and every seat's checksum, which now carries the board, agrees;
 *   2. two seats are graded exactly as the private table grades the same cards,
 *      down to the card the player reads;
 *   3. a table replays from its log with no clock;
 *   4. the conditional join refuses the second comer, at an Ultimate table;
 *
 * and, from Idan's two rules: one board and one dealer for everybody, nobody's
 * choice or arrival moving anybody else's cards; everyone decides, the board
 * turns when everyone has, three times, with no reservation anywhere; a seat
 * that has raised is finished and never holds the table; and the drop, the
 * forfeit and the rating reach Ultimate by the paths Blackjack's do.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeRng, UthTable, type UthAction } from '@evtrainer/game-engine';

import {
  deriveTable,
  seatCardsHash,
  seatRatable,
  seatView,
  seatsAgree,
  counterfactualBack,
  forgetLastDerivation,
  sharedSpots,
  type SeatMove,
  type TableRecord,
} from '../src/shared-table.ts';
import { sharedScreen } from '../src/shared-screen.ts';
import { isUthTable, playUthTable, UTH_PRESET_ID } from '../src/shared-uth.ts';
import { UthSession } from '../src/uth-session.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (...parts: string[]) => readFileSync(join(HERE, '..', ...parts), 'utf8');

/** An Ultimate table nobody has played yet. */
function freshTable(seed: number, seats = 2): TableRecord {
  return {
    id: `u${seed}`,
    seed,
    presetId: UTH_PRESET_ID,
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

/**
 * Seeded, repeatable, and cheap: mostly the pre-flop raise, which is a table
 * lookup, so a few hundred hands cost few flop solves. Every street is still
 * reached often enough to be exercised.
 */
function playCheap(record: TableRecord, hands: number, seed: number) {
  const rng = makeRng(seed);
  return playUthTable(record, hands, ({ legal }) => {
    if (legal.includes('raise4x') && rng.nextInt(10) < 7) return 'raise4x';
    return legal[rng.nextInt(legal.length)] as SeatMove['action'];
  });
}

/** A copy of a record with the same moves and nothing shared. */
function copyOf(record: TableRecord): TableRecord {
  return JSON.parse(JSON.stringify(record)) as TableRecord;
}

const boardsOf = (table: ReturnType<typeof deriveTable>) =>
  table.hands.map((hand) => ({
    board: hand.uth!.board,
    dealer: hand.dealer,
    seats: hand.seats.map((seat) => ({ seat: seat.seat, cards: seat.cards, net: seat.net })),
    decisions: hand.decisions.map((d) => [d.seat, d.round, d.action, d.evCost]),
  }));

// --- 1. The same seed and the same decisions --------------------------------------------------

test('an Ultimate table derives to the same board and cards every time, over many tables', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const record = freshTable(seed, 2 + (seed % 5));
    const played = playCheap(record, 6, seed * 7);
    const again = deriveTable(copyOf(record));
    assert.deepEqual(boardsOf(again), boardsOf(played), `seed ${seed} derived differently`);
    for (const seat of record.seats) {
      assert.equal(seatCardsHash(again, seat.seat), seatCardsHash(played, seat.seat));
    }
  }
});

test('one board and one dealer for the whole table, and each seat its own two cards', () => {
  const record = freshTable(11, 6);
  const table = playCheap(record, 20, 3);
  for (const hand of table.hands) {
    const facts = hand.uth!;
    assert.equal(facts.board.length, 5, 'a finished hand shows its whole board');
    const all = [...hand.dealer, ...facts.board, ...hand.seats.flatMap((seat) => seat.cards)];
    assert.equal(new Set(all).size, all.length, `hand ${hand.hand} dealt a card twice`);
    for (const seat of hand.seats) assert.equal(seat.cards.length, 2);
  }
  /*
   * And every seat's screen shows the one board: the same cards, in the same
   * order, whoever is looking.
   */
  const boards = record.seats.map((seat) => JSON.stringify(sharedScreen(record, seat.seat).board));
  assert.equal(new Set(boards).size, 1, 'two seats were shown two different boards');
  assert.ok(seatsAgree({ ...record, seats: record.seats.map((s) => ({ ...s, cardsHash: seatCardsHash(table, s.seat) })) }, table));
});

test('nobody can move anybody else\'s cards or the board: not by playing differently, not by leaving', () => {
  const base = freshTable(21, 3);
  const played = playCheap(base, 8, 5);

  // Seat 1 plays every hand differently.
  const other = freshTable(21, 3);
  const rng = makeRng(99);
  const replayed = playUthTable(other, 8, ({ seat, hand, round, legal }) => {
    if (seat === 1) return legal[rng.nextInt(legal.length)] as SeatMove['action'];
    return base.seats[seat]!.moves.find((m) => m.hand === hand && m.round === round)!.action;
  });
  for (let h = 0; h < 8; h++) {
    assert.deepEqual(replayed.hands[h]!.dealer, played.hands[h]!.dealer);
    for (const seat of [0, 2]) {
      assert.deepEqual(
        replayed.hands[h]!.seats.find((s) => s.seat === seat)!.cards,
        played.hands[h]!.seats.find((s) => s.seat === seat)!.cards,
      );
    }
    // The board as far as it turned may differ; the cards on it may not.
    const a = played.hands[h]!.uth!.board;
    const b = replayed.hands[h]!.uth!.board;
    assert.deepEqual(a.slice(0, Math.min(a.length, b.length)), b.slice(0, Math.min(a.length, b.length)));
  }

  // Seat 1 is not at the table at all.
  const without = copyOf(base);
  without.seats[1]!.events = [];
  const alone = deriveTable(without);
  for (let h = 0; h < 8; h++) {
    assert.equal(alone.hands[h]!.seats.some((s) => s.seat === 1), false);
    assert.deepEqual(alone.hands[h]!.dealer, played.hands[h]!.dealer);
    for (const seat of [0, 2]) {
      assert.deepEqual(
        alone.hands[h]!.seats.find((s) => s.seat === seat)!.cards,
        played.hands[h]!.seats.find((s) => s.seat === seat)!.cards,
      );
    }
  }
});

// --- 2. Graded exactly as the private table grades the same cards ------------------------------

test('a shared Ultimate decision is graded, settled and worded exactly as the private table does it', () => {
  const record = freshTable(31, 2);
  /* Every street, both ways: a table where nobody raises before the river, and one where they do. */
  const rng = makeRng(8);
  const table = playUthTable(record, 12, ({ legal, hand }) => {
    if (hand % 3 === 0) return legal[legal.length - 1] as SeatMove['action']; // check, check, fold
    return legal[rng.nextInt(legal.length)] as SeatMove['action'];
  });
  let compared = 0;
  const streets = new Set<number>();
  for (const hand of table.hands) {
    for (const seatHand of hand.seats) {
      const mine = hand.decisions.filter((d) => d.seat === seatHand.seat);
      const facts = mine[0]!.uth!;
      /* The private table itself, stacked with the same nine cards and played the same way. */
      const solo = new UthSession(1);
      solo.setLocale('he');
      const soloTable = (solo as unknown as { table: UthTable }).table;
      soloTable.stackNextHand([...facts.hole, ...hand.dealer, ...hand.uth!.board]);
      solo.deal();
      const speaker = new UthSession(1);
      speaker.setLocale('he');
      for (const decision of mine) {
        const view = solo.act(decision.action as UthAction) as { feedback: Record<string, unknown> };
        const graded = decision.uth!.record;
        const shared = speaker.explainDecision({ ...decision.uth!, bet: 1 });
        /* The card the player reads, whole: verdict, rows, worked lines, sentence, notes. */
        const { solveMs: _a, ...soloCard } = view.feedback as { solveMs: number };
        const { solveMs: _b, ...sharedCard } = shared as unknown as { solveMs: number };
        assert.deepEqual(sharedCard, soloCard, `hand ${hand.hand} seat ${seatHand.seat} round ${decision.round}`);
        assert.equal(graded.evCost, (view.feedback as { evCost: number }).evCost);
        streets.add(decision.round);
        compared++;
      }
      /* And the settlement: the same units, times this seat's own Ante. */
      const units = (solo as unknown as { table: UthTable }).table.view.netUnits!;
      const bet = record.seats[seatHand.seat]!.bet;
      assert.equal(seatHand.net, units * bet, `hand ${hand.hand} seat ${seatHand.seat} settled differently`);
    }
  }
  assert.ok(compared > 20, `only ${compared} decisions compared`);
  assert.deepEqual([...streets].sort(), [0, 1, 2], 'not every street was compared');
});

test('the memo that keeps a long table fast returns what a fresh solve returns', () => {
  const record = freshTable(41, 2);
  const table = playUthTable(record, 6, ({ legal }) => legal[legal.length - 1] as SeatMove['action']);
  for (const hand of table.hands) {
    for (const decision of hand.decisions.filter((d) => d.round > 0)) {
      const fresh = new UthTable({ seed: 1 });
      const facts = decision.uth!;
      fresh.stackNextHand([...facts.hole, ...hand.dealer, ...hand.uth!.board]);
      fresh.startHand();
      for (let street = 0; street < decision.round; street++) fresh.act('check');
      const { solveMs: _x, ...solved } = fresh.evaluate();
      const { solveMs: _y, ...memo } = facts.evaluation;
      assert.deepEqual(memo, solved);
    }
  }
});

// --- 3. From the log, with no clock --------------------------------------------------------------

test('an Ultimate table replays from its log alone, whatever the clock says', () => {
  const record = freshTable(51, 3);
  const played = boardsOf(playCheap(record, 10, 4));
  const realNow = Date.now;
  try {
    for (const fake of [0, 1e12, 4242]) {
      Date.now = () => fake;
      // Afresh each time, not the derivation `deriveTable` kept from the last one.
      forgetLastDerivation();
      assert.deepEqual(boardsOf(deriveTable(copyOf(record))), played);
    }
  } finally {
    Date.now = realNow;
  }
  const code = source('src', 'shared-uth.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/Date\b|performance|setTimeout|now\(/.test(code), 'the derivation reads a clock');
});

// --- Idan's rule: everyone decides, then the board turns ----------------------------------------

test('everyone decides; the board turns when everyone has; three times — with no reservation anywhere', () => {
  const record = freshTable(61, 2);
  record.seats.forEach((seat) => (seat.hands = 1));
  const act = (seat: number, action: SeatMove['action']) => {
    const view = seatView(record, seat);
    assert.ok(view.legal.includes(action), `seat ${seat} could not ${action}: ${view.legal}`);
    record.seats[seat]!.moves.push({ hand: 0, round: view.round, action });
  };
  const board = () => sharedScreen(record, 0).board.length;

  assert.equal(board(), 0);
  act(0, 'check');
  // Seat 0 has decided; seat 1 has not. Nothing turns, and seat 0 has nothing to press.
  assert.equal(board(), 0);
  assert.deepEqual(seatView(record, 0).legal, []);
  assert.deepEqual(seatView(record, 0).waitingFor, [1]);
  assert.equal(seatView(record, 0).onlyMe, false);
  assert.equal(seatView(record, 1).onlyMe, true, 'the clock would not start on the last one holding the table');
  act(1, 'check');
  assert.equal(board(), 3, 'the flop did not turn when both had decided');
  assert.equal(seatView(record, 1).round, 1);

  act(1, 'raise2x');
  assert.equal(board(), 3);
  // Seat 1 raised: it is finished, shown as finished, and nobody waits for it.
  assert.equal(seatView(record, 0).seats[1]!.status, 'done');
  assert.deepEqual(seatView(record, 0).waitingFor, [0]);
  act(0, 'check');
  assert.equal(board(), 5, 'the turn and river did not come when everyone had decided');
  // Only seat 0 owes the river; seat 1 is not asked again.
  assert.deepEqual(seatView(record, 1).legal, []);
  assert.deepEqual(seatView(record, 0).waitingFor, [0]);
  act(0, 'raise1x');

  const screen = sharedScreen(record, 0);
  assert.equal(screen.handOver, true);
  assert.equal(screen.dealer.length, 2, 'the dealer did not turn his cards at the end');
  assert.ok(screen.seats.every((seat) => seat.net !== null));

  const derived = deriveTable(record);
  assert.ok(derived.hands.every((hand) => hand.reserved.length === 0 && hand.burned.length === 0));
  const code = source('src', 'shared-uth.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/reserv/i.test(code.replace('reserved: []', '')), 'a reservation crept into the Ultimate table');
});

test('a seat that raised before the flop never holds the table, and the clock waits only on who owes', () => {
  const record = freshTable(71, 3);
  record.seats.forEach((seat) => (seat.hands = 1));
  record.seats[0]!.moves.push({ hand: 0, round: 0, action: 'raise4x' });
  record.seats[1]!.moves.push({ hand: 0, round: 0, action: 'check' });
  let view = seatView(record, 0);
  assert.deepEqual(view.waitingFor, [2]);
  record.seats[2]!.moves.push({ hand: 0, round: 0, action: 'check' });
  view = seatView(record, 0);
  assert.deepEqual(view.waitingFor, [1, 2], 'the seat that raised was waited for');
  assert.equal(view.seats[0]!.status, 'done');
});

test('a neighbour\'s two cards and the dealer\'s stay face down until the hand is over', () => {
  const record = freshTable(81, 2);
  record.seats.forEach((seat) => (seat.hands = 1));
  let screen = sharedScreen(record, 0);
  assert.equal(screen.me!.hands[0]!.length, 2, 'my own cards are not face up');
  const other = screen.seats.find((seat) => !seat.mine)!;
  assert.equal(other.hands.length, 0, 'a neighbour\'s cards were in the screen mid-hand');
  assert.equal(other.faceDown, 2);
  assert.equal(screen.dealer.length, 0, 'the dealer\'s cards were in the screen mid-hand');
  assert.equal(screen.boardHidden, 5);

  record.seats[0]!.moves.push({ hand: 0, round: 0, action: 'raise4x' });
  record.seats[1]!.moves.push({ hand: 0, round: 0, action: 'raise4x' });
  screen = sharedScreen(record, 0);
  assert.equal(screen.handOver, true);
  assert.equal(screen.seats.find((seat) => !seat.mine)!.hands[0]!.length, 2);
  assert.equal(screen.dealer.length, 2);
  assert.ok(screen.dealerWords);
});

test('when every seat folds, the hand is over and the dealer keeps his cards, as at the private table', () => {
  const record = freshTable(91, 2);
  record.seats.forEach((seat) => (seat.hands = 1));
  for (const seat of record.seats) {
    seat.moves.push({ hand: 0, round: 0, action: 'check' }, { hand: 0, round: 1, action: 'check' }, { hand: 0, round: 2, action: 'fold' });
  }
  const screen = sharedScreen(record, 1);
  assert.equal(screen.handOver, true);
  assert.equal(screen.dealerRevealed, false);
  assert.equal(screen.dealer.length, 0);
  assert.ok(screen.seats.every((seat) => seat.net === -2 * seat.bet));
});

// --- The screen's own parts, reached through the same interface ------------------------------

test('the Ultimate screen carries the analysis, the measures, the ticker and the bars, as Blackjack\'s does', () => {
  const record = freshTable(101, 2);
  const table = playCheap(record, 14, 12);
  record.seats[0]!.reactions = { '3': ['brave'] };
  const screen = sharedScreen(record, 0, 'he');
  assert.equal(screen.game, 'uth');
  assert.ok(screen.analysis.length > 0, 'no analysis of my last hand');
  const card = screen.analysis[screen.analysis.length - 1]!.feedback as { returns: { worked: unknown[] }; sentence: string };
  assert.ok(card.returns && Array.isArray(card.returns.worked), 'the analysis has no returns block');
  assert.ok(card.sentence.length > 0);
  const decided = table.hands.flatMap((hand) => hand.decisions.filter((d) => d.seat === 0)).length;
  assert.equal(screen.me!.decisions, decided);
  assert.ok(screen.me!.bar !== null, 'fourteen hands left the bar settling');
  assert.equal(screen.table.seats, 2);
  assert.ok(screen.ticker.some((item) => item.kind === 'reaction'));
  assert.ok(screen.me!.words, 'my hand is not named');
  // Blackjack's folklore has nothing to say here, and is not asked.
  assert.equal(counterfactualBack(record, 0, 13), null);
  assert.deepEqual(sharedSpots(record, 0), []);
});

// --- The drop, the forfeit and the rating ------------------------------------------------------

test('a vote drops an Ultimate seat from the hand, prices the forfeit, and leaves everybody else\'s cards alone', () => {
  const record = freshTable(111, 2);
  record.seats.forEach((seat) => (seat.hands = 1));
  record.seats[0]!.moves.push({ hand: 0, round: 0, action: 'check' });
  const before = deriveTable(record).hands[0]!;
  assert.deepEqual(before.waitingFor, [1]);
  // Two seats: the thirty seconds end the hand on their own, written as seat 0's vote.
  record.seats[0]!.vote = { hand: 0, against: 1, at: 0, needs: 1 };
  const after = deriveTable(record).hands[0]!;
  assert.equal(after.seats.some((seat) => seat.seat === 1), false, 'the dropped seat is still in the hand');
  assert.deepEqual(after.seats[0]!.cards, before.seats.find((s) => s.seat === 0)!.cards);
  assert.deepEqual(after.dealer, before.dealer);

  const owed = seatRatable(record, 1);
  assert.equal(owed.length, 1);
  assert.equal(owed[0]!.forfeit, true);
  assert.equal(owed[0]!.round, 0);
  assert.ok(owed[0]!.evByAction && 'raise4x' in owed[0]!.evByAction);
  const evs = Object.values(owed[0]!.evByAction!) as number[];
  assert.ok(Math.abs(owed[0]!.evCost - (Math.max(...evs) - Math.min(...evs))) < 1e-12, 'not priced at the worst action');
});

test("shared Ultimate decisions move the Ultimate rating exactly as the private table's would, and nothing else", () => {
  const record = freshTable(121, 2);
  const table = playCheap(record, 10, 6);
  const owed = seatRatable(record, 0);
  assert.ok(owed.every((d) => d.scenarioKey.startsWith('uth:') && d.evByAction));

  const shared = new UthSession(1);
  shared.absorbRated(owed);
  const after = shared.progress;
  assert.equal(after.hands, 0, 'a shared hand was counted as a private one');
  assert.equal(after.decisions, 0, "shared decisions reached the private table's accuracy");
  assert.equal(after.lifetimeDecisions, owed.length);

  /* The same hands, played at the private table: the rating must land in the same place. */
  const solo = new UthSession(1);
  const soloTable = (solo as unknown as { table: UthTable }).table;
  for (const hand of table.hands) {
    const mine = hand.decisions.filter((d) => d.seat === 0);
    soloTable.stackNextHand([...mine[0]!.uth!.hole, ...hand.dealer, ...hand.uth!.board]);
    solo.deal();
    for (const decision of mine) solo.act(decision.action as UthAction);
  }
  assert.deepEqual(
    { ...after.rating!, sessionDelta: 0 },
    { ...solo.progress.rating!, sessionDelta: 0 },
    'the shared table rated the same decisions differently',
  );
  assert.ok(after.rating!.ratedDecisions > 0, 'nothing reached the rating');
});

test('Blackjack tables are untouched: a Blackjack preset is not an Ultimate table', () => {
  assert.equal(isUthTable({ presetId: 'vegas-strip-6d-s17' }), false);
  assert.equal(isUthTable({ presetId: UTH_PRESET_ID }), true);
});

// --- 4. The conditional join, at an Ultimate table ----------------------------------------------

test('the conditional join gives an Ultimate seat to the first comer and tells the second', async () => {
  const rows: Record<string, unknown>[] = [];
  const tables: Record<string, unknown>[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const store = url.pathname.endsWith('/tables') ? tables : rows;
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk as Buffer));
    request.on('end', () => {
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      const matches = (row: Record<string, unknown>) => {
        for (const [column, rule] of url.searchParams) {
          if (column === 'select' || column === 'order') continue;
          if (rule === 'is.null' && row[column] !== null && row[column] !== undefined) return false;
          if (rule.startsWith('eq.') && String(row[column]) !== decodeURIComponent(rule.slice(3))) return false;
        }
        return true;
      };
      if (request.method === 'POST') {
        const added = Array.isArray(body) ? body : [body];
        store.push(...(added as Record<string, unknown>[]));
        response.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify(added));
      } else if (request.method === 'PATCH') {
        const changed = store.filter(matches);
        for (const row of changed) Object.assign(row, body);
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(changed));
      } else {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(store.filter(matches)));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const code = source('artifact', 'backends.js');
    const from = code.indexOf('function httpBackend(');
    const to = code.indexOf('\nfunction ', from + 10);
    const backend = new Function(`${code.slice(from, to > 0 ? to : undefined)}; return httpBackend;`)()({
      url: origin,
      key: 'test-key',
    });
    await backend.createTable({
      id: 'uth-1',
      seed: 7,
      presetId: UTH_PRESET_ID,
      restrictions: {},
      seats: 2,
      createdBy: 'idan',
      createdByName: 'Idan',
      bet: 1,
    });
    const answers = await Promise.all([
      backend.joinTable('uth-1', 1, { id: 'dani', name: 'Dani' }),
      backend.joinTable('uth-1', 1, { id: 'ruti', name: 'Ruti' }),
    ]);
    assert.equal(answers.filter((a: { taken: boolean }) => !a.taken).length, 1);
    assert.equal(answers.filter((a: { taken: boolean }) => a.taken).length, 1);
    const read = await backend.readTable('uth-1');
    assert.equal(read.presetId, UTH_PRESET_ID, 'the table came back as some other game');
  } finally {
    server.close();
  }
});

test('leaving by the home link costs nothing at an Ultimate table, and moves nobody else\'s cards', () => {
  const record = freshTable(131, 2);
  record.seats.forEach((seat) => (seat.hands = 1));
  record.seats[0]!.moves.push({ hand: 0, round: 0, action: 'check' });
  const before = deriveTable(record).hands[0]!;
  // What `sharedLeave` writes: a drop in the leaver's own row, marked as leaving.
  record.seats[1]!.events = [...(record.seats[1]!.events ?? []), { kind: 'drop', seat: 1, hand: 0, why: 'left' }];
  const after = deriveTable(record).hands[0]!;
  assert.equal(after.seats.some((seat) => seat.seat === 1), false, 'the seat that left is still dealt in');
  assert.deepEqual(after.seats[0]!.cards, before.seats.find((s) => s.seat === 0)!.cards);
  assert.deepEqual(after.dealer, before.dealer);
  assert.deepEqual(seatRatable(record, 1), [], 'leaving on purpose was charged as a forfeit');
  // The one still sitting goes on to the flop at once; nobody waits for the player who left.
  assert.deepEqual(seatView(record, 0).waitingFor, [0], 'the table still waits for the player who left');
  assert.equal(sharedScreen(record, 0).board.length, 3);
});
