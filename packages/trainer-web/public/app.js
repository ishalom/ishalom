/*
 * Client for the EV Trainer.
 *
 * Plain JavaScript, no build step: the engines run on the server, where Node
 * strips their types, and this only draws what it is told.
 *
 * Two rules from the spec shape the whole flow:
 *
 *   §3.1  The grade is shown on the decision, before and independently of the
 *         result. So the feedback card appears the moment an action is taken,
 *         and the hand's outcome is drawn afterwards and kept visually quiet.
 *   §10.1 Actions live along the bottom edge, and Deal needs no confirmation.
 */

const el = (id) => document.getElementById(id);

const state = { view: null, busy: false };

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

/** Every call that changes the table funnels through here. */
async function send(path, body) {
  if (state.busy) return;
  state.busy = true;
  try {
    state.view = await api(path, body ?? {});
    render();
  } catch (error) {
    console.error(error);
    alert(error.message);
  } finally {
    state.busy = false;
  }
}

// --- Rendering -------------------------------------------------------------

function cardNode(card) {
  const node = document.createElement('div');
  node.className = 'card' + (card.red ? ' red' : '');
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', card.label);
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
  node.className = 'card back';
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', 'face-down card');
  return node;
}

function renderDealer(view) {
  const box = el('dealer-cards');
  box.replaceChildren(...view.dealer.cards.map(cardNode));
  if (view.dealer.hidden) box.appendChild(faceDownNode());
  el('dealer-total').textContent =
    view.dealer.total === null
      ? ''
      : `· ${view.dealer.total}${view.dealer.total > 21 ? ' bust' : ''}`;
}

function renderHands(view) {
  const box = el('player-hands');
  box.replaceChildren();

  for (const hand of view.hands) {
    const wrap = document.createElement('div');
    wrap.className = 'hand' + (hand.active ? ' active' : '');

    const cards = document.createElement('div');
    cards.className = 'cards';
    cards.replaceChildren(...hand.cards.map(cardNode));
    wrap.appendChild(cards);

    const meta = document.createElement('div');
    meta.className = 'hand-meta';
    const bits = [`${hand.total}${hand.total > 21 ? ' bust' : ''}`];
    if (hand.doubled) bits.push('doubled');
    if (hand.surrendered) bits.push('surrendered');
    if (hand.bet !== 1) bits.push(`${hand.bet} units`);
    meta.textContent = bits.join(' · ');

    // §3.1: the result is shown, but afterwards and de-emphasised.
    if (hand.net !== null && hand.net !== undefined) {
      const net = document.createElement('span');
      net.className = 'hand-net ' + (hand.net > 0 ? 'win' : hand.net < 0 ? 'loss' : '');
      net.textContent = `  ${hand.net > 0 ? '+' : ''}${hand.net}`;
      meta.appendChild(net);
    }
    wrap.appendChild(meta);
    box.appendChild(wrap);
  }

  el('empty-state').hidden = view.hands.length > 0;
}

const SEVERITY_WORD = {
  optimal: 'Correct',
  negligible: 'Negligible',
  minor: 'Minor error',
  significant: 'Significant error',
  blunder: 'Blunder',
};

function renderFeedback(view) {
  const box = el('feedback');
  const feedback = view.feedback;
  if (!feedback) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.className = `feedback ${feedback.severity}`;
  box.replaceChildren();

  const verdict = document.createElement('p');
  verdict.className = 'verdict';
  verdict.textContent = feedback.correct
    ? `Correct — ${feedback.optimalLabel}`
    : `${SEVERITY_WORD[feedback.severity]} — cost ${feedback.evCost.toFixed(3)} units`;
  box.appendChild(verdict);

  if (!feedback.correct) {
    const did = document.createElement('p');
    did.className = 'did';
    did.textContent =
      `You chose ${feedback.chosenLabel.toLowerCase()}. ` +
      `Best is ${feedback.optimalLabel.toLowerCase()}.`;
    box.appendChild(did);
  }

  // §7.1 item 3: the EV of every legal action, sorted, in units.
  const evs = document.createElement('div');
  evs.className = 'evs';
  feedback.ranked.forEach((entry, index) => {
    const chip = document.createElement('span');
    chip.className =
      'ev' + (index === 0 ? ' best' : '') + (entry.action === feedback.chosen ? ' chosen' : '');
    const sign = entry.ev >= 0 ? '+' : '';
    chip.textContent = `${entry.label}: ${sign}${entry.ev.toFixed(3)}`;
    evs.appendChild(chip);
  });
  box.appendChild(evs);

  const reason = document.createElement('p');
  reason.className = 'reason';
  reason.textContent = feedback.reason;
  box.appendChild(reason);

  // §7.1 item 6: flag answers that flip under another common rule set.
  if (feedback.sensitivity.length > 0) {
    const note = document.createElement('p');
    note.className = 'sensitivity';
    note.textContent =
      'Rule-sensitive: ' +
      feedback.sensitivity.map((s) => `${s.action} ${s.label}`).join('; ') +
      '.';
    box.appendChild(note);
  }
}

const LABELS = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  surrender: 'Surrender',
};

function renderActions(view) {
  const box = el('actions');
  box.replaceChildren();

  const add = (label, handler, primary) => {
    const button = document.createElement('button');
    button.className = 'action' + (primary ? ' primary' : '');
    button.textContent = label;
    button.addEventListener('click', handler);
    box.appendChild(button);
  };

  if (view.phase === 'insurance') {
    add('Take insurance', () => send('/api/insurance', { take: true }));
    add('Decline', () => send('/api/insurance', { take: false }), true);
    return;
  }
  if (view.phase === 'player') {
    for (const action of view.legalActions) {
      add(LABELS[action] ?? action, () => send('/api/act', { action }));
    }
    return;
  }
  add('Deal', () => send('/api/deal'), true);
}

function renderStats(view) {
  const stats = view.stats;
  el('stat-accuracy').textContent =
    stats.decisions === 0 ? '—' : `${(stats.accuracy * 100).toFixed(1)}%`;
  el('stat-evlost').textContent = stats.hands === 0 ? '—' : stats.evLostPer100.toFixed(2);
  el('stat-edge').textContent =
    stats.hands === 0
      ? `${view.ruleSet.edgePercent.toFixed(2)}%`
      : `${stats.effectiveHouseEdgePercent.toFixed(2)}%`;
  el('stat-units').textContent = `${stats.netUnits > 0 ? '+' : ''}${stats.netUnits}`;
}

function render() {
  const view = state.view;
  if (!view) return;

  el('rules-name').textContent = view.ruleSet.name;
  el('rules-badge').textContent = view.ruleSet.badge;
  // §16: the residual house edge is stated in plain numbers, not buried.
  el('edge-note').textContent =
    `Perfect play still loses ${view.ruleSet.edgePercent.toFixed(2)}% of every unit bet.`;

  renderDealer(view);
  renderHands(view);
  renderFeedback(view);
  renderActions(view);
  renderStats(view);
}

// --- Settings and the reference chart --------------------------------------

async function openSettings() {
  const presets = await api('/api/presets');
  const list = el('preset-list');
  list.replaceChildren();
  for (const preset of presets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset' + (preset.id === state.view.ruleSet.id ? ' current' : '');
    const name = document.createElement('strong');
    name.textContent = preset.name;
    button.appendChild(name);
    if (preset.note) {
      const note = document.createElement('span');
      note.className = 'preset-note';
      note.textContent = preset.note;
      button.appendChild(note);
    }
    button.addEventListener('click', async () => {
      el('settings').close();
      await send('/api/session', { presetId: preset.id });
    });
    list.appendChild(button);
  }
  el('settings').showModal();
}

const HARD = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const SOFT = [13, 14, 15, 16, 17, 18, 19, 20];
const PAIRS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T'];
const UPCARDS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
const LETTER = { hit: 'H', stand: 'S', double: 'D', split: 'P', surrender: 'R' };

function chartTable(title, rows, cells) {
  const table = document.createElement('table');
  table.className = 'chart';

  const head = document.createElement('tr');
  const corner = document.createElement('th');
  corner.textContent = title;
  head.appendChild(corner);
  for (const up of UPCARDS) {
    const th = document.createElement('th');
    th.textContent = up;
    head.appendChild(th);
  }
  table.appendChild(head);

  for (const row of rows) {
    const tr = document.createElement('tr');
    const label = document.createElement('th');
    label.textContent = row.label;
    tr.appendChild(label);
    for (const up of UPCARDS) {
      const td = document.createElement('td');
      const letter = LETTER[cells[row.key(up)]] ?? '';
      td.className = letter;
      td.textContent = letter;
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  return table;
}

async function openReference() {
  const { cells } = await api('/api/chart');
  const grid = document.createElement('div');
  grid.className = 'chart-grid';
  grid.append(
    chartTable('Hard', HARD.map((t) => ({ label: String(t), key: (up) => `bj:hard${t}:vs${up}` })), cells),
    chartTable('Soft', SOFT.map((t) => ({ label: `A${t - 11}`, key: (up) => `bj:soft${t}:vs${up}` })), cells),
    chartTable('Pairs', PAIRS.map((p) => ({ label: `${p},${p}`, key: (up) => `bj:pair${p}:vs${up}` })), cells),
  );
  el('chart-container').replaceChildren(grid);
  el('reference').showModal();
}

// --- Keyboard ---------------------------------------------------------------
// Speed mode (§8) times decisions at five seconds, which rules out hunting for
// a button. The same shortcuts work everywhere.

document.addEventListener('keydown', (event) => {
  if (document.querySelector('dialog[open]')) return;
  const view = state.view;
  if (!view) return;
  const key = event.key.toLowerCase();

  if (view.phase === 'insurance') {
    if (key === 'y') send('/api/insurance', { take: true });
    if (key === 'n' || key === ' ') send('/api/insurance', { take: false });
    return;
  }
  if (view.phase === 'player') {
    const action = { h: 'hit', s: 'stand', d: 'double', p: 'split', r: 'surrender' }[key];
    if (action && view.legalActions.includes(action)) send('/api/act', { action });
    return;
  }
  if (key === ' ' || key === 'enter') {
    event.preventDefault();
    send('/api/deal');
  }
});

el('open-settings').addEventListener('click', openSettings);
el('open-reference').addEventListener('click', openReference);

send('/api/state');
