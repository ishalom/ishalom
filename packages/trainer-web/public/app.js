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

const state = { view: null, busy: false, reveal: null };

/**
 * Step through the reasoning, or show it all at once. Persisted, because being
 * asked to click three times on every hand of a drilling session is a tax.
 */
function showAllPreferred() {
  try {
    return localStorage.getItem('ev:showAll') === '1';
  } catch {
    return false;
  }
}
function setShowAllPreferred(value) {
  try {
    localStorage.setItem('ev:showAll', value ? '1' : '0');
  } catch {
    // A browser with storage disabled just loses the preference; not fatal.
  }
}

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
    const feedback = state.view.feedback;
    state.reveal = feedback
      ? { steps: feedback.steps, shown: showAllPreferred() ? 3 : 1 }
      : null;
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
  // While the reveal is running the outcome stays under wraps: §3.1 wants the
  // grade independent of the result, and a result shown two clicks before the
  // grade would break that far more thoroughly than an early EV chip.
  const withhold = !revealComplete();
  const cards = withhold ? view.dealer.cards.slice(0, 1) : view.dealer.cards;
  box.replaceChildren(...cards.map(cardNode));
  if (view.dealer.hidden || withhold) box.appendChild(faceDownNode());
  el('dealer-total').textContent =
    view.dealer.total === null || withhold
      ? ''
      : `· ${view.dealer.total}${view.dealer.total > 21 ? ' bust' : ''}`;

  // §3.1 again: a bare total after the player busts reads as "you would have won
  // by standing", which is the opposite of true.
  let note = document.getElementById('dealer-note');
  if (view.dealer.didNotDraw && !withhold) {
    if (!note) {
      note = document.createElement('div');
      note.id = 'dealer-note';
      note.className = 'dealer-note';
      box.parentElement.appendChild(note);
    }
    note.textContent = 'Did not draw — you busted first. A dealer must keep drawing to 17.';
  } else if (note) {
    note.remove();
  }
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

    // §3.1: the result is shown, but afterwards and de-emphasised — and never
    // before the grade it might otherwise colour.
    if (hand.net !== null && hand.net !== undefined && revealComplete()) {
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

/**
 * The guided reveal (§3.4, §7.1).
 *
 * Steps one and two show only the readings; the verdict, its cost and the EV
 * chips all arrive together at step three. Hiding the chips alone would have
 * been theatre — the verdict names the best action, so the answer was already
 * out. Hiding both means the player genuinely reasons before seeing the answer.
 *
 * The hand's *outcome* is gated on the same switch. §3.1 requires the grade to
 * be independent of the result, and a result visible two clicks before the grade
 * would break that far more thoroughly than showing the chips early.
 */
function revealComplete() {
  return !state.reveal || state.reveal.shown >= 3;
}

const STEP_TITLES = ['Read the dealer', 'Read your hand', 'Put them together'];

function renderFeedback(view) {
  const box = el('feedback');
  const feedback = view.feedback;
  if (!feedback || !state.reveal) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const done = revealComplete();
  box.className = done ? `feedback ${feedback.severity}` : 'feedback';
  box.replaceChildren();

  // The evaluated hand, always. After a split the board no longer shows what was
  // actually decided, so without this the steps have nothing to refer to.
  const anchor = document.createElement('p');
  anchor.className = 'anchor';
  anchor.innerHTML = done
    ? `<b>${feedback.headline}</b>`
    : `<b>${feedback.headline.split(' → ')[0]}</b> — thinking it through`;
  box.appendChild(anchor);

  if (done) {
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
        `Best is ${feedback.optimalLabel.toLowerCase()}.` +
        (feedback.closeCall ? ' The top two are within a hundredth of a unit.' : '');
      box.appendChild(did);
    }
  }

  const reveal = document.createElement('div');
  reveal.className = 'reveal';
  for (let i = 0; i < state.reveal.shown && i < 3; i++) {
    const step = document.createElement('div');
    step.className = 'step' + (i === state.reveal.shown - 1 ? ' latest' : '');
    const n = document.createElement('div');
    n.className = 'step-n';
    n.textContent = String(i + 1);
    const body = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'step-head';
    head.textContent = STEP_TITLES[i];
    const text = document.createElement('p');
    text.textContent = state.reveal.steps[i];
    body.append(head, text);
    step.append(n, body);
    reveal.appendChild(step);
  }
  box.appendChild(reveal);

  if (!done) {
    const controls = document.createElement('div');
    controls.className = 'reveal-controls';
    const next = document.createElement('button');
    next.className = 'reveal-next';
    next.innerHTML = `Next<span class="key">SPACE</span>`;
    next.addEventListener('click', advanceReveal);
    const skip = document.createElement('button');
    skip.className = 'reveal-skip';
    skip.textContent = 'Show all';
    skip.addEventListener('click', () => {
      setShowAllPreferred(true);
      state.reveal.shown = 3;
      render();
    });
    controls.append(next, skip);
    box.appendChild(controls);
    return;
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

function advanceReveal() {
  if (!state.reveal || revealComplete()) return false;
  state.reveal.shown++;
  if (state.reveal.shown >= 3) setShowAllPreferred(false);
  render();
  return true;
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

  // The definition is surfaced rather than left mysterious: a metric nobody can
  // explain is a metric nobody should trust.
  const excluded = stats.closeCallsExcluded;
  el('accuracy-tip').textContent =
    stats.decisions === 0
      ? 'Share of decisions played correctly, once coin-flips are set aside.'
      : `${stats.correct - 0} of ${stats.decisions} decisions right. ` +
        (excluded > 0
          ? `${excluded} close call${excluded === 1 ? '' : 's'} excluded — spots where the ` +
            `best two plays differ by under 0.01 units, which is inside the noise. ` +
            `Counting everything: ${(stats.accuracyIncludingCloseCalls * 100).toFixed(1)}%.`
          : 'No close calls yet.');
  el('stat-evlost').textContent = stats.hands === 0 ? '—' : stats.evLostPer100.toFixed(2);
  el('stat-edge').textContent =
    stats.hands === 0
      ? `${view.ruleSet.edgePercent.toFixed(2)}%`
      : `${stats.effectiveHouseEdgePercent.toFixed(2)}%`;
  el('stat-units').textContent = `${stats.netUnits > 0 ? '+' : ''}${stats.netUnits}`;
}

/**
 * The session's finished hands.
 *
 * Tapping one reopens its reasoning — the same three steps the feedback card
 * showed, which is what makes this a review surface rather than a receipt.
 */
function renderLog(view) {
  const panel = el('log-panel');
  const log = el('log');
  const hands = view.history ?? [];
  panel.hidden = hands.length === 0;
  log.replaceChildren();

  for (const hand of hands) {
    // A hand's grade is its worst decision; a natural has none at all.
    const worst = hand.decisions.reduce(
      (acc, d) => (acc === null || d.evCost > acc.evCost ? d : acc),
      null,
    );
    const row = document.createElement('div');
    row.className = 'log-row';

    const tier = document.createElement('div');
    tier.className = `log-tier ${worst ? worst.severity : 'optimal'}`;

    const body = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'log-hand';
    title.textContent =
      hand.playerHands.map((h) => h.map((c) => c.rank + c.suit).join(' ')).join('  |  ') +
      '  vs  ' +
      hand.dealerCards.map((c) => c.rank + c.suit).join(' ');
    const detail = document.createElement('div');
    detail.className = 'log-detail';
    detail.textContent = worst
      ? worst.correct
        ? `${worst.headline} · played correctly`
        : `${worst.headline} · played ${worst.chosen.toLowerCase()} · cost ${worst.evCost.toFixed(3)}`
      : 'natural — nothing to decide';
    body.append(title, detail);

    const net = document.createElement('div');
    net.className = 'log-net ' + (hand.netUnits > 0 ? 'win' : hand.netUnits < 0 ? 'loss' : '');
    net.textContent = `${hand.netUnits > 0 ? '+' : ''}${hand.netUnits}`;

    row.append(tier, body, net);

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

    log.append(row, steps);
  }
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
  renderLog(view);
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

  // Space and Enter step the reasoning while a reveal is open, so the whole
  // thing is reachable without a mouse.
  if ((key === ' ' || key === 'enter') && !revealComplete()) {
    event.preventDefault();
    advanceReveal();
    return;
  }

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
