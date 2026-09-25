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
import {
  counterfactualBack,
  deriveTable,
  isLive,
  lastOccupant,
  passedVote,
  seatCardsHash,
  seatRatable,
  sharedSpots,
  type SeatMove,
  type TableRecord,
} from '../src/shared-table.ts';
import { exportUthSolves, importUthSolves, isUthTable } from '../src/shared-uth.ts';

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
  events: unknown[];
  /** The column's own default is an empty object, and so is this. */
  reactions: Record<string, string[]>;
  cards_hash: string | null;
}

/**
 * A stand-in for the database, with the one property the design rests on: a
 * write names a row, and only that row changes. The join is conditional in the
 * same way the real one is — it takes the seat only while it is still free —
 * because that is the mechanism, not an implementation detail of PostgREST.
 */
function fakeStore() {
  const tables = new Map<string, { id: string; seed: number; presetId: string; restrictions: unknown }>();
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
          events: seat === 0 ? [{ kind: 'join', seat: 0, hand: 0 }] : [],
          reactions: {},
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
      /*
       * The real write is filtered on the writer's own id, `player_id=eq.…`,
       * and a filter that matches nothing is not an error — PostgREST answers
       * 204 and changes nothing. This stand-in used to write by seat alone, so
       * a join that wrote its event from a row still reading "nobody here"
       * passed every test and lost the event on every phone (round 29).
       */
      if (row.player_id === null || row.player_id !== record.playerId) return true;
      writes++;
      const key = `${id}:${seat}`;
      store.writesByRow.set(key, (store.writesByRow.get(key) ?? 0) + 1);
      row.moves = record.moves;
      row.bet = record.bet;
      row.hands = record.hands ?? 0;
      row.vote = record.vote ?? null;
      row.events = record.events ?? [];
      row.reactions = record.reactions ?? {};
      row.cards_hash = record.cardsHash ?? null;
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
          events: (row.events ?? []).map((event) => ({ ...(event as object) })),
          reactions: JSON.parse(JSON.stringify(row.reactions ?? {})),
          cardsHash: row.cards_hash ?? undefined,
        })),
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
  react(key: string): Promise<any>;
  counterfactual(): any;
  spots(): any[];
  expire(): Promise<any>;
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
    'counterfactualBack',
    'sharedSpots',
    'isLive',
    // Round 35: the driver tells the games apart, keeps solves, and knows who sat in a seat before.
    'isUthTable',
    'importUthSolves',
    'exportUthSolves',
    'lastOccupant',
    'seatRatable',
    'passedVote',
    `${code}
     return {
       sharedCreate, sharedJoin, sharedRefresh, sharedAct, sharedDeal,
       sharedVote, sharedClockExpired, sharedLeave, sharedForceMismatch,
       sharedReact, sharedCounterfactual, sharedCounterfactualShown, sharedSpotsNow,
       sharedScreenNow, sharedClock, sharedState,
     };`,
  )(
    store,
    sharedScreen,
    deriveTable,
    seatCardsHash,
    counterfactualBack,
    sharedSpots,
    isLive,
    isUthTable,
    importUthSolves,
    exportUthSolves,
    lastOccupant,
    seatRatable,
    passedVote,
  ) as any;

  return {
    create: (options = {}) =>
      made.sharedCreate({ playerId: who.id, name: who.name, bet: 1, seats: 2, ...options }),
    join: (id: string) => made.sharedJoin(id, { id: who.id, name: who.name, bet: 1 }),
    refresh: () => made.sharedRefresh(),
    act: (action: string) => made.sharedAct(action),
    deal: () => made.sharedDeal(),
    vote: () => made.sharedVote(),
    react: (key: string) => made.sharedReact(key),
    counterfactual: () => made.sharedCounterfactual(),
    spots: () => made.sharedSpotsNow(),
    expire: () => made.sharedClockExpired(),
    leave: () => made.sharedLeave(),
    breakChecksum: () => made.sharedForceMismatch(),
    screen: () => made.sharedScreenNow(),
    clock: () => made.sharedClock(),
    state: made.sharedState,
  };
}

/**
 * Sit two people down at a new table and hand back both phones.
 *
 * A seed may be named, and the clock tests name one. Without it the table takes
 * a random shoe, which is right for a real table and wrong for a test about
 * what happens when one player is left holding it: on some shoes the second
 * player has no decision to make — a natural, or the dealer's — and there is
 * nothing to hold. Round 22's clock tests did not name one and passed on luck.
 */
async function twoSeats(seed?: number) {
  const store = fakeStore();
  const idan = phone(store, { id: 'idan', name: 'Idan' });
  const dani = phone(store, { id: 'dani', name: 'Dani' });
  const made = await idan.create(seed === undefined ? {} : { seed });
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
  const { idan, dani } = await twoSeats(11);
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
  const { store, idan, dani, id } = await twoSeats(12);
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
  const { idan, dani } = await twoSeats(3);
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
  const { idan, dani } = await twoSeats(3);
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
  const { idan, dani } = await twoSeats(3);
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
  const { idan, dani } = await twoSeats(3);
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

  // And the player waiting sees the same countdown, about somebody else.
  const watching = idan.clock();
  assert.ok(watching, 'the waiting player cannot see the countdown');
  assert.equal(watching.mine, false);
  assert.equal(watching.name, 'Dani');
});

test('at two seats there is no vote: the thirty seconds end the hand by themselves', async () => {
  /*
   * Idan's decision, and his reading of it was the same as the report's: with
   * one player waiting, a "vote" is that player pressing a button to agree with
   * himself. So there is no button. The hand simply ends, as the same drop with
   * the same consequences — one agreement, recorded in the waiting player's own
   * row, written without being asked for.
   */
  const { idan, dani } = await twoSeats(3);
  await idan.deal();
  await dani.refresh();
  await idan.act('stand');
  await idan.refresh();

  const held = idan.clock();
  assert.ok(held, 'the table is not being held');
  assert.equal(held.automatic, true, 'a two-seat table offered a vote');
  assert.equal(held.canVote, false, 'a vote was offered at two seats');
  assert.equal(held.waiting, 1, 'a two-seat table thinks more than one player is waiting');

  // Nothing happens before the thirty seconds are up.
  await idan.expire();
  await dani.refresh();
  assert.notEqual(
    dani.screen().seats.find((seat: any) => seat.seat === dani.state.seat).status,
    'away',
    'the hand ended before the thirty seconds were up',
  );

  // Wind the clock back rather than waiting thirty seconds for it.
  idan.state.heldSince = Date.now() - 31000;
  await idan.expire();
  await dani.refresh();

  const gone = dani.screen().seats.find((seat: any) => seat.seat === dani.state.seat);
  assert.equal(gone.status, 'away', 'the thirty seconds ran out and the seat is still live');
});

test('the seat being timed out is never the one that writes it', () => {
  const driver = source('artifact', 'shared.js');
  const expire = driver.slice(
    driver.indexOf('async function sharedClockExpired('),
    driver.indexOf('/** Agree that the player holding the table'),
  );
  assert.match(expire, /sharedState\.seat === clock\.seat/, 'the timed-out player can write his own drop');
});

test('the screen never asks for a seed, and no route offers one', () => {
  /*
   * §3.11: a seed you can ask for is a shoe you can practise against twice. The
   * driver accepts one so the clock can be tested against a fixed shoe; the
   * point of this test is that nothing a player can reach ever passes it.
   */
  /*
   * Read with the prose stripped out: this file explains that the cards come
   * from the seed and the log, and a scan that cannot tell a sentence from a
   * statement would fail on its own documentation.
   */
  const screen = source('public', 'shared.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(screen, /seed/, 'the screen asks for a seed');
  const shell = source('artifact', 'shell.js');
  const route = shell.slice(shell.indexOf("case '/api/shared/create'"), shell.indexOf("case '/api/shared/join'"));
  assert.doesNotMatch(route, /seed/, 'the create route passes a seed');
});

test('leaving deliberately writes the same event and costs nothing', async () => {
  const { store, idan, dani, id } = await twoSeats(13);
  await idan.deal();
  await dani.refresh();
  await dani.leave();

  const record = (await store.readTable(id))!;
  const his = record.seats.find((row: any) => row.seat === 1)!;
  const events = (his as any).events as Array<{ kind: string; seat: number; why?: string }>;
  const left = events.find((event) => event.kind === 'drop' && event.why === 'left');
  assert.ok(left, 'leaving wrote no event');
  // And it is in his own row, which is the whole point of round 23.
  const mine = record.seats.find((row: any) => row.seat === 0)!;
  assert.equal(
    ((mine as any).events as unknown[]).some((event: any) => event.kind === 'drop'),
    false,
    "one seat's leaving was written into another seat's row",
  );
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

test('a player who left by the home link and follows the link back is dealt in again', async () => {
  /*
   * Round 30 made the home link the way to leave, one tap from the felt — so
   * coming back has to work. Before, nothing ever wrote a return, and a seat
   * that had left sat at its own table for ever without a card.
   */
  const { store, idan, dani, id } = await twoSeats(13);
  await idan.deal();
  await dani.refresh();
  await dani.leave();
  await idan.refresh();
  assert.equal(idan.screen().seats.find((seat: any) => seat.seat === 1).status, 'away');

  // He follows the same link again, from his own phone.
  const back = phone(store, { id: 'dani', name: 'Dani' });
  await back.join(id);
  const record = (await store.readTable(id))!;
  const events = (record.seats.find((row: any) => row.seat === 1) as any).events as Array<{ kind: string; hand: number }>;
  const returned = events.find((event) => event.kind === 'return');
  assert.ok(returned, 'coming back wrote no return');
  const left = events.find((event) => event.kind === 'drop')!;
  assert.ok(returned!.hand > left.hand, 'he was put back into the hand he had left');

  // The next hand is dealt to him.
  await idan.refresh();
  for (let guard = 0; guard < 40 && (idan.screen().hand ?? -1) < returned!.hand; guard++) {
    for (const who of [idan, back]) {
      await who.refresh();
      const mine = who.screen();
      if (mine.legal.length > 0) await who.act(mine.legal.includes('stand') ? 'stand' : mine.legal[0]);
    }
    await idan.refresh();
    if (idan.screen().handOver) await idan.deal();
  }
  await back.refresh();
  const him = back.screen().seats.find((seat: any) => seat.seat === 1);
  assert.notEqual(him.status, 'away', 'back at the table, he is still away');
  assert.ok(him.split.length > 0, 'back at the table, he is not dealt a hand');
});

test('nothing about a drop is written as a timestamp', () => {
  const driver = source('artifact', 'shared.js');
  const drop = driver.slice(driver.indexOf('async function sharedDrop('), driver.indexOf('async function sharedLeave('));
  assert.doesNotMatch(drop, /Date\.now\(\)|toISOString|new Date/, 'a drop carries a clock');
});

/* --- 4b. The race that used to lose an event (round 23) ----------------------------------- */

/**
 * The old layout, reproduced.
 *
 * Until round 23 joins, drops and returns lived in one list on the `tables`
 * row, and every writer sent the whole list it had last read. That is the
 * classic lost update, and it is worth showing rather than asserting: two
 * players leave in the same instant, both having read a log with one event in
 * it, both write two events, and the table ends with one of them gone.
 */
test('the old shared list loses an event when two seats write in the same instant', () => {
  const table = { events: [{ kind: 'join', seat: 0, hand: 0 }] as Array<Record<string, unknown>> };
  const pushEvents = (events: Array<Record<string, unknown>>) => {
    table.events = events;
  };

  // Both phones read, at the same moment, the same log.
  const asIdanSawIt = [...table.events];
  const asDaniSawIt = [...table.events];

  // Both append their own event to what they read, and both write it back.
  pushEvents([...asIdanSawIt, { kind: 'drop', seat: 0, hand: 3, why: 'left' }]);
  pushEvents([...asDaniSawIt, { kind: 'drop', seat: 1, hand: 3, why: 'left' }]);

  const dropped = table.events.filter((event) => event.kind === 'drop');
  assert.equal(dropped.length, 1, 'the old layout was supposed to lose one of the two');
  assert.equal(dropped[0]!.seat, 1, 'the later writer should be the one that survived');
});

test('the new layout keeps both, because the two writes are to different rows', async () => {
  const store = fakeStore();
  const idan = phone(store, { id: 'idan', name: 'Idan' });
  const dani = phone(store, { id: 'dani', name: 'Dani' });
  const made = await idan.create();
  await dani.join(made.id);
  await idan.refresh();
  await idan.deal();
  await dani.refresh();

  /*
   * The same instant, as nearly as a test can have one: both leave without
   * either having seen the other's write. Under the old layout that cost an
   * event; here they are two rows and neither can touch the other.
   */
  await Promise.all([idan.leave(), dani.leave()]);

  const record = (await store.readTable(made.id))!;
  const drops = record.seats.flatMap((row: any) =>
    ((row.events ?? []) as Array<Record<string, unknown>>).filter((event) => event.kind === 'drop'),
  );
  assert.equal(drops.length, 2, 'an event was lost');
  assert.deepEqual(drops.map((drop) => drop.seat).sort(), [0, 1]);
});

test('no row at this table has two writers', () => {
  /*
   * The property itself, read off the code rather than inferred from a passing
   * test: the driver writes seats through `pushSeat`, and `pushSeat` names the
   * writer's own seat. There is no call left that writes a shared list.
   */
  const driver = source('artifact', 'shared.js');
  assert.doesNotMatch(driver, /pushEvents/, 'the shared event list is still being written');
  const backends = source('artifact', 'backends.js');
  assert.doesNotMatch(backends, /pushEvents/, 'the backend still offers a shared write');
  /* And the seat write is filtered by the writer's own player id. */
  const push = backends.slice(backends.indexOf('async pushSeat('), backends.indexOf('async readTable('));
  assert.match(push, /seat=eq\./);
  assert.match(push, /player_id=eq\./);
  /* The migration no longer has a column two people would write. */
  const sql = source('artifact', 'migrations', '004-shared-tables.sql');
  const tablesBlock = sql.slice(sql.indexOf('create table if not exists public.tables'), sql.indexOf('create table if not exists public.table_seats'));
  assert.doesNotMatch(tablesBlock, /^\s*events\s+jsonb/m, 'the shared events column is still there');
});

/* --- 4c. The ladder, from three seats up (round 23) --------------------------------------- */

/** A table of `seats` people, all sat down, on a named shoe. */
async function seatsMany(seats: number, seed: number) {
  const store = fakeStore();
  const names = ['Idan', 'Dani', 'Ruti', 'Noa', 'Amit', 'Tal'];
  const phones = names.slice(0, seats).map((name, i) =>
    phone(store, { id: name.toLowerCase(), name }),
  );
  const made = await phones[0]!.create({ seats, seed });
  for (const who of phones.slice(1)) await who.join(made.id);
  for (const who of phones) await who.refresh();
  return { store, phones, id: made.id as string };
}

/**
 * Deal, and leave exactly one seat holding the table.
 *
 * Everybody who can act does; whoever is left is the holdout. Which seat that
 * turns out to be is up to the shoe, and it does not matter — what the ladder
 * is about is how many people are waiting, not who.
 */
async function leaveOneHolding(phones: Phone[]) {
  await phones[0]!.deal();
  for (const who of phones) await who.refresh();
  const waiting = phones[0]!.screen().waitingFor as number[];
  const target = waiting[waiting.length - 1]!;
  for (const who of phones) {
    await who.refresh();
    if (who.state.seat === target) continue;
    let guard = 0;
    while (who.screen().legal.length > 0 && guard++ < 10) await who.act('stand');
  }
  for (const who of phones) await who.refresh();
  return target;
}

for (const seats of [3, 4, 5, 6]) {
  test(`the vote ladder at ${seats} seats: every waiting player, then one fewer each time`, async () => {
    const { phones } = await seatsMany(seats, 3);
    const target = await leaveOneHolding(phones);
    const waiters = phones.filter((who) => who.state.seat !== target);

    const held = waiters[0]!.clock();
    assert.ok(held, `nobody is holding the table at ${seats} seats`);
    assert.equal(held.seat, target);
    /* From three seats up there is a vote to call, and it is not automatic. */
    assert.equal(held.automatic, false, `${seats} seats ended the hand without asking`);
    assert.equal(held.waiting, seats - 1, `${seats} seats counted ${held.waiting} waiting`);
    assert.equal(held.canVote, false, 'a vote was offered before the thirty seconds');

    /* The first attempt needs every waiting player. */
    for (const who of waiters) who.state.heldSince = Date.now() - 31000;
    assert.equal(waiters[0]!.clock().needs, seats - 1, 'the first vote did not need everybody');

    /*
     * One of them alone is not enough. From three seats up there are always at
     * least two waiting, so the first attempt can never be carried by one — a
     * stubborn friend can shield you once, which is the point of the rung.
     */
    await waiters[0]!.vote();
    for (const who of phones) await who.refresh();
    const afterOne = phones[0]!.screen().seats.find((seat: any) => seat.seat === target);
    assert.notEqual(afterOne.status, 'away', 'one vote carried the first attempt');

    /* Each later attempt, fifteen seconds on, needs one agreement fewer. */
    for (let step = 1; step <= seats - 2; step++) {
      const expected = Math.max(1, seats - 1 - step);
      const who = waiters[0]!;
      who.state.heldSince = Date.now() - (30000 + step * 15000 + 1000);
      assert.equal(who.clock().needs, expected, `attempt ${step} asked for ${who.clock().needs}`);
    }
  });
}

test('the ladder ends the hand once enough of the waiting players agree', async () => {
  /*
   * Four seats, so three are waiting and the ladder has rungs to climb: the
   * first attempt needs all three, and nobody is dropped on one vote. Fifteen
   * seconds later two are enough; thirty seconds later one is.
   */
  const { phones } = await seatsMany(4, 3);
  const target = await leaveOneHolding(phones);
  const waiters = phones.filter((who) => who.state.seat !== target);

  for (const who of waiters) who.state.heldSince = Date.now() - 31000;
  await waiters[0]!.vote();
  for (const who of phones) await who.refresh();
  assert.notEqual(
    phones[0]!.screen().seats.find((seat: any) => seat.seat === target).status,
    'away',
    'one vote of three was enough on the first attempt',
  );

  /* Two rungs down, one agreement carries it. */
  waiters[0]!.state.heldSince = Date.now() - (30000 + 2 * 15000 + 1000);
  assert.equal(waiters[0]!.clock().needs, 1, 'the ladder did not reach the bottom rung');
  await waiters[0]!.vote();
  for (const who of phones) await who.refresh();
  assert.equal(
    phones[0]!.screen().seats.find((seat: any) => seat.seat === target).status,
    'away',
    'the bottom rung did not end the hand',
  );
});

test('a drop is still derived rather than written, however many seats there are', async () => {
  const { store, phones, id } = await seatsMany(5, 3);
  const target = await leaveOneHolding(phones);
  const waiters = phones.filter((who) => who.state.seat !== target);
  for (const who of waiters) who.state.heldSince = Date.now() - (30000 + 4 * 15000 + 1000);
  await waiters[0]!.vote();
  for (const who of phones) await who.refresh();

  const record = (await store.readTable(id))!;
  /*
   * Nobody wrote a drop. The votes are in their own writers' rows and the drop
   * is read out of them — which is why a player being voted out, the one thing
   * here that is about somebody but not done by him, still needs no shared row.
   */
  for (const row of record.seats as any[]) {
    for (const event of row.events ?? []) {
      assert.notEqual(event.kind, 'drop', `seat ${row.seat} had a drop written into its row`);
    }
  }
  assert.equal(
    phones[0]!.screen().seats.find((seat: any) => seat.seat === target).status,
    'away',
    'the derived drop did not take effect',
  );
});

/* --- 5. The two measures ----------------------------------------------------------------- */

test('the bar prints nothing until it has settled, and the stack always prints', () => {
  const record: TableRecord = {
    id: 't', seed: 3, presetId: 'vegas-strip-6d-s17',
    restrictions: { noSurrender: false, likeRanksOnly: false },
    seats: [0, 1].map((seat) => ({
      seat, playerId: `p${seat}`, name: seat ? 'Dani' : 'Idan', bet: seat ? 5 : 1,
      moves: [] as SeatMove[], hands: 1,
      events: [{ kind: 'join' as const, seat, hand: 0 }],
    })),
  };
  const screen = sharedScreen(record, 0);
  for (const seat of screen.seats) {
    assert.equal(seat.bar, null, 'a bar printed a percentage on the first hand');
    assert.equal(typeof seat.stack, 'number', 'the stack did not print');
  }
  assert.ok(BAR_SETTLES_AT >= 10, 'the bar settles too early to mean anything');
});

test('the line that names the two measures appears only when they disagree', async () => {
  const { idan, dani } = await twoSeats(14);
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
  const { idan, dani } = await twoSeats(15);
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

/* --- 6b. Six seats on a phone, and waiting without an empty screen (round 23) ------------- */

test('nothing at a six-seat table is wider than a phone, and the other seats go compact', () => {
  /*
   * Checked as CSS rather than measured: there is no layout engine in this
   * suite, so what can be held here is that nothing declares a width a phone
   * cannot hold and that the rule which shrinks the other seats exists. The
   * real answer to "does six seats fit" comes from two people on two phones,
   * and the report says so rather than implying this test settled it.
   */
  const css = source('public', 'styles.css');
  const shared = css.slice(css.indexOf('.shared-door'));
  for (const rule of shared.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
    const width = /min-width:\s*(\d+)px/.exec(rule[2]!);
    if (width) {
      assert.ok(
        Number(width[1]) <= 360,
        `${rule[1]!.trim()} asks for ${width[1]}px, which is wider than the narrowest phone`,
      );
    }
  }
  assert.match(shared, /\.shared-seat\.other/, 'the other seats are not drawn any differently');
  assert.match(shared, /@media \(max-width: 420px\)/, 'nothing shrinks on a narrow phone');
  /* And beyond four seats the other players are a list rather than a stack (§3.1). */
  assert.match(shared, /\.shared-seats\.many \.shared-seat\.other/, 'nothing collapses beyond four seats');
  const screen = source('public', 'shared.js');
  assert.match(screen, /order\.length > 4 \? 'shared-seats many'/, 'the list is never turned on');
  /* The seat picker's targets are thumb-sized. */
  assert.match(shared, /\.seat-pick \{[^}]*min-width: 44px/, 'the seat buttons are too small to press');
});

test('a table can be made for any size from two to six, and no more', async () => {
  for (const seats of [2, 3, 4, 5, 6]) {
    const { phones } = await seatsMany(seats, 5);
    assert.equal(phones[0]!.screen().seats.length, seats, `a ${seats}-seat table came out wrong`);
  }
  /* And the driver clamps anything outside that range rather than trusting it. */
  const store = fakeStore();
  const one = phone(store, { id: 'idan', name: 'Idan' });
  await one.create({ seats: 99, seed: 5 });
  assert.equal(one.screen().seats.length, 6, 'a table larger than six was made');
});

test('waiting for a friend is playing the private table, not sitting on an empty screen', () => {
  const strip = source('artifact', 'waiting.js');
  /*
   * The two things Idan asked for: he plays meanwhile, and it stays visible
   * that he is waiting.
   */
  assert.match(strip, /waiting\.forFriend/, 'the strip never says what he is waiting for');
  assert.match(strip, /waiting\.arrived/, 'he is not told when his friend sits down');
  /* And he is moved between hands, never in the middle of one. */
  assert.match(strip, /function midHand\(\)/, 'nothing checks whether a hand is in progress');
  assert.match(strip, /if \(!midHand\(\)\)/, 'he can be pulled off a live hand');
  const screen = source('public', 'shared.js');
  assert.match(screen, /shared-meanwhile/, 'there is no way to go and play meanwhile');
});

/* --- 7. Leaving is one tap, in plain sight — and never between hands (round 30) -------- */

test('leaving is the home link, one tap and in plain sight, and nothing to press appears between hands', () => {
  const screen = source('public', 'shared.js');
  /*
   * §3.3 still holds: if silence is punished then leaving has to be cheap, and
   * never buried in a menu. Round 30 moved the door, not the rule — it is the
   * home link at the top of the screen, which is where Idan left from anyway,
   * and pressing it writes the same free leave the button did.
   */
  assert.ok(screen.includes("querySelector('#shared-bar a.back')"), 'the home link does not leave the table');
  assert.ok(screen.includes("api('/api/shared/leave'"), 'leaving no longer writes the leave');
  /*
   * And the space between hands has nothing to press in it: no Deal, no Leave.
   * Those two appeared where Hit and Stand had just been, and a quick thumb
   * landed on them (Idan: *"ולחצת בטעות — ובלאגן"*).
   */
  const dock = screen.slice(screen.indexOf('function renderActions('), screen.indexOf('function dockWords('));
  assert.doesNotMatch(dock, /shared-deal|shared-leave/, 'the dock still offers Deal or Leave');
  assert.ok(dock.includes('EVDock.ready()'), "the new hand's buttons take a press the moment they appear");
});

test('a drop stays a drop: a later vote, or the voter leaving, never rewrites a hand already played (round 35)', async () => {
  /*
   * Found on round 35's six-phone walk. A drop is derived from the votes in the
   * voters' own rows, and a row holds one vote — so the next vote a player cast,
   * or his row being freed when he left, took the old vote away, and the hand
   * it had ended was played again as if nobody had been dropped: the dropped
   * seat back in it, owing a decision, and the table's past changed under
   * everybody.
   */
  const { idan, dani, id } = await twoSeats(3);
  const handAt = async (hand: number) => {
    await idan.refresh();
    return deriveTable(idan.state.record).hands.find((entry: any) => entry.hand === hand);
  };
  const shape = (hand: any) => ({ incomplete: hand.incomplete, seats: hand.seats.map((seat: any) => [seat.seat, seat.cards]) });

  // Hand 0: Idan stands, Dani holds the table, the thirty seconds end it (as the two-seat test).
  await idan.deal();
  await dani.refresh();
  await idan.act('stand');
  await idan.refresh();
  assert.ok(idan.clock(), 'the table is not being held');
  idan.state.heldSince = Date.now() - 31000;
  await idan.expire();
  const before = shape(await handAt(0));
  assert.equal(before.incomplete, false, 'the thirty seconds did not end hand 0');
  assert.ok(!before.seats.some(([seat]: any) => seat === dani.state.seat), 'Dani was still in hand 0');

  // Dani comes back, and a later hand is held by him too: the clock ends it again.
  await dani.join(id);
  let votedAgain = false;
  for (let hand = 0; hand < 8 && !votedAgain; hand++) {
    await idan.refresh();
    await idan.deal();
    await dani.refresh();
    await idan.refresh();
    for (let guard = 0; guard < 10 && idan.screen().legal.length > 0; guard++) {
      await idan.act(idan.screen().legal.includes('stand') ? 'stand' : idan.screen().legal[0]);
      await idan.refresh();
    }
    if (idan.clock()) {
      idan.state.heldSince = Date.now() - 31000;
      await idan.expire();
      votedAgain = true;
    } else {
      // Dani plays this one out, so the next can be dealt.
      for (let guard = 0; guard < 10; guard++) {
        await dani.refresh();
        if (dani.screen().legal.length === 0) break;
        await dani.act(dani.screen().legal.includes('stand') ? 'stand' : dani.screen().legal[0]);
      }
    }
  }
  assert.ok(votedAgain, 'no later hand was held, so the second vote is untested');
  assert.deepEqual(shape(await handAt(0)), before, 'a second vote rewrote hand 0');

  // And Idan leaving — his row freed — changes nothing that was played either.
  await idan.leave();
  await dani.refresh();
  const still = deriveTable(dani.state.record).hands.find((entry: any) => entry.hand === 0);
  assert.deepEqual(shape(still), before, 'the voter leaving rewrote hand 0');
});
