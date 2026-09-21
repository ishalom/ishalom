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
 *   findByName(nameKey)      -> rows already using that name
 *   usage()                  -> how much each live player has played (round 9)
 *   uthBoard()               -> live players ranked by their Ultimate rating (round 10)
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
      const [summary, saved, feed] = await Promise.all([
        db.doc(`players/${id}`).get(),
        db.doc(`players/${id}/history/recent`).get(),
        db.doc(`feed/${id}`).get(),
      ]);
      return {
        progress: saved.exists ? (saved.data()?.progress ?? null) : null,
        feed: feed.exists ? (feed.data()?.items ?? []) : [],
        mergedInto: summary.exists ? (summary.data()?.mergedInto ?? null) : null,
        updatedAt: summary.exists ? (summary.data()?.at ?? null) : null,
      };
    },

    /* Ranked by the Ultimate rating the summaries carry; players never rated in Ultimate are not on it. */

    async uthBoard() {
      const snap = await db.collection('players').get();
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((row) => !row.mergedInto && typeof row.uthRating === 'number')
        .sort((a, b) => b.uthRating - a.uthRating)
        .slice(0, 60)
        .map((row) => ({
          id: row.id,
          name: row.name,
          rating: row.uthRating,
          provisional: row.uthProvisional !== false,
          decisions: row.uthDecisions ?? 0,
        }));
    },

    /* The summaries carry the day count and both games' decisions, so nobody's session is read. */
    async usage() {
      const snap = await db.collection('players').get();
      return snap.docs
        .map((d) => d.data())
        .filter((row) => !row.mergedInto)
        .map((row) => ({
          name: row.name,
          blackjack: row.lifetimeDecisions ?? row.decisions ?? 0,
          ultimate: row.uthDecisions ?? 0,
          activity: row.activity ?? null,
          counters: row.counters ?? null,
          at: row.at ?? 0,
        }));
    },

    async save(id, record) {
      const { progress, feed, ...summary } = record;
      // nameKey and pinHash ride with the summary, so a name can be looked up
      // and a returning player recognised without reading anyone's session.
      await Promise.all([
        db.doc(`players/${id}`).set(summary),
        db.doc(`players/${id}/history/recent`).set({ at: record.at, progress }),
        db.doc(`feed/${id}`).set({ name: record.name, at: record.at, items: feed }),
      ]);
    },

    /*
     * Who already answers to this name. The document store has no index, so
     * this reads the collection — fine at the scale this runs at, where the
     * whole point is that fifteen people share a table.
     */
    async findByName(key) {
      const snap = await db.collection('players').get();
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((row) => (row.nameKey ?? '') === key);
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
          players = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((row) => !row.mergedInto);
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
  const base = `${url.replace(/\/+$/, '')}/rest/v1`;
  const endpoint = `${base}/${table}`;
  /* The shared table's two rows, added by migration 004 (round 21, spec A1). */
  const tablesEndpoint = `${base}/tables`;
  const seatsEndpoint = `${base}/table_seats`;
  /*
   * Whether the table has the Ultimate rating's two columns (migration 003,
   * round 10). Assumed until the table says otherwise. Without them a save that
   * names them is refused whole, so the first refusal that names them turns
   * them off for the rest of the visit and the save goes again without them:
   * everything else is kept exactly as before the migration.
   */
  let uthColumns = true;
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
    lifetimeDecisions: row.lifetime_decisions ?? row.decisions ?? 0,
    at: Date.parse(row.updated_at) || 0,
    feed: row.feed ?? [],
  });

  // The leaderboard never needs anyone else's saved session, and it is by far
  // the largest column — so it is left out of the list query on purpose.
  const LIST =
    'id,name,rating,peak,provisional,mode,hands,decisions,lifetime_decisions,accuracy,ev_lost_per_100,feed,updated_at';

  return {
    /*
     * Rows already using this name, merged ones included so the caller can see
     * why a name is taken. `name_key` is the normalised form and carries the
     * unique index, so this is a single indexed lookup.
     */
    /* ------------------------------------------------------------------
     * The shared table (round 21, spec A1)
     *
     * Four calls and no more: make one, sit at one, write what I did, read it
     * back. Each seat writes only its own row, which is what lets several
     * people play one table with no transactions anywhere — and the join is a
     * *conditional* write, so two people pressing at the same instant produce
     * one seat and one clear answer rather than two seats and a corrupt table.
     * ----------------------------------------------------------------- */

    /** Make a table and its empty seats; the maker takes seat 0. */
    async createTable(table) {
      const made = await fetch(tablesEndpoint, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({
          id: table.id,
          seed: table.seed,
          preset_id: table.presetId,
          restrictions: table.restrictions,
          seats: table.seats,
          created_by: table.createdBy,
        }),
      });
      if (!made.ok) throw new Error(`createTable failed: ${made.status}`);
      const rows = [];
      for (let seat = 0; seat < table.seats; seat++) {
        rows.push({
          table_id: table.id,
          seat,
          player_id: seat === 0 ? table.createdBy : null,
          name: seat === 0 ? table.createdByName : null,
          bet: seat === 0 ? (table.bet ?? 1) : 1,
          /* The maker's own join, in the maker's own row (round 23). */
          events: seat === 0 ? [{ kind: 'join', seat: 0, hand: 0 }] : [],
        });
      }
      const seated = await fetch(seatsEndpoint, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(rows),
      });
      if (!seated.ok) throw new Error(`createTable seats failed: ${seated.status}`);
      return table.id;
    },

    /**
     * Sit at the first free seat — and only if it is still free.
     *
     * The filter is the whole mechanism: `player_id=is.null` makes the update
     * a no-op against a seat somebody else has taken, and PostgREST answers
     * with the rows it changed. No rows changed means the seat went to
     * somebody else between reading and writing, which is exactly the race
     * this is here to lose safely.
     */
    async joinTable(tableId, seat, player) {
      const response = await fetch(
        `${seatsEndpoint}?table_id=eq.${encodeURIComponent(tableId)}` +
          `&seat=eq.${seat}&player_id=is.null`,
        {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify({ player_id: player.id, name: player.name, bet: player.bet ?? 1 }),
        },
      );
      if (!response.ok) throw new Error(`joinTable failed: ${response.status}`);
      const rows = await response.json();
      return rows.length > 0 ? { seat, taken: false } : { seat, taken: true };
    },

    /** Write my own row, and never anybody else's. */
    async pushSeat(tableId, seat, seatRecord) {
      const response = await fetch(
        `${seatsEndpoint}?table_id=eq.${encodeURIComponent(tableId)}&seat=eq.${seat}` +
          `&player_id=eq.${encodeURIComponent(seatRecord.playerId)}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            moves: seatRecord.moves,
            bet: seatRecord.bet,
            /* How far this seat has been dealt. The moves cannot say: a hand the
               dealer wins with a natural is decided by nobody and leaves none. */
            hands: seatRecord.hands ?? 0,
            /* This seat's own vote, so a tally needs no shared row (round 22). */
            vote: seatRecord.vote ?? null,
            /* What happened to this seat, written only by this seat (round 23). */
            events: seatRecord.events ?? [],
            /* And what this seat said, by hand — also only by this seat (round 24). */
            reactions: seatRecord.reactions ?? {},
            /* How far this seat's decisions have reached its owner's rating (round 25). */
            rated_decisions: seatRecord.ratedDecisions ?? 0,
            cards_hash: seatRecord.cardsHash ?? null,
            seen_at: new Date().toISOString(),
          }),
        },
      );
      if (!response.ok) throw new Error(`pushSeat failed: ${response.status}`);
      return true;
    },

    /** The whole table, as the derivation wants it. */
    async readTable(tableId) {
      const [table, seats] = await Promise.all([
        fetch(`${tablesEndpoint}?id=eq.${encodeURIComponent(tableId)}&select=*`, { headers }),
        fetch(
          `${seatsEndpoint}?table_id=eq.${encodeURIComponent(tableId)}&select=*&order=seat.asc`,
          { headers },
        ),
      ]);
      if (!table.ok || !seats.ok) throw new Error(`readTable failed: ${table.status}/${seats.status}`);
      const rows = await table.json();
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        id: row.id,
        seed: row.seed,
        presetId: row.preset_id,
        restrictions: row.restrictions ?? {},
        state: row.state,
        seats: (await seats.json()).map((seat) => ({
          seat: seat.seat,
          playerId: seat.player_id,
          name: seat.name,
          bet: Number(seat.bet) || 1,
          moves: seat.moves ?? [],
          hands: seat.hands ?? 0,
          vote: seat.vote ?? null,
          events: seat.events ?? [],
          reactions: seat.reactions ?? {},
          ratedDecisions: seat.rated_decisions ?? 0,
          cardsHash: seat.cards_hash ?? undefined,
          seenAt: seat.seen_at ? Date.parse(seat.seen_at) : null,
        })),
      };
    },

    async findByName(key) {
      const response = await fetch(
        `${endpoint}?name_key=eq.${encodeURIComponent(key)}` +
          `&select=id,name,pin_hash,merged_into,lifetime_decisions,decisions`,
        { headers },
      );
      if (!response.ok) throw new Error(`findByName failed: ${response.status}`);
      return (await response.json()).map((row) => ({
        id: row.id,
        name: row.name,
        pinHash: row.pin_hash,
        mergedInto: row.merged_into,
        lifetimeDecisions: row.lifetime_decisions ?? row.decisions ?? 0,
      }));
    },

    async load(id) {
      const response = await fetch(
        `${endpoint}?id=eq.${encodeURIComponent(id)}&select=progress,feed,merged_into,updated_at`,
        { headers },
      );
      if (!response.ok) throw new Error(`load failed: ${response.status}`);
      const rows = await response.json();
      if (rows.length === 0) return null;
      return {
        progress: rows[0].progress ?? null,
        feed: rows[0].feed ?? [],
        // A row that points at another has been retired by a merge. The caller
        // has to know, or it will read a dormant session back and then write to
        // it — which would put an abandoned rating back on the leaderboard.
        mergedInto: rows[0].merged_into ?? null,
        // When the row was last written: the last day a player from before the
        // day count is known to have played (round 9).
        updatedAt: Date.parse(rows[0].updated_at) || null,
      };
    },

    /*
     * How much each live player has played, for the usage page (round 9).
     *
     * Only what that page counts: the name, both games' lifetime decisions and
     * the day count, which lives inside the saved record — so nothing new was
     * added to the table and no migration is needed. The two JSON paths return
     * those few fields, not the saved session around them. Merged rows are not
     * people and are left out.
     *
     * A refusal is thrown with its status, so the page can say "the table
     * refused (400)" rather than showing zero people as if that were true.
     */
    async usage() {
      const response = await fetch(
        `${endpoint}?select=name,decisions,lifetime_decisions,updated_at,` +
          'activity:progress->activity,uth_decisions:progress->uth->>lifetimeDecisions,' +
          // Which explanations people open (round 15). Read out of the record
          // that already exists — no column, no migration.
          'counters:progress->counters' +
          '&merged_into=is.null&order=updated_at.desc&limit=1000',
        { headers },
      );
      if (!response.ok) {
        const error = new Error(`usage failed: ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const rows = await response.json();
      return (Array.isArray(rows) ? rows : []).map((row) => ({
        name: row.name,
        blackjack: row.lifetime_decisions ?? row.decisions ?? 0,
        ultimate: Number(row.uth_decisions) || 0,
        activity: row.activity && typeof row.activity === 'object' ? row.activity : null,
        counters: row.counters && typeof row.counters === 'object' ? row.counters : null,
        at: Date.parse(row.updated_at) || 0,
      }));
    },

    async save(id, record) {
      const write = (body) =>
        fetch(endpoint, {
          method: 'POST',
          headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(body),
        });
      const body = {
          id,
          name: record.name,
          rating: record.rating,
          peak: record.peak,
          provisional: record.provisional,
          mode: record.mode,
          hands: record.hands,
          decisions: record.decisions,
          lifetime_decisions: record.lifetimeDecisions,
          name_key: record.nameKey,
          // Only when this device holds one. The upsert updates just the columns
          // it is sent, so leaving it out keeps the row's code; sending null
          // would erase it (round 9).
          ...(record.pinHash ? { pin_hash: record.pinHash } : {}),
          accuracy: record.accuracy,
          ev_lost_per_100: record.evLostPer100,
          progress: record.progress,
          feed: record.feed,
          updated_at: new Date().toISOString(),
      };
      if (uthColumns) {
        // Null until an Ultimate decision has been rated: never rated is not rated.
        body.uth_rating = record.uthRating ?? null;
        body.uth_provisional = record.uthProvisional !== false;
      }
      let response = await write(body);
      if (!response.ok && uthColumns && response.status === 400) {
        const reason = await response.text().catch(() => '');
        if (/uth_rating|uth_provisional/.test(reason)) {
          uthColumns = false;
          delete body.uth_rating;
          delete body.uth_provisional;
          response = await write(body);
        }
      }
      if (!response.ok) throw new Error(`save failed: ${response.status}`);
    },

    /*
     * The Ultimate side of the leaderboard (round 10): live players with an
     * Ultimate rating, best first. A table without the columns yet answers 400,
     * which is thrown with its status so the board can say it is waiting for the
     * table rather than showing nobody as if that were true.
     */
    async uthBoard() {
      const response = await fetch(
        `${endpoint}?select=id,name,uth_rating,uth_provisional,uth_decisions:progress->uth->>lifetimeDecisions` +
          '&merged_into=is.null&uth_rating=not.is.null&order=uth_rating.desc&limit=60',
        { headers },
      );
      if (!response.ok) {
        const error = new Error(`uthBoard failed: ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const rows = await response.json();
      return (Array.isArray(rows) ? rows : []).map((row) => ({
        id: row.id,
        name: row.name,
        rating: row.uth_rating,
        provisional: row.uth_provisional !== false,
        decisions: Number(row.uth_decisions) || 0,
      }));
    },

    /**
     * @param onRows   the leaderboard rows, whenever the table answers
     * @param onStatus true when a poll reached the table, false when it did not
     *                 — so the page can say it is offline instead of showing an
     *                 empty or stale leaderboard as if it were live
     */
    watch(onRows, onStatus = () => {}) {
      // Polling rather than a socket: fifteen people watching a leaderboard do
      // not need sub-second news, and a poll has no connection to lose, no
      // reconnect to get wrong, and nothing to clean up on a backgrounded tab.
      let stopped = false;
      let timer = null;

      const tick = async () => {
        try {
          // Merged rows are excluded here, not filtered afterwards: they are
          // not people, and one person listed twice under one name is worse
          // than a short leaderboard.
          const response = await fetch(
            `${endpoint}?select=${LIST}&merged_into=is.null&order=rating.desc&limit=60`,
            { headers },
          );
          if (response.ok) {
            onRows((await response.json()).map(rowToRecord));
            onStatus(true);
          } else {
            onStatus(false);
          }
        } catch {
          // Offline, or the project is asleep. Say so, and try again next tick.
          onStatus(false);
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
