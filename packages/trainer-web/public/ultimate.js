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
  el('uth-class').textContent = view.holeClass ?? '';

  uthRenderRail(view);
  uthRenderCard(view);
  uthRenderActions();
}

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
  feedback.ranked.forEach((entry, index) => {
    const chip = document.createElement('span');
    chip.className =
      'ev' + (index === 0 ? ' best' : '') + (entry.action === feedback.chosen ? ' chosen' : '');
    chip.textContent =
      `${entry.label}: ` + uthFigure(`${entry.ev >= 0 ? '+' : '−'}${Math.abs(entry.ev).toFixed(3)}`);
    evs.appendChild(chip);
  });
  box.appendChild(evs);

  const sentence = document.createElement('p');
  sentence.className = 'reason';
  uthRich(sentence, feedback.sentence);
  box.appendChild(sentence);

  if (view.settlement) {
    const result = document.createElement('div');
    result.className = 'uth-result uth-late';
    result.hidden = true;
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

function uthRenderActions(waiting) {
  const box = el('uth-actions');
  const view = uthState.view;
  box.replaceChildren();
  if (!view) return;

  const add = (label, key, handler, primary) => {
    const button = document.createElement('button');
    button.className = 'action' + (primary ? ' primary' : '');
    button.type = 'button';
    button.disabled = uthState.busy;
    const text = document.createElement('span');
    text.textContent = label;
    const hint = document.createElement('span');
    hint.className = 'key';
    hint.textContent = key;
    button.append(text, hint);
    button.addEventListener('click', handler);
    box.appendChild(button);
  };

  if (waiting) {
    const note = document.createElement('p');
    note.className = 'uth-waiting';
    note.textContent = waiting;
    box.appendChild(note);
    return;
  }

  if (view.legalActions.length > 0) {
    // All decision buttons look the same. Colouring the first one — raise, as
    // it happens — would be the page quietly suggesting an answer to a decision
    // it is about to grade.
    for (const entry of view.legalActions) {
      add(entry.label, entry.key, () => uthSend('/api/uth/act', { action: entry.action }), false);
    }
    return;
  }
  add(T(view.phase === 'idle' ? 'ui.deal' : 'uth.nextHand'), 'N', () => uthSend('/api/uth/deal'), true);
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
