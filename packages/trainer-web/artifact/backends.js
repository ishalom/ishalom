/*
 * Where the shared table lives.
 *
 * The app runs in two places and they store things differently: published on
 * claude.ai it has the artifact's own document store, and served as a plain page
 * it has whatever HTTP backend it was built with. Rather than teach the app both,
 * each is wrapped to the same small interface and the app is handed whichever
 * one answers.
 *
 *   load(id)                 -> { progress, feed } or null
 *   save(id, record)         -> void
 *   watch(onRows)            -> unsubscribe
 *
 * A record is one player: their summary for the leaderboard, their saved
 * session, and their few most recent showable hands. One logical record per
 * person, however the backend underneath chooses to keep it.
 *
 * Both are optional. When neither answers, the app plays exactly as well and
 * simply has no leaderboard — see `renderLeaderboard`.
 */

/** How often the HTTP backend re-reads the table. */
const POLL_MS = 20_000;

/**
 * The artifact's document store.
 *
 * Three documents rather than one, because the leaderboard is a live query over
 * the summaries and there is no reason to ship every player's full saved session
 * to every viewer just to draw a ranked list.
 */
function artifactBackend(db) {
  return {
    async load(id) {
      const [saved, feed] = await Promise.all([
        db.doc(`players/${id}/history/recent`).get(),
        db.doc(`feed/${id}`).get(),
      ]);
      return {
        progress: saved.exists ? (saved.data()?.progress ?? null) : null,
        feed: feed.exists ? (feed.data()?.items ?? []) : [],
      };
    },

    async save(id, record) {
      const { progress, feed, ...summary } = record;
      await Promise.all([
        db.doc(`players/${id}`).set(summary),
        db.doc(`players/${id}/history/recent`).set({ at: record.at, progress }),
        db.doc(`feed/${id}`).set({ name: record.name, at: record.at, items: feed }),
      ]);
    },

    watch(onRows) {
      let players = [];
      let feeds = [];
      const merge = () =>
        onRows(
          players.map((p) => ({
            ...p,
            feed: (feeds.find((f) => f.id === p.id)?.items ?? []),
          })),
        );

      const stopPlayers = db
        .collection('players')
        .orderBy('rating', 'desc')
        .limit(60)
        .onSnapshot((snap) => {
          players = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          merge();
        }, () => {});

      const stopFeeds = db.collection('feed').onSnapshot((snap) => {
        feeds = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        merge();
      }, () => {});

      return () => {
        stopPlayers();
        stopFeeds();
      };
    },
  };
}

/**
 * A PostgREST table — Supabase, or anything speaking the same dialect.
 *
 * One row per player, upserted whole. The key in the page is the publishable
 * anonymous key, which is what it is meant to be: it identifies the project, not
 * a person, and the table's own policies decide what it may do. Those policies
 * allow reading and writing rows and nothing else — in particular they refuse
 * deletes, so the worst a stranger who finds the page can do is add a row or
 * overwrite one, and no history can be destroyed.
 *
 * Say plainly what this is: the shared table is open to anyone who opens the
 * page. For a family it is the right trade against making everybody sign in.
 * It is not a place for anything private, and nothing private is put in it.
 */
function httpBackend({ url, key, table = 'players' }) {
  const endpoint = `${url.replace(/\/+$/, '')}/rest/v1/${table}`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  const rowToRecord = (row) => ({
    id: row.id,
    name: row.name,
    rating: row.rating,
    peak: row.peak,
    provisional: row.provisional,
    mode: row.mode,
    hands: row.hands,
    decisions: row.decisions,
    accuracy: row.accuracy,
    evLostPer100: row.ev_lost_per_100,
    at: Date.parse(row.updated_at) || 0,
    feed: row.feed ?? [],
  });

  // The leaderboard never needs anyone else's saved session, and it is by far
  // the largest column — so it is left out of the list query on purpose.
  const LIST = 'id,name,rating,peak,provisional,mode,hands,decisions,accuracy,ev_lost_per_100,feed,updated_at';

  return {
    async load(id) {
      const response = await fetch(
        `${endpoint}?id=eq.${encodeURIComponent(id)}&select=progress,feed`,
        { headers },
      );
      if (!response.ok) throw new Error(`load failed: ${response.status}`);
      const rows = await response.json();
      if (rows.length === 0) return null;
      return { progress: rows[0].progress ?? null, feed: rows[0].feed ?? [] };
    },

    async save(id, record) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          id,
          name: record.name,
          rating: record.rating,
          peak: record.peak,
          provisional: record.provisional,
          mode: record.mode,
          hands: record.hands,
          decisions: record.decisions,
          accuracy: record.accuracy,
          ev_lost_per_100: record.evLostPer100,
          progress: record.progress,
          feed: record.feed,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!response.ok) throw new Error(`save failed: ${response.status}`);
    },

    watch(onRows) {
      // Polling rather than a socket: fifteen people watching a leaderboard do
      // not need sub-second news, and a poll has no connection to lose, no
      // reconnect to get wrong, and nothing to clean up on a backgrounded tab.
      let stopped = false;
      let timer = null;

      const tick = async () => {
        try {
          const response = await fetch(
            `${endpoint}?select=${LIST}&order=rating.desc&limit=60`,
            { headers },
          );
          if (response.ok) onRows((await response.json()).map(rowToRecord));
        } catch {
          // Offline, or the project is asleep. Try again on the next tick.
        }
        if (!stopped) timer = setTimeout(tick, POLL_MS);
      };
      tick();

      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      };
    },
  };
}

/**
 * Whichever backend this copy of the page can actually reach.
 *
 * The artifact store is tried first and only exists inside the claude.ai
 * viewer; the HTTP one is configured at build time and only exists when the
 * page was built with a project to talk to. Returning null is a normal outcome,
 * not an error.
 */
async function openBackend(config) {
  try {
    const db = await window.claude?.use?.('db');
    if (db) return artifactBackend(db);
  } catch {
    // Not published as an artifact, or the capability was declined.
  }
  if (config && config.url && config.key) {
    try {
      return httpBackend(config);
    } catch {
      // A malformed configuration should not stop anyone playing.
    }
  }
  return null;
}
