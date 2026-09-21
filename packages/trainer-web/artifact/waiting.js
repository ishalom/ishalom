/*
 * Waiting for a friend, without an empty screen (round 23, item 5).
 *
 * Idan: *"גם אם קובעים אז מבאס לחכות... פשוט לא מסך ירוק ריק."* Making a table
 * and staring at a link until somebody arrives is the worst screen in the app,
 * so the player does not have to: he plays the ordinary private table while he
 * waits, and a strip along the top says what he is waiting for.
 *
 * TWO THINGS THIS DELIBERATELY IS NOT.
 *
 * It is **not a second mode**. The game he plays while waiting is the private
 * table, dealt by the same session and graded by the same code path as any hand
 * he plays alone — there is nothing here that touches a decision.
 *
 * And the strip is **not a clock**. It counts nothing down and it can eject
 * nobody; the thirty seconds, the vote and the drop belong to the shared table
 * alone, and `test/shared-table.test.ts` scans the private game's files to
 * prove they are not there. A line saying "somebody may arrive" is not one of
 * them.
 *
 * WHEN HE MOVES. Between hands, never in the middle of one — being pulled off a
 * live hand would cost him the hand and the decision, which is exactly what the
 * shared table's own rules are careful never to do to anybody.
 */

/** How often to look for the second player, in ms. Slower than the table's own poll. */
const WAITING_POLL_MS = 2500;

const waiting = {
  /** The table being waited on, or null. */
  id: null,
  /** Set once somebody has sat down, so the strip can say so before moving him. */
  arrived: null,
  timer: null,
};

/** Start watching a table this player has made and is waiting at. */
function watchForFriend(id) {
  waiting.id = id;
  waiting.arrived = null;
  if (waiting.timer) clearInterval(waiting.timer);
  waiting.timer = setInterval(() => void pollForFriend(), WAITING_POLL_MS);
  drawWaitingStrip();
}

/** Stop watching — he arrived, or the player left the table. */
function stopWaitingForFriend() {
  waiting.id = null;
  waiting.arrived = null;
  if (waiting.timer) clearInterval(waiting.timer);
  waiting.timer = null;
  drawWaitingStrip();
}

/**
 * Whether the private table is mid-hand.
 *
 * The one question that decides when he moves. `idle` and `settled` are both
 * between hands; `player` and `insurance` are a hand he is in the middle of.
 */
function midHand() {
  try {
    const phase = session.view.phase;
    return phase === 'player' || phase === 'insurance';
  } catch {
    return false;
  }
}

async function pollForFriend() {
  if (!waiting.id || !sharedAvailable()) return;
  const store = sharedBackend();
  let record = null;
  try {
    record = await store.readTable(waiting.id);
  } catch {
    return; // A failed poll changes nothing; he is still waiting.
  }
  if (!record) return;
  const others = record.seats.filter((row) => row.playerId && row.playerId !== me.id);
  if (others.length === 0) {
    drawWaitingStrip();
    return;
  }
  waiting.arrived = others[0].name || '';
  drawWaitingStrip();
  // Between hands, never in the middle of one.
  if (!midHand()) {
    const id = waiting.id;
    stopWaitingForFriend();
    location.hash = `#shared=${encodeURIComponent(id)}`;
  }
}

/**
 * The strip itself, drawn outside the mounted screen.
 *
 * Outside because it has to survive a screen changing under it: he made the
 * table on one screen and is playing on another, and what he is waiting for did
 * not stop being true in between.
 */
function drawWaitingStrip() {
  let strip = document.getElementById('waiting-strip');
  if (!waiting.id) {
    if (strip) strip.remove();
    return;
  }
  if (!strip) {
    strip = document.createElement('div');
    strip.id = 'waiting-strip';
    strip.className = 'waiting-strip';
    strip.setAttribute('role', 'status');
    document.body.insertBefore(strip, document.body.firstChild);
  }
  strip.replaceChildren();

  const line = document.createElement('span');
  line.className = 'waiting-line';
  line.textContent = waiting.arrived
    ? tr('waiting.arrived', { name: waiting.arrived })
    : tr('waiting.forFriend');
  strip.appendChild(line);

  if (!waiting.arrived) {
    const copy = document.createElement('button');
    copy.className = 'waiting-copy';
    copy.type = 'button';
    copy.textContent = tr('shared.copy');
    copy.addEventListener('click', () => {
      const link = `${location.origin}${location.pathname}#shared=${encodeURIComponent(waiting.id)}`;
      if (navigator.clipboard) void navigator.clipboard.writeText(link);
      copy.textContent = tr('shared.copied');
    });
    strip.appendChild(copy);
  }

  const go = document.createElement('button');
  go.className = 'waiting-go';
  go.type = 'button';
  go.textContent = tr('waiting.go');
  go.addEventListener('click', () => {
    location.hash = `#shared=${encodeURIComponent(waiting.id)}`;
  });
  strip.appendChild(go);
}
