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

function renderStanding(profile) {
  const { rating, ladder } = profile;
  const rated = rating.ratedDecisions > 0;

  el('rating').textContent = rated ? round10(rating.rating) : '—';
  el('rating').className = 'standing-value' + (rating.provisional ? ' provisional' : '');
  el('rating-label').textContent = rated
    ? T('home.ratingOf', { mode: T('ui.mode.' + rating.mode) })
    : T('home.unrated');
  el('rating-note').textContent = !rated
    ? T('home.rating.none')
    : rating.provisional
      ? T('home.rating.settling', { left: Math.max(1, 30 - rating.ratedDecisions) })
      : T('home.rating.peak', { peak: round10(rating.peak) });

  // Which way it has gone this session. The rating falls as readily as it
  // rises, which is what makes it worth showing at all.
  const swing = el('rating-swing');
  if (swing) {
    const moved = rated && Math.round(rating.sessionDelta) !== 0;
    swing.hidden = !moved;
    if (moved) {
      const points = Math.round(rating.sessionDelta);
      swing.className = 'rating-side ' + (points > 0 ? 'up' : 'down');
      swing.textContent = T('home.sessionSwing', {
        delta: points > 0 ? `+${points}` : `−${Math.abs(points)}`,
      });
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
  head.textContent = 'what this mode counts as hard';
  box.appendChild(head);

  const lo = ladder[0].difficulty;
  const hi = ladder[ladder.length - 1].difficulty;
  for (const row of ladder) {
    const width = hi === lo ? 50 : ((row.difficulty - lo) / (hi - lo)) * 100;
    const div = document.createElement('div');
    div.className = 'ladder-row';
    div.innerHTML =
      `<div><div>${row.label} <span class="muted">· ${row.optimal}</span></div>` +
      `<div class="ladder-bar" style="width:${Math.max(6, width)}%"></div>` +
      `<div class="ladder-meta">one in ${row.oneIn.toLocaleString()} hands</div></div>` +
      `<div class="ladder-score">${row.difficulty}</div>`;
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

function renderHands(view) {
  const box = el('hands');
  box.replaceChildren();
  const hands = view.history ?? [];

  if (hands.length === 0) {
    const note = document.createElement('p');
    note.className = 'empty-note';
    note.textContent = T('home.noHands');
    box.appendChild(note);
    return;
  }

  for (const hand of hands) {
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
      `<div class="log-net ${hand.netUnits > 0 ? 'win' : hand.netUnits < 0 ? 'loss' : ''}">${
        hand.netUnits > 0 ? '+' : ''
      }${hand.netUnits}</div>`;

    const steps = decisionBlocks(hand);
    row.addEventListener('click', () => {
      steps.hidden = !steps.hidden;
    });
    box.append(row, steps);
  }
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

function renderStats(view, profile) {
  const s = view.stats;
  const box = el('stats');
  box.replaceChildren();

  if (s.decisions === 0) {
    const note = document.createElement('p');
    note.className = 'empty-note';
    note.textContent = T('home.noStats');
    box.appendChild(note);
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
      `${s.netUnits > 0 ? '+' : ''}${s.netUnits}`,
      T('home.fig.units'),
      T('home.fig.unitsNote'),
      true,
    ),
  );
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
  const [profile, view] = await Promise.all([api('/api/profile'), api('/api/state')]);
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
  renderHands(view);
  renderStats(view, profile);
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

try {
  selectTab(localStorage.getItem('ev:tab') ?? 'standing');
} catch {
  selectTab('standing');
}
// After the locale handshake, so the first render is already in the right language.
Promise.resolve(window.EV && window.EV.ready).then(refresh);
