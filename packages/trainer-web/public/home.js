/*
 * Home (§10, screen 1).
 *
 * A greeting and two doors. Everything measured sits behind a tab, because a
 * front page of figures is an instrument panel rather than a welcome — and
 * §3.1 would rather you came here to play than to check a scoreboard.
 *
 * Nothing shown is invented. Where there is no history yet it says so, because
 * a home screen that fabricates your progress is worse than one admitting it
 * has none.
 */

const T = (key, params) => (window.EV ? window.EV.t(key, params) : key);

const el = (id) => document.getElementById(id);

async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? 'request failed');
  return response.json();
}

const round10 = (n) => Math.round(n / 10) * 10;

function greet(stats) {
  const hands = stats.hands.toLocaleString();
  if (stats.hands === 0) return T('home.greet.none');
  if (stats.hands < 25) return T('home.greet.early', { hands });
  if (stats.accuracy >= 0.99) return T('home.greet.clean', { hands });
  if (stats.accuracy >= 0.95) return T('home.greet.close', { hands });
  return T('home.greet.work', { hands });
}

/**
 * The Ultimate rating beside Blackjack's (round 10): its own number, named with
 * its game, rounded to ten like Blackjack's, and never added to it. A player
 * who has not had an Ultimate decision rated is shown as not rated.
 */
function renderUthStanding(rating) {
  const value = el('uth-rating');
  if (!value || !rating) return;
  const rated = rating.ratedDecisions > 0;
  value.textContent = rated ? window.EVFigure.units(round10(rating.rating)) : '—';
  value.className = 'standing-value' + (rated && rating.provisional ? ' provisional' : '');
  el('uth-rating-label').textContent = T(rated ? 'home.uthRating' : 'home.uthUnrated');
  el('uth-rating-note').textContent = !rated
    ? T('home.uthRating.none')
    : rating.provisional
      ? T('home.uthRating.settling', { left: window.EVFigure.units(Math.max(1, 30 - rating.ratedDecisions)) })
      : T('home.uthRating.peak', { peak: window.EVFigure.units(round10(rating.peak)) });
  const swing = el('uth-rating-swing');
  const points = Math.round(rating.sessionDelta || 0);
  swing.hidden = !rated || points === 0;
  if (!swing.hidden) {
    swing.className = 'rating-side ' + (points > 0 ? 'up' : 'down');
    swing.textContent = T('home.sessionSwing', { delta: window.EVFigure.units(points, true) });
  }
}

function renderStanding(profile) {
  const { rating, ladder } = profile;
  const rated = rating.ratedDecisions > 0;

  el('rating').textContent = rated ? window.EVFigure.units(round10(rating.rating)) : '—';
  el('rating').className = 'standing-value' + (rating.provisional ? ' provisional' : '');
  el('rating-label').textContent = rated
    ? T('home.ratingOf', { mode: T('ui.mode.' + rating.mode) })
    : T('home.unrated');
  el('rating-note').textContent = !rated
    ? T('home.rating.none')
    : rating.provisional
      ? T('home.rating.settling', { left: window.EVFigure.units(Math.max(1, 30 - rating.ratedDecisions)) })
      : T('home.rating.peak', { peak: window.EVFigure.units(round10(rating.peak)) });

  // Which way it has gone this session. The rating falls as readily as it
  // rises, which is what makes it worth showing at all.
  const swing = el('rating-swing');
  if (swing) {
    const moved = rated && Math.round(rating.sessionDelta) !== 0;
    swing.hidden = !moved;
    if (moved) {
      const points = Math.round(rating.sessionDelta);
      swing.className = 'rating-side ' + (points > 0 ? 'up' : 'down');
      swing.textContent = T('home.sessionSwing', { delta: window.EVFigure.units(points, true) });
    }
  }

  for (const button of document.querySelectorAll('.mode')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === rating.mode));
  }

  const box = el('ladder');
  box.replaceChildren();
  if (ladder.length === 0) return;

  const head = document.createElement('div');
  head.className = 'ladder-head';
  head.textContent = T('home.ladderHead');
  box.appendChild(head);

  const lo = ladder[0].difficulty;
  const hi = ladder[ladder.length - 1].difficulty;
  for (const row of ladder) {
    const width = hi === lo ? 50 : ((row.difficulty - lo) / (hi - lo)) * 100;
    const div = document.createElement('div');
    div.className = 'ladder-row';
    div.innerHTML =
      // Every word from the catalogue and every figure by the one rule (round 11):
      // this row read English inside Hebrew until the sweep found it.
      `<div><div><bdi>${row.label}</bdi> <span class="muted">· ${row.optimalLabel ?? row.optimal}</span></div>` +
      `<div class="ladder-bar" style="width:${Math.max(6, width)}%"></div>` +
      `<div class="ladder-meta">${T('home.ladderOneIn', { n: window.EVFigure.units(row.oneIn) })}</div></div>` +
      `<div class="ladder-score">${window.EVFigure.units(row.difficulty)}</div>`;
    box.appendChild(div);
  }
}

/**
 * Why a hand carried no decision at all.
 *
 * It used to say "a natural" for every one of them, which is wrong more often
 * than it is right: a *dealer* natural ends the hand on the deal too, and that
 * is the case a player is most likely to come back and check, because from the
 * seat it looked as though their turn had been skipped.
 */
function noDecisionReason(hand) {
  const value = (cards) => {
    let total = 0;
    let aces = 0;
    for (const card of cards) {
      if (card.rank === 'A') {
        aces++;
        total += 11;
      } else total += card.rank === '10' || 'JQK'.includes(card.rank) ? 10 : Number(card.rank);
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces--;
    }
    return total;
  };
  const natural = (cards) => cards.length === 2 && value(cards) === 21;
  if (natural(hand.dealerCards)) {
    return natural(hand.playerHands[0] ?? []) ? 'log.bothNaturals' : 'log.dealerNatural';
  }
  if (natural(hand.playerHands[0] ?? [])) return 'log.playerNatural';
  return 'log.noDecisions';
}

/**
 * The one-line summary of a whole hand.
 *
 * It used to be the headline of the hand's *worst* decision — "5,5 vs 8 →
 * Double" — sitting above three decisions, belonging to one of them and
 * describing none of the others. Idan read it as the app changing its mind:
 * "how come one time one thing was right and then another?" A hand with one
 * decision can still be summarised by that decision; a hand with several has to
 * be summarised as a hand.
 */
function handSummary(hand) {
  const decisions = hand.decisions;
  if (decisions.length === 0) return T(noDecisionReason(hand));
  if (decisions.length === 1) {
    const only = decisions[0];
    return T(only.correct ? 'log.right' : 'log.played', {
      headline: only.headline,
      chosen: only.chosen.toLowerCase(),
    });
  }
  const off = decisions.filter((d) => !d.correct).length;
  return off === 0
    ? T('log.allRight', { n: decisions.length })
    : T('log.someOff', { n: decisions.length, bad: off });
}

const STEP_TITLES = () => [T('ui.readDealer'), T('ui.readHand'), T('ui.combine')];

/**
 * The expanded hand: one block per decision, each under its own header.
 *
 * Three decisions used to expand into nine unlabelled paragraphs, the first of
 * which — the dealer read — was identical three times over, because the dealer's
 * upcard does not change inside a hand. In the live reveal repeating it is
 * right: each decision is walked on its own. In the log it is noise, and it
 * pushed the part that differs off the bottom of the block.
 *
 * So the dealer read is lifted out and shown once, and repeated only if it
 * genuinely changes — which it does when an insurance decision and a hand
 * decision sit in the same hand, since those two do not read the same dealer.
 */
function decisionBlocks(hand) {
  const box = document.createElement('div');
  box.className = 'log-steps';
  box.hidden = true;

  const titles = STEP_TITLES();
  let dealerShown = null;

  for (const decision of hand.decisions) {
    const block = document.createElement('div');
    block.className = 'log-decision';

    const head = document.createElement('div');
    head.className = 'log-decision-head';
    const tier = document.createElement('span');
    tier.className = `log-dot ${decision.severity}`;
    const text = document.createElement('span');
    text.textContent = T(decision.correct ? 'log.right' : 'log.played', {
      headline: decision.headline,
      chosen: decision.chosen.toLowerCase(),
    });
    head.append(tier, text);
    block.appendChild(head);

    decision.steps.forEach((line, i) => {
      // Step one is the dealer read. Once per hand, unless it changed.
      if (i === 0) {
        if (line === dealerShown) return;
        dealerShown = line;
      }
      const step = document.createElement('p');
      const title = document.createElement('span');
      title.className = 'log-step-title';
      title.textContent = titles[i] ?? '';
      step.append(title, document.createTextNode(line));
      block.appendChild(step);
    });

    box.appendChild(block);
  }
  return box;
}

/** Rows a table's track can open, by game and position. Rebuilt with the list. */
let openable = new Map();

function handsHeading(text) {
  const head = document.createElement('h3');
  head.className = 'hands-game';
  head.textContent = text;
  return head;
}

function renderHands(view, uthView) {
  const box = el('hands');
  box.replaceChildren();
  openable = new Map();
  const hands = view.history ?? [];
  const uthHands = (uthView && uthView.history) || [];

  if (hands.length === 0 && uthHands.length === 0) {
    const note = document.createElement('p');
    note.className = 'empty-note';
    note.textContent = T('home.noHands');
    box.appendChild(note);
    return;
  }

  // Each game under its own name. Ultimate's hands moved here from its table
  // screen in round 6, when the decision track took their place there.
  if (hands.length > 0) box.appendChild(handsHeading(T('ui.blackjack')));
  hands.forEach((hand, index) => {
    const worst = hand.decisions.reduce(
      (acc, d) => (acc === null || d.evCost > acc.evCost ? d : acc),
      null,
    );
    const cards = hand.playerHands.map((h) => h.map((c) => c.rank + c.suit).join(' ')).join('  |  ');
    const dealer = hand.dealerCards.map((c) => c.rank + c.suit).join(' ');
    const detail = handSummary(hand);

    const row = document.createElement('div');
    row.className = 'log-row';
    row.innerHTML =
      `<div class="log-tier ${worst ? worst.severity : 'optimal'}"></div>` +
      // Each run of cards is its own left-to-right island. In Hebrew a suit is a
      // neutral character, and without this "7♠ 2♦" drew as "♠7 ♦2":
      // 26 of 27 cards measured suit-first on a 390px phone.
      `<div><div class="log-hand"><bdi dir="ltr">${cards}</bdi> <span class="muted">${T('log.vs')}</span> <bdi dir="ltr">${dealer}</bdi></div>` +
      `<div class="log-detail">${detail}</div></div>` +
      // The figure is kept in one piece too: in Hebrew "+1.5" drew as "1.5+" and
      // "−1" as "1-", seen on a phone once the track started opening this list.
      // In chips at the bet the hand was dealt at, like the track row that opens
      // it (round 6b); hands saved before chips were all played at 1.
      // Written by the one figure rule (figure.js, round 8), so it reads exactly
      // as the track row that opens it.
      `<div class="log-net ${hand.netUnits > 0 ? 'win' : hand.netUnits < 0 ? 'loss' : ''}">${
        window.EVFigure.units(hand.netUnits * (hand.bet ?? 1), true)
      }</div>`;

    const steps = decisionBlocks(hand);
    row.addEventListener('click', () => {
      if (steps.hidden && window.EVCount) window.EVCount.bump('hand');
      steps.hidden = !steps.hidden;
    });
    openable.set(`bj:${index}`, { row, steps, id: hand.id });
    box.append(row, steps);
  });

  if (uthHands.length > 0) box.appendChild(handsHeading(T('ui.ultimate')));
  uthHands.forEach((hand, index) => {
    const [row, steps] = uthHandRow(hand);
    openable.set(`uth:${index}`, { row, steps, id: hand.id });
    box.append(row, steps);
  });
}

/** A figure kept in one piece inside right-to-left text, as on the tables. */
const isolate = (text) =>
  document.documentElement.getAttribute('dir') === 'rtl' ? `\u2066${text}\u2069` : text;

/** Bold the parts the copy marks with **, and nothing else — no HTML from data. */
function boldParts(target, text) {
  target.replaceChildren();
  text.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      const b = document.createElement('b');
      b.textContent = part.slice(2, -2);
      target.appendChild(b);
    } else if (part) {
      target.appendChild(document.createTextNode(part));
    }
  });
}

/**
 * One finished Ultimate hand, in the Blackjack log's round 3 structure.
 *
 * The row summarises the hand, not one decision in it. Opened, each decision
 * has its own header and its sentences, and the result comes last, in the quiet
 * style the card uses for it. Everything arrives worded by the session in the
 * current language; the page only lays it out. Moved here from the UTH table
 * screen in round 6, unchanged.
 */
function uthHandRow(hand) {
  const row = document.createElement('div');
  row.className = 'log-row';
  const tier = document.createElement('div');
  tier.className = `log-tier ${hand.severity}`;
  const middle = document.createElement('div');
  const cards = document.createElement('div');
  cards.className = 'log-hand';
  cards.textContent = hand.cards.dealer
    ? `${hand.cards.hole} ${T('log.vs')} ${hand.cards.dealer} · ${hand.cards.board}`
    : `${hand.cards.hole} · ${hand.cards.board}`;
  const detail = document.createElement('div');
  detail.className = 'log-detail';
  detail.textContent = hand.summary;
  middle.append(cards, detail);
  const net = document.createElement('div');
  net.className = 'log-net ' + (hand.net > 0 ? 'win' : hand.net < 0 ? 'loss' : '');
  net.textContent = window.EVFigure.units(hand.net, true);
  row.append(tier, middle, net);

  const steps = document.createElement('div');
  steps.className = 'log-steps';
  steps.hidden = true;
  for (const decision of hand.decisions) {
    const block = document.createElement('div');
    block.className = 'log-decision';
    const head = document.createElement('div');
    head.className = 'log-decision-head';
    const dot = document.createElement('span');
    dot.className = `log-dot ${decision.severity}`;
    const text = document.createElement('span');
    text.textContent = decision.header;
    head.append(dot, text);
    const sentence = document.createElement('p');
    boldParts(sentence, decision.sentence);
    block.append(head, sentence);
    for (const line of decision.notes || []) {
      const note = document.createElement('p');
      boldParts(note, line);
      block.appendChild(note);
    }
    steps.appendChild(block);
  }
  const result = document.createElement('div');
  result.className = 'uth-result';
  for (const line of [...(hand.showdown || []), ...hand.lines, hand.netLine]) {
    const p = document.createElement('p');
    p.textContent = line;
    result.appendChild(p);
  }
  steps.appendChild(result);

  row.addEventListener('click', () => {
    if (steps.hidden && window.EVCount) window.EVCount.bump('hand');
    steps.hidden = !steps.hidden;
  });
  return [row, steps];
}

/**
 * Open a hand a table's track asked for: show its decisions, bring it into view.
 *
 * Found by game and position, then checked against the id — ids start again
 * when a page reloads, so a restored history can hold two hands with one id.
 */
function openHand(wanted) {
  let found = openable.get(`${wanted.game}:${wanted.index}`);
  if (!found || found.id !== wanted.id) {
    found = [...openable.entries()].find(
      ([key, entry]) => key.startsWith(`${wanted.game}:`) && entry.id === wanted.id,
    )?.[1];
  }
  if (!found) return;
  if (window.EVCount) window.EVCount.bump('hand');
  found.steps.hidden = false;
  if (found.row.classList) found.row.classList.add('opened');
  if (typeof found.row.scrollIntoView === 'function') found.row.scrollIntoView({ block: 'center' });
}

/** A figure, written out rather than tabulated — one number, one sentence. */
function figure(value, label, note, quiet) {
  const div = document.createElement('div');
  div.className = 'figure';
  div.innerHTML =
    `<div class="figure-value${quiet ? ' quiet' : ''}">${value}</div>` +
    `<div class="figure-label">${label}</div>` +
    (note ? `<div class="figure-note">${note}</div>` : '');
  return div;
}

/**
 * The Trips row (round 11): what was put on it, what it costs over time, and
 * what it actually did. A cost stated in its own place, under its own heading,
 * never mixed into the figures above that measure the play. Shown once anything
 * has been put on Trips, whichever game the rest of the tab is about.
 */
function tripsFigures(uthView) {
  const trips = uthView && uthView.tripsStats;
  if (!trips || trips.hands === 0) return [];
  const head = document.createElement('h3');
  head.className = 'hands-game';
  head.textContent = T('home.tripsHead');
  return [
    head,
    figure(
      window.EVFigure.units(trips.wagered),
      T('home.fig.tripsPut'),
      trips.hands === 1
        ? T('home.fig.tripsPutNoteOne')
        : T('home.fig.tripsPutNote', { hands: window.EVFigure.units(trips.hands) }),
    ),
    figure(
      window.EVFigure.units(-trips.expectedCost, true),
      T('home.fig.tripsCost'),
      T('home.fig.tripsCostNote', { edge: trips.edge }),
    ),
    figure(window.EVFigure.units(trips.net, true), T('home.fig.tripsResult'), T('home.fig.tripsResultNote'), true),
  ];
}

/**
 * The records line (round 20).
 *
 * The chip Idan asked for, in the one currency that cannot lie: things he did.
 * The best run he has ever had, how much of the chart he has mastered, and how
 * many decisions he has been graded on in his life. No chips, no units, no
 * stack — §16 — and nothing here is a score anybody is ranked on.
 */
function renderRecords(view) {
  const box = el('records');
  const line = el('records-line');
  if (!box || !line) return;
  const records = view.records;
  const parts = [];
  if (records) {
    if (records.streak > 0) parts.push(T('records.streak', { n: window.EVFigure.units(records.streak) }));
    if (records.mastered > 0) {
      parts.push(T('records.mastered', {
        n: window.EVFigure.units(records.mastered),
        total: window.EVFigure.units(records.cells),
      }));
    }
    if (records.decisions > 0) parts.push(T('records.decisions', { n: window.EVFigure.units(records.decisions) }));
  }
  // Nothing to show is not a line saying there is nothing to show.
  box.hidden = parts.length === 0;
  line.textContent = parts.join(' · ');
}

/**
 * The sentence that ends a sitting.
 *
 * It appears here rather than on the felt because a sitting ends by leaving the
 * table, and because nothing that sums up a session belongs over the top of a
 * live hand. It names the one leak, which is the half a player can act on.
 */
function renderSitting(view) {
  const box = el('sitting');
  if (!box) return;
  const sitting = view.sitting;
  if (!sitting) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.hidden = false;
  const said = sitting.mistakes === 0
    ? T('sitting.clean', { decisions: window.EVFigure.units(sitting.decisions) })
    : T('sitting.line', {
        decisions: window.EVFigure.units(sitting.decisions),
        mistakes: window.EVFigure.units(sitting.mistakes),
      });
  const leak = !sitting.leak
    ? ''
    : sitting.leakCount === sitting.mistakes
      ? ' ' + T('sitting.allOne', { spot: sitting.leakSpot })
      : ' ' + T('sitting.leak', { spot: sitting.leakSpot, n: window.EVFigure.units(sitting.leakCount) });
  boldParts(box, said + leak);
}

function renderStats(view, profile, uthView) {
  const s = view.stats;
  const box = el('stats');
  box.replaceChildren();

  if (s.decisions === 0) {
    const note = document.createElement('p');
    note.className = 'empty-note';
    note.textContent = T('home.noStats');
    box.appendChild(note);
    box.append(...tripsFigures(uthView));
    return;
  }

  const excluded =
    s.closeCallsExcluded > 0
      ? T(s.closeCallsExcluded === 1 ? 'home.excludedOne' : 'home.excluded', {
          n: s.closeCallsExcluded,
          pct: (s.accuracyIncludingCloseCalls * 100).toFixed(1),
        })
      : T('home.noExcluded');

  box.append(
    figure(`${(s.accuracy * 100).toFixed(1)}%`, T('home.fig.accuracy'), excluded),
    figure(s.evLostPer100.toFixed(2), T('home.fig.evLost'), T('home.fig.evLostNote')),
    figure(
      `${s.effectiveHouseEdgePercent.toFixed(2)}%`,
      T('home.fig.edge'),
      T('home.fig.edgeNote', { pct: profile.ruleSet.edgePercent.toFixed(2) }),
    ),
    figure(
      window.EVFigure.units(s.netUnits, true),
      T('home.fig.units'),
      T('home.fig.unitsNote'),
      true,
    ),
  );
  box.append(...tripsFigures(uthView));
}

function selectTab(name) {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  }
  for (const panel of ['standing', 'hands', 'stats']) {
    el(`panel-${panel}`).hidden = panel !== name;
  }
  try {
    localStorage.setItem('ev:tab', name);
  } catch {
    // storage disabled; the tab simply does not persist
  }
}

async function refresh() {
  const [profile, view, uthView] = await Promise.all([
    api('/api/profile'),
    api('/api/state'),
    api('/api/uth/state'),
  ]);
  // The placeholder is the client's business, because it has to be in the
  // language on screen; the server only knows a name once one is typed.
  const name = profile.player.name || T('ui.defaultName');
  el('name').value = name;
  el('initial').textContent = name.charAt(0).toUpperCase();
  el('greeting').textContent = greet(view.stats);
  el('bj-sub').textContent =
    view.stats.hands === 0
      ? T('ui.playAHand')
      : T('home.handsPlayed', { hands: view.stats.hands.toLocaleString() });
  el('footer').textContent = T('home.footer', {
    pct: profile.ruleSet.edgePercent.toFixed(2),
  });

  renderStanding(profile);
  renderRecords(view);
  renderSitting(view);
  renderUthStanding(uthView.rating);
  renderHands(view, uthView);
  renderStats(view, profile, uthView);
  if (pendingOpen) {
    openHand(pendingOpen);
    pendingOpen = null;
  }
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab));
}
for (const button of document.querySelectorAll('.mode')) {
  button.addEventListener('click', async () => {
    await api('/api/player', { mode: button.dataset.mode });
    await refresh();
  });
}
el('name').addEventListener('change', async (event) => {
  await api('/api/player', { name: event.target.value });
  await refresh();
});

/*
 * A hand asked for from a table's track opens the Hands tab, whatever tab was
 * open last. Choosing it here also stores it as the tab, which is what stops the
 * built page's shell from reopening a social tab over it.
 */
let pendingOpen = window.EVTrack ? window.EVTrack.takeOpened() : null;
try {
  selectTab(pendingOpen ? 'hands' : localStorage.getItem('ev:tab') ?? 'standing');
} catch {
  selectTab(pendingOpen ? 'hands' : 'standing');
}
/**
 * The line that says a name was just claimed (round 33).
 *
 * Somebody who types a name that had no code, and a code of his own, takes
 * over that record and everything in it. That should never happen without his
 * knowing: one line, once, on the first home screen after the door.
 */
function renderClaimed() {
  const box = el('claimed');
  if (!box) return;
  let claimed = null;
  try {
    claimed = JSON.parse(localStorage.getItem('ev:claimed') || 'null');
    // Emptied rather than removed: once said, it is not said again.
    localStorage.setItem('ev:claimed', '');
  } catch {
    claimed = null;
  }
  if (!claimed || !claimed.name) {
    box.hidden = true;
    return;
  }
  box.textContent = T(claimed.decisions > 0 ? 'welcome.claimed' : 'welcome.claimedNew', {
    name: claimed.name,
    n: window.EVFigure ? window.EVFigure.units(claimed.decisions) : String(claimed.decisions),
  });
  box.hidden = false;
}

/**
 * The last shared table's evening, summed up once on the way home from it
 * (round 34) — with the button that makes it a picture to send.
 */
function renderLastEvening() {
  const box = el('home-evening');
  if (!box || !window.EVEvening) return;
  const kept = window.EVEvening.takeKept();
  box.hidden = !kept;
  box.replaceChildren(...(kept ? [window.EVEvening.card(kept)] : []));
}

// After the locale handshake, so the first render is already in the right language.
Promise.resolve(window.EV && window.EV.ready).then(() => {
  renderClaimed();
  renderLastEvening();
  return refresh();
});
