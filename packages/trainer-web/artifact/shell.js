/*
 * The shareable build.
 *
 * Same product, no server. `TrainerSession` and the whole EV engine are bundled
 * into the page above this file, so `api()` below answers the very calls the
 * Node server answers — same paths, same bodies, same shapes — and the two page
 * scripts that draw the app cannot tell the difference. That is deliberate:
 * there is one engine and one set of screens, and this file is only the thing
 * that stands where the server used to.
 *
 * What is genuinely new here is people. The local app had one player; this one
 * is meant to be passed around a family, so it keeps a profile per person, saves
 * their hands, and puts everyone on one table.
 */

/* --------------------------------------------------------------------------
 * Who is playing
 *
 * No passwords: this is a link people send to their family, and a sign-up form
 * is a reason not to bother. A player picks a name once; the id behind it is
 * random and lives in their browser. Anyone who clears their storage starts
 * fresh, which for fifteen people around a kitchen table is the right trade.
 * ----------------------------------------------------------------------- */

const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : raw;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private window, or storage switched off. The session still plays.
    }
  },
};

const newId = () => {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

const me = {
  id: store.get('ev:playerId') || (() => {
    const id = newId();
    store.set('ev:playerId', id);
    return id;
  })(),
  name: store.get('ev:playerName') || '',
  /* Set when a player claims or creates a name at the door. Written with the
     record so the next device can check a code against it. Never the code. */
  pinHash: store.get('ev:pinHash') || null,
};

/* --------------------------------------------------------------------------
 * The shared table
 *
 * A backend is optional at every moment. It may be absent because the page was
 * opened from a file, because the artifact store was declined, or because the
 * network is down mid-hand. Everything below is written so that none of those
 * change the game: you still play, you still get graded, your own record is
 * still kept in the browser — you simply do not appear on the leaderboard.
 *
 * A trainer that refuses to deal because a database is unreachable would have
 * its priorities exactly backwards.
 * ----------------------------------------------------------------------- */

let backend = null;
let backendReady = false;
/*
 * Whether the shared table answered the last time it was asked. A configured
 * table is not a reachable one: on a phone with no signal the page still has a
 * backend object, and without this it showed "nobody has played yet" — false —
 * where it should have said it was offline.
 */
let backendReachable = true;
/* Held so the poll can be stopped — a browser tab never needs to, but anything
   that loads this page without being a browser tab does. */
let stopWatching = null;
let leaderboard = [];
let feed = [];

/*
 * The leaderboard's other side (round 10). One screen, a switch between the
 * games; the Ultimate side is asked for only while it is the one on screen.
 * `pending` is a table that has not had migration 003 yet.
 */
let boardGame = store.get('ev:board') === 'uth' ? 'uth' : 'bj';
let uthBoard = { state: 'idle', rows: [] };

async function loadUthBoard() {
  if (!backend || typeof backend.uthBoard !== 'function') {
    uthBoard = { state: 'none', rows: [] };
    renderSocial();
    return;
  }
  if (uthBoard.state === 'idle') {
    uthBoard = { state: 'loading', rows: [] };
    renderSocial();
  }
  try {
    uthBoard = { state: 'ready', rows: await backend.uthBoard() };
  } catch (error) {
    uthBoard = { state: error && error.status ? 'pending' : 'offline', rows: uthBoard.rows };
  }
  renderSocial();
}

/** How many of a player's showable hands ride along with their record. */
const FEED_KEPT = 5;

async function connect() {
  backend = await openBackend(typeof BACKEND_CONFIG === 'undefined' ? null : BACKEND_CONFIG);
  backendReady = true;

  if (backend) {
    await restoreMine();
    stopWatching = backend.watch(
      (rows) => {
      leaderboard = rows;
      feed = rows
        .flatMap((row) =>
          (row.feed ?? []).map((item) => ({ ...item, playerId: row.id, name: row.name })),
        )
        .sort((a, b) => b.at - a.at)
        .slice(0, 40);
      renderSocial();
      // The Ultimate side keeps pace with the same poll while it is on screen.
      if (boardGame === 'uth') void loadUthBoard();
      },
      (reachable) => {
        if (reachable === backendReachable) return;
        backendReachable = reachable;
        renderSocial();
        // Back from offline: what was played meanwhile is only in this browser.
        // Send it now, not at the next hand — the offline line promises as much.
        if (reachable) void publish();
      },
    );
    void publish();
  } else {
    // No table to join, but the local copy is still worth reading back.
    const local = readLocalProgress();
    if (local) {
      session.restore(local);
      // The UTH part too. Without it a browser with no shared table (the
      // published artifact, or a page built without one) reopened Ultimate at a
      // fresh stack every time, while Blackjack came back as it was.
      uthSession.restore(local.uth);
    }
    activity = activityOf(local);
    playedBefore = earlierDay(local?.playedBefore, null);
    myFeed = readLocalFeed();
    myHistory = session.view.history;
  }
  renderSocial();
}

/**
 * One record, written whole.
 *
 * Summary, saved session and recent hands go together because they describe one
 * moment and would be misleading apart — a leaderboard row claiming four hundred
 * hands beside a saved session holding forty is worse than either alone.
 */
let publishing = false;
let publishAgain = false;

async function publish() {
  if (!backend || !me.name) return;

  /*
   * One write at a time, and the last state always wins.
   *
   * Publishing is fire-and-forget from the caller's side, so without this two
   * writes can be in flight at once and land out of order — leaving the table
   * showing the rating from the hand before last. Writes are last-writer-wins,
   * so "out of order" means "wrong", not "briefly behind".
   *
   * A newer state arriving mid-flight does not queue a second write; it just
   * marks the current one stale, and the loop re-reads the session when the
   * first finishes. Ten hands played during one slow request still cost one
   * extra write, not ten.
   */
  if (publishing) {
    publishAgain = true;
    return;
  }
  publishing = true;
  try {
    do {
      publishAgain = false;
      await writeRecord();
    } while (publishAgain);
  } finally {
    publishing = false;
  }
}

async function writeRecord() {
  const profile = session.profile;
  const stats = session.view.stats;
  const uth = uthSession.progress;
  const uthRated = Boolean(uth.rating) && uth.rating.ratedDecisions > 0;
  try {
    await backend.save(me.id, {
      name: me.name,
      rating: profile.rating.ratedDecisions > 0 ? Math.round(profile.rating.rating) : 0,
      peak: Math.round(profile.rating.peak),
      provisional: Boolean(profile.rating.provisional),
      mode: profile.rating.mode,
      nameKey: nameKey(me.name),
      pinHash: me.pinHash,
      lifetimeDecisions: session.progress.lifetimeDecisions,
      // For the usage page. The HTTP table reads both from the saved record;
      // the artifact store keeps them on the summary, which is all it reads.
      uthDecisions: uth.lifetimeDecisions,
      // The Ultimate rating (round 10): null until an Ultimate decision is rated.
      uthRating: uthRated ? Math.round(uth.rating.rating) : null,
      uthProvisional: !uthRated || uth.rating.ratedDecisions < 30,
      activity,
      hands: stats.hands,
      decisions: stats.decisions,
      accuracy: stats.accuracy,
      evLostPer100: stats.evLostPer100,
      at: Date.now(),
      progress: fullProgress(),
      feed: myFeed,
    });
  } catch {
    // Offline, refused, or asleep. The browser copy already has everything.
  }
}

/* --------------------------------------------------------------------------
 * Keeping a player's record
 *
 * Two copies, on purpose. The browser always gets one, so the app remembers you
 * whether it was opened from a link, from a file, or on a plane. The backend
 * gets one when there is a backend, so the same person picks up on another
 * device and the shared table has something true to rank.
 *
 * The browser copy is written first and is never conditional: a rating built
 * over three hundred hands should not depend on a network.
 * ----------------------------------------------------------------------- */

const PROGRESS_KEY = 'ev:progress';
const FEED_KEY = 'ev:feed';

/* --------------------------------------------------------------------------
 * How often this player has played (round 9)
 *
 * Counted in calendar days on this device's clock, because the question it
 * answers is "did they come back on another day". Three things are kept and
 * nothing else: the first day, the last day, and how many different days have
 * a finished hand in them. No times, no list of dates, nothing about the
 * device. It rides inside the saved record, so it travels with the player to
 * another device the same way their rating does.
 * ----------------------------------------------------------------------- */

let activity = null;

/*
 * For a player from before the count: a day they are known to have played on
 * or before, kept until their first hand under the count absorbs it. It comes
 * from their row's last write as the table held it before this build first
 * wrote it — and it is saved, because this build writes the row as soon as the
 * page opens, after which that date would only say the app was opened.
 */
let playedBefore = null;

/** Today on this device, as 2026-09-14. */
function localDay(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A saved record's day count, or null when it has none that can be read. */
function activityOf(progress) {
  const a = progress && progress.activity;
  if (!a || typeof a !== 'object' || !DAY.test(a.firstDay) || !DAY.test(a.lastDay)) return null;
  const days = Number.isInteger(a.days) && a.days > 0 ? a.days : 1;
  return { firstDay: a.firstDay, lastDay: a.lastDay, days };
}

/**
 * Two copies of the count, as one.
 *
 * The larger count wins, never the sum: two devices played on the same day
 * would otherwise count that day twice. The first and last days are the
 * earliest and latest either copy has seen, and two different days mean at
 * least two days whatever the counts say. When copies disagree this can only
 * undercount, which is the safe direction for a number a decision rests on.
 */
function mergeActivity(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const firstDay = a.firstDay < b.firstDay ? a.firstDay : b.firstDay;
  const lastDay = a.lastDay > b.lastDay ? a.lastDay : b.lastDay;
  const days = Math.max(a.days, b.days, firstDay === lastDay ? 1 : 2);
  return { firstDay, lastDay, days };
}

/** The earlier of two days, either of which may be missing. */
function earlierDay(a, b) {
  if (!DAY.test(a ?? '')) return DAY.test(b ?? '') ? b : null;
  if (!DAY.test(b ?? '')) return a;
  return a < b ? a : b;
}

/**
 * A day played before the count, folded into it once there is a count.
 *
 * A day before the first counted day is a different day, so it adds one. A day
 * on or after it is already inside the count, so it adds nothing — which is
 * also what makes folding the same day in twice, from two devices, harmless.
 */
function absorbPrior(counted, prior) {
  if (!counted || !DAY.test(prior ?? '') || prior >= counted.firstDay) return counted;
  return { ...counted, firstDay: prior, days: counted.days + 1 };
}

/** A finished hand on `day`. A new day adds one; another hand on the same day adds nothing. */
function markPlayed(day = localDay()) {
  if (!activity) {
    activity = { firstDay: day, lastDay: day, days: 1 };
  } else if (day > activity.lastDay) {
    activity = { ...activity, lastDay: day, days: activity.days + 1 };
  }
  activity = absorbPrior(activity, playedBefore);
  if (activity.firstDay === playedBefore) playedBefore = null;
}

/** The parts of a saved session that outlive the rules it was played under. */
function playerOnly(progress) {
  return {
    ...progress,
    hands: 0,
    decisions: 0,
    correct: 0,
    evLost: 0,
    netUnits: 0,
    closeCalls: 0,
    closeCallsCorrect: 0,
    bySeverity: { optimal: 0, negligible: 0, minor: 0, significant: 0, blunder: 0 },
    scenarioStats: [],
    history: [],
  };
}

function saveProgressLocally() {
  try {
    store.set(PROGRESS_KEY, JSON.stringify(fullProgress()));
    store.set(FEED_KEY, JSON.stringify(myFeed));
  } catch {
    // Storage full or switched off. The session in front of the player is fine.
  }
}

/**
 * The whole saved record: the Blackjack session's version 3 blob, with the UTH
 * session's part under `uth`.
 *
 * Composed here rather than inside either session, so neither class holds a
 * reference to the other — which is what keeps a UTH hand from ever being able
 * to reach the Blackjack rating.
 */
function fullProgress() {
  // `level` is how much the app explains (round 14) — a preference, not a
  // measure. It rides here so it follows the player to another device, exactly
  // as the day count does, and nothing that grades a hand ever reads it.
  const level = window.EVLevel ? window.EVLevel.read() : null;
  // Which explanations this player opens (round 15): counts only, no sequence
  // and no timestamps, riding beside the day count exactly as round 9 did.
  const counters = window.EVCount ? window.EVCount.all() : null;
  return {
    ...session.progress,
    uth: uthSession.progress,
    activity,
    playedBefore,
    ...(level ? { level } : {}),
    ...(counters && Object.keys(counters).length > 0 ? { counters } : {}),
  };
}

function readLocalProgress() {
  try {
    const raw = store.get(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Corrupt or half-written. Starting fresh beats refusing to open.
    return null;
  }
}

/**
 * How far a saved copy has got, for comparing two of them.
 *
 * Version 1 saves predate the lifetime counter, so their session count is the
 * best lower bound available — and a lower bound is safe here, because the only
 * question being asked is which of two copies is further along.
 */
function lifetimeOf(progress) {
  if (!progress) return -1;
  /*
   * Both games' lifetime counters, added. Each only ever rises, so the sum only
   * ever rises. Counting Blackjack alone would let an evening of UTH on one
   * device lose to an older copy on another, because its Blackjack count had not
   * moved.
   */
  const blackjack = progress.lifetimeDecisions ?? progress.decisions ?? 0;
  const uth = progress.uth && typeof progress.uth.lifetimeDecisions === 'number' ? progress.uth.lifetimeDecisions : 0;
  return blackjack + uth;
}

function readLocalFeed() {
  try {
    const raw = store.get(FEED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Pick up where this player left off.
 *
 * The browser copy is applied first so the screen is right immediately, then the
 * stored one replaces it if it is further along. "Further along" is measured in
 * decisions played, which only ever rises — comparing timestamps would let a
 * device with a wrong clock overwrite the real record.
 */
async function restoreMine() {
  const local = readLocalProgress();
  if (local) {
    session.restore(local);
    // A version 1 or 2 blob has no `uth`, and this leaves UTH at zero.
    uthSession.restore(local.uth);
  }
  activity = activityOf(local);
  playedBefore = earlierDay(local?.playedBefore, null);
  if (window.EVCount && local?.counters) window.EVCount.restore(local.counters);
  myFeed = readLocalFeed();

  if (backend && me.name) {
    try {
      let remote = await backend.load(me.id);

      /*
       * This browser may be holding an id that has since been merged into
       * another row. Follow the pointer once and adopt the survivor, before
       * anything is read back or written: reading the retired row would restore
       * a session the merge put to sleep, and the next save would resurrect it
       * on the leaderboard under a rating its owner had abandoned.
       *
       * One hop only. `merged_into` is set by the migration to a row that is
       * itself live, so a chain would mean the data is wrong, and following it
       * blindly would be a way to loop forever.
       */
      if (remote?.mergedInto) {
        me.id = remote.mergedInto;
        store.set('ev:playerId', me.id);
        remote = await backend.load(me.id);
      }

      if (remote) {
        /*
         * Which copy is further along, decided on a number that only ever
         * rises. `decisions` is zeroed by a rule change while the rating is
         * kept, so comparing on it can hand the session to a copy with more
         * hands this sitting and an older rating.
         */
        const here = lifetimeOf(local);
        const there = lifetimeOf(remote.progress);
        if (remote.progress && (!local || there > here)) {
          session.restore(remote.progress);
          uthSession.restore(remote.progress.uth);
        }
        /*
         * How much the app explains, carried across devices (round 14).
         *
         * A device that has never been asked takes the answer the player gave
         * somewhere else; a device that has been asked keeps its own, because
         * the last answer a player gave on the phone in his hand is the one he
         * meant. It changes nothing measured either way.
         */
        if (window.EVLevel && window.EVLevel.read() === null && remote.progress?.level) {
          window.EVLevel.set(remote.progress.level);
        }
        /*
         * The counters are merged whichever copy won, the same way the day
         * count is: the larger of each pair, never the sum. This device's own
         * record is written and read back constantly, and adding would inflate
         * every count by however often it synced.
         */
        if (window.EVCount && remote.progress?.counters) {
          window.EVCount.restore(remote.progress.counters);
        }
        /*
         * The day count is merged whichever copy won, because each device may
         * have seen days the other has not. A row no build with the count has
         * written yet belongs to a player from before it, who played on or
         * before the day it was last written.
         */
        activity = mergeActivity(activity, activityOf(remote.progress));
        const untouched =
          remote.progress && !('activity' in remote.progress) && lifetimeOf(remote.progress) > 0 && remote.updatedAt;
        playedBefore = earlierDay(
          earlierDay(playedBefore, remote.progress?.playedBefore),
          untouched ? localDay(new Date(remote.updatedAt)) : null,
        );
        activity = absorbPrior(activity, playedBefore);
        if (activity && activity.firstDay === playedBefore) playedBefore = null;
        if (remote.feed.length > 0) myFeed = remote.feed;
        saveProgressLocally();
      }
    } catch {
      // A first-time player, or an unreachable backend. The local copy stands.
    }
  }
  myHistory = session.view.history;
}

/* --------------------------------------------------------------------------
 * What lands on the shared feed
 *
 * Not every hand — a wall of routine twenty-against-six is nobody's idea of a
 * feed. Two things are worth showing other people: an expensive mistake, and a
 * hard spot played correctly. They are the same fact from opposite sides, which
 * is what this trainer is about, so both go up and neither is dressed as the
 * other.
 * ----------------------------------------------------------------------- */

/*
 * Hard enough to be worth showing other people.
 *
 * This used to be a hand-written list of twelve scenario keys, which was a
 * guess at something the engine measures for all three hundred and eleven. It
 * now asks. Older saved hands predate the field and simply do not qualify,
 * which is why the read is guarded rather than assumed.
 */
const hardSpot = (decision) => Boolean(decision.spot && decision.spot.hard);

function showcaseOf(hand) {
  const worst = hand.decisions.reduce(
    (acc, d) => (acc === null || d.evCost > acc.evCost ? d : acc),
    null,
  );
  if (worst && (worst.severity === 'blunder' || worst.severity === 'significant')) return worst;
  return hand.decisions.find((d) => d.correct && !d.closeCall && hardSpot(d)) ?? null;
}

let myFeed = [];
let myHistory = [];

function noteForFeed(hand) {
  const showcase = showcaseOf(hand);
  if (!showcase) return;
  myFeed = [
    {
      at: Date.now(),
      headline: showcase.headline,
      scenarioKey: showcase.scenarioKey,
      chosen: showcase.chosen,
      optimal: showcase.optimal,
      correct: showcase.correct,
      severity: showcase.severity,
      evCost: showcase.evCost,
      netUnits: hand.netUnits,
    },
    ...myFeed,
  ].slice(0, FEED_KEPT);
}

/** After a hand settles: keep it, and share it if it is worth showing. */
function keep(hand) {
  markPlayed();
  noteForFeed(hand);
  myHistory = session.view.history;
  saveProgressLocally();
  void publish();
}

/* --------------------------------------------------------------------------
 * Standing where the server stood
 * ----------------------------------------------------------------------- */

let session = new TrainerSession(
  store.get('ev:preset', 'vegas-strip-6d-s17'),
  undefined,
  {
    noSurrender: store.get('ev:noSurrender') === '1',
    likeRanksOnly: store.get('ev:likeRanksOnly') === '1',
  },
);
let lastSavedHandId = -1;

/*
 * Ultimate Texas Hold'em. Its own session: saved under `uth` in the same record
 * as Blackjack since round 4b, but never read by the Blackjack session, so it
 * cannot reach the Blackjack rating, stats or history in either direction.
 */
const uthSession = new UthSession();

/**
 * The server's routes, answered in the page.
 *
 * Kept path-for-path rather than replaced with direct calls, because the two
 * screen scripts are the ones from the local app, unmodified. When a route
 * changes there it changes here, and the test that runs both against the same
 * session is what catches the day they drift.
 */
async function api(path, body) {
  const b = body ?? {};
  switch (path) {
    case '/api/state':
      return session.view;

    /*
     * The hand analyser (round 16): cards nobody played. Answered by a pure
     * function with no session in it, which is what makes "it counts towards
     * nothing" structural rather than remembered — there is no rating, no
     * accuracy and no day count within its reach.
     */
    case '/api/analyse':
      return analyse({
        player: Array.isArray(b.player) ? b.player : [],
        dealer: typeof b.dealer === 'string' ? b.dealer : '',
        presetId: typeof b.presetId === 'string' ? b.presetId : undefined,
        locale,
      });

    case '/api/presets':
      // In the language on screen, as the rules bar is (round 11).
      return RULE_PRESETS.map((p) => ({
        id: p.id,
        name: t(session.localeCode, `preset.${p.id}`),
        note: p.note ? t(session.localeCode, `preset.${p.id}.note`) : null,
      }));

    case '/api/session': {
      const presetId = typeof b.presetId === 'string' ? b.presetId : undefined;
      const locale = session.localeCode;
      store.set('ev:preset', presetId ?? 'vegas-strip-6d-s17');
      store.set('ev:noSurrender', b.noSurrender ? '1' : '0');
      store.set('ev:likeRanksOnly', b.likeRanksOnly ? '1' : '0');
      session = new TrainerSession(presetId, undefined, {
        noSurrender: Boolean(b.noSurrender),
        likeRanksOnly: Boolean(b.likeRanksOnly),
      });
      session.setLocale(locale);
      if (me.name) session.setPlayerName(me.name);
      // A rule change deals a new shoe against a new set of correct answers, so
      // this session's totals go with it. The player does not: their name and
      // their rating belong to them rather than to the rule set they were last
      // sitting at.
      const carried = readLocalProgress();
      if (carried) session.restore(playerOnly(carried));
      lastSavedHandId = -1;
      saveProgressLocally();
      return session.view;
    }

    // The chips (round 6b). A change to the bet is kept in this browser at once
    // and reaches the shared table with the next hand; a rebuy goes straight away.
    case '/api/bet':
      session.placeBet(b.op, b.chip);
      saveProgressLocally();
      return session.view;
    case '/api/rebuy':
      session.rebuy();
      saveProgressLocally();
      void publish();
      return session.view;
    case '/api/uth/bet':
      // The circle the chips go on: the Ante unless Trips is chosen (round 11).
      uthSession.placeBet(b.op, b.chip, b.spot === 'trips' ? 'trips' : 'ante');
      saveProgressLocally();
      return uthSession.view;
    case '/api/uth/rebuy':
      uthSession.rebuy();
      saveProgressLocally();
      void publish();
      return uthSession.view;

    case '/api/uth/state':
      return uthSession.view;
    case '/api/uth/deal':
      return uthSession.deal();
    case '/api/uth/act': {
      const view = uthSession.act(b.action);
      if (view.phase === 'settled') {
        markPlayed();
        saveProgressLocally();
        void publish();
      }
      return view;
    }
    case '/api/uth/prepare':
      return uthSession.prepare();

    /*
     * The Trips paytable (round 19). Saved with the record, because it is the
     * table this player sat down at; graded nothing, so nothing restarts.
     */
    case '/api/uth/rules':
      if (typeof b.trips === 'string' && uthSession.setTripsPaytable(b.trips)) saveProgressLocally();
      return uthSession.view;

    case '/api/deal':
      session.deal();
      return afterPlay();

    case '/api/act':
      session.act(b.action);
      return afterPlay();

    case '/api/insurance':
      session.insurance(Boolean(b.take));
      return afterPlay();

    case '/api/chart':
      return session.chart;
    case '/api/weak-spots':
      return session.weakSpots;
    case '/api/profile':
      return session.profile;
    case '/api/coach':
      return session.coach;

    case '/api/player': {
      if (typeof b.name === 'string') {
        session.setPlayerName(b.name);
        me.name = b.name.trim().slice(0, 24);
        store.set('ev:playerName', me.name);
        if (me.pinHash) store.set('ev:pinHash', me.pinHash);
        saveProgressLocally();
        void publish();
      }
      if (typeof b.mode === 'string') session.setMode(b.mode);
      if (typeof b.locale === 'string') session.setLocale(b.locale);
      return session.profile;
    }

    default:
      throw new Error(`no such endpoint: ${path}`);
  }
}

/** After anything that can finish a hand: keep the record, share what is worth sharing. */
function afterPlay() {
  const view = session.view;
  const newest = view.history[0];
  if (newest && newest.id !== lastSavedHandId) {
    lastSavedHandId = newest.id;
    keep(newest);
  }
  return view;
}

