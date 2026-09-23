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

/** The seats somebody is sitting in. An empty chair is drawn nowhere (round 29). */
const seatedAt = (screen) => (screen ? screen.seats.filter((seat) => seat.seated) : []);

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
  /**
   * Set when the link names a table the store does not have, or the join
   * failed (round 29). Either way there is nothing to draw but the door, and
   * before this there was nothing drawn at all.
   */
  lost: false,
  /** How many seats a new table gets. Two unless somebody says otherwise. */
  seats: 2,
  /** Which game a new table deals (round 32): 'blackjack' unless Ultimate is chosen. */
  game: 'blackjack',
  /** Which ticker item is showing, and when it last changed (§3.10). */
  tickerAt: 0,
  tickerShownAt: 0,
  /** The counterfactual, once asked for, and whether it has been asked (§3.8). */
  folklore: null,
  folkloreAsked: false,
  /** The next hand deals itself (round 30): which finished hand it is counting past, and when. */
  dueKey: null,
  dueAt: 0,
  dealtKey: null,
  ticking: null,
  /** What is in flight, one press that may wait behind it, and a count of writes (round 30). */
  busyKind: null,
  waiting: null,
  seq: 0,
};

/**
 * An action's name, as the buttons say it — in either game (round 32).
 *
 * Ultimate's actions are named by the private Ultimate table's own keys, so a
 * button here and a button there say the same words.
 */
const UTH_ACTION_KEYS = {
  raise4x: 'uth.raise4',
  raise3x: 'uth.raise3',
  raise2x: 'uth.raise2',
  raise1x: 'uth.raise1',
  check: 'uth.check',
  fold: 'uth.fold',
};
const actionLabel = (action) => T(UTH_ACTION_KEYS[action] || `action.${action}`);

/**
 * Ultimate's buttons in the private table's rows: each street's two choices
 * side by side, yes on the left (round 4b), and 3× on a row of its own.
 */
function sharedUthRows(legal) {
  const rows = [];
  for (const [yes, no] of [['raise4x', 'check'], ['raise2x', 'check'], ['raise1x', 'fold']]) {
    if (legal.includes(yes) && legal.includes(no)) rows.push([yes, no]);
  }
  if (legal.includes('raise3x')) rows.push(['raise3x']);
  const placed = new Set(rows.flat());
  for (const action of legal) if (!placed.has(action)) rows.push([action]);
  return rows;
}

/** The six, in Idan's order. The page draws them; the record stores the key. */
const REACTION_KEYS = ['brave', 'where', 'withYou', 'shame', 'mum', 'explain'];

/** One line of the ticker every eight seconds (§3.10). */
const TICKER_MS = 8000;

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
 * Mine full size, the others compact — §3.1. Three things were added in round
 * 30, all Idan's, all so that a player can tell what just happened:
 *
 *   - **the bar**, beside the name (item 4): how everyone is doing, on the felt
 *     where it is read while playing, rather than in a box under it;
 *   - **what he did** (item 2): the actions of this hand in order, as facts —
 *     never a grade. A neighbour's arrive once I have made my own first move of
 *     the hand, or once it is over, because until then §3.7 keeps them out of
 *     the object this is drawn from;
 *   - **each hand of a split** (item 3), with its own header, its own total and,
 *     once the dealer has turned, its own result — and the one being decided
 *     now marked. With one hand the seat's header carries the total and the
 *     result, exactly as the private table's does (round 17); with two, each
 *     hand carries its own and the seat header steps back.
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
  /*
   * The crown on this seat's current run (round 33): on his own row, beside his
   * name — mine on mine, a neighbour's on his. A fact about the run; the ticker
   * never says it, and when a mistake ends the run it is simply not drawn.
   */
  const crown = window.EVCrown ? window.EVCrown.node(seat.crown) : null;
  const bar = document.createElement('span');
  bar.className = 'shared-seat-bar' + (seat.bar === null ? ' settling' : '');
  bar.textContent = barText(seat.bar);
  const status = document.createElement('span');
  status.className = 'shared-status';
  status.textContent = T(`shared.status.${seat.status}`);
  const total = document.createElement('span');
  total.className = 'seat-total';
  const only = seat.split.length === 1 ? seat.split[0] : null;
  total.textContent = only ? headerFigure(only, seat.words) : seat.words || '';
  title.append(...[who, crown, bar, status, total].filter(Boolean));
  box.appendChild(title);

  if (seat.actions.length > 0) {
    const acts = document.createElement('p');
    acts.className = 'shared-acts';
    acts.setAttribute('aria-label', T('shared.actsLabel'));
    for (const action of seat.actions) {
      const chip = document.createElement('span');
      chip.className = 'shared-act' + (action === 'forfeit' ? ' forfeit' : '');
      chip.textContent = action === 'forfeit' ? T('shared.act.forfeit') : actionLabel(action);
      acts.appendChild(chip);
    }
    box.appendChild(acts);
  }

  if (seat.split.length > 1) {
    const hands = document.createElement('div');
    hands.className = 'shared-split split';
    seat.split.forEach((hand, index) => {
      const wrap = document.createElement('div');
      wrap.className = 'shared-hand' + (hand.active ? ' active' : '') + (hand.total > 21 ? ' bust' : '');
      const head = document.createElement('div');
      head.className = 'hand-head';
      head.textContent =
        T('hand.nth', { n: index + 1 }) +
        ` · ${headerFigure(hand)}` +
        (hand.doubled ? ` · ${T('hand.doubled')}` : '') +
        (hand.active ? ` · ${T('shared.hand.now')}` : '');
      const cards = document.createElement('div');
      cards.className = 'cards';
      for (const card of hand.cards) cards.appendChild(cardNode(card));
      wrap.append(head, cards);
      hands.appendChild(wrap);
    });
    box.appendChild(hands);
  } else if (only) {
    const cards = document.createElement('div');
    cards.className = 'cards';
    for (const card of only.cards) cards.appendChild(cardNode(card));
    box.appendChild(cards);
  } else if (seat.faceDown > 0) {
    /* An Ultimate neighbour's two cards are his own until the hand is over (round 32). */
    const cards = document.createElement('div');
    cards.className = 'cards';
    for (let i = 0; i < seat.faceDown; i++) cards.appendChild(faceDownNode());
    box.appendChild(cards);
  } else {
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

/** A bar as the seat header shows it: a percentage, or "settling" under ten decisions. */
function barText(bar) {
  return bar === null ? T('shared.settling') : T('shared.barValue', { pct: Math.round(bar * 100) });
}

/**
 * A hand's total and, once it has one, what became of it — in the hand's own
 * words (*ניצחה*, *הפסידה*), because at a shared table the hand may be a
 * neighbour's and "you won" would be wrong about it.
 */
function headerFigure(hand, words) {
  let outcome = null;
  /* Ultimate has no total: the hand in words stands where the total would (round 32). */
  const figure = words ? words : String(hand.total);
  if (hand.surrendered) outcome = T('hand.surrendered');
  else if (!words && hand.total > 21) outcome = T('shared.hand.bust');
  else if (hand.net !== null) {
    outcome = T(hand.net > 0 ? 'shared.hand.won' : hand.net < 0 ? 'shared.hand.lost' : 'shared.hand.push');
  }
  return outcome ? `${figure} · ${outcome}` : figure;
}

/**
 * The space under the felt: this hand's analysis first (round 30, items 5 and 7).
 *
 * The bars moved onto the felt, beside the names, and what was left here is
 * the commentary the private table gives and the shared one never did — drawn
 * from the same words (`explain()` wrote them, for the same scenario and the
 * same rules) and the same returns block, in the same order as the solo quick
 * card: what was decided, the verdict, the rows, the gesture, what was chosen
 * instead, and then the working.
 *
 * Mine only, as everything graded is until I have played (§3.7): the screen
 * object carries my decisions and nobody else's. It stays up after the hand
 * ends and while the next one is dealt, until my next decision replaces it —
 * so there is always something here to read, and nothing jumps as a hand ends.
 *
 * Under it, as text and nothing to press: the table's figures, the line that
 * names the two measures, and the comparison when they disagree.
 */
function renderMeasures(screen) {
  const box = el('shared-measures');
  if (!screen) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.replaceChildren();

  const card = analysisCard(screen.analysis);
  if (card) box.appendChild(card);

  if (screen.table.seats > 1) box.appendChild(tableExtras(screen.table));

  const legend = document.createElement('p');
  legend.className = 'shared-legend';
  legend.textContent = T('shared.legend');
  box.appendChild(legend);

  if (screen.table.seats > 1) {
    const how = document.createElement('p');
    how.className = 'shared-legend shared-table-legend';
    how.textContent = T('shared.tableLegend');
    box.appendChild(how);
  }

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


/** The verdict line, in the private card's own words. */
function verdictText(decision) {
  /* Ultimate's card already carries its verdict, in the private card's words. */
  if (decision.feedback && decision.feedback.verdict) return decision.feedback.verdict;
  return decision.correct
    ? T('fb.correct', { action: actionLabel(decision.optimalAction) })
    : T('fb.wrong', { severity: T(`fb.${decision.severity}`), cost: decision.evCost.toFixed(3) });
}

/**
 * The analysis of my latest hand, as the private quick card lays it out.
 *
 * Earlier decisions in the same hand get their headline and verdict on one line
 * each; the latest gets the whole card.
 */
function analysisCard(decisions) {
  if (!decisions || decisions.length === 0) return null;
  const last = decisions[decisions.length - 1];
  if (last.feedback) return uthAnalysisCard(decisions);
  const card = document.createElement('section');
  card.className = `quickcard shared-analysis ${last.severity}`;
  card.setAttribute('aria-label', T('shared.analysisTitle'));

  for (const earlier of decisions.slice(0, -1)) {
    const line = document.createElement('p');
    line.className = 'shared-analysis-earlier';
    line.textContent = `${earlier.headline} — ${verdictText(earlier)}`;
    card.appendChild(line);
  }

  const anchor = document.createElement('p');
  anchor.className = 'anchor';
  const head = document.createElement('b');
  head.textContent = last.headline;
  anchor.appendChild(head);
  card.appendChild(anchor);

  const verdict = document.createElement('p');
  verdict.className = 'verdict';
  verdict.textContent = verdictText(last);
  card.appendChild(verdict);

  if (last.returns && window.EVReturns) {
    card.appendChild(
      window.EVReturns.block(
        { returns: last.returns, ranked: last.ranked.map((row) => ({ ...row, label: actionLabel(row.action) })) },
        { helpId: 'shared-returns-help' },
      ),
    );
  }

  /*
   * The gesture for a mistake (item 7), where the private card puts its
   * gestures: directly under the rows. On this screen and no other — the app
   * never remarks on a player's mistake in front of his friends; the ticker
   * keeps its own rules and the reactions stay the players' own voice. A
   * negligible cost gets no remark: it is not the kind of mistake worth one.
   */
  const oops = mistakeLine(last);
  if (oops) card.appendChild(oops);

  if (!last.correct) {
    const did = document.createElement('p');
    did.className = 'did';
    did.textContent = T('fb.youChose', {
      chosen: actionLabel(last.action).toLowerCase(),
      best: actionLabel(last.optimalAction).toLowerCase(),
    });
    card.appendChild(did);
  }

  /* The working, as much of it as this player's level reads (round 14). */
  const shown = window.EVLevel ? window.EVLevel.steps() : 3;
  const titles = [T('ui.readDealer'), T('ui.readHand'), T('ui.combine')];
  const reveal = document.createElement('div');
  reveal.className = 'reveal';
  for (let i = 3 - shown; i < 3; i++) {
    if (!last.steps[i]) continue;
    const step = document.createElement('div');
    step.className = 'step';
    const title = document.createElement('div');
    title.className = 'step-head';
    title.textContent = titles[i];
    const text = document.createElement('p');
    boldText(text, last.steps[i]);
    step.append(title, text);
    reveal.appendChild(step);
  }
  if (reveal.children.length > 0) card.appendChild(reveal);
  return card;
}

/**
 * The analysis of my latest Ultimate hand (round 32): the private Ultimate
 * table's own card, built from the object `compose()` made for it — headline,
 * verdict, the rows with their worked lines, the percentages and the
 * calculation, what was chosen instead, then the sentence and its notes — in
 * the order the private table draws them. The mistake remark sits under the
 * rows, as it does on the Blackjack side of this screen.
 */
function uthAnalysisCard(decisions) {
  const last = decisions[decisions.length - 1];
  const feedback = last.feedback;
  const card = document.createElement('section');
  card.className = `quickcard shared-analysis ${feedback.severity}`;
  card.setAttribute('aria-label', T('shared.analysisTitle'));

  for (const earlier of decisions.slice(0, -1)) {
    const line = document.createElement('p');
    line.className = 'shared-analysis-earlier';
    line.textContent = `${earlier.headline} — ${verdictText(earlier)}`;
    card.appendChild(line);
  }

  const anchor = document.createElement('p');
  anchor.className = 'anchor';
  const head = document.createElement('b');
  head.textContent = feedback.headline;
  anchor.appendChild(head);
  card.appendChild(anchor);

  const verdict = document.createElement('p');
  verdict.className = 'verdict';
  verdict.textContent = feedback.verdict;
  card.appendChild(verdict);

  if (window.EVReturns) {
    card.appendChild(
      window.EVReturns.block(feedback, {
        game: 'uth',
        decisions: shared.screen && shared.screen.me ? shared.screen.me.decisions : 0,
        helpId: 'shared-returns-help',
      }),
    );
  }

  const oops = mistakeLine(last);
  if (oops) card.appendChild(oops);

  if (feedback.youChose) {
    const did = document.createElement('p');
    did.className = 'did';
    did.textContent = feedback.youChose;
    card.appendChild(did);
  }

  const reveal = document.createElement('div');
  reveal.className = 'reveal';
  for (const text of [feedback.sentence, ...(feedback.notes || [])]) {
    if (!text) continue;
    const line = document.createElement('p');
    line.className = 'reason';
    boldText(line, text);
    reveal.appendChild(line);
  }
  if (reveal.children.length > 0) card.appendChild(reveal);
  return card;
}

/**
 * The copy's own emphasis: words between `**` are bold, as on the private card.
 * Built from text nodes rather than markup, so nothing in a sentence is ever
 * read as HTML.
 */
function boldText(target, text) {
  target.replaceChildren();
  String(text)
    .split('**')
    .forEach((part, index) => {
      if (part === '') return;
      if (index % 2 === 1) {
        const bold = document.createElement('b');
        bold.textContent = part;
        target.appendChild(bold);
      } else {
        target.appendChild(document.createTextNode(part));
      }
    });
}

/** The remark a mistake earns, on the player's own screen. Nothing for a negligible one. */
function mistakeLine(decision) {
  if (decision.correct) return null;
  if (!['minor', 'significant', 'blunder'].includes(decision.severity)) return null;
  const note = document.createElement('p');
  note.className = 'gesture shared-oops';
  note.textContent = T(`shared.oops.${decision.severity}`);
  return note;
}

/**
 * The table's own row, under the players' (§3.6).
 *
 * The same two figures in the same two places as a player's row, so the eye
 * reads it as one more player — which is what it is: the table, against the
 * dealer. The line under it says how each figure was combined, because "the
 * table's bar" is only honest if a reader can tell it is weighted rather than
 * averaged.
 */
function tableRow(measures) {
  const row = document.createElement('div');
  row.className = 'shared-measure shared-measure-table';
  row.id = 'shared-table-row';

  const name = document.createElement('span');
  name.className = 'shared-measure-name';
  name.textContent = T('shared.tableName');

  const bar = document.createElement('span');
  bar.className = 'shared-measure-bar';
  bar.textContent =
    measures.bar === null
      ? T('shared.settling')
      : T('shared.barValue', { pct: Math.round(measures.bar * 100) });

  const stack = document.createElement('span');
  stack.className = 'shared-measure-stack';
  stack.textContent = window.EVFigure
    ? window.EVFigure.units(measures.stack)
    : (measures.stack > 0 ? '+' : '') + measures.stack;

  row.append(name, bar, stack);
  return row;
}

/** The three figures that only the table has: hands, what it cost, the best run. */
function tableExtras(measures) {
  const line = document.createElement('p');
  line.className = 'shared-table-extras';
  const parts = [T('shared.handsPlayed', { n: measures.handsPlayed })];
  if (measures.evLostPer100 !== null) {
    parts.push(T('shared.evLost', { n: measures.evLostPer100.toFixed(1) }));
  }
  if (measures.streak > 0) parts.push(T('shared.bestRun', { n: measures.streak }));
  line.textContent = parts.join(' · ');
  return line;
}

/**
 * What has just been said, attributed to whoever said it (§3.9).
 *
 * Only this hand's, because a table's talk is about the hand in front of it —
 * everything older is the ticker's job. Each chip carries a name, which is the
 * condition the whole feature rides on: these are a player's words, and the
 * screen must never let them be read as the app's.
 */
function renderSaid(screen) {
  const box = el('shared-said');
  if (!screen || screen.hand === null) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  const said = screen.reactions.filter((post) => post.hand === screen.hand);
  if (said.length === 0) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.hidden = false;
  box.replaceChildren(
    ...said.map((post) => {
      const chip = document.createElement('p');
      chip.className = 'shared-speech' + (post.seat === shared.seat ? ' mine' : '');
      const who = document.createElement('span');
      who.className = 'shared-speech-who';
      who.textContent = post.seat === shared.seat ? T('shared.you') : post.name;
      const what = document.createElement('span');
      what.className = 'shared-speech-what';
      what.textContent = T(`reaction.${post.key}`);
      chip.append(who, what);
      return chip;
    }),
  );
}

/**
 * The six buttons (§3.9).
 *
 * One row, one tap, below the felt — sending one never covers the cards. They
 * are drawn only once somebody else is at the table, because talking to an
 * empty room is not a feature.
 */
function renderReactions(screen) {
  const box = el('shared-reactions');
  if (!screen || shared.seat === null || seatedAt(screen).length < 2) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.hidden = false;
  box.replaceChildren();
  for (const key of REACTION_KEYS) {
    const button = document.createElement('button');
    button.className = 'action shared-react';
    button.type = 'button';
    button.dataset.reaction = key;
    button.textContent = T(`reaction.${key}`);
    button.addEventListener('click', () => {
      /*
       * "תסביר לי" keeps the job it was given: as well as being said out loud
       * like the other five, it opens my own decision's working on my own
       * screen. Nobody else's screen changes — it is a question I am asking
       * the table and an answer I am giving myself.
       */
      void act(() => api('/api/shared/react', { id: shared.id, key }));
    });
    box.appendChild(button);
  }
}

/**
 * The ticker (§3.10).
 *
 * One line, holding still while a hand is live and rotating every eight
 * seconds once it is not. It fades rather than moves, which is the difference
 * between a line you can ignore and a line that drags your eye off the cards.
 */
function renderTicker(screen) {
  const box = el('shared-ticker');
  const items = screen ? screen.ticker : [];
  if (!screen || items.length === 0) {
    box.hidden = true;
    box.textContent = '';
    return;
  }
  /* Newest first: what just happened is what a table is talking about. */
  const shown = [...items].reverse();
  const live = screen.hand !== null && !screen.handOver;
  const now = Date.now();
  /*
   * The first line gets its full eight seconds like every other one. Without
   * this the clock would have been running since the epoch and the ticker would
   * open on its second item.
   */
  if (shared.tickerShownAt === 0) shared.tickerShownAt = now;
  if (!live && now - shared.tickerShownAt > TICKER_MS) {
    shared.tickerAt = (shared.tickerAt + 1) % shown.length;
    shared.tickerShownAt = now;
  }
  if (shared.tickerAt >= shown.length) shared.tickerAt = 0;
  const item = shown[shared.tickerAt];
  const text = tickerText(item);
  box.hidden = false;
  if (box.textContent !== text) {
    box.textContent = text;
    /* The fade is the whole animation. Nothing here moves. */
    box.classList.remove('fading');
    void box.offsetWidth;
    box.classList.add('fading');
  }
}

/** One ticker item as a sentence. None of the three ever mentions money (§3.10). */
function tickerText(item) {
  if (!item) return '';
  const name = item.seat === shared.seat ? T('shared.you') : item.name;
  if (item.kind === 'reaction') {
    return T('shared.ticker.reaction', { name, said: T(`reaction.${item.key}`) });
  }
  if (item.kind === 'record') return T('shared.ticker.record', { name, n: item.streak });
  if (item.kind === 'arrived') return T('shared.ticker.arrived', { name });
  if (item.kind === 'left') return T('shared.ticker.left', { name });
  return T('shared.ticker.gesture', { name, n: item.decisions });
}

/**
 * He took my card — offered once, answered by a replay (§3.8).
 *
 * The button is the whole of it until somebody presses: this is evidence for a
 * thing people already believe, and evidence nobody asked for is a lecture.
 */
function renderFolklore(screen) {
  const box = el('shared-folklore');
  /* Ultimate has no "he took my card": no choice of anybody's moves a card there (round 32). */
  const canAsk =
    Boolean(screen) && screen.game !== 'uth' && screen.handOver && seatedAt(screen).length > 1 && shared.seat !== null;
  if (!canAsk && !shared.folkloreAsked) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.hidden = false;
  box.replaceChildren();

  if (!shared.folkloreAsked) {
    const ask = document.createElement('button');
    ask.className = 'action shared-ask';
    ask.type = 'button';
    ask.id = 'shared-cf-ask';
    ask.textContent = T('shared.cfAsk');
    ask.addEventListener('click', () => void askFolklore());
    box.appendChild(ask);
    return;
  }

  const answer = shared.folklore;
  if (!answer || !answer.counterfactual) {
    const none = document.createElement('p');
    none.className = 'shared-cf-none';
    none.textContent = T('shared.cfNone');
    box.appendChild(none);
  } else {
    const cf = answer.counterfactual;
    const line = document.createElement('p');
    line.className = 'shared-cf-line';
    /*
     * Which of the two it is decides which sentence it gets. The same-hand one
     * is §3.8's own and the stronger claim; the next-hand one is the commoner,
     * and saying it in the same words would claim something the reservation
     * rule makes impossible.
     */
    line.textContent = T(cf.showing === cf.hand ? 'shared.cfLine' : 'shared.cfLineNext', {
      name: cf.seat === shared.seat ? T('shared.you') : cf.name,
      instead: T(cf.instead === 'stand' ? 'shared.cfStood' : 'shared.cfHit'),
      theirTotal: cf.theirTotal,
      otherCard: faceOf(cf.otherCard),
      actualCard: faceOf(cf.actualCard),
      otherTotal: cf.otherTotal,
      actualTotal: cf.actualTotal,
    });
    box.appendChild(line);

    /*
     * And the half that matters more, said in the same breath: the cards moved
     * and the grading did not. He can move your stack and he cannot move your
     * bar — which is a property of how a decision is graded, not a slogan.
     */
    const rule = document.createElement('p');
    rule.className = 'shared-cf-rule';
    rule.textContent = T('shared.cfRule');
    box.appendChild(rule);
  }

  const spots = (answer && answer.spots) || [];
  if (spots.length > 0) {
    const spot = spots[spots.length - 1];
    const title = document.createElement('h3');
    title.className = 'shared-spots-title';
    title.textContent = T('shared.spotsTitle');
    const line = document.createElement('p');
    line.className = 'shared-spot-line';
    line.textContent = T('shared.spotLine', {
      spot: spot.label,
      mine: T(`action.${spot.myAction}`),
      name: spot.name,
      theirs: T(`action.${spot.theirAction}`),
      best: T(`action.${spot.optimalAction}`),
    });
    box.append(title, line);
  }
}

/** A card as a player would say it: the rank and the suit, together. */
function faceOf(card) {
  if (!card) return '';
  return `${card.rank}${card.suit}`;
}

/** Ask for the replay, once. The driver keeps the once-a-session rule, not this. */
async function askFolklore() {
  shared.folkloreAsked = true;
  try {
    shared.folklore = await api('/api/shared/counterfactual', { id: shared.id });
  } catch {
    shared.folklore = null;
  }
  render();
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

/** How long a finished hand stays on the table before the next is dealt (round 30). */
const NEXT_HAND_MS = 4000;

/**
 * The dock: the buttons while I have a decision, and words while I do not.
 *
 * Round 30, item 1. Between hands this used to offer **Deal** and **Leave**, in
 * the place Hit and Stand had just been — so a quick tap meant for the hand
 * that was ending landed on a button that had appeared under the thumb, and
 * Idan: *"ולחצת בטעות — ובלאגן."* Now nothing to press ever appears there when
 * a hand ends:
 *
 *   - **the next hand deals itself**, four seconds after the last one ends, so
 *     there is no Deal to press; whoever's phone gets there first deals for the
 *     table, because the table runs as far as the furthest seat has been dealt;
 *   - **leaving is the home link**, at the top, where Idan left from anyway;
 *   - **the space keeps its height** and shows the commentary instead: my
 *     verdict on the hand, what the table is waiting for, and the countdown.
 *
 * And when buttons do come back for the next hand, the dock's settle-in hold
 * (round 7, shared by both tables) ignores a press for a moment, so a double
 * tap cannot play the new hand's first decision by accident.
 */
function renderActions(screen) {
  const box = el('shared-actions');
  box.replaceChildren();
  if (!screen) return;

  const offer = screen.legal.join(',');
  if (window.EVDock) window.EVDock.enter(`shared:${screen.hand}:${screen.round}:${offer}`);

  const press = (action) => {
    const button = document.createElement('button');
    /*
     * In Ultimate every decision button looks the same, as at the private
     * Ultimate table: colouring one would be the page suggesting an answer.
     */
    button.className =
      'action' + (screen.game !== 'uth' && (action === 'hit' || action === 'stand') ? ' primary' : '');
    button.type = 'button';
    button.dataset.action = action;
    button.textContent = actionLabel(action);
    button.addEventListener('click', () => {
      if (window.EVDock && !window.EVDock.ready()) return;
      void act(() => api('/api/shared/act', { id: shared.id, action }), 'move');
    });
    return button;
  };
  if (screen.game === 'uth' && screen.legal.length > 0) {
    box.classList.add('rows');
    for (const actions of sharedUthRows(screen.legal)) {
      const line = document.createElement('div');
      line.className = 'action-row';
      line.style.setProperty('--cols', String(actions.length));
      line.append(...actions.map(press));
      box.appendChild(line);
    }
  } else {
    box.classList.remove('rows');
    for (const action of screen.legal) box.appendChild(press(action));
  }

  if (screen.legal.length === 0) {
    const line = document.createElement('p');
    line.className = 'shared-dock-line';
    line.id = 'shared-dock-line';
    line.setAttribute('aria-live', 'polite');
    for (const text of dockWords(screen)) {
      const part = document.createElement('span');
      part.textContent = text;
      line.appendChild(part);
    }
    box.appendChild(line);
  }

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

/** What the dock says while there is nothing for me to decide. */
function dockWords(screen) {
  const words = [];
  const waiting = screen.waitingFor.filter((seat) => seat !== shared.seat);
  if (screen.hand !== null && !screen.handOver && waiting.length > 0) {
    const names = waiting
      .map((seat) => screen.seats.find((row) => row.seat === seat)?.name || '')
      .filter(Boolean)
      .join(', ');
    words.push(T('shared.waitingFor', { names }));
    return words;
  }
  if (screen.hand !== null && screen.handOver) {
    /* The hand's verdict, in one line — the card under the felt has the rest. */
    const last = screen.analysis.length > 0 ? screen.analysis[screen.analysis.length - 1] : null;
    if (last && last.hand === screen.hand) words.push(verdictText(last));
    else words.push(T('shared.handOver'));
  }
  const left = secondsToNextHand(screen);
  if (left !== null) {
    words.push(T(screen.hand === null ? 'shared.firstHand' : 'shared.nextHand', { n: left }));
  }
  return words;
}

/** Whether this phone should deal the next hand when its time comes. */
function dealsNext(screen) {
  return (
    Boolean(screen) &&
    !screen.refused &&
    shared.seat !== null &&
    seatedAt(screen).length >= 2 &&
    Boolean(screen.me) &&
    screen.me.status !== 'away' &&
    (screen.hand === null || screen.handOver)
  );
}

/** Seconds until the next hand deals itself, or null when none is coming. */
function secondsToNextHand(screen) {
  if (!dealsNext(screen)) return null;
  const key = screen.hand === null ? -1 : screen.hand;
  if (shared.dueKey !== key) {
    shared.dueKey = key;
    shared.dueAt = Date.now() + NEXT_HAND_MS;
  }
  return Math.max(0, Math.ceil((shared.dueAt - Date.now()) / 1000));
}

/**
 * The quarter-second tick: the countdown's words, and the deal when it is due.
 * Each finished hand is dealt past at most once from this phone.
 */
function tickNextHand() {
  if (!el('shared-door')) {
    clearInterval(shared.ticking);
    shared.ticking = null;
    return;
  }
  const screen = shared.screen;
  if (!dealsNext(screen)) return;
  const left = secondsToNextHand(screen);
  const line = el('shared-dock-line');
  if (line && screen.legal.length === 0) {
    const words = dockWords(screen);
    line.replaceChildren(
      ...words.map((text) => {
        const part = document.createElement('span');
        part.textContent = text;
        return part;
      }),
    );
  }
  if (left === 0 && shared.dealtKey !== shared.dueKey && !shared.busy) {
    shared.dealtKey = shared.dueKey;
    void act(() => api('/api/shared/deal', { id: shared.id }));
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

/** Which game, chosen before the table exists (round 32). Blackjack unless changed. */
function renderGamePicker() {
  const row = el('shared-game-row');
  if (!row) return;
  row.replaceChildren();
  for (const [game, key] of [['blackjack', 'ui.blackjack'], ['uth', 'ui.ultimate']]) {
    const pick = document.createElement('button');
    pick.className = 'action game-pick' + (game === shared.game ? ' primary' : '');
    pick.type = 'button';
    pick.dataset.game = game;
    pick.textContent = T(key);
    pick.setAttribute('aria-pressed', game === shared.game ? 'true' : 'false');
    pick.addEventListener('click', () => {
      shared.game = game;
      renderGamePicker();
    });
    row.appendChild(pick);
  }
}

function render() {
  /*
   * Nothing to draw into once another screen is mounted (round 31). A poll or
   * a move already in flight when the player left lands afterwards and calls
   * this — found by the live walk as "Cannot set properties of null (setting
   * 'hidden')" the moment a phone went home from the table.
   */
  if (!el('shared-door')) return;
  const screen = shared.screen;

  /*
   * A link with no table behind it opens the door, with a line saying why,
   * rather than a page with nothing on it (round 29).
   */
  const lost = shared.lost && !screen;
  el('shared-door').hidden = Boolean(shared.id) && !lost;
  if (lost) {
    const note = el('shared-door-note');
    note.hidden = false;
    note.textContent = T('shared.missing');
  }
  el('shared-refused').hidden = !(screen && screen.refused);

  if (shared.unavailable) {
    el('shared-door').hidden = false;
    const note = el('shared-door-note');
    note.hidden = false;
    note.textContent = T('shared.needsHosted');
    el('shared-make').hidden = true;
    const dock = el('shared-actions').parentElement;
    if (dock) dock.hidden = true;
    return;
  }

  /*
   * A table with an empty seat is a table waiting for somebody, and the link is
   * the only growth this app has (§3.11) — so it is the whole screen until
   * somebody sits down, rather than a line beside a felt nobody can play.
   */
  const seated = seatedAt(screen).length;
  const alone = Boolean(screen) && seated < 2;
  const free = Boolean(screen) && screen.seats.some((seat) => !seat.seated);
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
  el('shared-talk').hidden = true;
  /* The dock holds the buttons and nothing else, so with none it is not drawn. */
  const dock = el('shared-actions').parentElement;
  if (dock) dock.hidden = !playable;
  if (!playable) {
    renderClock(null);
    el('shared-measures').hidden = true;
    el('shared-actions').replaceChildren();
    el('shared-ticker').hidden = true;
    el('shared-said').hidden = true;
    el('shared-reactions').hidden = true;
    el('shared-folklore').hidden = true;
    return;
  }

  /* Which game this table deals, in the bar at the top. */
  el('shared-rules').textContent = T(screen.game === 'uth' ? 'ui.ultimate' : 'ui.blackjack');

  const dealerCards = el('shared-dealer-cards');
  dealerCards.replaceChildren(...screen.dealer.map(cardNode));
  if (screen.game === 'uth') {
    /* Ultimate: both of the dealer's cards are down until the hand is over. */
    if (screen.hand !== null && screen.dealer.length === 0) {
      dealerCards.append(faceDownNode(), faceDownNode());
    }
    el('shared-dealer-total').textContent = screen.dealerWords || '';
  } else {
    if (!screen.dealerRevealed) dealerCards.appendChild(faceDownNode());
    el('shared-dealer-total').textContent = screen.dealerTotal === null ? '' : String(screen.dealerTotal);
  }

  /* The one board (round 32): what has turned, and the rest face down. */
  const boardSeat = el('shared-board-seat');
  if (boardSeat) {
    boardSeat.hidden = screen.game !== 'uth' || screen.hand === null;
    const board = el('shared-board');
    board.replaceChildren(...(screen.board || []).map(cardNode));
    for (let i = 0; i < (screen.boardHidden || 0); i++) board.appendChild(faceDownNode());
  }

  /* Mine first, always: it is the hand being played (§3.1). */
  const order = seatedAt(screen).sort((a, b) => Number(b.mine) - Number(a.mine) || a.seat - b.seat);
  const box = el('shared-seats');
  /*
   * Beyond four the other seats collapse into a list (§3.1): mine stays full
   * size because it is the hand being played, and five other people's hands
   * laid out like it would push my own cards off the phone.
   */
  box.className = order.length > 4 ? 'shared-seats many' : 'shared-seats';
  box.replaceChildren(...order.map(seatNode));

  /*
   * The table against the dealer, on the felt under the seats (item 4) — the
   * same row §3.6 drew under the bars, moved with them. Only once more than one
   * seat has played, because until then it is one player's figures twice.
   */
  const line = el('shared-table-line');
  line.replaceChildren();
  line.hidden = screen.table.seats <= 1;
  if (screen.table.seats > 1) line.appendChild(tableRow(screen.table));

  renderClock(shared.clock);
  renderMeasures(screen);
  renderActions(screen);
  renderTicker(screen);
  renderSaid(screen);
  renderReactions(screen);
  renderFolklore(screen);
}

/* --- Talking to the table ------------------------------------------------ */

/**
 * Every call that changes the table funnels through here, so two cannot overlap.
 *
 * One press may wait (round 30). With the next hand dealing itself, two phones
 * can both deal at the same moment, and the slower one is still busy with its
 * own deal when the new hand's buttons are already on its screen — a press then
 * used to vanish without a trace. A move pressed while something else is in
 * flight now waits for it and then goes; a second move pressed on top of a
 * first still does not, because that is a double tap, not a decision.
 */
async function act(run, kind = 'other') {
  if (shared.busy) {
    if (kind === 'move' && shared.busyKind !== 'move' && !shared.waiting) shared.waiting = run;
    return;
  }
  shared.busy = true;
  shared.busyKind = kind;
  shared.seq++;
  try {
    const answer = await run();
    apply(answer);
  } catch (failure) {
    if (!shared.screen && shared.id) shared.lost = true;
    const note = el('shared-door-note');
    if (note) {
      note.hidden = false;
      note.textContent = String(failure && failure.message ? failure.message : failure);
    }
  } finally {
    shared.busy = false;
    shared.busyKind = null;
    render();
    if (shared.waiting) {
      const next = shared.waiting;
      shared.waiting = null;
      void act(next, 'move');
    }
  }
}

function apply(answer) {
  if (!answer) return;
  if (answer.available === false) {
    shared.unavailable = true;
    return;
  }
  if (answer.missing) shared.lost = true;
  if (answer.id) {
    shared.id = answer.id;
    shared.lost = false;
  }
  if (answer.seat !== undefined && answer.seat !== null) shared.seat = answer.seat;
  if (answer.screen !== undefined) shared.screen = answer.screen;
  if (answer.clock !== undefined) shared.clock = answer.clock;
}

async function refresh() {
  /*
   * The screen was left: another one is mounted in its place, and a poll that
   * went on drawing would be drawing into elements that are not there.
   */
  if (!el('shared-door')) {
    clearInterval(shared.timer);
    shared.timer = null;
    return;
  }
  if (!shared.id || shared.busy) return;
  /*
   * A poll that set off before a write must not land after it (round 30): it
   * would draw the table as it was, the buttons would go and come back, and the
   * dock's hold would start again under the player's thumb.
   */
  const seq = shared.seq;
  let answer;
  try {
    answer = await api('/api/shared/view', { id: shared.id });
  } catch {
    // A poll that fails changes nothing: the table is still what it was.
    return;
  }
  if (seq !== shared.seq || shared.busy) return;
  apply(answer);
  render();
}

/*
 * The screen, started.
 *
 * Not called `initShared`, and that is the whole of round 29. The built page
 * wraps this file in a function of that name and calls the wrapper; a function
 * of the same name in here was declared inside it, shadowed by nothing, and
 * called by nobody — so from round 22 to round 28 the shared table drew no
 * door, no seats and no buttons on any phone, while every route under it
 * passed its tests. The call at the bottom of this file is what runs it, in
 * the local app and the built page alike.
 */
function openShared() {
  const id = tableFromLocation();
  shared.id = id || null;
  shared.seat = null;
  shared.screen = null;
  shared.clock = null;
  shared.unavailable = false;

  renderSeatPicker();
  renderGamePicker();

  el('shared-make').addEventListener('click', () =>
    void act(async () => {
      const made = await api('/api/shared/create', { seats: shared.seats, game: shared.game });
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

  /*
   * Leaving is the home link (round 30, item 1). Idan left that way anyway, and
   * a Leave button between hands was one of the two a quick thumb kept landing
   * on. It stays one tap and in plain sight, which is what §3.3 asks of the
   * door: leaving costs nothing, and coming back by the same link seats him
   * again from the next hand.
   */
  const home = document.querySelector('#shared-bar a.back');
  if (home) {
    home.setAttribute('title', T('shared.leaveHint'));
    home.addEventListener('click', () => {
      if (shared.id && shared.seat !== null) void api('/api/shared/leave', { id: shared.id });
    });
  }

  if (shared.ticking) clearInterval(shared.ticking);
  shared.ticking = setInterval(tickNextHand, 250);

  render();

  if (shared.id) void act(() => api('/api/shared/join', { id: shared.id }));

  if (shared.timer) clearInterval(shared.timer);
  shared.timer = setInterval(() => void refresh(), 1500);
}

window.EV.ready.then(openShared);
