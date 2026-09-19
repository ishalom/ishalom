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

const state = {
  view: null,
  busy: false,
  reveal: null,
  /*
   * Which cards the felt is already showing.
   *
   * `render()` runs after every response *and* after every step of the reveal,
   * and the seats are rebuilt wholesale each time. Without a record of what was
   * already there, anything that animates a card would replay the entire deal
   * three times while the player reads the reasoning. So each pass works out
   * which cards are genuinely new, and only those are treated as newly dealt.
   */
  shown: { dealer: [], hands: [] },
  /** Guards the one-shot verdict effects; see `flashOnce`. */
  flashed: null,
  /** Hands settled when the chips last moved, so they move once a hand. */
  chipsSettled: null,
  /** Whether the chips are open between hands while the last card is still up. */
  betOpen: false,
};

/** Identity of a card in its seat: same rank, same suit, same position. */
const cardKey = (card, index) => `${index}:${card.rank}${card.suit}`;

/**
 * Which of these cards were not on the felt a moment ago.
 *
 * Positional, because that is what a seat is: the third card of a hand is a
 * different thing from the third card of another hand, even with the same face.
 * Returns a Set of keys, plus each new card's position among the new ones, so a
 * fresh deal staggers and a single hit does not wait behind it.
 */
function newCards(keys, previous) {
  const fresh = new Map();
  for (let i = 0; i < keys.length; i++) {
    if (previous[i] !== keys[i]) fresh.set(i, fresh.size);
  }
  return fresh;
}

/* --------------------------------------------------------------------------
 * Sound
 *
 * Off unless asked for, and synthesised rather than shipped: no files, no
 * fetch, nothing for a content policy to block, and a couple of kilobytes
 * instead of a couple of hundred.
 *
 * Two voices, and a hard rule about what has none. A card landing makes a
 * noise. A verdict makes a noise — the same length, the same loudness, right
 * or wrong, differing only in pitch. Winning money makes no noise at all. A
 * jingle on a won hand is the exact conditioning §3.1 and §16 exist to keep
 * out of this app, and a buzzer on a lost one is the same mistake inverted.
 * ----------------------------------------------------------------------- */

function soundEnabled() {
  try {
    return localStorage.getItem('ev:sound') === '1';
  } catch {
    return false;
  }
}
function setSoundEnabled(value) {
  try {
    localStorage.setItem('ev:sound', value ? '1' : '0');
  } catch {
    // Storage disabled; the preference simply lasts for this page.
  }
}

/**
 * The audio context, made only once and only on demand.
 *
 * Lazily, because a player who never turns sound on should never have one at
 * all. On `window`, because the artifact build wraps this file in a function
 * that runs again on every screen change — a module-level context would leak
 * one per navigation.
 */
function audio() {
  if (!soundEnabled()) return null;
  try {
    if (!window.__evAudio) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      const master = ctx.createGain();
      master.gain.value = 0.25; // Nothing here can ever be loud.
      master.connect(ctx.destination);
      window.__evAudio = { ctx, master };
    }
    const held = window.__evAudio;
    if (held.ctx.state === 'suspended') held.ctx.resume();
    return held;
  } catch {
    return null;
  }
}

/** A card landing on felt: a short filtered noise burst, nothing musical. */
function playCard(delayMs) {
  const held = audio();
  if (!held) return;
  const { ctx, master } = held;
  const length = Math.floor(ctx.sampleRate * 0.012);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / length);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2400;
  const gain = ctx.createGain();
  gain.gain.value = 0.5;
  source.connect(filter).connect(gain).connect(master);
  source.start(ctx.currentTime + delayMs / 1000);
}

/**
 * The verdict.
 *
 * Identical envelope, duration and gain either way — only the pitch moves.
 * Not a rising arpeggio, not a chime, not a coin.
 */
function playVerdict(correct) {
  const held = audio();
  if (!held) return;
  const { ctx, master } = held;
  const at = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = correct ? 660 : 220;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.4, at + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + 0.1);
}

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

/** Building a bet or taking the rebuy: nothing about the last hand changes. */
const CHIP_PATHS = ['/api/bet', '/api/rebuy'];

/** Every call that changes the table funnels through here. */
async function send(path, body) {
  if (state.busy) return;
  state.busy = true;
  try {
    // A new hand starts an empty felt, so its first cards are new even if they
    // happen to match the last hand's rank, suit and seat.
    if (path === '/api/deal') {
      state.shown = { dealer: [], hands: [] };
      state.betOpen = false;
    }
    state.view = await api(path, body ?? {});
    const feedback = state.view.feedback;
    // A chip placed after a hand leaves that hand's card where the player had
    // the reveal, rather than starting the reasoning over.
    if (!CHIP_PATHS.includes(path)) {
      state.reveal = feedback
        ? { steps: feedback.steps, shown: showAllPreferred() ? revealPlan().total : 1 }
        : null;
    }
    render();
  } catch (error) {
    console.error(error);
    alert(error.message);
  } finally {
    state.busy = false;
  }
}

// --- Rendering -------------------------------------------------------------

/**
 * A decision that puts more chips out — a double, a split, insurance — moves
 * them from the stack to the spot, with the one chip click (round 6b).
 */
async function sendPlacing(path, body, placesChips) {
  const from = placesChips ? document.querySelector('#rail .rail-bank .chips')?.getBoundingClientRect() : null;
  await send(path, body);
  if (from && window.EVChips) window.EVChips.place(from, document.querySelector('#rail .rail-bet .chips'), 5);
}

/**
 * One card, marked by where it came from.
 *
 * A hand of three cards tells you nothing about how it got there, and "16" that
 * arrived as 10+6 is a different lesson from one that arrived as 5+4 then 7. So
 * the opening two sit flush and plain, and every card taken since carries the
 * number of the draw that brought it. The distinction is in the shape and the
 * badge, not in colour alone (§13), and it reaches a screen reader too.
 */
function cardNode(card, index, dealtNow) {
  const drawn = index !== undefined && index >= 2;
  // In step with the visual stagger, so the sound is the card landing rather
  // than a separate event that happens to coincide.
  if (dealtNow !== undefined) playCard(dealtNow * 70);
  const node = document.createElement('div');
  node.className =
    'card' + (card.red ? ' red' : '') + (drawn ? ' drawn' : ' dealt') +
    (dealtNow === undefined ? '' : ' arriving');
  if (dealtNow !== undefined) node.style.setProperty('--deal-index', dealtNow);
  node.setAttribute('role', 'img');
  node.setAttribute(
    'aria-label',
    drawn
      ? T('ui.cardDrawn', { card: cardWords(card), n: index - 1 })
      : T('ui.cardDealt', { card: cardWords(card) }),
  );
  if (drawn) node.dataset.draw = index - 1;
  const rank = document.createElement('span');
  rank.className = 'card-rank';
  rank.textContent = card.rank;
  const suit = document.createElement('span');
  suit.className = 'card-suit';
  suit.textContent = card.suit;
  node.append(rank, suit);
  return node;
}

function faceDownNode(dealtNow) {
  const node = document.createElement('div');
  node.className = 'card back dealt' + (dealtNow === undefined ? '' : ' arriving');
  if (dealtNow !== undefined) node.style.setProperty('--deal-index', dealtNow);
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', T('card.faceDown'));
  return node;
}

function renderDealer(view) {
  const box = el('dealer-cards');
  // While the reveal is running the outcome stays under wraps: §3.1 wants the
  // grade independent of the result, and a result shown two clicks before the
  // grade would break that far more thoroughly than an early EV chip.
  const withhold = !revealComplete();
  const cards = withhold ? view.dealer.cards.slice(0, 1) : view.dealer.cards;

  const keys = cards.map(cardKey);
  // The hole card keys as itself, so turning it over counts as a card arriving
  // rather than as one silently changing its face.
  if (view.dealer.hidden || withhold) keys.push(`${keys.length}:back`);
  const fresh = newCards(keys, state.shown.dealer);
  state.shown.dealer = keys;

  box.replaceChildren(...cards.map((card, i) => cardNode(card, i, fresh.get(i))));
  if (view.dealer.hidden || withhold) box.appendChild(faceDownNode(fresh.get(cards.length)));
  el('dealer-total').textContent =
    view.dealer.total === null || withhold
      ? ''
      // The word comes from the catalogue, as the player's own total does: the
      // Hebrew sweep found the dealer's reading "23 bust" (round 12).
      : `· ${view.dealer.total}${view.dealer.total > 21 ? ` ${T('ui.bust')}` : ''}`;

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

/*
 * Chips.
 *
 * Real denominations, broken high to low, because a stack of two hundred ones
 * is a bar chart and a stack with a black chip in it is money. The colours are
 * the ones every table uses — white one, red five, green twenty-five, black
 * hundred — so the stack is readable before the number beside it is.
 */
const DENOMINATIONS = [
  { value: 500, name: 'purple' },
  { value: 100, name: 'black' },
  { value: 25, name: 'green' },
  { value: 5, name: 'red' },
  { value: 1, name: 'white' },
];

/*
 * The row has to add up.
 *
 * While the chips were blank the count was decoration and a cap that dropped
 * the last few cost nothing. Now that each one says what it is worth, a player
 * can add the row up — so it must equal the figure beside it, or the rail is
 * quietly lying. The cap is therefore generous enough that no reachable balance
 * is ever truncated, and the row wraps rather than losing a chip.
 */
function chipNodes(amount, cap) {
  const chips = [];
  let left = Math.max(0, Math.round(amount * 2) / 2);
  for (const { value, name } of DENOMINATIONS) {
    let count = Math.floor(left / value);
    left -= count * value;
    while (count-- > 0 && chips.length < cap) chips.push({ name, value });
  }
  // A half unit is what a surrender leaves behind; it is worth showing rather
  // than rounding away, since it is the whole point of the play.
  if (left >= 0.5 && chips.length < cap) chips.push({ name: 'half', value: '½' });

  return chips.map(({ name, value }) => {
    const chip = document.createElement('span');
    chip.className = `chip chip-${name}`;
    // Laid out in a row rather than stacked, so every denomination is legible;
    // a real stack shows only its top face, which is no use for reading a total.
    chip.textContent = value;
    return chip;
  });
}

/** A chip figure: exact, a real minus sign, one piece in Hebrew. */
/**
 * A card as a screen reader hears it, in the language on screen (round 11):
 * "nine of hearts", "9 לב". The session sends the rank and the suit; the words
 * are the page's, like every other word on it.
 */
const SUIT_WORDS = { '♣': 'clubs', '♦': 'diamonds', '♥': 'hearts', '♠': 'spades' };
const cardWords = (card) =>
  T('card.label', { rank: T(`card.rank.${card.rank}`), suit: T(`card.suit.${SUIT_WORDS[card.suit] || 'spades'}`) });

const chipFigure = (value, signed) =>
  window.EVChips ? window.EVChips.figure(value, signed) : String(value);

/**
 * The player's rail: what is in play, and what is behind it.
 *
 * Between hands the spot holds the bet being built, and a tap takes the last
 * chip back. During a hand it holds what is in play, in chips. The stack can be
 * below zero after a hand that needed more than it held; it is drawn like any
 * other figure, because it is one (round 6b).
 */
function renderRail(view) {
  const box = el('rail');
  if (!box) return;
  const stack = view.stack;
  const chips = view.chips;
  box.replaceChildren();

  const between = view.phase !== 'player' && view.phase !== 'insurance';
  const onSpot = between && chips ? chips.bet : stack.wager;
  /*
   * The rail is a betting rail between hands and a readout during one.
   *
   * Between hands the chips are placed here, so it needs the room. Once the
   * cards are out the bet cannot change, and a stacked column of chip art was
   * taking 188px of the felt to say two numbers that were not going to move —
   * which is the height that pushes the reasoning below the fold (round 16).
   */
  box.className = 'rail' + (between ? '' : ' playing');

  const wager = document.createElement('div');
  wager.className = 'rail-spot rail-bet';
  const wagerChips = document.createElement('span');
  wagerChips.className = 'chips';
  wagerChips.setAttribute('aria-hidden', 'true');
  wagerChips.replaceChildren(...chipNodes(onSpot, 12));
  const wagerFigure = document.createElement('span');
  wagerFigure.className = 'rail-value';
  wagerFigure.textContent = onSpot > 0 ? chipFigure(onSpot) : '—';
  const wagerLabel = document.createElement('span');
  wagerLabel.className = 'rail-label';
  wagerLabel.textContent = between && chips ? T('bet.yourBet') : T('ui.wager');
  wager.append(wagerChips, wagerFigure, wagerLabel);
  if (between && chips && window.EVChips) {
    window.EVChips.spot(wager, chips, (op) => send('/api/bet', { op }));
  }

  const bank = document.createElement('div');
  bank.className = 'rail-spot rail-bank';
  const bankChips = document.createElement('span');
  bankChips.className = 'chips';
  bankChips.setAttribute('aria-hidden', 'true');
  bankChips.replaceChildren(...chipNodes(stack.balance, 24));
  const bankFigure = document.createElement('span');
  bankFigure.className = 'rail-value';
  bankFigure.textContent = chipFigure(stack.balance);
  const bankLabel = document.createElement('span');
  bankLabel.className = 'rail-label';
  bankLabel.textContent = T('ui.stack');
  bank.append(bankChips, bankFigure, bankLabel);

  // The swing from the last hand, and only once the grade is out — §3.1 keeps
  // the result behind the decision, and money is the most distracting result
  // there is.
  if (stack.lastNet !== null && stack.lastNet !== undefined && revealComplete()) {
    const delta = document.createElement('span');
    delta.className =
      'rail-delta ' + (stack.lastNet > 0 ? 'win' : stack.lastNet < 0 ? 'loss' : '');
    delta.textContent = chipFigure(stack.lastNet, true);
    bank.appendChild(delta);
  }

  box.append(wager, bank);
  if (chips && window.EVChips) box.appendChild(window.EVChips.limits(chips));
}

function renderHands(view) {
  const box = el('player-hands');
  box.replaceChildren();

  // Each seat keeps its own record, so splitting into a second hand does not
  // make the first one look newly dealt.
  const previous = state.shown.hands;
  state.shown.hands = view.hands.map((hand) => hand.cards.map(cardKey));

  // Two hands after a split need the room of one: the felt says so, and the
  // stylesheet steps the cards down on a narrow phone (round 16).
  box.className = view.hands.length > 1 ? 'split' : '';

  view.hands.forEach((hand, handIndex) => {
    const wrap = document.createElement('div');
    // A long hand says so, so the felt can hold it in the room it has: at 360px
    // a seventh card sat under the dock until the player scrolled (round 15),
    // and a fifth did once the felt was tightened (round 16). Both found by
    // measuring rather than by eye.
    wrap.className = 'hand' + (hand.active ? ' active' : '') + (hand.cards.length >= 5 ? ' long' : '');

    const fresh = newCards(state.shown.hands[handIndex], previous[handIndex] ?? []);
    const cards = document.createElement('div');
    cards.className = 'cards';
    cards.replaceChildren(...hand.cards.map((card, i) => cardNode(card, i, fresh.get(i))));
    wrap.appendChild(cards);

    // Only once there is more than one hand. With a single hand the betting
    // circle below already shows the wager, and saying it twice on the same
    // felt reads as two different bets.
    if (view.hands.length > 1) {
      const wager = document.createElement('div');
      wager.className = 'hand-wager';
      wager.setAttribute('aria-hidden', 'true');
      wager.replaceChildren(...chipNodes(hand.bet, 8));
      wrap.appendChild(wager);
    }

    // The total is the thing the player is actually reading, so it is its own
    // element and sized like it — the notes beside it stay small and quiet.
    const total = document.createElement('div');
    total.className = 'hand-total' + (hand.total > 21 ? ' bust' : '');
    total.textContent = hand.total;
    wrap.appendChild(total);

    const meta = document.createElement('div');
    meta.className = 'hand-meta';
    const bits = [];
    if (hand.total > 21) bits.push(T('ui.bust'));
    if (hand.doubled) bits.push(T('hand.doubled'));
    if (hand.surrendered) bits.push(T('hand.surrendered'));
    // A doubled or split hand says what it carries, in chips.
    if (hand.units !== 1) bits.push(T('hand.chips', { n: chipFigure(hand.bet) }));
    meta.textContent = bits.join(' · ');

    // §3.1: the result is shown, but afterwards and de-emphasised — and never
    // before the grade it might otherwise colour.
    if (hand.net !== null && hand.net !== undefined && revealComplete()) {
      const net = document.createElement('span');
      net.className = 'hand-net ' + (hand.net > 0 ? 'win' : hand.net < 0 ? 'loss' : '');
      net.textContent = `  ${chipFigure(hand.net, true)}`;
      meta.appendChild(net);
    }
    wrap.appendChild(meta);
    box.appendChild(wrap);
  });

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
/**
 * Which of the three steps this level reads, and how many there are.
 *
 * The walkthrough is an argument in order — the dealer's card, then the hand,
 * then the two together and what follows. The last step is the conclusion and
 * stands on its own, so a player who asked for less reads that one; the others
 * read the argument that reaches it. One explanation, not three (round 14).
 */
function revealPlan() {
  const shown = window.EVLevel ? window.EVLevel.steps() : 3;
  return { from: 3 - shown, total: shown };
}

function revealComplete() {
  return !state.reveal || state.reveal.shown >= revealPlan().total;
}

const stepTitles = () => [T('ui.readDealer'), T('ui.readHand'), T('ui.combine')];

/**
 * True once per token — the guard for anything that should happen exactly once
 * when a verdict appears, rather than on every re-render of the same verdict.
 */
function flashOnce(token) {
  if (state.flashed === token) return false;
  state.flashed = token;
  return true;
}

/**
 * The rating points the decision was worth.
 *
 * Shown whether the hand went on to win or lose, and that is the point: a
 * correct play that loses puts a green gain here directly above a red loss on
 * the rail, in one frame. That picture argues §3.1 better than any sentence.
 */
function ratingSide(feedback) {
  const side = document.createElement('span');
  side.className = 'rating-side';
  const delta = feedback.ratingDelta;

  // Off the 311-cell grid there is no cell and nothing to rate. Say so rather
  // than showing nothing, which reads as a bug.
  if (delta === null || delta === undefined) {
    const none = document.createElement('span');
    none.className = 'unrated';
    none.textContent = '—';
    none.title = T('fb.unratedWhy');
    side.appendChild(none);
    return side;
  }

  const points = Math.round(delta);
  const moved = document.createElement('span');
  moved.className = points >= 0 ? 'up' : 'down';
  // U+2212 for the minus, matching the typography everywhere else.
  moved.textContent = T('ui.ratingPoints', { delta: window.EVFigure.units(points, true) });
  moved.title = T('fb.ratingWhy');
  side.appendChild(moved);
  return side;
}

/**
 * How hard the spot was — but only when that is worth saying.
 *
 * Silence on the routine ones is what makes the tag mean anything. It comes
 * free at the top of the board too: hard 20 has no chart cell at all, so the
 * engine already reports nothing for it.
 */
function describeSpotLine(feedback) {
  const spot = feedback.spot;
  if (!spot) return null;
  if (!spot.hard && !spot.aboveYou) return null;

  const line = document.createElement('p');
  line.className = 'spot';

  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = T('fb.spotBand', { band: T(`spot.${spot.band}`) });
  line.appendChild(tag);

  const rarity = document.createElement('span');
  rarity.className = 'spot-note';
  rarity.textContent =
    (feedback.correct ? T('fb.spotHeld', { oneIn: spot.oneIn }) : T('fb.spotRarity', { oneIn: spot.oneIn })) +
    (spot.aboveYou ? ` ${T('fb.spotAboveYou')}` : '');
  line.appendChild(rarity);
  return line;
}

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
  // The affirmation is added at build time on a freshly made node, so the
  // animation starts once and only when the token says this is a new verdict.
  const fresh = done && flashOnce(`${view.stats.decisions}`);
  // Both the sweep and the tone hang off the same gate as everything else on
  // this card. Firing either at click time would tell a player stepping through
  // the reveal whether they were right, two clicks before the card says so.
  if (fresh) playVerdict(feedback.correct);
  const affirm = fresh && feedback.correct;
  box.className =
    (done ? `quickcard ${feedback.severity}` : 'quickcard thinking') + (affirm ? ' affirm' : '');
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
  anchor.appendChild(ratingSide(feedback));
  box.appendChild(anchor);

  const verdict = document.createElement('p');
  verdict.className = 'verdict';
  verdict.textContent = feedback.correct
    ? T('fb.correct', { action: feedback.optimalLabel })
    : T('fb.wrong', {
        severity: severityWord(feedback.severity),
        cost: feedback.evCost.toFixed(3),
      });
  // A run is an observation, not a score, so it stays quiet and only appears
  // once there is actually something to observe.
  const streak = feedback.streak;
  if (streak && streak.current >= 3) {
    const pill = document.createElement('span');
    pill.className = 'streak';
    pill.textContent = T('fb.streak', { n: streak.current });
    pill.title = T('fb.streakCounts');
    verdict.appendChild(pill);
  }
  box.appendChild(verdict);

  // How hard the spot was \u2014 the same line whether it was played right or wrong.
  // Only the last clause differs, which is what stops the tag being a prize.
  const spotLine = describeSpotLine(feedback);
  if (spotLine) box.appendChild(spotLine);

  if (feedback.milestone) {
    const hard = feedback.streak.hard;
    const note = document.createElement('p');
    note.className = 'milestone';
    renderRich(
      note,
      T(
        hard === 0 ? 'fb.milestoneNone' : hard === 1 ? 'fb.milestoneOne' : 'fb.milestone',
        { n: feedback.milestone, hard },
      ),
    );
    box.appendChild(note);
  }

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

  // §7.1 item 3, as round 13 draws it: one row per legal action, longest bar
  // best, on a scale that does not move from hand to hand. The pills this
  // replaces are gone — they showed four minus signs and no distances.
  box.appendChild(
    window.EVReturns.block(feedback, { game: 'bj', decisions: view.stats.decisions, helpId: 'bj-returns-help' }),
  );
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
  const plan = revealPlan();
  for (let i = plan.from; i < 3; i++) {
    const place = i - plan.from;
    const revealed = place < state.reveal.shown;
    const step = document.createElement('div');
    step.className =
      'step' + (revealed ? '' : ' pending') + (place === state.reveal.shown - 1 ? ' latest' : '');
    const n = document.createElement('div');
    n.className = 'step-n';
    n.textContent = String(place + 1);
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
    next.innerHTML = `${T('ui.next')}<span class="key">${T('key.space')}</span>`;
    next.addEventListener('click', () => {
      window.EVCount.bump('next');
      advanceReveal();
    });
    const skip = document.createElement('button');
    skip.className = 'reveal-skip';
    skip.textContent = T('fb.skipAlways');
    skip.title = T('fb.skipAlwaysHint');
    skip.addEventListener('click', () => {
      window.EVCount.bump('skip');
      setShowAllPreferred(true);
      state.reveal.shown = revealPlan().total;
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

  // The count said otherwise, and saying so costs the player nothing.
  if (feedback.counterNote) {
    const note = document.createElement('p');
    note.className = 'sensitivity';
    note.textContent = feedback.counterNote;
    box.appendChild(note);
  }

  // §7.1 item 6: flag answers that flip under another common rule set. Part of
  // how the decision is computed, so it arrives with the reasoning rather than
  // with the basics — and in full, inside the breakdown, at Advanced.
  if (feedback.sensitivity.length > 0 && window.EVLevel.rank() > 0) {
    const note = document.createElement('p');
    note.className = 'sensitivity';
    note.textContent = T('fb.ruleSensitive', {
      // Worded here from untranslated ids (round 7): the Hebrew card used to
      // read "תלוי בחוקים: hit without late surrender".
      list: feedback.sensitivity
        .map((s) => `${T('action.' + s.action).toLowerCase()} ${T('sens.' + s.id)}`)
        .join('; '),
    });
    box.appendChild(note);
  }

  const breakdown = renderBreakdown(feedback);
  if (breakdown) box.appendChild(breakdown);
}

/**
 * The whole spot, for a player who asked to see the numbers (round 14).
 *
 * Everything in here is already computed on every hand at every level; this is
 * the one place it is drawn. Nothing in it is new arithmetic and nothing in it
 * can move a grade — it is the same decision, with its working shown:
 *
 *   - everything the dealer can end up with from this upcard, in full;
 *   - the exact figures, past the three decimals the bars round to;
 *   - how rare the spot is, and what it rates;
 *   - what another rule set would answer (§3.3).
 */
function renderBreakdown(feedback) {
  if (!window.EVLevel.breakdown() || !revealComplete()) return null;
  const box = document.createElement('section');
  box.className = 'breakdown';
  const head = document.createElement('p');
  head.className = 'breakdown-head';
  head.textContent = T('bd.title');
  box.appendChild(head);

  const line = (text) => {
    const p = document.createElement('p');
    renderRich(p, text);
    box.appendChild(p);
  };

  if (feedback.breakdown) {
    const pct = (p) => `${(p * 100).toFixed(1)}%`;
    const list = feedback.breakdown.dealer
      .map((row) => `${row.outcome === 'bust' ? T('bd.breaks') : row.outcome === 'blackjack' ? T('bd.natural') : row.outcome} ${pct(row.p)}`)
      .join(' · ');
    line(T('bd.dealer', { list }));
  }

  // The same figures the bars carry, to a decimal the bars deliberately round
  // away — the card is for reading at a glance, this is for checking.
  line(
    T('bd.exact', {
      list: feedback.ranked
        .map((row) => `${row.label} ${row.value < 0 ? '−' : '+'}${Math.abs(row.value).toFixed(4)}`)
        .join(' · '),
    }),
  );

  if (feedback.spot) {
    line(T('bd.rarity', { oneIn: feedback.spot.oneIn, difficulty: feedback.spot.rating, band: T(`spot.${feedback.spot.band}`) }));
  }

  line(
    feedback.sensitivity.length === 0
      ? T('bd.rulesNone')
      : T('bd.rules', {
          list: feedback.sensitivity
            .map((s) => `${T('action.' + s.action).toLowerCase()} ${T('sens.' + s.id)}`)
            .join('; '),
        }),
  );
  return box;
}

function advanceReveal() {
  if (!state.reveal || revealComplete()) return false;
  state.reveal.shown++;
  if (state.reveal.shown >= revealPlan().total) setShowAllPreferred(false);
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

/**
 * Where each decision button sits, as rows of action names.
 *
 * Idan's rule, for both games and both languages: the "yes" action on the
 * physical left, the "no" action on the physical right. Opening a hand, Hit and
 * Stand share the top row and Double and Surrender the row below, and either of
 * those alone takes the whole row. A pair adds Split as a row of its own. Later
 * in the hand only Hit and Stand are left, so that is one row.
 *
 * Layout only: the rows are built from the legal actions the engine sends and
 * never add, drop or change what is legal.
 */
function blackjackRows(legal) {
  const has = (action) => legal.includes(action);
  const rows = [
    ['hit', 'stand'].filter(has),
    ['double', 'surrender'].filter(has),
    ['split'].filter(has),
  ];
  return rows.filter((row) => row.length > 0);
}

function renderActions(view) {
  const box = el('actions');
  box.replaceChildren();
  box.classList.add('rows');

  /*
   * One row, laid out left to right whatever the page direction. The row has
   * `direction: ltr` in the stylesheet, so a Hebrew page does not mirror it; the
   * text inside each button still reads right to left.
   */
  const row = (buttons) => {
    const line = document.createElement('div');
    line.className = 'action-row';
    line.style.setProperty('--cols', String(buttons.length));
    line.append(...buttons);
    box.appendChild(line);
  };
  const dock = window.EVDock;
  const button = (label, handler, primary, action) => {
    const node = document.createElement('button');
    node.className = 'action' + (primary ? ' primary' : '');
    node.type = 'button';
    node.textContent = label;
    if (action) node.dataset.action = action;
    // A second tap arriving with the one that replaced these buttons is not a
    // new choice; see dock.js.
    node.addEventListener('click', (event) => {
      if (dock && !dock.ready()) return;
      handler(event);
    });
    return node;
  };

  if (view.phase === 'insurance') {
    if (dock) dock.enter('bj:insurance');
    // No decision button is primary: colouring one suggests the answer to a
    // decision the page is about to grade.
    row([
      button(T('action.takeInsurance'), () => sendPlacing('/api/insurance', { take: true }, true), false, 'takeInsurance'),
      button(T('ui.declineInsurance'), () => send('/api/insurance', { take: false }), false, 'declineInsurance'),
    ]);
    return;
  }
  if (view.phase === 'player') {
    if (dock) dock.enter('bj:player');
    for (const actions of blackjackRows(view.legalActions)) {
      row(
        actions.map((action) =>
          button(
            LABELS[action] ? T(LABELS[action]) : action,
            () => sendPlacing('/api/act', { action }, action === 'double' || action === 'split'),
            false,
            action,
          ),
        ),
      );
    }
    return;
  }
  /*
   * The hand is over but its walkthrough is not: the dock finishes that first.
   *
   * A hand that ended on a decision — the insurance answer against a dealer's
   * blackjack, most of all — used to offer Deal at once, with the dealer's card
   * still face down, nothing said about why, and the walkthrough's own Next
   * below the fold on a phone. The one button in reach dealt the next hand, and
   * the one just played was never seen to end (Idan, round 7). Deal and the
   * chips wait until the walkthrough has shown how it ended.
   */
  if (!revealComplete()) {
    if (dock) dock.enter('bj:reveal');
    row([button(T('ui.next'), () => advanceReveal(), true, 'reveal-next')]);
    return;
  }

  // Between hands: the chips, then Deal. Below the table minimum, the rebuy alone.
  const chips = view.chips;
  if (dock) dock.enter(chips && chips.needsRebuy ? 'bj:rebuy' : 'bj:between');
  // While the last hand's card is up: one row, Deal at the same bet and the chips a tap away.
  const compact = Boolean(view.feedback && state.reveal) && !state.betOpen;
  let shown = null;
  if (chips && window.EVChips) {
    shown = window.EVChips.controls(
      box,
      chips,
      (op, chip) => send('/api/bet', { op, chip }),
      () => send('/api/rebuy'),
      () => document.querySelector('#rail .rail-bet .chips'),
      false,
      compact,
    );
    if (shown === 'rebuy') return;
  }
  const deal = button(T('ui.deal'), () => send('/api/deal'), true, 'deal');
  deal.disabled = Boolean(chips && !chips.canDeal);
  if (shown === 'compact') {
    const open = () => {
      state.betOpen = true;
      render();
    };
    row([deal, window.EVChips.toggle(chips, open, false)]);
    return;
  }
  row([deal]);
}

function renderStats(view) {
  const stats = view.stats;
  // Which cells are shown, and how their labels are worded (round 14). Every
  // figure below is computed and saved whatever the level: only the cells a
  // player is shown change, so moving up a level never finds a gap.
  window.EVLevel.applyStrip(el('stats'));
  el('stat-accuracy').textContent =
    stats.decisions === 0 ? '—' : `${(stats.accuracy * 100).toFixed(1)}%`;
  el('stat-evlost').textContent = stats.hands === 0 ? '—' : stats.evLostPer100.toFixed(2);
  el('stat-edge').textContent =
    stats.hands === 0
      ? `${view.ruleSet.edgePercent.toFixed(2)}%`
      : `${stats.effectiveHouseEdgePercent.toFixed(2)}%`;
  // Through the one figure rule (figure.js): results add up in binary, and this
  // cell read +1.4000000000000004 after a 6:5 blackjack (round 8).
  el('stat-units').textContent = window.EVFigure
    ? window.EVFigure.units(stats.netUnits, true)
    : String(stats.netUnits);
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
  // The best run of the session belongs here rather than on the felt: it is a
  // fact to look up, not a number to play towards.
  const best = state.view?.feedback?.streak?.best ?? 0;
  if (best >= 3) parts.push(T('fb.streakBest', { n: best }));
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
  // The edge of the rules themselves is a live figure, not a constant: it moves
  // with the preset, with surrender, and with the split rule. Read from the same
  // place the badge reads it, so the tooltip can never quote a stale number.
  const rulesEdge = state.view?.ruleSet
    ? `${state.view.ruleSet.edgePercent.toFixed(2)}%`
    : '—';
  renderRich(body, T(`info.${which}.body`, { rulesEdge }));
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
    else {
      window.EVCount.bump('statInfo');
      showInfo(button.dataset.info);
    }
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
/**
 * What the dealer says when a hand resolves.
 *
 * A real dealer calls the hand, not the play: what she made, who took it, and
 * whether the bet stays up. She was restating the verdict instead — which the
 * card above the buttons already gives, in more detail — so she sounded like a
 * scoreboard reading itself out rather than someone dealing cards.
 *
 * Nothing here touches whether the decision was right. That separation is the
 * point of §3.1: the grade belongs to the decision and the table talk belongs
 * to the cards, and letting the two speak in one voice is how a player starts
 * hearing "you played well" in a hand that simply won.
 */
/** A dealer natural: two cards to twenty-one, face up because the hand is over. */
function dealerNatural(view) {
  const dealer = view.dealer;
  return !dealer.hidden && dealer.cards.length === 2 && dealer.total === 21;
}

function tableTalk(view) {
  const hands = view.hands;
  const dealer = view.dealer;
  const only = hands.length === 1 ? hands[0] : null;

  if (only && only.surrendered) return T('dealer.surrendered');

  /*
   * The dealer's own natural, named before anything else.
   *
   * It ends the hand where it stands — sometimes before the player has taken a
   * single decision — and from the seat that is indistinguishable from the app
   * having skipped their turn. Idan reported exactly that, on 5♥ K♣ against
   * A♦ K♣. Nothing was skipped; there was nothing left to play. Saying so is
   * the whole fix.
   */
  const playerNatural = Boolean(only && only.cards.length === 2 && only.total === 21);
  if (dealerNatural(view)) {
    return playerNatural ? T('dealer.bothNaturals') : T('dealer.dealerNatural');
  }
  // Two cards to twenty-one, and no split to have made them: a natural. Checked
  // after the dealer's, because when both have one it is a push, not a payout.
  // The payout is a rule, not a constant: 6:5 tables exist and the app offers
  // one, and a dealer who promises 3:2 on a 6:5 table is lying about money.
  if (playerNatural) {
    const short = view.ruleSet && view.ruleSet.blackjackPayout === '6:5';
    return T('dealer.blackjack', { pays: T(short ? 'dealer.pays65' : 'dealer.pays32') });
  }
  if (hands.length > 0 && hands.every((hand) => hand.total > 21)) return T('dealer.youBust');
  /*
   * "And I break. Yours." — but only on a single hand.
   *
   * Across a split it can be false: one hand busts, the other lives, the dealer
   * breaks, and the player is level rather than paid. With one hand it cannot
   * be: the bust case was ruled out above, so a broken dealer always pays.
   */
  if (only && dealer.total !== null && dealer.total > 21) return T('dealer.iBust');

  const net = view.netUnits;
  if (net === 0) return T('dealer.push');
  // Unreachable: settle() reveals the dealer before the phase becomes settled.
  // Kept as a guard, because the lines below name a total and this one cannot.
  if (dealer.total === null) return T(net > 0 ? 'dealer.youWinPlain' : 'dealer.iWinPlain');
  if (net > 0) {
    return only
      ? T('dealer.youWin', { player: only.total, dealer: dealer.total })
      : T('dealer.youWinPlain');
  }
  return only ? T('dealer.iWin', { dealer: dealer.total }) : T('dealer.iWinPlain');
}

/**
 * What the cards did, in one line, below the table (round 14).
 *
 * Idan, watching people play: nobody pressed the dealer's questions and nobody
 * read her bubble, so the avatar, the name, the speech and the two buttons are
 * gone. The one thing that lived only there was the call on the hand itself —
 * most of all on a dealer's blackjack, which ends a hand before the player
 * decides anything and otherwise looks like the app skipping his turn.
 *
 * It says nothing about the decision. That separation is §3.1: the grade
 * belongs to the decision and the table talk belongs to the cards, and a player
 * who hears them in one voice starts reading "you played well" into a hand that
 * merely won.
 */
function renderTalk(view) {
  const line = el('table-talk');
  if (!line) return;
  const spoken = view.phase === 'settled' && (view.feedback || dealerNatural(view));
  // Held behind the same gate as everything else that shows a result: the hand
  // is not called until the reveal is done (§3.1, §3.4).
  if (!spoken || !revealComplete()) {
    line.hidden = true;
    line.textContent = '';
    return;
  }
  line.hidden = false;
  line.textContent = tableTalk(view);
}

/**
 * The chips go where the hand sends them: once a hand, and only once the reveal
 * is complete, like everything else that shows a result (§3.1). The click is the
 * same whichever way they go.
 */
function settleChips(view) {
  if (state.chipsSettled === null) {
    // What was already settled when the page opened has already moved.
    state.chipsSettled = view.stats.hands;
    return;
  }
  if (!window.EVChips || view.phase !== 'settled' || !revealComplete()) return;
  if (state.chipsSettled === view.stats.hands) return;
  state.chipsSettled = view.stats.hands;
  const rail = el('rail');
  window.EVChips.settle(
    view.stack.lastNet ?? 0,
    [rail && rail.querySelector('.rail-bet .chips')],
    rail && rail.querySelector('.rail-bank .chips'),
    el('dealer-cards'),
  );
}

/**
 * The decision track (round 6), drawn by track.js.
 *
 * Held to the rail's gate. While the reveal is still running, the hand being
 * revealed is already in the history, and its dots and its result would give
 * away the grade and the outcome before the card does (§3.1). It joins the
 * track once the reveal is complete.
 */
function renderTrack(view) {
  if (!window.EVTrack) return;
  const rows = view.track || [];
  const withheld = view.phase === 'settled' && !revealComplete();
  window.EVTrack.render(el('bj-track'), withheld ? rows.slice(1) : rows, 'bj');
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
  renderRail(view);
  renderQuickCard(view);
  renderFeedback(view);
  renderActions(view);
  renderStats(view);
  renderTrack(view);
  settleChips(view);
  renderTalk(view);
  if (moreBelow) moreBelow.update();
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
  el('opt-sound').checked = soundEnabled();
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

/*
 * Sound is a preference, not a rule: it must not restart the session, and it
 * must not close the dialog either — someone turning it on wants to hear that
 * it worked, not be thrown back to the felt.
 *
 * The change handler is a click, which is the user gesture browsers require
 * before audio may start, so the context can safely be built right here.
 */
el('opt-sound').addEventListener('change', (event) => {
  setSoundEnabled(event.target.checked);
  if (event.target.checked) playCard(0);
});

/** What a natural pays at this table: the primer quotes the rules in force. */
function blackjackPays() {
  const payout = state.view && state.view.ruleSet ? state.view.ruleSet.blackjackPayout : null;
  return payout === '6:5' ? '6:5' : '3:2';
}

function openHowTo() {
  // The same passage a new player was shown once, where they would look for it.
  window.EVIntro.passage(el('howto-lead'));
  // The game itself, in whatever share this level reads — the same words the
  // first screen taught, from the one source (round 15).
  window.EVIntro.primer(el('howto-primer'), undefined, blackjackPays());
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
  /*
   * A held key must not walk the table.
   *
   * Space steps the reveal, and space deals the next hand. Held down, the
   * auto-repeat ran straight through the end of one reveal and into a fresh
   * deal — and, when the dealer showed an ace, on into the insurance decision,
   * which used to take space as "decline". Three actions from one press, the
   * last of them a bet. Only deliberate presses count.
   */
  if (event.repeat) return;
  // Ctrl+S is the browser saving the page, not a stand.
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  /*
   * Physical keys, not characters.
   *
   * These were matched on `event.key`, the character typed. On a Hebrew layout
   * H types a Hebrew letter and so does S, so none of the shortcuts worked for a
   * player typing in Hebrew, which is most of the people this app is played by.
   * `event.code` names the key on the keyboard whatever the layout puts on it.
   * The keys themselves are unchanged.
   */
  const code = event.code;
  const carryOn = code === 'Space' || code === 'Enter' || code === 'NumpadEnter';

  // Space and Enter step the reasoning while a reveal is open, so the whole
  // thing is reachable without a mouse.
  if (carryOn && !revealComplete()) {
    event.preventDefault();
    advanceReveal();
    return;
  }

  if (view.phase === 'insurance') {
    // Y and N only. Space belongs to the reveal and to the deal, and a key that
    // means "carry on" elsewhere must never resolve a bet here.
    if (carryOn) event.preventDefault();
    if (code === 'KeyY') sendPlacing('/api/insurance', { take: true }, true);
    if (code === 'KeyN') send('/api/insurance', { take: false });
    return;
  }
  if (view.phase === 'player') {
    const action = { KeyH: 'hit', KeyS: 'stand', KeyD: 'double', KeyP: 'split', KeyR: 'surrender' }[code];
    if (action && view.legalActions.includes(action)) {
      sendPlacing('/api/act', { action }, action === 'double' || action === 'split');
    }
    return;
  }
  if (carryOn) {
    event.preventDefault();
    // Deal only with a bet inside the limits and chips to bet; otherwise the rail says what to do.
    // And not in the moment the dock changed: a double press is not a deal.
    if ((!view.chips || view.chips.canDeal) && (!window.EVDock || window.EVDock.ready())) send('/api/deal');
  }
});

/**
 * Keep the pinned strip sitting exactly under the pinned rules bar.
 *
 * The offset cannot be a constant: the rules bar holds two lines of text whose
 * height moves with the language, the font and the length of the rule-set name.
 * Measuring it is three lines and is right in every locale.
 *
 * `ResizeObserver` where it exists, because the bar also changes height when the
 * rule set changes rather than only when the window does.
 */
function pinStrip() {
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

pinStrip();

el('open-settings').addEventListener('click', () => {
  window.EVCount.bump('rules');
  openSettings();
});
el('change-rules').addEventListener('click', openSettings);
el('open-reference').addEventListener('click', () => {
  window.EVCount.bump('chart');
  openReference();
});
el('open-howto').addEventListener('click', () => {
  window.EVCount.bump('howto');
  openHowTo();
});

// After the locale handshake, so the first render is already in the right language.
/**
 * The primer, one tap from the felt, for a player who asked to be taught the
 * game (round 15). Shown only at the level that asks for it, and drawn from the
 * same words as the first screen.
 */
function renderPrimerHere() {
  const box = el('primer-here');
  if (!box) return;
  const wanted = window.EVLevel.primer().length > 2;
  box.hidden = !wanted;
  if (!wanted) return;
  const body = el('primer-here-body');
  if (body.children.length === 0) {
    window.EVIntro.primer(body, undefined, blackjackPays());
    // Closed until he asks for it — stated here rather than left to the markup,
    // so a screen the shell rebuilds cannot come back open.
    body.hidden = true;
  }
}

/** Redraw everything a level decides, without touching what is measured. */
function relevel() {
  window.EVLevel.applyStrip(el('stats'));
  renderPrimerHere();
  if (state.reveal) state.reveal.shown = Math.min(state.reveal.shown, revealPlan().total);
  render();
}

window.addEventListener('ev:level', relevel);

/*
 * The arrow that says there is reasoning below the table (round 14). Its token
 * is the decision count, so it can appear again on the next hand but never
 * twice for the same one.
 */
const moreBelow = window.EVArrow.watch(el('feedback'), {
  token: () => (state.view && state.view.stats ? String(state.view.stats.decisions) : ''),
  label: T('ui.moreBelow'),
});

Promise.resolve(window.EV && window.EV.ready).then(() => {
  // What this app is, and how much it should explain: one screen, in that
  // order, before the first hand this player ever plays (rounds 13 and 14).
  window.EVIntro.firstRun(
    {
      welcome: 'welcome',
      body: 'intro-body',
      passage: 'welcome-passage',
      choices: 'level-choices',
      ask: 'first-screen-ask',
      note: 'first-screen-note',
      primer: 'primer',
      primerBody: 'primer-body',
      start: 'primer-start',
    },
    relevel,
    { pays: blackjackPays() },
  );
  window.EVIntro.settings(el('level-settings'), relevel);
  renderPrimerHere();
  el('primer-open').addEventListener('click', () => {
    const body = el('primer-here-body');
    const open = body.hidden;
    if (open) window.EVCount.bump('primer');
    body.hidden = !open;
    el('primer-open').setAttribute('aria-expanded', String(open));
  });
  return send('/api/state');
});
