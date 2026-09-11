/*
 * Ultimate Texas Hold'em, playable (round 4a).
 *
 * Draws what `UthSession.view` describes and sends the player's choices back.
 * It decides nothing: the grade, the EVs, the sentence and the settlement lines
 * all arrive composed, in the current language, from the session — the same
 * division of labour as the Blackjack table, and for the same reason. A page
 * that computed its own verdict would be a second grader, and the day the two
 * disagreed the app would be teaching two answers.
 */

const T = (key, params) => (window.EV ? window.EV.t(key, params) : key);

const el = (id) => document.getElementById(id);

/**
 * A figure kept in one piece inside right-to-left text: in Hebrew, "−0.416"
 * next to a Hebrew label otherwise draws as "0.416−". See `isolateFor` in
 * uth-session.ts, which does the same for the prose composed there.
 */
const uthFigure = (text) =>
  document.documentElement.getAttribute('dir') === 'rtl' ? `\u2066${text}\u2069` : text;

const uthState = {
  view: null,
  busy: false,
  /** The decision the card was last drawn for, so the result waits its turn. */
  cardToken: null,
  /** Measured solve times on this page, for anyone checking the flop is quick. */
  timings: [],
};

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

/** Every call that changes the table goes through here, one at a time. */
async function uthSend(path, body) {
  if (uthState.busy) return;
  uthState.busy = true;
  try {
    uthState.view = await api(path, body ?? {});
    uthRender();
    if (uthState.view.needsPrepare) await uthPrepare();
  } catch (error) {
    console.error(error);
    alert(error.message);
  } finally {
    uthState.busy = false;
    uthRenderActions();
  }
}

/**
 * Solve the flop while it is being turned over.
 *
 * The flop solve is about 80 ms of main-thread work. Done at the moment of the
 * click, it would sit between the player's decision and the card that grades it.
 * Done here, it runs while the new cards animate in — transforms run on the
 * compositor, so the turn-over does not stall — and the buttons come back only
 * once the answer is cached, so the grading click itself is instant.
 *
 * Waiting two frames first lets the browser paint the flop before the solve
 * takes the thread — but never waiting on frames alone. A tab in the background
 * gets no animation frames at all, so a player who clicked Check and switched
 * away would come back to "Reading the flop…" still waiting to start. Whichever
 * comes first, two frames or 50 ms, the solve goes ahead.
 */
async function uthPrepare() {
  uthRenderActions(T('uth.readingFlop'));
  await Promise.race([
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    new Promise((resolve) => setTimeout(resolve, 50)),
  ]);
  const started = performance.now();
  const result = await api('/api/uth/prepare', {});
  const wall = performance.now() - started;
  uthState.timings.push({ phase: result.phase, solveMs: result.solveMs, wallMs: wall });
  window.EV_UTH_TIMINGS = uthState.timings;
}

// --- Drawing ----------------------------------------------------------------

function uthCard(card) {
  const node = document.createElement('div');
  node.className = 'card dealt' + (card.red ? ' red' : '');
  if (card.code !== undefined) node.dataset.code = String(card.code);
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

function uthBack() {
  const node = document.createElement('div');
  node.className = 'card back dealt';
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', 'face-down card');
  return node;
}

/**
 * How many decimals each EV chip shows.
 *
 * Three, unless two different values would print the same — K4s showed 3× and
 * check both as +0.019 when they are +0.0193 and +0.0189, and chips that look
 * equal but are ranked differently read as a bug. Those chips get a fourth
 * decimal. Truly equal values stay at three: there the chips should look equal.
 */
function uthChipDigits(evs) {
  const three = evs.map((ev) => ev.toFixed(3));
  return evs.map((ev, i) => (evs.some((other, j) => j !== i && other !== ev && three[j] === three[i]) ? 4 : 3));
}

/** Bold the parts the copy marks with **, and nothing else — no HTML from data. */
function uthRich(target, text) {
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

/*
 * On a portrait phone the felt, the card and the buttons share one screen. A
 * long card would otherwise climb over your own two cards, which at showdown are
 * ringed and are the point of the rings. So the card is capped at the room left
 * under your hand, and scrolls inside itself past that. A floor keeps it
 * readable on a short screen, where the page scrolls instead; wider screens keep
 * the stylesheet's cap.
 */
function uthFitCard() {
  const card = el('uth-card');
  const hole = el('uth-hole');
  const actions = el('uth-actions');
  if (!card || !hole || !actions || !card.style || typeof getComputedStyle !== 'function') return;
  if (!(window.innerWidth <= 560) || !hole.children.length) {
    card.style.maxHeight = '';
    return;
  }
  const style = getComputedStyle(card);
  const chrome =
    style.boxSizing === 'border-box'
      ? 0
      : parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth);
  const holeBottom = hole.getBoundingClientRect().bottom + window.scrollY;
  const room = window.innerHeight - holeBottom - actions.getBoundingClientRect().height - chrome - 8;
  card.style.maxHeight = `${Math.floor(Math.min(Math.max(150, room), window.innerHeight * 0.42))}px`;
}
if (!window.__uthFitBound && typeof window.addEventListener === 'function') {
  window.__uthFitBound = true;
  window.addEventListener('resize', () => uthFitCard());
}

function uthRender() {
  const view = uthState.view;
  if (!view) return;
  const inHand = view.phase !== 'idle';

  el('uth-empty').hidden = inHand;

  el('uth-dealer').replaceChildren(
    ...(view.dealerRevealed
      ? view.dealerHole.map(uthCard)
      : inHand ? [uthBack(), uthBack()] : []),
  );

  const board = view.board.map(uthCard);
  for (let i = 0; i < view.boardHidden; i++) board.push(uthBack());
  el('uth-board').replaceChildren(...board);

  el('uth-hole').replaceChildren(...view.hole.map(uthCard));
  // Plain words beside "You"; the notation is there for anyone who hovers.
  el('uth-class').textContent = view.holeWords ?? '';
  el('uth-class').title = view.holeClass ?? '';

  /*
   * At showdown, ring the five cards that make each hand: gold for yours, grey
   * for the dealer's. A board card in both hands carries both rings.
   */
  const shown = view.showdown;
  for (const node of document.querySelectorAll('#uth-table .card[data-code]')) {
    const code = Number(node.dataset.code);
    node.classList.toggle('best-you', !!shown && shown.player.cards.includes(code));
    node.classList.toggle('best-dealer', !!shown && shown.dealer.cards.includes(code));
  }

  uthRenderRail(view);
  uthRenderCard(view);
  uthFitCard();
  uthRenderStats(view);
  uthRenderLog(view);
  uthRenderActions();
}

// --- The strip, its tooltips, the hand log and How to play --------------------

let uthOpenInfo = null;

/**
 * Keep the pinned strip sitting under the pinned rules bar, measured rather than
 * guessed — the same reason and the same three lines as `pinStrip` on the
 * Blackjack table: the bar's height moves with the language and the font.
 */
function uthPinStrip() {
  const bar = el('rules-bar');
  const shell = bar && bar.parentElement;
  if (!bar || !shell) return;
  const measure = () => {
    shell.style.setProperty('--rules-h', `${Math.round(bar.getBoundingClientRect().height)}px`);
  };
  measure();
  if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(bar);
  else window.addEventListener('resize', measure);
}

/** The same four figures as the Blackjack strip, from this game's session. */
function uthRenderStats(view) {
  const s = view.stats;
  if (!s) return;
  el('uth-stat-accuracy').textContent = s.decisions === 0 ? '—' : `${(s.accuracy * 100).toFixed(1)}%`;
  el('uth-stat-evlost').textContent = s.hands === 0 ? '—' : s.evLostPer100.toFixed(2);
  el('uth-stat-edge').textContent = `${s.effectiveHouseEdgePercent.toFixed(2)}%`;
  el('uth-stat-units').textContent = uthFigure(
    `${s.netUnits > 0 ? '+' : s.netUnits < 0 ? '−' : ''}${Math.abs(s.netUnits)}`,
  );
  if (uthOpenInfo) uthShowInfo(uthOpenInfo);
}

function uthShowInfo(which) {
  const box = el('uth-stat-info');
  box.replaceChildren();
  box.hidden = false;
  uthOpenInfo = which;

  const head = document.createElement('div');
  head.className = 'stat-info-head';
  head.textContent = T(`info.${which}.title`);
  const body = document.createElement('p');
  // The floor is this game's perfect-play edge, composed by the session from the
  // solved table, so the tooltip cannot quote a number the engine did not give.
  uthRich(body, T(`info.${which}.body`, { rulesEdge: uthState.view ? uthState.view.rulesEdge : '—' }));
  box.append(head, body);

  const s = uthState.view && uthState.view.stats;
  if (which === 'accuracy' && s && s.decisions > 0) {
    const parts = [T('fb.accuracyCount', { right: s.correct, total: s.decisions })];
    if (s.closeCallsExcluded > 0) {
      parts.push(
        T(s.closeCallsExcluded === 1 ? 'fb.accuracyExcludedOne' : 'fb.accuracyExcluded', {
          n: s.closeCallsExcluded,
        }),
      );
      parts.push(T('fb.accuracyAll', { pct: (s.accuracyIncludingCloseCalls * 100).toFixed(1) }));
    } else {
      parts.push(T('fb.noCloseCalls'));
    }
    const detail = document.createElement('p');
    detail.className = 'stat-info-detail';
    uthRich(detail, parts.join(' '));
    box.appendChild(detail);
  }

  for (const button of document.querySelectorAll('#uth-stats .stat[data-info]')) {
    button.setAttribute('aria-expanded', String(button.dataset.info === which));
  }
}

function uthHideInfo() {
  el('uth-stat-info').hidden = true;
  uthOpenInfo = null;
  for (const button of document.querySelectorAll('#uth-stats .stat[data-info]')) {
    button.setAttribute('aria-expanded', 'false');
  }
}

for (const button of document.querySelectorAll('#uth-stats .stat[data-info]')) {
  button.addEventListener('click', () => {
    if (uthOpenInfo === button.dataset.info) uthHideInfo();
    else uthShowInfo(button.dataset.info);
  });
}

/**
 * Every finished hand, in the Blackjack log's round 3 structure.
 *
 * The row summarises the hand, not one decision in it. Opened, each decision
 * has its own header and its one sentence, and the result comes last, in the
 * quiet style the card uses for it. Everything arrives worded by the session in
 * the current language; the page only lays it out.
 */
function uthRenderLog(view) {
  const box = el('uth-hands');
  if (!box) return;
  box.replaceChildren();
  const hands = view.history || [];
  if (hands.length === 0) {
    const note = document.createElement('p');
    note.className = 'empty-note';
    note.textContent = T('uth.logEmpty');
    box.appendChild(note);
    return;
  }

  for (const hand of hands) {
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
    net.textContent = uthFigure(`${hand.net > 0 ? '+' : hand.net < 0 ? '−' : ''}${Math.abs(hand.net)}`);
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
      uthRich(sentence, decision.sentence);
      block.append(head, sentence);
      for (const line of decision.notes || []) {
        const note = document.createElement('p');
        uthRich(note, line);
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
      steps.hidden = !steps.hidden;
    });
    box.append(row, steps);
  }
}

/** How to play, including the Trips line — worded, and figured, by the session. */
function uthOpenHowTo() {
  const list = el('uth-howto-list');
  list.replaceChildren();
  for (const line of (uthState.view && uthState.view.howTo) || []) {
    const item = document.createElement('li');
    uthRich(item, line);
    list.appendChild(item);
  }
  el('uth-howto').showModal();
}

el('uth-open-howto')?.addEventListener('click', uthOpenHowTo);
uthPinStrip();

function uthRenderRail(view) {
  const rail = el('uth-rail');
  rail.replaceChildren();
  const spot = (label, value, extra) => {
    const div = document.createElement('div');
    div.className = 'uth-spot' + (extra ? ` ${extra}` : '');
    const figure = document.createElement('span');
    figure.className = 'rail-value';
    figure.textContent = value;
    const name = document.createElement('span');
    name.className = 'rail-label';
    name.textContent = label;
    div.append(figure, name);
    return div;
  };
  const stake = view.stake;
  rail.append(
    spot(T('uth.ante'), stake.ante || '—'),
    spot(T('uth.blind'), stake.blind || '—'),
    spot(T('uth.play'), stake.play || '—'),
  );

  const bank = spot(T('ui.stack'), view.stack.balance.toFixed(view.stack.balance % 1 === 0 ? 0 : 1), 'bank');
  // The swing from the hand, drawn only once the card above has had its moment.
  if (view.stack.lastNet !== null && view.settlement) {
    const delta = document.createElement('span');
    const net = view.stack.lastNet;
    delta.className = 'rail-delta uth-late ' + (net > 0 ? 'win' : net < 0 ? 'loss' : '');
    delta.textContent = uthFigure(`${net > 0 ? '+' : net < 0 ? '−' : ''}${Math.abs(net)}`);
    delta.hidden = true;
    bank.appendChild(delta);
  }
  rail.appendChild(bank);
}

/**
 * The card: the grade, then — later and quieter — what the cards did.
 *
 * §3.1 keeps the result behind the decision. With no three-step reveal in 4a
 * the separation is made in time and in weight instead: the verdict is drawn at
 * once and large, and the settlement lines appear a moment later, small and
 * muted, underneath it.
 */
function uthRenderCard(view) {
  const box = el('uth-card');
  const feedback = view.feedback;
  if (!feedback) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.hidden = false;
  box.className = `quickcard ${feedback.severity}`;
  box.dataset.solveMs = String(feedback.solveMs);
  box.replaceChildren();

  const anchor = document.createElement('p');
  anchor.className = 'anchor';
  const head = document.createElement('b');
  head.textContent = feedback.headline;
  anchor.appendChild(head);
  box.appendChild(anchor);

  const verdict = document.createElement('p');
  verdict.className = 'verdict';
  verdict.textContent = feedback.verdict;
  box.appendChild(verdict);

  if (feedback.youChose) {
    const did = document.createElement('p');
    did.className = 'did';
    did.textContent = feedback.youChose;
    box.appendChild(did);
  }

  const evs = document.createElement('div');
  evs.className = 'evs';
  const digits = uthChipDigits(feedback.ranked.map((entry) => entry.ev));
  feedback.ranked.forEach((entry, index) => {
    const chip = document.createElement('span');
    chip.className =
      'ev' + (index === 0 ? ' best' : '') + (entry.action === feedback.chosen ? ' chosen' : '');
    chip.textContent =
      `${entry.label}: ` + uthFigure(`${entry.ev >= 0 ? '+' : '−'}${Math.abs(entry.ev).toFixed(digits[index])}`);
    evs.appendChild(chip);
  });
  box.appendChild(evs);

  const sentence = document.createElement('p');
  sentence.className = 'reason';
  uthRich(sentence, feedback.sentence);
  box.appendChild(sentence);
  for (const line of feedback.notes || []) {
    const note = document.createElement('p');
    note.className = 'reason uth-note';
    uthRich(note, line);
    box.appendChild(note);
  }

  if (view.settlement) {
    const result = document.createElement('div');
    result.className = 'uth-result uth-late';
    result.hidden = true;
    if (view.showdown) {
      for (const line of [view.showdown.player.words, view.showdown.dealer.words]) {
        const p = document.createElement('p');
        p.className = 'uth-hand-name';
        p.textContent = line;
        result.appendChild(p);
      }
      const legend = document.createElement('p');
      legend.className = 'uth-legend';
      legend.textContent = view.showdown.legend;
      result.appendChild(legend);
    }
    for (const line of view.settlement.lines) {
      const p = document.createElement('p');
      p.textContent = line;
      result.appendChild(p);
    }
    const net = document.createElement('p');
    net.className = 'uth-net';
    net.textContent = view.settlement.net;
    result.appendChild(net);
    box.appendChild(result);
  }

  // One token per graded decision: the result is revealed once, after a beat,
  // and not again on an unrelated re-render.
  const token = `${view.hands}:${feedback.phase}:${feedback.chosen}`;
  const reduced =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reveal = () => {
    for (const node of document.querySelectorAll('.uth-late')) node.hidden = false;
  };
  if (uthState.cardToken === token || reduced) reveal();
  else {
    uthState.cardToken = token;
    setTimeout(reveal, 450);
  }
}

/**
 * Where each decision button sits, as rows of action names.
 *
 * The "yes" action on the physical left and the "no" action on the physical
 * right, in both languages: Raise 4× | Check before the flop, with Raise 3× as
 * a full-width row under them; Raise 2× | Check on the flop; Raise 1× | Fold on
 * the river. Layout only — built from the legal actions the session sends.
 */
function uthRows(legal) {
  const rows = [];
  for (const [yes, no] of [['raise4x', 'check'], ['raise2x', 'check'], ['raise1x', 'fold']]) {
    if (legal.includes(yes) && legal.includes(no)) rows.push([yes, no]);
  }
  if (legal.includes('raise3x')) rows.push(['raise3x']);
  // Anything a future rule adds that no row names still gets a button.
  const placed = new Set(rows.flat());
  for (const action of legal) if (!placed.has(action)) rows.push([action]);
  return rows;
}

function uthRenderActions(waiting) {
  const box = el('uth-actions');
  const view = uthState.view;
  box.replaceChildren();
  box.classList.add('rows');
  if (!view) return;

  const button = (label, key, handler, primary, action) => {
    const node = document.createElement('button');
    node.className = 'action' + (primary ? ' primary' : '');
    node.type = 'button';
    node.disabled = uthState.busy;
    if (action) node.dataset.action = action;
    const text = document.createElement('span');
    text.textContent = label;
    const hint = document.createElement('span');
    hint.className = 'key';
    hint.textContent = key;
    node.append(text, hint);
    node.addEventListener('click', handler);
    return node;
  };
  const row = (buttons) => {
    const line = document.createElement('div');
    line.className = 'action-row';
    line.style.setProperty('--cols', String(buttons.length));
    line.append(...buttons);
    box.appendChild(line);
  };

  if (waiting) {
    const note = document.createElement('p');
    note.className = 'uth-waiting';
    note.textContent = waiting;
    box.appendChild(note);
    return;
  }

  if (view.legalActions.length > 0) {
    // All decision buttons look the same. Colouring one would be the page
    // quietly suggesting an answer to a decision it is about to grade.
    const byAction = new Map(view.legalActions.map((entry) => [entry.action, entry]));
    for (const actions of uthRows(view.legalActions.map((entry) => entry.action))) {
      row(
        actions.map((action) => {
          const entry = byAction.get(action);
          return button(entry.label, entry.key, () => uthSend('/api/uth/act', { action }), false, action);
        }),
      );
    }
    return;
  }
  row([button(T(view.phase === 'idle' ? 'ui.deal' : 'uth.nextHand'), 'N', () => uthSend('/api/uth/deal'), true, 'deal')]);
}

// --- Keyboard ---------------------------------------------------------------

/*
 * Physical keys, not characters: a Hebrew layout turns C into ב and F into כ,
 * and a shortcut that only works in English is not a shortcut for the person
 * this app is mostly played by.
 *
 * Space and Enter do nothing here at all. Every action on this table places or
 * resolves a bet — dealing posts the Ante and the Blind — and round 2 found a
 * "carry on" key resolving a bet the player never chose. N deals; a held key
 * never repeats.
 */
document.addEventListener('keydown', (event) => {
  if (document.querySelector('dialog[open]')) return;
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  const view = uthState.view;
  if (!view || uthState.busy) return;
  if (event.code === 'Space' || event.code === 'Enter' || event.code === 'NumpadEnter') {
    event.preventDefault();
    return;
  }
  const entry = view.legalActions.find((candidate) => candidate.code === event.code);
  if (entry) {
    event.preventDefault();
    uthSend('/api/uth/act', { action: entry.action });
    return;
  }
  if (view.legalActions.length === 0 && event.code === 'KeyN') {
    event.preventDefault();
    uthSend('/api/uth/deal');
  }
});

Promise.resolve(window.EV && window.EV.ready).then(() => uthSend('/api/uth/state'));
