/*
 * The shared table's screen (round 22; spec A, round A2).
 *
 * Two seats, one shoe, both playing at once. This file draws and nothing else:
 * every card, every grade and every legal action comes back from the routes,
 * which reach the same derivation the tests hold to. There is no second copy of
 * the rules here, and there is no card in this file that was not derived from
 * the seed and the log.
 *
 * WHAT THE POLL IS FOR, AND WHAT IT IS NOT. The table is read back every second
 * and a half so a player sees his friend act. It is not how anything is
 * decided: the cards are a function of the seed and the log, so a slow poll
 * shows an old table, never a different one. Nothing here reads a clock to work
 * out what was dealt — the clock in this file drives one thing, the thirty
 * seconds before a vote may be called, and that writes an event rather than a
 * card.
 */

const T = (key, params) => (window.EV ? window.EV.t(key, params) : key);
const el = (id) => document.getElementById(id);

async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'request failed');
  return data;
}

const shared = {
  id: null,
  seat: null,
  screen: null,
  clock: null,
  timer: null,
  busy: false,
  /** Set when the page has no store to talk to: the artifact copy says so (§3.11). */
  unavailable: false,
  /** How many seats a new table gets. Two unless somebody says otherwise. */
  seats: 2,
};

/** The smallest and largest table (§3.1). */
const SHARED_MIN_SEATS = 2;
const SHARED_MAX_SEATS = 6;

/** The table this link points at, or null for the door. */
function tableFromLocation() {
  const hash = String(location.hash || '');
  const at = hash.indexOf('=');
  if (at > 0) return decodeURIComponent(hash.slice(at + 1));
  const query = new URLSearchParams(location.search);
  return query.get('t');
}

/** The link to send, which is this page with the table's name on it. */
function inviteLink() {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#shared=${encodeURIComponent(shared.id)}`;
}

/* --- Drawing ------------------------------------------------------------- */

function cardNode(card) {
  const node = document.createElement('div');
  node.className = 'card dealt' + (card.red ? ' red' : '');
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', card.label ?? `${card.rank}${card.suit}`);
  const rank = document.createElement('span');
  rank.className = 'card-rank';
  rank.textContent = card.rank;
  const suit = document.createElement('span');
  suit.className = 'card-suit';
  suit.textContent = card.suit;
  node.append(rank, suit);
  return node;
}

function faceDownNode() {
  const node = document.createElement('div');
  node.className = 'card back dealt';
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', T('card.faceDown'));
  return node;
}

/**
 * One seat, drawn.
 *
 * Mine full size, the others compact — §3.1. What a neighbour's panel does not
 * carry is what he did: his cards are face up at a real table, his decisions
 * are not, and they are not in the object this came from until I have played.
 */
function seatNode(seat) {
  const box = document.createElement('section');
  box.className = 'shared-seat' + (seat.mine ? ' mine' : ' other') + ` is-${seat.status}`;
  box.dataset.seat = String(seat.seat);

  const title = document.createElement('h2');
  title.className = 'seat-title';
  const who = document.createElement('span');
  who.className = 'shared-name';
  who.textContent = seat.mine ? T('shared.you') : seat.name || T('shared.seatN', { n: seat.seat + 1 });
  const status = document.createElement('span');
  status.className = 'shared-status';
  status.textContent = T(`shared.status.${seat.status}`);
  const total = document.createElement('span');
  total.className = 'seat-total';
  total.textContent = seat.total === null ? '' : String(seat.total);
  title.append(who, status, total);
  box.appendChild(title);

  for (const hand of seat.hands) {
    const cards = document.createElement('div');
    cards.className = 'cards';
    for (const card of hand) cards.appendChild(cardNode(card));
    box.appendChild(cards);
  }
  if (seat.hands.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'shared-empty';
    empty.textContent = T('shared.notDealt');
    box.appendChild(empty);
  }
  if (seat.net !== null) {
    const net = document.createElement('p');
    net.className = 'shared-net';
    net.textContent = window.EVFigure
      ? window.EVFigure.units(seat.net)
      : (seat.net > 0 ? '+' : '') + seat.net;
    box.appendChild(net);
  }
  return box;
}

/**
 * The two measures, side by side.
 *
 * The bar first and the stack second, and the screen says which is which: the
 * share of decisions played correctly does not care what anybody wagered, and
 * the stack does. Under ten decisions the bar prints no percentage at all.
 */
function renderMeasures(screen) {
  const box = el('shared-measures');
  if (!screen || screen.seats.length === 0) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.replaceChildren();

  const table = document.createElement('div');
  table.className = 'shared-measure-rows';
  for (const seat of screen.seats) {
    const row = document.createElement('div');
    row.className = 'shared-measure' + (seat.mine ? ' mine' : '');

    const name = document.createElement('span');
    name.className = 'shared-measure-name';
    name.textContent = seat.mine ? T('shared.you') : seat.name;

    const bar = document.createElement('span');
    bar.className = 'shared-measure-bar';
    bar.textContent =
      seat.bar === null
        ? T('shared.settling')
        : T('shared.barValue', { pct: Math.round(seat.bar * 100) });

    const stack = document.createElement('span');
    stack.className = 'shared-measure-stack';
    stack.textContent = window.EVFigure
      ? window.EVFigure.units(seat.stack)
      : (seat.stack > 0 ? '+' : '') + seat.stack;

    row.append(name, bar, stack);
    table.appendChild(row);
  }
  box.appendChild(table);

  const legend = document.createElement('p');
  legend.className = 'shared-legend';
  legend.textContent = T('shared.legend');
  box.appendChild(legend);

  /*
   * And when the two disagree, the line that names which is which. It is the
   * whole reason both are on screen: somebody bet his way to the top of one of
   * these numbers, and saying so is the only honest way to show it.
   */
  if (screen.comparison) {
    const line = document.createElement('p');
    line.className = 'shared-comparison';
    line.textContent = T('shared.comparison', {
      stackLeader: screen.comparison.leaderByStack,
      barLeader: screen.comparison.leaderByBar,
    });
    box.appendChild(line);
  }
}

/** The countdown and the vote, drawn for everybody who can see either (§3.4). */
function renderClock(clock) {
  const box = el('shared-clock');
  if (!clock) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.hidden = false;
  box.replaceChildren();

  const line = document.createElement('p');
  line.className = 'shared-clock-line';
  /*
   * At two seats the countdown ends the hand by itself, so it says so rather
   * than promising a vote nobody will be offered.
   */
  if (clock.mine) {
    line.textContent =
      clock.secondsLeft > 0
        ? T(clock.automatic ? 'shared.clockYouAuto' : 'shared.clockYou', { n: clock.secondsLeft })
        : T(clock.automatic ? 'shared.clockYouAutoOver' : 'shared.clockYouOver');
  } else {
    line.textContent =
      clock.secondsLeft > 0
        ? T(clock.automatic ? 'shared.clockThemAuto' : 'shared.clockThem', {
            name: clock.name,
            n: clock.secondsLeft,
          })
        : T(clock.automatic ? 'shared.clockThemAutoOver' : 'shared.clockThemOver', { name: clock.name });
  }
  box.appendChild(line);

  if (clock.canVote) {
    const vote = document.createElement('button');
    vote.className = 'action';
    vote.type = 'button';
    vote.id = 'shared-vote';
    vote.textContent = T('shared.vote', { name: clock.name, votes: clock.votes, needs: clock.needs });
    vote.addEventListener('click', () => void act(() => api('/api/shared/vote', { id: shared.id })));
    box.appendChild(vote);
  }
}

/**
 * The buttons.
 *
 * The leave control sits with them and looks like them, which §3.3 makes part
 * of the spec rather than a preference: if silence is punished then speaking
 * has to be cheap, and a clean exit buried in a menu means the penalty lands on
 * somebody who did not know there was a door.
 */
function renderActions(screen) {
  const box = el('shared-actions');
  box.replaceChildren();
  if (!screen) return;

  for (const action of screen.legal) {
    const button = document.createElement('button');
    button.className = 'action' + (action === 'hit' || action === 'stand' ? ' primary' : '');
    button.type = 'button';
    button.dataset.action = action;
    button.textContent = T(`action.${action}`);
    button.addEventListener('click', () => void act(() => api('/api/shared/act', { id: shared.id, action })));
    box.appendChild(button);
  }

  if (screen.legal.length === 0 && (screen.hand === null || screen.handOver)) {
    const deal = document.createElement('button');
    deal.className = 'action primary';
    deal.type = 'button';
    deal.id = 'shared-deal';
    deal.textContent = T('shared.deal');
    deal.addEventListener('click', () => void act(() => api('/api/shared/deal', { id: shared.id })));
    box.appendChild(deal);
  }

  const leave = document.createElement('button');
  leave.className = 'action shared-leave';
  leave.type = 'button';
  leave.id = 'shared-leave';
  leave.textContent = T('shared.leave');
  leave.addEventListener('click', () => void act(() => api('/api/shared/leave', { id: shared.id })));
  box.appendChild(leave);

  /*
   * The refusal, made reachable. Only with the debug flag set — it is a way to
   * see what the app does when two phones disagree, not a thing to press.
   */
  if (window.localStorage && window.localStorage.getItem('ev:debug') === '1') {
    const breaker = document.createElement('button');
    breaker.className = 'action shared-debug';
    breaker.type = 'button';
    breaker.id = 'shared-force-mismatch';
    breaker.textContent = T('shared.forceMismatch');
    breaker.addEventListener('click', () =>
      void act(() => api('/api/shared/force-mismatch', { id: shared.id })),
    );
    box.appendChild(breaker);
  }
}

/**
 * How many seats, chosen before the table exists.
 *
 * Buttons rather than a number field: this is a choice between five things on a
 * phone, and the answer is almost always the first one.
 */
function renderSeatPicker() {
  const row = el('shared-seats-row');
  if (!row) return;
  row.replaceChildren();
  for (let seats = SHARED_MIN_SEATS; seats <= SHARED_MAX_SEATS; seats++) {
    const pick = document.createElement('button');
    pick.className = 'action seat-pick' + (seats === shared.seats ? ' primary' : '');
    pick.type = 'button';
    pick.dataset.seats = String(seats);
    pick.textContent = String(seats);
    pick.setAttribute('aria-pressed', seats === shared.seats ? 'true' : 'false');
    pick.addEventListener('click', () => {
      shared.seats = seats;
      renderSeatPicker();
    });
    row.appendChild(pick);
  }
}

function renderTalk(screen) {
  const box = el('shared-talk');
  if (!screen || screen.hand === null) {
    box.hidden = true;
    return;
  }
  if (screen.handOver) {
    box.hidden = false;
    box.textContent = T('shared.handOver');
    return;
  }
  const waiting = screen.waitingFor.filter((seat) => seat !== shared.seat);
  if (screen.legal.length > 0) {
    box.hidden = false;
    box.textContent = T('shared.yourMove');
  } else if (waiting.length > 0) {
    box.hidden = false;
    const names = waiting
      .map((seat) => screen.seats.find((row) => row.seat === seat)?.name || '')
      .filter(Boolean)
      .join(', ');
    box.textContent = T('shared.waitingFor', { names });
  } else {
    box.hidden = true;
  }
}

function render() {
  const screen = shared.screen;

  el('shared-door').hidden = Boolean(shared.id);
  el('shared-refused').hidden = !(screen && screen.refused);

  if (shared.unavailable) {
    el('shared-door').hidden = false;
    const note = el('shared-door-note');
    note.hidden = false;
    note.textContent = T('shared.needsHosted');
    el('shared-make').hidden = true;
    return;
  }

  /*
   * A table with an empty seat is a table waiting for somebody, and the link is
   * the only growth this app has (§3.11) — so it is the whole screen until
   * somebody sits down, rather than a line beside a felt nobody can play.
   */
  const seated = Boolean(screen) ? screen.seats.filter((seat) => seat.playerId !== null).length : 0;
  const alone = Boolean(screen) && seated < 2;
  const free = Boolean(screen) && screen.seats.some((seat) => seat.playerId === null);
  /*
   * The link stays reachable while any seat is empty — at six seats people
   * arrive one at a time — but it is only the *whole* screen while nobody else
   * has come, which is the moment there is nothing else to show.
   */
  el('shared-invite').hidden = !(shared.id && free && !(screen && screen.refused));
  el('shared-invite').classList.toggle('waiting', alone);
  if (shared.id && free) el('shared-link').textContent = inviteLink();

  const playable = Boolean(screen) && !screen.refused && !alone;
  el('shared-table').hidden = !playable;
  if (!playable) {
    renderClock(null);
    el('shared-measures').hidden = true;
    el('shared-actions').replaceChildren();
    el('shared-talk').hidden = true;
    return;
  }

  const dealerCards = el('shared-dealer-cards');
  dealerCards.replaceChildren(...screen.dealer.map(cardNode));
  if (!screen.dealerRevealed) dealerCards.appendChild(faceDownNode());
  el('shared-dealer-total').textContent = screen.dealerTotal === null ? '' : String(screen.dealerTotal);

  /* Mine first, always: it is the hand being played (§3.1). */
  const order = [...screen.seats].sort((a, b) => Number(b.mine) - Number(a.mine) || a.seat - b.seat);
  const box = el('shared-seats');
  /*
   * Beyond four the other seats collapse into a list (§3.1): mine stays full
   * size because it is the hand being played, and five other people's hands
   * laid out like it would push my own cards off the phone.
   */
  box.className = order.length > 4 ? 'shared-seats many' : 'shared-seats';
  box.replaceChildren(...order.map(seatNode));

  renderClock(shared.clock);
  renderMeasures(screen);
  renderActions(screen);
  renderTalk(screen);
}

/* --- Talking to the table ------------------------------------------------ */

/** Every call that changes the table funnels through here, so two cannot overlap. */
async function act(run) {
  if (shared.busy) return;
  shared.busy = true;
  try {
    const answer = await run();
    apply(answer);
  } catch (failure) {
    const note = el('shared-door-note');
    if (note) {
      note.hidden = false;
      note.textContent = String(failure && failure.message ? failure.message : failure);
    }
  } finally {
    shared.busy = false;
    render();
  }
}

function apply(answer) {
  if (!answer) return;
  if (answer.available === false) {
    shared.unavailable = true;
    return;
  }
  if (answer.id) shared.id = answer.id;
  if (answer.seat !== undefined && answer.seat !== null) shared.seat = answer.seat;
  if (answer.screen !== undefined) shared.screen = answer.screen;
  if (answer.clock !== undefined) shared.clock = answer.clock;
}

async function refresh() {
  if (!shared.id || shared.busy) return;
  try {
    apply(await api('/api/shared/view', { id: shared.id }));
  } catch {
    // A poll that fails changes nothing: the table is still what it was.
    return;
  }
  render();
}

function initShared() {
  const id = tableFromLocation();
  shared.id = id || null;
  shared.seat = null;
  shared.screen = null;
  shared.clock = null;
  shared.unavailable = false;

  renderSeatPicker();

  el('shared-make').addEventListener('click', () =>
    void act(async () => {
      const made = await api('/api/shared/create', { seats: shared.seats });
      if (made && made.id && location.hash !== `#shared=${made.id}`) {
        location.hash = `#shared=${made.id}`;
      }
      return made;
    }),
  );

  el('shared-meanwhile').addEventListener('click', () => {
    if (!shared.id) return;
    void api('/api/shared/wait', { id: shared.id }).then(() => {
      location.hash = '#table';
    });
  });

  el('shared-copy').addEventListener('click', () => {
    const link = inviteLink();
    if (navigator.clipboard) void navigator.clipboard.writeText(link);
    el('shared-copy').textContent = T('shared.copied');
  });

  render();

  if (shared.id) void act(() => api('/api/shared/join', { id: shared.id }));

  if (shared.timer) clearInterval(shared.timer);
  shared.timer = setInterval(() => void refresh(), 1500);
}
