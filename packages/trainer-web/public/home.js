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
  if (stats.hands === 0) return 'Nothing played yet. Pick a table.';
  if (stats.hands < 25) return `${stats.hands} hands in. Early days.`;
  if (stats.accuracy >= 0.99) return `${stats.hands.toLocaleString()} hands, and playing them well.`;
  if (stats.accuracy >= 0.95) return `${stats.hands.toLocaleString()} hands. Close to clean.`;
  return `${stats.hands.toLocaleString()} hands. There is work in here.`;
}

function renderStanding(profile) {
  const { rating, ladder } = profile;
  const rated = rating.ratedDecisions > 0;

  el('rating').textContent = rated ? round10(rating.rating) : '—';
  el('rating').className = 'standing-value' + (rating.provisional ? ' provisional' : '');
  el('rating-label').textContent = rated ? `${rating.mode} rating` : 'unrated';
  el('rating-note').textContent = !rated
    ? 'Play a few hands and this settles on a number. It rises when you beat a hard spot and falls when you lose an easy one.'
    : rating.provisional
      ? `Still settling — about ${Math.max(1, 30 - rating.ratedDecisions)} more decisions before it means much.`
      : `Peak ${round10(rating.peak)}. It moves with every decision, both ways.`;

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

function renderHands(view) {
  const box = el('hands');
  box.replaceChildren();
  const hands = view.history ?? [];

  if (hands.length === 0) {
    const note = document.createElement('p');
    note.className = 'empty-note';
    note.textContent =
      'No hands yet this session. Every one you play shows up here, with what it cost.';
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

    const row = document.createElement('div');
    row.className = 'log-row';
    row.innerHTML =
      `<div class="log-tier ${worst ? worst.severity : 'optimal'}"></div>` +
      `<div><div class="log-hand">${cards} <span class="muted">vs</span> ${dealer}</div>` +
      `<div class="log-detail">${
        worst
          ? worst.correct
            ? `${worst.headline} · played it right`
            : `${worst.headline} · you played ${worst.chosen.toLowerCase()}`
          : 'a natural — nothing to decide'
      }</div></div>` +
      `<div class="log-net ${hand.netUnits > 0 ? 'win' : hand.netUnits < 0 ? 'loss' : ''}">${
        hand.netUnits > 0 ? '+' : ''
      }${hand.netUnits}</div>`;

    const steps = document.createElement('div');
    steps.className = 'log-steps';
    steps.hidden = true;
    for (const decision of hand.decisions) {
      for (const line of decision.steps) {
        const p = document.createElement('p');
        p.textContent = line;
        steps.appendChild(p);
      }
    }
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
    note.textContent = 'Nothing to measure yet. Play a hand or two.';
    box.appendChild(note);
    return;
  }

  const excluded =
    s.closeCallsExcluded > 0
      ? `${s.closeCallsExcluded} coin-flip${s.closeCallsExcluded === 1 ? '' : 's'} left out — ` +
        'spots where the best two plays are within a hundredth of a unit. Counting those ' +
        `too, it is ${(s.accuracyIncludingCloseCalls * 100).toFixed(1)}%.`
      : 'Every decision so far had a clear best play.';

  box.append(
    figure(`${(s.accuracy * 100).toFixed(1)}%`, 'of your decisions were the best play', excluded),
    figure(
      s.evLostPer100.toFixed(2),
      'units given away per hundred hands',
      'What your mistakes cost, separate from how the cards happened to fall.',
    ),
    figure(
      `${s.effectiveHouseEdgePercent.toFixed(2)}%`,
      'the edge you are really playing against',
      `The house takes ${profile.ruleSet.edgePercent.toFixed(2)}% from perfect play under these ` +
        'rules. The rest of that is yours to close.',
    ),
    figure(
      `${s.netUnits > 0 ? '+' : ''}${s.netUnits}`,
      'units, this session',
      'How the cards fell. Kept last on purpose.',
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
  el('name').value = profile.player.name;
  el('initial').textContent = profile.player.initial;
  el('greeting').textContent = greet(view.stats);
  el('bj-sub').textContent =
    view.stats.hands === 0 ? 'Play a hand' : `${view.stats.hands.toLocaleString()} hands played`;
  el('footer').textContent =
    `Under these rules perfect play still loses ${profile.ruleSet.edgePercent.toFixed(2)}% of ` +
    'every unit bet. This teaches you to lose less, not to win.';

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
refresh();
