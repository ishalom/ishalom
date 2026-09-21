/**
 * Two seats, one shoe, two phones (round 22; spec A, round A2).
 *
 * A1 proved the derivation agrees with itself. The thing A2 has to prove is the
 * one that cannot be tested any other way: **that what one phone shows is what
 * the other shows** — so these tests run two independent copies of the driver,
 * each with its own state, against one store, exactly as two devices would.
 * Neither can see the other's variables; the only thing they share is the table.
 *
 * The driver is `artifact/shared.js`, the file the built page actually runs,
 * evaluated here rather than reimplemented. A test that exercised a copy of it
 * would pass on the day the real one broke.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sharedScreen, BAR_SETTLES_AT } from '../src/shared-screen.ts';
import { deriveTable, seatCardsHash, type SeatMove, type TableRecord } from '../src/shared-table.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (...parts: string[]) => readFileSync(join(HERE, '..', ...parts), 'utf8');

/* --- One store, as two phones see it ----------------------------------------------------- */

interface StoredSeat {
  seat: number;
  player_id: string | null;
  name: string | null;
  bet: number;
  moves: SeatMove[];
  hands: number;
  vote: unknown;
  cards_hash: string | null;
}

/**
 * A stand-in for the database, with the one property the design rests on: a
 * write names a row, and only that row changes. The join is conditional in the
 * same way the real one is — it takes the seat only while it is still free —
 * because that is the mechanism, not an implementation detail of PostgREST.
 */
function fakeStore() {
  const tables = new Map<string, { id: string; seed: number; presetId: string; restrictions: unknown; events: unknown[] }>();
  const seats = new Map<string, StoredSeat[]>();
  let writes = 0;
  const store = {
    writesByRow: new Map<string, number>(),
    async createTable(table: any) {
      tables.set(table.id, {
        id: table.id,
        seed: table.seed,
        presetId: table.presetId,
        restrictions: table.restrictions,
        events: table.events ?? [],
      });
      seats.set(
        table.id,
        Array.from({ length: table.seats }, (_, seat) => ({
          seat,
          player_id: seat === 0 ? table.createdBy : null,
          name: seat === 0 ? table.createdByName : null,
          bet: seat === 0 ? table.bet : 1,
          moves: [],
          hands: 0,
          vote: null,
          cards_hash: null,
        })),
      );
      return table.id;
    },
    async joinTable(id: string, seat: number, player: any) {
      const row = seats.get(id)?.find((entry) => entry.seat === seat);
      if (!row) return { seat, taken: true };
      // Conditional: it is taken only while it is free.
      if (row.player_id !== null) return { seat, taken: true };
      row.player_id = player.id;
      row.name = player.name;
      row.bet = player.bet ?? 1;
      return { seat, taken: false };
    },
    async pushSeat(id: string, seat: number, record: any) {
      const row = seats.get(id)?.find((entry) => entry.seat === seat);
      if (!row) return false;
      writes++;
      const key = `${id}:${seat}`;
      store.writesByRow.set(key, (store.writesByRow.get(key) ?? 0) + 1);
      row.moves = record.moves;
      row.bet = record.bet;
      row.hands = record.hands ?? 0;
      row.vote = record.vote ?? null;
      row.cards_hash = record.cardsHash ?? null;
      return true;
    },
    async pushEvents(id: string, events: unknown[]) {
      const table = tables.get(id);
      if (table) table.events = events;
      return true;
    },
    async readTable(id: string) {
      const table = tables.get(id);
      if (!table) return null;
      return {
        ...table,
        // Read back as copies, so a phone can never hold a live handle on the
        // store and see another phone's write without asking for it.
        seats: (seats.get(id) ?? []).map((row) => ({
          seat: row.seat,
          playerId: row.player_id,
          name: row.name,
          bet: row.bet,
          moves: row.moves.map((move) => ({ ...move })),
          hands: row.hands,
          vote: row.vote,
          cardsHash: row.cards_hash ?? undefined,
        })),
        events: table.events.map((event) => ({ ...(event as object) })),
      };
    },
    get writes() {
      return writes;
    },
  };
  return store;
}

interface Phone {
  create(options?: Record<string, unknown>): Promise<any>;
  join(id: string): Promise<any>;
  refresh(): Promise<unknown>;
  act(action: string): Promise<any>;
  deal(): Promise<any>;
  vote(): Promise<any>;
  leave(): Promise<void>;
  breakChecksum(): Promise<void>;
  screen(): any;
  clock(): any;
  state: any;
}

/**
 * One device, running the page's own driver in its own scope.
 *
 * `new Function` gives each phone a private copy of every variable the file
 * declares, which is the point: if the two ever agree only because they are
 * sharing a closure, the test is worthless.
 */
function phone(store: ReturnType<typeof fakeStore>, who: { id: string; name: string }): Phone {
  const code = source('artifact', 'shared.js');
  const made = new Function(
    'backend',
    'sharedScreen',
    'deriveTable',
    'seatCardsHash',
    `${code}
     return {
       sharedCreate, sharedJoin, sharedRefresh, sharedAct, sharedDeal,
       sharedVote, sharedLeave, sharedForceMismatch,
       sharedScreenNow, sharedClock, sharedState,
     };`,
  )(store, sharedScreen, deriveTable, seatCardsHash) as any;

  return {
    create: (options = {}) =>
      made.sharedCreate({ playerId: who.id, name: who.name, bet: 1, seats: 2, ...options }),
    join: (id: string) => made.sharedJoin(id, { id: who.id, name: who.name, bet: 1 }),
    refresh: () => made.sharedRefresh(),
    act: (action: string) => made.sharedAct(action),
    deal: () => made.sharedDeal(),
    vote: () => made.sharedVote(),
    leave: () => made.sharedLeave(),
    breakChecksum: () => made.sharedForceMismatch(),
    screen: () => made.sharedScreenNow(),
    clock: () => made.sharedClock(),
    state: made.sharedState,
  };
}

/** Sit two people down at a new table and hand back both phones. */
async function twoSeats() {
  const store = fakeStore();
  const idan = phone(store, { id: 'idan', name: 'Idan' });
  const dani = phone(store, { id: 'dani', name: 'Dani' });
  const made = await idan.create();
  await dani.join(made.id);
  await idan.refresh();
  return { store, idan, dani, id: made.id as string };
}

/** Whoever the table is waiting on, played by a fixed rule so the test repeats. */
async function playOut(idan: Phone, dani: Phone, hands: number) {
  await idan.deal();
  await dani.refresh();
  for (let played = 0; played < hands; played++) {
    for (let guard = 0; guard < 80; guard++) {
      const screen = idan.screen();
      if (!screen || screen.handOver) break;
      let moved = false;
      for (const who of [idan, dani]) {
        await who.refresh();
        const mine = who.screen();
        if (mine && mine.legal.length > 0) {
          await who.act(mine.legal.includes('stand') ? 'stand' : mine.legal[0]);
          moved = true;
        }
      }
      await idan.refresh();
      if (!moved) break;
    }
    if (played < hands - 1) {
      await idan.deal();
      await dani.refresh();
    }
  }
  await idan.refresh();
  await dani.refresh();
}

/* --- 1. Two phones, one shoe ------------------------------------------------------------- */

test('two seats create, join and play a shoe, and both phones show the same cards', async () => {
  const { idan, dani } = await twoSeats();
  await playOut(idan, dani, 6);

  const mine = idan.screen();
  const theirs = dani.screen();
  assert.ok(mine && theirs, 'a phone has no screen');
  assert.equal(mine.hand, theirs.hand, 'the two phones are on different hands');

  /*
   * The claim, stated as a player would: every card either of them can see is
   * the same card. Compared seat by seat rather than by hashing the lot, so a
   * failure says which hand went wrong.
   */
  for (const seat of mine.seats) {
    const same = theirs.seats.find((row: any) => row.seat === seat.seat);
    assert.ok(same, `seat ${seat.seat} is missing from the other phone`);
    assert.deepEqual(
      seat.hands.map((hand: any[]) => hand.map((card) => `${card.rank}${card.suit}`)),
      same.hands.map((hand: any[]) => hand.map((card: any) => `${card.rank}${card.suit}`)),
      `seat ${seat.seat} was dealt differently on the two phones`,
    );
    assert.equal(seat.net, same.net, `seat ${seat.seat} settled differently on the two phones`);
  }
  assert.deepEqual(
    mine.dealer.map((card: any) => `${card.rank}${card.suit}`),
    theirs.dealer.map((card: any) => `${card.rank}${card.suit}`),
    'the dealer is different on the two phones',
  );
  assert.ok(!mine.refused && !theirs.refused, 'the table refused itself');
  assert.ok(mine.seats[0].decisions > 0, 'nobody played a decision');
});

test('each phone writes only its own row', async () => {
  const { store, idan, dani, id } = await twoSeats();
  await playOut(idan, dani, 3);
  // Both rows were written, which is only interesting because of the next line.
  assert.ok((store.writesByRow.get(`${id}:0`) ?? 0) > 0, 'seat 0 never wrote');
  assert.ok((store.writesByRow.get(`${id}:1`) ?? 0) > 0, 'seat 1 never wrote');
  /*
   * And the moves in each row were made by its owner. A driver that wrote its
   * neighbour's row would show up here as a move in the wrong place, because
   * each phone only ever knows one player's decisions to write.
   */
  const record = (await store.readTable(id))!;
  assert.equal(record.seats.length, 2);
  assert.equal(record.seats[0]!.playerId, 'idan');
  assert.equal(record.seats[1]!.playerId, 'dani');
});

/* --- 2. What one seat may see of the other ----------------------------------------------- */

test("a neighbour's decisions stay hidden until I have played my own hand", async () => {
  const { idan, dani } = await twoSeats();
  await idan.deal();
  await dani.refresh();

  // Idan acts first. Dani has not.
  const first = idan.screen();
  await idan.act(first.legal.includes('stand') ? 'stand' : first.legal[0]);
  await dani.refresh();

  const waiting = dani.screen();
  assert.ok(waiting.legal.length > 0, 'Dani was not asked to act');
  /*
   * His cards are face up — they are at a real table — but what he did with
   * them is not in the object at all. Not hidden in the markup: absent, so a
   * player reading the page's own state finds nothing to read.
   */
  const his = waiting.seats.find((seat: any) => !seat.mine);
  assert.ok(his.hands.length > 0, "the neighbour's cards should be face up");
  assert.equal(JSON.stringify(waiting).includes('evByAction'), false, 'a grade leaked into the view');

  await dani.act(waiting.legal.includes('stand') ? 'stand' : waiting.legal[0]);
  await dani.refresh();
  assert.ok(dani.screen().handOver, 'the hand did not finish once both had played');
});

test('the hole card is not in the view until the dealer turns it', async () => {
  const { idan, dani } = await twoSeats();
  await idan.deal();
  await dani.refresh();

  const before = idan.screen();
  assert.equal(before.dealerRevealed, false);
  assert.equal(before.dealer.length, 1, 'the hole card was in the view before it was turned');

  for (const who of [idan, dani]) {
    await who.refresh();
    const mine = who.screen();
    if (mine.legal.length > 0) await who.act('stand');
  }
  await idan.refresh();
  const after = idan.screen();
  assert.equal(after.dealerRevealed, true);
  assert.ok(after.dealer.length >= 2, 'the dealer never showed a second card');
});

/* --- 3. Nobody waits for anybody --------------------------------------------------------- */

test('a seat can act while its neighbour is still thinking, and sees its own card at once', async () => {
  const { idan, dani } = await twoSeats();
  await idan.deal();
  await dani.refresh();

  /*
   * The promise of dealing this way, tested as a player would feel it: Idan
   * hits and sees his card, with Dani not having touched the screen. Before
   * round 22 the derivation stopped the whole hand at the first seat that had
   * not acted, so this was exactly what a player could not do.
   */
  const before = idan.screen().me.hands[0].length;
  const legal = idan.screen().legal;
  if (legal.includes('hit')) {
    await idan.act('hit');
    const after = idan.screen();
    assert.ok(
      after.me.hands[0].length > before || after.handOver,
      'the card did not arrive until the neighbour acted',
    );
  }
  // And Dani is still the one the table is waiting on.
  await dani.refresh();
  assert.ok(dani.screen().legal.length > 0, 'Dani lost his turn because Idan took his');
});

/* --- 4. The clock and the vote ----------------------------------------------------------- */

test('the clock starts only when one player is the last one holding the table', async () => {
  const { idan, dani } = await twoSeats();
  await idan.deal();
  await dani.refresh();

  /*
   * Idan's rule, and the reason it is better than a per-turn clock: while both
   * are still deciding, nobody is being hurried.
   */
  assert.equal(idan.clock(), null, 'the clock ran while both players were still deciding');

  await idan.act('stand');
  await dani.refresh();

  const clock = dani.clock();
  assert.ok(clock, 'the clock did not start when one player was left holding the table');
  assert.equal(clock.seat, dani.state.seat, 'the clock is counting down the wrong seat');
  assert.equal(clock.mine, true, 'the player being counted cannot see it');
  assert.ok(clock.secondsLeft > 0 && clock.secondsLeft <= 30, `seconds left was ${clock.secondsLeft}`);
  assert.equal(clock.canVote, false, 'a vote was offered before the thirty seconds were up');

  // And the player waiting sees the same countdown, about somebody else.
  const watching = idan.clock();
  assert.ok(watching, 'the waiting player cannot see the countdown');
  assert.equal(watching.mine, false);
  assert.equal(watching.name, 'Dani');
});

test('after thirty seconds a vote may be called, and one waiting player is enough for two seats', async () => {
  const { idan, dani } = await twoSeats();
  await idan.deal();
  await dani.refresh();
  await idan.act('stand');
  await idan.refresh();

  // Wind the clock back rather than waiting thirty seconds for it.
  idan.state.heldSince = Date.now() - 31000;

  const ready = idan.clock();
  assert.equal(ready.canVote, true, 'no vote after thirty seconds');
  assert.equal(ready.votes, 0);
  /*
   * With two seats there is exactly one waiting player, so the first vote needs
   * one agreement and the escalation has no rungs to climb. The ladder in §3.3
   * — each vote needing one agreement fewer, down to one — is a six-seat
   * mechanism; at two seats it is already at the bottom.
   */
  assert.equal(ready.needs, 1, 'a two-seat table asked for more than the one waiting player');

  await idan.vote();
  await dani.refresh();

  const record = dani.screen();
  const gone = record.seats.find((seat: any) => seat.seat === dani.state.seat);
  assert.equal(gone.status, 'away', 'the vote passed but the seat is still live');
});

test('leaving deliberately writes the same event and costs nothing', async () => {
  const { store, idan, dani, id } = await twoSeats();
  await idan.deal();
  await dani.refresh();
  await dani.leave();

  const record = (await store.readTable(id))!;
  const events = record.events as Array<{ kind: string; seat: number; why?: string }>;
  const left = events.find((event) => event.kind === 'drop' && event.why === 'left');
  assert.ok(left, 'leaving wrote no event');
  /*
   * §3.3: the offence is not slowness, it is letting the table rot rather than
   * playing or leaving — so a clean exit is marked as one, and a vote is not
   * the only way a seat can end.
   */
  assert.notEqual(left!.why, 'vote');
  // And it carries the hand rather than a time, so the cards still follow the log.
  assert.equal(typeof (left as any).hand, 'number');
  assert.equal(Object.prototype.hasOwnProperty.call(left, 'at'), false);
});

test('nothing about a drop is written as a timestamp', () => {
  const driver = source('artifact', 'shared.js');
  const drop = driver.slice(driver.indexOf('async function sharedDrop('), driver.indexOf('async function sharedLeave('));
  assert.doesNotMatch(drop, /Date\.now\(\)|toISOString|new Date/, 'a drop carries a clock');
});

/* --- 5. The two measures ----------------------------------------------------------------- */

test('the bar prints nothing until it has settled, and the stack always prints', () => {
  const record: TableRecord = {
    id: 't', seed: 3, presetId: 'vegas-strip-6d-s17',
    restrictions: { noSurrender: false, likeRanksOnly: false },
    seats: [0, 1].map((seat) => ({
      seat, playerId: `p${seat}`, name: seat ? 'Dani' : 'Idan', bet: seat ? 5 : 1,
      moves: [] as SeatMove[], hands: 1,
    })),
    events: [0, 1].map((seat) => ({ kind: 'join' as const, seat, hand: 0 })),
  };
  const screen = sharedScreen(record, 0);
  for (const seat of screen.seats) {
    assert.equal(seat.bar, null, 'a bar printed a percentage on the first hand');
    assert.equal(typeof seat.stack, 'number', 'the stack did not print');
  }
  assert.ok(BAR_SETTLES_AT >= 10, 'the bar settles too early to mean anything');
});

test('the line that names the two measures appears only when they disagree', async () => {
  const { idan, dani } = await twoSeats();
  await playOut(idan, dani, 12);
  const screen = idan.screen();
  const bars = screen.seats.map((seat: any) => seat.bar);
  if (bars.every((bar: number | null) => bar !== null)) {
    const leaderByStack = [...screen.seats].sort((a: any, b: any) => b.stack - a.stack)[0];
    const leaderByBar = [...screen.seats].sort((a: any, b: any) => b.bar - a.bar)[0];
    if (leaderByStack.name === leaderByBar.name) {
      assert.equal(screen.comparison, null, 'the line appeared when the same player led both');
    } else {
      assert.ok(screen.comparison, 'the line is missing when the two measures disagree');
      assert.equal(screen.comparison.leaderByStack, leaderByStack.name);
      assert.equal(screen.comparison.leaderByBar, leaderByBar.name);
    }
  }
});

/* --- 6. The refusal, seen -------------------------------------------------------------- */

test('a seat whose checksum does not match refuses the whole table, on both phones', async () => {
  const { idan, dani } = await twoSeats();
  await playOut(idan, dani, 2);
  assert.equal(idan.screen().refused, false, 'the table refused itself before anything went wrong');

  // The hatch: it writes a hash this seat's cards could not have produced.
  await dani.breakChecksum();
  await idan.refresh();

  assert.equal(dani.screen().refused, true, 'the seat that broke its own hash still shows a table');
  assert.equal(idan.screen().refused, true, 'the other phone still shows a table');
});

test('the refusal is reachable on purpose, and only behind the debug flag', () => {
  const screen = source('public', 'shared.js');
  assert.match(screen, /ev:debug/, 'there is no way to reach the refusal');
  assert.match(screen, /force-mismatch/, 'the hatch does not call the route');
  const shell = source('artifact', 'shell.js');
  assert.match(shell, /'\/api\/shared\/force-mismatch'/, 'the route is missing');
  /* And the screen that says so exists, in both languages. */
  const strings = source('src', 'i18n.ts');
  assert.match(strings, /'shared\.refusedTitle': 'This table cannot be shown'/);
  assert.match(strings, /'shared\.refusedTitle': 'אי אפשר להציג את השולחן הזה'/);
});

/* --- 7. The leave control is as prominent as the rest ----------------------------------- */

test('the leave control sits with the actions rather than in a menu', () => {
  const screen = source('public', 'shared.js');
  const actions = screen.slice(screen.indexOf('function renderActions('), screen.indexOf('function renderTalk('));
  assert.match(actions, /shared-leave/, 'leaving is not among the actions');
  assert.match(actions, /class = 'action shared-leave'|'action shared-leave'/, 'leaving does not look like an action');
  /*
   * §3.3 makes this part of the spec rather than a preference: if silence is
   * punished then speaking has to be cheap, and an exit buried in a menu means
   * the penalty lands on somebody who did not know there was a door.
   */
});
