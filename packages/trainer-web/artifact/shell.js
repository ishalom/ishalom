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
/* Held so the poll can be stopped — a browser tab never needs to, but anything
   that loads this page without being a browser tab does. */
let stopWatching = null;
let leaderboard = [];
let feed = [];

/** How many of a player's showable hands ride along with their record. */
const FEED_KEPT = 5;

async function connect() {
  backend = await openBackend(typeof BACKEND_CONFIG === 'undefined' ? null : BACKEND_CONFIG);
  backendReady = true;

  if (backend) {
    await restoreMine();
    stopWatching = backend.watch((rows) => {
      leaderboard = rows;
      feed = rows
        .flatMap((row) =>
          (row.feed ?? []).map((item) => ({ ...item, playerId: row.id, name: row.name })),
        )
        .sort((a, b) => b.at - a.at)
        .slice(0, 40);
      renderSocial();
    });
    void publish();
  } else {
    // No table to join, but the local copy is still worth reading back.
    const local = readLocalProgress();
    if (local) session.restore(local);
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
  try {
    await backend.save(me.id, {
      name: me.name,
      rating: profile.rating.ratedDecisions > 0 ? Math.round(profile.rating.rating) : 0,
      peak: Math.round(profile.rating.peak),
      provisional: Boolean(profile.rating.provisional),
      mode: profile.rating.mode,
      hands: stats.hands,
      decisions: stats.decisions,
      accuracy: stats.accuracy,
      evLostPer100: stats.evLostPer100,
      at: Date.now(),
      progress: session.progress,
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
    store.set(PROGRESS_KEY, JSON.stringify(session.progress));
    store.set(FEED_KEY, JSON.stringify(myFeed));
  } catch {
    // Storage full or switched off. The session in front of the player is fine.
  }
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
  if (local) session.restore(local);
  myFeed = readLocalFeed();

  if (backend && me.name) {
    try {
      const remote = await backend.load(me.id);
      if (remote) {
        if (remote.progress && (!local || remote.progress.decisions > local.decisions)) {
          session.restore(remote.progress);
        }
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

    case '/api/presets':
      return RULE_PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note ?? null }));

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

