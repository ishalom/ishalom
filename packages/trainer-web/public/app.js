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

const T = (key, params) => (window.EV ? window.EV.t(key, params) : key);


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
    note.textContent = T('fb.didNotDraw');
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

/**
 * Render a step's text: emphasis where the copy asks for it, and figures set in
 * the display face so they read as numbers rather than as more prose.
 *
 * The copy is authored in explain.ts with ** around the words that carry the
 * point; numbers are picked out here so nobody has to mark up every one. All of
 * it is engine-generated — no user text reaches this — but it is escaped first
 * regardless, because "the input is trusted" is how that stops being true.
 */
function renderRich(target, text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  target.innerHTML = escaped
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    // Percentages, signed EVs and bare figures, including 17+ and A,A.
    .replace(/(?<![\w>])([+−-]?\d+(?:[.,]\d+)?%?\+?)(?![\w<])/g, '<span class="num">$1</span>');
}

const severityWord = (severity) => T('fb.' + severity);

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

const stepTitles = () => [T('ui.readDealer'), T('ui.readHand'), T('ui.combine')];

/**
 * The answer, pinned above the cards.
 *
 * The three-step reveal is the teaching, but it is long, and a player drilling
 * quickly was having to scroll past the felt to find out what a hand cost. So
 * the parts that are a verdict rather than an argument — the spot, the grade,
 * what was played, and the EV of every legal action — sit between the dealer
 * and the cards, where the eye already is.
 *
 * It obeys the same gate as the rest: nothing here appears until the reveal is
 * complete, so stepping through the reasoning still means reasoning before
 * seeing the answer (§3.4). A player who has chosen to skip the walkthrough
 * gets it immediately, which is the point of that setting.
 */
function renderQuickCard(view) {
  const box = el('quickcard');
  if (!box) return;
  const feedback = view.feedback;
  const done = revealComplete();

  if (!feedback || !state.reveal) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.className = done ? `quickcard ${feedback.severity}` : 'quickcard thinking';
  box.replaceChildren();

  // After a split the board no longer shows what was actually decided, so the
  // spot is named here whether or not the rest is revealed yet.
  const anchor = document.createElement('p');
  anchor.className = 'anchor';
  if (done) {
    anchor.innerHTML = `<b>${feedback.headline}</b>`;
  } else {
    anchor.innerHTML =
      `<b>${feedback.headline.split(' \u2192 ')[0]}</b> \u2014 ${T('fb.thinking')}`;
    return void box.appendChild(anchor);
  }
  box.appendChild(anchor);

  const verdict = document.createElement('p');
  verdict.className = 'verdict';
  verdict.textContent = feedback.correct
    ? T('fb.correct', { action: feedback.optimalLabel })
    : T('fb.wrong', {
        severity: severityWord(feedback.severity),
        cost: feedback.evCost.toFixed(3),
      });
  box.appendChild(verdict);

  if (!feedback.correct) {
    const did = document.createElement('p');
    did.className = 'did';
    did.textContent =
      T('fb.youChose', {
        chosen: feedback.chosenLabel.toLowerCase(),
        best: feedback.optimalLabel.toLowerCase(),
      }) + (feedback.closeCall ? ' ' + T('fb.closeCall') : '');
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
}

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

  // All three slots are always laid out. Only their text arrives a step at a
  // time, so the card keeps its size and nothing under the cursor moves.
  const reveal = document.createElement('div');
  reveal.className = 'reveal';
  for (let i = 0; i < 3; i++) {
    const revealed = i < state.reveal.shown;
    const step = document.createElement('div');
    step.className =
      'step' + (revealed ? '' : ' pending') + (i === state.reveal.shown - 1 ? ' latest' : '');
    const n = document.createElement('div');
    n.className = 'step-n';
    n.textContent = String(i + 1);
    const body = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'step-head';
    head.textContent = stepTitles()[i];
    const text = document.createElement('p');
    if (revealed) renderRich(text, state.reveal.steps[i]);
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
    next.innerHTML = `${T('ui.next')}<span class="key">SPACE</span>`;
    next.addEventListener('click', advanceReveal);
    const skip = document.createElement('button');
    skip.className = 'reveal-skip';
    skip.textContent = T('fb.skipAlways');
    skip.title = T('fb.skipAlwaysHint');
    skip.addEventListener('click', () => {
      setShowAllPreferred(true);
      state.reveal.shown = 3;
      render();
    });
    controls.append(next, skip);
    box.appendChild(controls);
    return;
  }

  // The preference is reversible from where it took effect, rather than buried
  // in a settings screen the player has no reason to open.
  const pref = document.createElement('button');
  pref.className = 'reveal-skip pref';
  pref.textContent = T(showAllPreferred() ? 'fb.walkMe' : 'fb.skipNext');
  pref.addEventListener('click', () => {
    setShowAllPreferred(!showAllPreferred());
    render();
  });
  box.appendChild(pref);

  // §7.1 item 6: flag answers that flip under another common rule set.
  if (feedback.sensitivity.length > 0) {
    const note = document.createElement('p');
    note.className = 'sensitivity';
    note.textContent = T('fb.ruleSensitive', {
      list: feedback.sensitivity.map((s) => `${s.action} ${s.label}`).join('; '),
    });
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
  hit: 'action.hit',
  stand: 'action.stand',
  double: 'action.double',
  split: 'action.split',
  surrender: 'action.surrender',
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
    add(T('action.takeInsurance'), () => send('/api/insurance', { take: true }));
    add(T('ui.declineInsurance'), () => send('/api/insurance', { take: false }), true);
    return;
  }
  if (view.phase === 'player') {
    for (const action of view.legalActions) {
      add(LABELS[action] ? T(LABELS[action]) : action, () => send('/api/act', { action }));
    }
    return;
  }
  add(T('ui.deal'), () => send('/api/deal'), true);
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
  if (openInfo) showInfo(openInfo);
}

/*
 * What each figure means (§9.2).
 *
 * A metric nobody can explain is a metric nobody should trust, and three of
 * these four are easy to misread in the direction that flatters the player.
 * The definition opens where the number is rather than in a glossary, and the
 * accuracy panel also shows its own working — how many decisions, how many
 * close calls set aside — because that is the one people query.
 */
let openInfo = null;

function accuracyDetail(stats) {
  if (stats.decisions === 0) return '';
  const excluded = stats.closeCallsExcluded;
  const parts = [T('fb.accuracyCount', { right: stats.correct, total: stats.decisions })];
  if (excluded > 0) {
    parts.push(T(excluded === 1 ? 'fb.accuracyExcludedOne' : 'fb.accuracyExcluded', { n: excluded }));
    parts.push(T('fb.accuracyAll', { pct: (stats.accuracyIncludingCloseCalls * 100).toFixed(1) }));
  } else {
    parts.push(T('fb.noCloseCalls'));
  }
  return parts.join(' ');
}

function showInfo(which) {
  const box = el('stat-info');
  box.replaceChildren();
  box.hidden = false;
  openInfo = which;

  const head = document.createElement('div');
  head.className = 'stat-info-head';
  head.textContent = T(`info.${which}.title`);
  const body = document.createElement('p');
  renderRich(body, T(`info.${which}.body`));
  box.append(head, body);

  if (which === 'accuracy' && state.view) {
    const detail = accuracyDetail(state.view.stats);
    if (detail) {
      const p = document.createElement('p');
      p.className = 'stat-info-detail';
      renderRich(p, detail);
      box.appendChild(p);
    }
  }

  for (const button of document.querySelectorAll('.stat[data-info]')) {
    button.setAttribute('aria-expanded', String(button.dataset.info === which));
  }
}

function hideInfo() {
  openInfo = null;
  el('stat-info').hidden = true;
  for (const button of document.querySelectorAll('.stat[data-info]')) {
    button.setAttribute('aria-expanded', 'false');
  }
}

for (const button of document.querySelectorAll('.stat[data-info]')) {
  button.addEventListener('click', () => {
    if (openInfo === button.dataset.info) hideInfo();
    else showInfo(button.dataset.info);
  });
}

/**
 * The dealer's voice.
 *
 * Before the decision she names the spot and answers factual questions; after
 * it, she delivers the verdict. She never names the best play early — §3.1 puts
 * feedback after the decision, and a helpful dealer who blurts the answer is
 * just a chart with a face.
 */
async function renderCoach(view) {
  const say = el('say');
  const answer = el('answer');
  const asks = el('asks');
  if (!say || !asks) return;

  if (view.feedback && revealComplete()) {
    const f = view.feedback;
    say.textContent = f.correct
      ? `${f.optimalLabel}. That's the play.`
      : `${f.optimalLabel} was the play — that one cost you ${f.evCost.toFixed(3)}.`;
  } else if (view.feedback) {
    say.textContent = T('ui.thinkPrompt');
  }

  if (view.phase !== 'player' && view.phase !== 'insurance') {
    if (!view.feedback) say.textContent = T('ui.dealWhenReady');
    asks.replaceChildren();
    answer.hidden = true;
    return;
  }

  const coach = await api('/api/coach');
  if (coach.prompt && !view.feedback) say.textContent = coach.prompt;

  asks.replaceChildren();
  answer.hidden = true;
  for (const ask of coach.asks) {
    const button = document.createElement('button');
    button.className = 'ask';
    button.type = 'button';
    button.textContent = ask.question;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      for (const b of asks.children) b.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-pressed', 'true');
      answer.hidden = false;
      answer.textContent = ask.answer;
    });
    asks.appendChild(button);
  }

  // Once the decision is made the answer is already out, so the full reasoning
  // can be asked for without giving anything away.
  if (view.feedback && revealComplete()) {
    const why = document.createElement('button');
    why.className = 'ask';
    why.type = 'button';
    why.textContent = T('ui.why');
    why.addEventListener('click', () => {
      answer.hidden = false;
      answer.textContent = view.feedback.steps.join(' ');
    });
    asks.appendChild(why);
  }
}

function render() {
  const view = state.view;
  if (!view) return;

  el('rules-name').textContent = view.ruleSet.name;
  el('rules-badge').textContent = view.ruleSet.badge;
  // §16: the residual house edge is stated in plain numbers, not buried.
  el('edge-note').textContent =
    T('ui.edgeNote', { pct: view.ruleSet.edgePercent.toFixed(2) });

  renderDealer(view);
  renderHands(view);
  renderQuickCard(view);
  renderFeedback(view);
  renderActions(view);
  renderStats(view);
  renderCoach(view).catch(() => {});
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
      await send('/api/session', { presetId: preset.id, ...restrictions() });
    });
    list.appendChild(button);
  }

  const current = state.view.ruleSet.restrictions;
  el('opt-no-surrender').checked = current.noSurrender;
  el('opt-like-ranks').checked = current.likeRanksOnly;
  el('settings').showModal();
}

const restrictions = () => ({
  noSurrender: el('opt-no-surrender').checked,
  likeRanksOnly: el('opt-like-ranks').checked,
});

/*
 * A restriction is part of the rule set, not a filter over it, so changing one
 * restarts the session exactly as changing the preset does. The chart is
 * re-solved, the house edge is recomputed, and every graded answer from here on
 * is the answer for the game actually being dealt.
 */
for (const id of ['opt-no-surrender', 'opt-like-ranks']) {
  el(id).addEventListener('change', async () => {
    el('settings').close();
    await send('/api/session', { presetId: state.view.ruleSet.id, ...restrictions() });
  });
}

function openHowTo() {
  const list = el('howto-list');
  list.replaceChildren();
  for (const n of [1, 2, 3, 4]) {
    const item = document.createElement('li');
    renderRich(item, T(`howto.${n}`));
    list.appendChild(item);
  }
  el('howto').showModal();
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
    chartTable(T('ui.chart.hard'), HARD.map((t) => ({ label: String(t), key: (up) => `bj:hard${t}:vs${up}` })), cells),
    chartTable(T('ui.chart.soft'), SOFT.map((t) => ({ label: `A${t - 11}`, key: (up) => `bj:soft${t}:vs${up}` })), cells),
    chartTable(T('ui.chart.pairs'), PAIRS.map((p) => ({ label: `${p},${p}`, key: (up) => `bj:pair${p}:vs${up}` })), cells),
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
el('open-howto').addEventListener('click', openHowTo);

// After the locale handshake, so the first render is already in the right language.
Promise.resolve(window.EV && window.EV.ready).then(() => send('/api/state'));
