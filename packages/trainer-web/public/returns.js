/*
 * What comes back to you: the decision block (round 13).
 *
 * This replaces the four EV pills. Idan's report from play was that
 * `קלף: -0.463 · ויתור: -0.500 · עצירה: -0.540 · הכפלה: -0.933` never showed
 * which moves are close and which are miles apart, and that the negative
 * figures taught nothing. So:
 *
 *   - one row per legal action, longest bar = best move, because the display
 *     should encourage the right play rather than mark the error;
 *   - a fixed scale, 0 to 2.0, the same on every hand — never scaled to the
 *     hand, which is what lets a player see at a glance whether the hand is
 *     winnable at all;
 *   - two lines running the whole height of the block: where the best action
 *     reaches, so the small gap to each bar is what that move costs, and a
 *     dashed one at 1.0, break-even.
 *
 * No legend: the lines carry their own shape, and their exact meaning lives
 * behind the `?`. Nothing here marks an error — the grade above already said it
 * once, and saying it twice is what §3.1 exists to prevent.
 *
 * The figures themselves come from the session, which knows the stake each spot
 * puts at risk. This file draws them and works nothing out. Shared by both
 * tables; lives on `window.EVReturns`.
 */
(function () {
  const T = (key, params) => (window.EV ? window.EV.t(key, params) : key);
  /** How a return is written, from the one rule every figure goes through. */
  const figure = (value) => window.EVFigure.ret(value);

  /**
   * The help copy's own emphasis and figures, marked up the way the reveal's
   * steps are: `**` around the words that carry the point, numbers set in the
   * display face. Engine copy only — nothing a player typed reaches here — and
   * escaped first regardless.
   */
  function rich(target, text) {
    const escaped = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    target.innerHTML = escaped
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/(?<![\w>])([+−-]?\d+(?:[.,]\d+)?%?)(?![\w<])/g, '<span class="num">$1</span>');
  }

  /** Remembered across sessions: whether the explanation stands open. */
  const HELP_KEY = 'ev:returnsHelp';
  /** How many graded decisions count as "a new player's first hands". */
  const NEW_PLAYER_DECISIONS = 5;

  function readPreference() {
    try {
      return localStorage.getItem(HELP_KEY);
    } catch {
      // A browser with storage switched off still gets the explanation; it just
      // cannot be remembered, which is better than the page failing to draw.
      return null;
    }
  }

  function writePreference(value) {
    try {
      localStorage.setItem(HELP_KEY, value);
    } catch {
      /* nothing to do: the choice lasts as long as the page does */
    }
  }

  /** Open by itself for a new player's first hands; after that, as last left. */
  function helpOpen(decisions) {
    const stored = readPreference();
    if (stored === 'open') return true;
    if (stored === 'closed') return false;
    return decisions <= NEW_PLAYER_DECISIONS;
  }

  const percent = (share) => `${(share * 100).toFixed(2)}%`;

  /** A whole percentage, for the worked example the player is meant to redo. */
  const wholePercent = (value) => `${Math.round(value * 100)}%`;

  function lines(returns, rows) {
    const holder = document.createElement('div');
    holder.className = 'ret-lines';
    // Explicit rows, not `1 / -1`: with no explicit grid rows declared that
    // collapses to a single cell and the line stops being continuous.
    holder.style.gridRow = `1 / span ${rows}`;
    const best = document.createElement('i');
    best.className = 'ret-line ret-best';
    best.style.setProperty('--at', percent(share(returns.best, returns.scaleMax)));
    const even = document.createElement('i');
    even.className = 'ret-line ret-even';
    even.style.setProperty('--at', percent(share(1, returns.scaleMax)));
    holder.append(best, even);
    return holder;
  }

  function share(value, scaleMax) {
    return Math.max(0, Math.min(1, value / scaleMax));
  }

  /**
   * The sentence for actions that print the same figure.
   *
   * On 16 against a ten, hitting and standing differ in the fourth decimal.
   * Both used to be given a fourth decimal so no two chips looked equal, which
   * taught the player a difference that is not there. They are equivalent, and
   * the screen now says so.
   */
  function sameNote(groups, labelOf) {
    if (!groups || groups.length === 0) return null;
    const note = document.createElement('p');
    note.className = 'ret-same';
    note.textContent = groups
      .map((group) => {
        const labels = group.map(labelOf);
        return labels.length === 2
          ? T('ret.same2', { a: labels[0], b: labels[1] })
          : T('ret.sameMany', { list: labels.join(', ') });
      })
      .join(' ');
    return note;
  }

  /**
   * The explanation behind the `?`.
   *
   * Surrender — or folding, in Ultimate — is the anchor, because it is the one
   * figure a player can check without trusting anything: half the bet comes
   * back, always, so it is +0.500 and no arithmetic is involved. The worked
   * example uses this hand's own numbers, never a hard-coded one.
   */
  function helpPanel(feedback, opts) {
    const returns = feedback.returns;
    const box = document.createElement('section');
    box.className = 'returns-help';
    box.id = opts.helpId;

    const add = (key, values) => {
      const p = document.createElement('p');
      rich(p, T(key, values));
      box.appendChild(p);
    };

    add('ret.helpWhat');
    add(opts.game === 'uth' ? 'ret.helpFold' : 'ret.helpSurrender');

    const example = returns.example;
    if (example && example.kind === 'bust') {
      add('ret.helpStandBust', { win: wholePercent(example.win), value: figure(example.value) });
    } else if (example && example.kind === 'winPush') {
      add('ret.helpStandPush', {
        win: wholePercent(example.win),
        push: wholePercent(example.push),
        value: figure(example.value),
      });
    } else if (example && example.kind === 'river') {
      add('ret.helpRiver', {
        win: wholePercent(example.win),
        tie: wholePercent(example.tie),
        value: figure(example.value),
      });
    }

    add(opts.game === 'uth' ? 'ret.helpRaise' : 'ret.helpHit');
    add(opts.game === 'uth' ? 'ret.helpUthStake' : 'ret.helpDouble');
    add('ret.helpLines');
    return box;
  }

  /**
   * The whole block, ready to append.
   *
   * @param feedback the graded decision, carrying `ranked` and `returns`
   * @param opts     `game` ('bj' or 'uth'), `decisions` (how many have been
   *                 graded in this session) and an optional `helpId`
   */
  function block(feedback, opts) {
    const returns = feedback.returns;
    const rows = feedback.ranked;
    const section = document.createElement('section');
    section.className = 'returns';
    if (!returns || !rows || rows.length === 0) return section;

    const helpId = opts.helpId || 'returns-help';
    const head = document.createElement('div');
    head.className = 'returns-head';
    const title = document.createElement('span');
    title.className = 'returns-title';
    // The one place the quantity is named, which is what keeps it apart from
    // the chips, the stack and the hand's own figure — those stay net.
    title.textContent = T('ret.title');
    const why = document.createElement('button');
    why.type = 'button';
    why.className = 'returns-why';
    why.textContent = '?';
    why.setAttribute('aria-controls', helpId);
    why.setAttribute('aria-label', T('ret.helpAria'));
    head.append(title, why);
    section.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'returns-grid';
    grid.appendChild(lines(returns, rows.length));

    rows.forEach((row, index) => {
      const name = document.createElement('span');
      name.className = 'ret-name' + (index === 0 ? ' best' : '');
      name.textContent = row.label;

      const track = document.createElement('div');
      track.className = 'ret-track';
      const bar = document.createElement('i');
      // Longest is best: the strongest colour on the best action, stepping down
      // from there. Nothing is coloured for being wrong.
      bar.className = 'ret-bar';
      bar.style.setProperty('--step', String(Math.min(index, 3)));
      bar.style.setProperty('--len', percent(share(row.value, returns.scaleMax)));
      // Doubling and splitting can lose more than the stake, so a figure can be
      // negative: the bar bottoms out and the figure carries the minus.
      if (row.value <= 0) bar.classList.add('none');
      // Ultimate's river can be worth more than the scale holds; the bar says
      // so at its end rather than the scale being redrawn for one hand.
      if (row.value > returns.scaleMax) track.classList.add('over');
      track.appendChild(bar);

      const fig = document.createElement('span');
      fig.className = 'ret-fig' + (index === 0 ? ' best' : '');
      fig.textContent = figure(row.value);

      // Every cell is placed by hand. The lines below span the whole bar column,
      // and an auto-placed grid *skips* cells something else already occupies —
      // which quietly pushed each bar into the next column along.
      [name, track, fig].forEach((node, column) => {
        if (row.action === feedback.chosen) node.classList.add('chosen');
        node.style.gridColumn = String(column + 1);
        node.style.gridRow = String(index + 1);
        grid.appendChild(node);
      });
    });
    section.appendChild(grid);

    const labelOf = (action) => {
      const found = rows.find((row) => row.action === action);
      return found ? found.label : action;
    };
    const note = sameNote(returns.equivalent, labelOf);
    if (note) section.appendChild(note);

    const help = helpPanel(feedback, { ...opts, helpId });
    let open = helpOpen(opts.decisions ?? 0);
    const apply = () => {
      help.hidden = !open;
      why.setAttribute('aria-expanded', String(open));
    };
    apply();
    why.addEventListener('click', () => {
      open = !open;
      writePreference(open ? 'open' : 'closed');
      apply();
    });
    section.appendChild(help);
    return section;
  }

  window.EVReturns = { block, rich, HELP_KEY, NEW_PLAYER_DECISIONS };
})();
