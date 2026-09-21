/*
 * The shared table, driven (round 22; spec A, round A2).
 *
 * Everything a seat does to a shared table goes through here: make one, sit at
 * one, act, deal the next hand, call a vote, leave. It owns no rules — the
 * cards and the grades come from `sharedScreen`, which comes from the
 * derivation — and it owns no markup. What it owns is the round trip: read the
 * table, work out what this seat may see, write this seat's own row.
 *
 * ONE WRITER A ROW, INCLUDING THE VOTES. The concurrency design of this whole
 * feature is that nobody writes a row but its owner, so there are no
 * transactions anywhere. The thirty-second vote could have broken that — a
 * tally is naturally one shared number — so it does not have one: **each
 * waiting player records his own vote in his own row**, and anyone can count.
 * The drop is then written as an event carrying the hand it happened at, never
 * a time, so the cards still follow the log (§3.3).
 *
 * THE CLOCK IS NOT IN THE DERIVATION. It decides *when* a vote may be called
 * and when an event gets written, and that is all. Nothing about which card
 * comes next can be reached from it, which is what keeps two phones agreeing.
 */

/**
 * The six things a player can say, in Idan's words and his order (§3.9).
 *
 * Repeated here as keys rather than imported as text, because this file writes
 * the record and the record is language-neutral: what is stored is which of the
 * six was said, and the catalogue turns that into Hebrew or English on the
 * screen that draws it.
 */
const SHARED_REACTIONS = ['brave', 'where', 'withYou', 'shame', 'mum', 'explain'];

/** Thirty seconds, from the moment every other player is waiting for you (§3.3). */
const SHARED_CLOCK_MS = 30000;
/** And another vote every fifteen, each needing one agreement fewer (§3.3). */
const SHARED_VOTE_STEP_MS = 15000;

/** How many agreements a vote needs at attempt `step`, with `waiting` others held up. */
function sharedVoteNeeds(waiting, step) {
  return Math.max(1, waiting - step);
}

/**
 * Which vote attempt the clock is on, from how long the table has been held.
 *
 * Attempt 0 opens at thirty seconds and each later one fifteen after the last.
 * Before thirty seconds there is no vote to call, which is what `-1` means.
 */
function sharedVoteStep(heldMs) {
  if (heldMs < SHARED_CLOCK_MS) return -1;
  return Math.floor((heldMs - SHARED_CLOCK_MS) / SHARED_VOTE_STEP_MS);
}

/** A table id short enough to live in a link and wide enough not to collide. */
function sharedTableId() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) id += alphabet[byte % alphabet.length];
  return id;
}

/**
 * The seed, generated rather than chosen.
 *
 * §3.11: a seed you can ask for is a shoe you can practise against twice, so
 * the app makes it and no screen ever offers it.
 */
function sharedSeed() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] % 2147483647;
}

const sharedState = {
  /** The table this browser is at, or null. */
  id: null,
  /** My seat number, or null while only watching. */
  seat: null,
  /** The last record read back, or null. */
  record: null,
  /** When the table first became held up by one player, in ms since epoch. */
  heldSince: null,
  /** Which seat that was, so a change of holder restarts the clock. */
  heldSeat: null,
  /** Set when the backend cannot be reached, so the screen can say so. */
  error: null,
  /** Whether the counterfactual has already been offered. Once a session (§3.8). */
  toldCounterfactual: false,
};

/** The store the page was built with, or none — in which case say so plainly. */
function sharedBackend() {
  return typeof backend !== 'undefined' && backend && typeof backend.readTable === 'function'
    ? backend
    : null;
}

/** Whether this page can run a shared table at all (§3.11: hosted app only at first). */
function sharedAvailable() {
  return sharedBackend() !== null;
}

/** My own row in the record, or null. */
function sharedMyRow() {
  if (!sharedState.record || sharedState.seat === null) return null;
  return sharedState.record.seats.find((row) => row.seat === sharedState.seat) ?? null;
}

/**
 * Read the table back and keep the clock in step.
 *
 * The clock is started here rather than by a timer, because the only thing that
 * can start it is the table becoming held by exactly one player — which is a
 * fact about the record, not about the passage of time.
 */
async function sharedRefresh() {
  const store = sharedBackend();
  if (!store || !sharedState.id) return null;
  try {
    const record = await store.readTable(sharedState.id);
    sharedState.error = null;
    if (!record) {
      sharedState.record = null;
      return null;
    }
    sharedState.record = sharedNormalise(record);
    sharedTickHold();
    return sharedState.record;
  } catch (failure) {
    sharedState.error = String(failure && failure.message ? failure.message : failure);
    return sharedState.record;
  }
}

/** Fill in what an older row may not carry, so the derivation always has its shape. */
function sharedNormalise(record) {
  return {
    ...record,
    restrictions: record.restrictions ?? {},
    seats: (record.seats ?? []).map((row) => ({
      ...row,
      name: row.name ?? '',
      bet: Number(row.bet) || 1,
      moves: Array.isArray(row.moves) ? row.moves : [],
      hands: Number(row.hands) || 0,
      events: Array.isArray(row.events) ? row.events : [],
      /*
       * A row written before round 24 has no reactions, and the column's own
       * default is an empty object — so both shapes arrive here and both mean
       * the same thing: this seat has not said anything.
       */
      reactions: row.reactions && typeof row.reactions === 'object' && !Array.isArray(row.reactions)
        ? row.reactions
        : {},
    })),
  };
}

/**
 * Start, keep or clear the thirty-second clock.
 *
 * Idan's rule, and the reason it is his: the count begins only when you are the
 * last one holding the table, which is when a real table starts looking at you.
 * Nobody is hurried while somebody else is still deciding.
 */
function sharedTickHold() {
  const screen = sharedScreenNow();
  const held = screen && screen.waitingFor.length === 1 ? screen.waitingFor[0] : null;
  if (held === null) {
    sharedState.heldSince = null;
    sharedState.heldSeat = null;
    return;
  }
  if (sharedState.heldSeat !== held) {
    sharedState.heldSeat = held;
    sharedState.heldSince = Date.now();
  }
}

/** This seat's whole screen, or null when there is no table. */
function sharedScreenNow() {
  if (!sharedState.record) return null;
  return sharedScreen(sharedState.record, sharedState.seat);
}

/** Write my own row back: my moves, my bet, my count of hands, my hash, my vote. */
async function sharedPushMine() {
  const store = sharedBackend();
  const row = sharedMyRow();
  if (!store || !row) return;
  const derived = deriveTable(sharedState.record);
  await store.pushSeat(sharedState.id, row.seat, {
    playerId: row.playerId,
    bet: row.bet,
    moves: row.moves,
    hands: row.hands,
    vote: row.vote ?? null,
    events: row.events ?? [],
    /* What I said, in my own row, like everything else I write (§3.9). */
    reactions: row.reactions ?? {},
    cardsHash: seatCardsHash(derived, row.seat),
  });
}

/**
 * Say one of the six (§3.9).
 *
 * Into my own row and nowhere else, keyed by the hand it was said at — so the
 * one-writer rule covers speech as well as play, and two people reacting in the
 * same instant cannot cost one of the reactions the way the shared event list
 * used to cost an event.
 *
 * Nothing about a card can be reached from here. The derivation never reads
 * reactions, which is why this needs no thought about ordering beyond keeping
 * each seat's own list in the order he said things.
 */
async function sharedReact(key) {
  const row = sharedMyRow();
  const screen = sharedScreenNow();
  if (!row || !screen || !SHARED_REACTIONS.includes(key)) return screen;
  /* Before the first deal there is no hand to hang it on, so it waits. */
  const hand = screen.hand === null ? 0 : screen.hand;
  const said = { ...(row.reactions ?? {}) };
  const forHand = Array.isArray(said[hand]) ? said[hand] : [];
  /*
   * The same thing twice in one hand is a slip of the thumb rather than
   * emphasis, and a ticker repeating it would read as a stutter.
   */
  if (forHand.includes(key)) return screen;
  said[hand] = [...forHand, key];
  row.reactions = said;
  const optimistic = sharedScreenNow();
  await sharedPushMine();
  await sharedRefresh();
  return sharedScreenNow() ?? optimistic;
}

/**
 * The counterfactual, worked out on demand and offered once (§3.8).
 *
 * Behind a tap rather than on the screen, and once a session rather than every
 * hand, because it is evidence rather than decoration: a line that fired
 * whenever a neighbour breathed would stop being the answer to *he took my
 * card* and start being wallpaper.
 */
function sharedCounterfactual() {
  if (sharedState.toldCounterfactual) return null;
  const screen = sharedScreenNow();
  if (!screen || screen.hand === null || sharedState.seat === null) return null;
  /* Only on a hand that is over: mid-hand it would say what is coming. */
  if (!screen.handOver) return null;
  return counterfactualBack(sharedState.record, sharedState.seat, screen.hand);
}

/** Mark it said, so the once-a-session rule is kept by the driver and not by a screen. */
function sharedCounterfactualShown() {
  sharedState.toldCounterfactual = true;
}

/** The chart cells this seat and another both met and answered differently (§3.8). */
function sharedSpotsNow() {
  if (!sharedState.record || sharedState.seat === null) return [];
  return sharedSpots(sharedState.record, sharedState.seat);
}

/** Make a table, take seat 0, and hand back the link to send. */
async function sharedCreate(options) {
  const store = sharedBackend();
  if (!store) return { available: false };
  const id = sharedTableId();
  /*
   * The seed is generated, never chosen (§3.11) — a seed you can ask for is a
   * shoe you can practise against twice. A caller may hand one in, and exactly
   * one caller does: the test harness, which cannot test a thirty-second clock
   * against a shoe that deals a different hand every run. No route passes it,
   * and `test/shared-screen.test.ts` checks that none ever starts to.
   */
  const seed = Number.isInteger(options.seed) ? options.seed : sharedSeed();
  await store.createTable({
    id,
    seed,
    presetId: options.presetId || 'vegas-strip-6d-s17',
    restrictions: options.restrictions || {},
    seats: Math.max(2, Math.min(6, Number(options.seats) || 2)),
    createdBy: options.playerId,
    createdByName: options.name,
    bet: Number(options.bet) || 1,
  });
  sharedState.id = id;
  sharedState.seat = 0;
  await sharedRefresh();
  return { available: true, id, seat: 0 };
}

/**
 * Sit down, at the first free seat, and only if it is still free.
 *
 * The refusal is the point: two people pressing at the same instant produce one
 * seat and one clear message, because the write itself is conditional. The seat
 * is not checked and then taken — it is taken on condition it was free, which
 * is the only version of this that has no race in it.
 */
async function sharedJoin(id, player) {
  const store = sharedBackend();
  if (!store) return { available: false };
  sharedState.id = id;
  const record = await sharedRefresh();
  if (!record) return { available: true, missing: true };

  const already = record.seats.find((row) => row.playerId === player.id);
  if (already) {
    sharedState.seat = already.seat;
    return { available: true, seat: already.seat, taken: false };
  }
  for (const row of record.seats) {
    if (row.playerId) continue;
    const answer = await store.joinTable(id, row.seat, {
      id: player.id,
      name: player.name,
      bet: Number(player.bet) || 1,
    });
    if (!answer.taken) {
      sharedState.seat = row.seat;
      /*
       * And into the log, which is the part that matters.
       *
       * Taking the row makes the seat *yours*; the join event makes it *live*,
       * and only the log decides who is live — because who is live decides how
       * many cards a round consumes. A seat written without its event is a
       * player sitting at a table that never deals him in, which is exactly
       * what happened before the two-phone test caught it.
       *
       * At the hand after the one in progress: a player who sits down halfway
       * through a hand joins the next one, rather than appearing in the middle
       * of a deal he was not dealt into.
       */
      const seen = sharedScreenNow();
      const from = seen && seen.hand !== null ? seen.hand + 1 : 0;
      await sharedAddEvent({ kind: 'join', seat: row.seat, hand: from });
      await sharedRefresh();
      return { available: true, seat: row.seat, taken: false };
    }
  }
  await sharedRefresh();
  return { available: true, seat: null, taken: true };
}

/** Record one decision in my own row, and write it. */
async function sharedAct(action) {
  const screen = sharedScreenNow();
  const row = sharedMyRow();
  if (!screen || !row || !screen.legal.includes(action)) return sharedScreenNow();
  if (screen.hand === null) return screen;
  row.moves = [...row.moves, { hand: screen.hand, round: screen.round, action }];
  /*
   * Written to the screen before the network, so the player's own tap is
   * instant. The table is read back afterwards; if the write failed, the next
   * refresh puts the record back the way the table actually is.
   */
  const optimistic = sharedScreenNow();
  sharedTickHold();
  await sharedPushMine();
  await sharedRefresh();
  return sharedScreenNow() ?? optimistic;
}

/**
 * Deal the next hand.
 *
 * Whoever presses first starts it for everybody: each seat records how far it
 * has been dealt in its own row, and the table runs as far as the furthest.
 * There is no dealer to ask and no shared counter to race over.
 */
async function sharedDeal() {
  const row = sharedMyRow();
  const screen = sharedScreenNow();
  if (!row || !screen) return screen;
  if (screen.hand !== null && !screen.handOver) return screen;
  row.hands = (screen.hand === null ? 0 : screen.hand + 1) + 1;
  await sharedPushMine();
  await sharedRefresh();
  return sharedScreenNow();
}

/** How long the table has been held by one player, in ms. Zero when it is not. */
function sharedHeldMs() {
  if (sharedState.heldSince === null) return 0;
  return Date.now() - sharedState.heldSince;
}

/**
 * The state of the clock and the vote, for the screen to draw.
 *
 * `mine` is true when the seat being counted down is this one — the player the
 * clock is about sees it, and so does everybody waiting, which §3.4 requires:
 * thirty seconds is only fair if you can see the table is waiting for you.
 */
function sharedClock() {
  const screen = sharedScreenNow();
  if (!screen || sharedState.heldSeat === null) return null;
  const held = sharedState.heldSeat;
  const waiting = screen.seats.filter(
    (seat) => seat.seat !== held && seat.status !== 'away',
  ).length;
  const heldMs = sharedHeldMs();
  const step = sharedVoteStep(heldMs);
  const votes = (sharedState.record?.seats ?? []).filter(
    (row) =>
      row.vote &&
      row.vote.hand === screen.hand &&
      row.vote.against === held &&
      row.seat !== held,
  ).length;
  const needs = sharedVoteNeeds(waiting, Math.max(0, step));
  /*
   * At two seats there is no vote, and Idan is right that there was never one
   * to have: with a single player waiting, a "vote" is that player pressing a
   * button to agree with himself. So the thirty seconds simply end the hand.
   *
   * It is the same drop with the same consequences, and it is built out of the
   * same parts — one agreement, recorded in the waiting player's own row — so
   * there is no second mechanism here, only a button that is not drawn and a
   * write that happens on its own. From three seats up the ladder is unchanged.
   */
  const automatic = waiting === 1;
  return {
    seat: held,
    name: screen.seats.find((seat) => seat.seat === held)?.name ?? '',
    mine: held === sharedState.seat,
    /** Seconds left before the hand ends, or before a vote may be called. */
    secondsLeft: Math.max(0, Math.ceil((SHARED_CLOCK_MS - heldMs) / 1000)),
    automatic,
    canVote: !automatic && step >= 0 && sharedState.seat !== null && sharedState.seat !== held,
    step: Math.max(0, step),
    votes,
    needs,
    waiting,
    passed: step >= 0 && votes >= needs,
  };
}

/**
 * The clock running out, at a table where nobody has to be asked.
 *
 * Called by the screen's own tick. At two seats this ends the hand the moment
 * the thirty seconds are up; anywhere else it does nothing, because there the
 * waiting players are asked instead.
 */
async function sharedClockExpired() {
  const clock = sharedClock();
  if (!clock || !clock.automatic) return null;
  if (clock.secondsLeft > 0) return clock;
  // The player being timed out cannot be the one to write it.
  if (sharedState.seat === null || sharedState.seat === clock.seat) return clock;
  const row = sharedMyRow();
  const screen = sharedScreenNow();
  if (!row || !screen) return clock;
  if (row.vote && row.vote.hand === screen.hand && row.vote.against === clock.seat) return clock;
  row.vote = { hand: screen.hand, against: clock.seat, at: 0, needs: 1 };
  await sharedPushMine();
  await sharedRefresh();
  return sharedClock();
}

/** Agree that the player holding the table should be dropped from this hand. */
async function sharedVote() {
  const clock = sharedClock();
  const row = sharedMyRow();
  const screen = sharedScreenNow();
  if (!clock || !clock.canVote || !row || !screen) return clock;
  row.vote = { hand: screen.hand, against: clock.seat, at: clock.step, needs: clock.needs };
  await sharedPushMine();
  await sharedRefresh();
  /*
   * Nothing writes the drop. Enough votes *are* the drop — the derivation reads
   * them and says so — which is what keeps this the one thing at the table that
   * is about a player but not done by him, and still needs no shared row.
   */
  return sharedClock();
}

/**
 * Append one event about me, to my own row.
 *
 * There is no shared list to append to any more, and that is the point: the
 * only row this writes is the writer's own, so two players leaving in the same
 * instant cannot cost one of the events the way they used to.
 */
async function sharedAddEvent(event) {
  const row = sharedMyRow();
  if (!row) return;
  row.events = [...(row.events ?? []), event];
  await sharedPushMine();
}

/**
 * Write my own leaving into my own row.
 *
 * A seat being *voted* out is not written at all — it is derived from the votes,
 * which sit in their own writers' rows. So the only drop anybody writes is his
 * own, and it carries the hand rather than a time, which is what keeps the cards
 * following the log.
 */
async function sharedDrop(seat, why) {
  const screen = sharedScreenNow();
  const hand = screen && screen.hand !== null ? screen.hand : 0;
  await sharedAddEvent({ kind: 'drop', seat, hand, why: why || 'left' });
  await sharedRefresh();
}

/**
 * Leave, deliberately, and it costs nothing.
 *
 * §3.3 is explicit that this is what makes the penalty fair: the offence is not
 * slowness, it is letting the table rot rather than playing or leaving. So this
 * writes the same event a vote would, with a different reason and no
 * suspension, and the control that reaches it is as prominent as Hit.
 */
async function sharedLeave() {
  if (sharedState.seat === null) return;
  await sharedDrop(sharedState.seat, 'left');
  sharedState.seat = null;
}

/**
 * Break this seat's checksum on purpose, so the refusal can be seen.
 *
 * The app's answer to two phones disagreeing about what was dealt is to show
 * neither of them a table, and until now no human being had ever seen it
 * happen. This is the way to make it happen: it writes a hash this seat's cards
 * could not produce, which is exactly the shape of the bug it guards against.
 * It is reachable only with the debug flag set, and it changes no card.
 */
async function sharedForceMismatch() {
  const store = sharedBackend();
  const row = sharedMyRow();
  if (!store || !row) return;
  await store.pushSeat(sharedState.id, row.seat, {
    playerId: row.playerId,
    bet: row.bet,
    moves: row.moves,
    hands: row.hands,
    vote: row.vote ?? null,
    events: row.events ?? [],
    reactions: row.reactions ?? {},
    cardsHash: 'deadbeef',
  });
  await sharedRefresh();
}
