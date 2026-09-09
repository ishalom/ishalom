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
 * `db` is optional by contract — it resolves null when the page is opened
 * somewhere that cannot serve it. Everything below is written so that the game
 * is completely unaffected when that happens: you still play, you still get
 * graded, you simply do not appear on the leaderboard. A trainer that refuses
 * to deal because a database is unreachable would have its priorities backwards.
 * ----------------------------------------------------------------------- */

let db = null;
let dbReady = false;

async function connect() {
  try {
    db = await window.claude?.use?.('db');
  } catch {
    db = null;
  }
  dbReady = true;
  if (db) {
    await restoreMine();
    watchLeaderboard();
    watchFeed();
    saveProfile();
  }
  renderSocial();
}

let leaderboard = [];
let feed = [];

/*
 * The store holds at most five thousand documents for the whole artifact, so
 * nothing here may grow with the number of hands played. Everything is keyed by
 * player instead: one profile, one history, one feed entry each. Fifteen people
 * playing for a year still come to forty-five documents.
 *
 * That is why the history is a rolling window inside a single document rather
 * than a document per hand — the alternative reaches the cap in an evening and
 * then starts refusing to save anything at all.
 */
const HISTORY_KEPT = 40;
const FEED_KEPT = 5;

function watchLeaderboard() {
  db.collection('players')
    .orderBy('rating', 'desc')
    .limit(60)
    .onSnapshot(
      (snap) => {
        leaderboard = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderSocial();
      },
      () => {
        // A dead subscription is not worth a message on screen; the panel simply
        // goes on saying it has nothing yet.
      },
    );
}

function watchFeed() {
  // One document per player, each holding that player's few most recent
  // showable hands. Flattened and re-sorted here, which is cheap for the
  // handful of documents this can ever be.
  db.collection('feed').onSnapshot(
    (snap) => {
      feed = snap.docs
        .flatMap((d) => {
          const body = d.data() ?? {};
          return (body.items ?? []).map((item) => ({ ...item, playerId: d.id, name: body.name }));
        })
        .sort((a, b) => b.at - a.at)
        .slice(0, 40);
      renderSocial();
    },
    () => {},
  );
}

/** The player's standing, written after every settled hand. */
async function saveProfile() {
  if (!db || !me.name) return;
  const profile = session.profile;
  const stats = session.view.stats;
  try {
    await db.doc(`players/${me.id}`).set({
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
    });
  } catch {
    // Offline, or not granted. The session is unaffected.
  }
}

/**
 * What lands on the shared feed.
 *
 * Not every hand — a wall of routine twenty-against-six is nobody's idea of a
 * feed. Two things are worth showing other people: an expensive mistake, and a
 * hard spot played correctly. They are the same fact from opposite sides, which
 * is what this trainer is about, so both go up and neither is dressed as the
 * other.
 */
const HARD_SPOTS = new Set([
  'bj:hard16:vs10', 'bj:hard15:vs10', 'bj:hard16:vs9', 'bj:hard12:vs3',
  'bj:soft18:vs9', 'bj:soft18:vs10', 'bj:pair8:vs10', 'bj:pair8:vsA',
  'bj:hard12:vs2', 'bj:soft17:vs2', 'bj:pair9:vs7', 'bj:hard11:vsA',
]);
const hardSpot = (d) => HARD_SPOTS.has(d.scenarioKey);

function showcaseOf(hand) {
  const worst = hand.decisions.reduce(
    (acc, d) => (acc === null || d.evCost > acc.evCost ? d : acc),
    null,
  );
  if (worst && (worst.severity === 'blunder' || worst.severity === 'significant')) return worst;
  const held = hand.decisions.find((d) => d.correct && !d.closeCall && hardSpot(d));
  return held ?? null;
}

let myFeed = [];

async function pushToFeed(hand) {
  if (!db || !me.name) return;
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

  try {
    await db.doc(`feed/${me.id}`).set({ name: me.name, at: Date.now(), items: myFeed });
  } catch {
    // Same as above: a feed that cannot be written is not a reason to stop.
  }
}

/**
 * A player's own hands, kept as one rolling document.
 *
 * Everything the feedback card showed is stored, so a hand can be read back in
 * full later rather than reduced to a win or a loss — which, given §3.1, is the
 * only version of a hand worth keeping.
 */
let myHistory = [];

async function saveHand(hand) {
  if (!db || !me.name) return;
  myHistory = [hand, ...myHistory.filter((h) => h.id !== hand.id)].slice(0, HISTORY_KEPT);
  try {
    await db.doc(`players/${me.id}/history/recent`).set({
      at: Date.now(),
      hands: myHistory,
    });
  } catch {
    // Not fatal; the running session still has its own history.
  }
}

/** Pick up where this player left off, so the record survives a closed tab. */
async function restoreMine() {
  if (!db || !me.name) return;
  try {
    const [history, mine] = await Promise.all([
      db.doc(`players/${me.id}/history/recent`).get(),
      db.doc(`feed/${me.id}`).get(),
    ]);
    if (history.exists) myHistory = history.data()?.hands ?? [];
    if (mine.exists) myFeed = mine.data()?.items ?? [];
  } catch {
    // A first-time player, or an unreachable store. Both start empty.
  }
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
      lastSavedHandId = -1;
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
        saveProfile();
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
    saveHand(newest);
    pushToFeed(newest);
    saveProfile();
  }
  return view;
}

