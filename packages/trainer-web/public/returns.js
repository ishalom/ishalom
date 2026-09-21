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
   * A count, grouped, and kept in one piece inside right-to-left text.
   *
   * Ultimate's worked lines are built on counts — 990 dealer hands, 1,070,190
   * endings — and an ungrouped seven-digit number is not a number a reader can
   * take in. The isolate is the same treatment every other figure gets in
   * Hebrew: without it the bidirectional algorithm can hand a neighbouring
   * comma or minus to the wrong side.
   */
  const count = (value) => {
    if (typeof value !== 'number') return undefined;
    const text = String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return document.documentElement.getAttribute('dir') === 'rtl' ? `⁦${text}⁩` : text;
  };

  /** A chip figure, by the one figure rule, so the money lines read like the rail. */
  const chips = (value) =>
    window.EVChips ? window.EVChips.figure(value) : String(Math.round(value * 100) / 100);

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

  /**
   * Open unless this player has closed it (round 15).
   *
   * It used to open for a new player's first five decisions and then keep
   * whatever he last did. Idan's correction: open by default, for everyone,
   * until closed — the figures are the product, and a panel that explains them
   * is not an interruption.
   */
  function helpOpen() {
    return readPreference() !== 'closed';
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

    /** A paragraph of the fixed explanation. */
    const say = (key, values) => {
      const p = document.createElement('p');
      rich(p, T(key, values));
      return p;
    };

    /*
     * The fixed part, in one order for both games, and a level reads a prefix
     * of it: what the figure is, then what the two lines mean, then — on
     * Ultimate, whose settlement is three bets against a paytable and does not
     * close into one sum — the anchor and the notes that stand in for the
     * worked lines Blackjack gets.
     */
    const fixed = [['what', 'ret.helpWhat'], ['lines', 'ret.helpLines']];
    if (opts.game === 'uth') {
      /*
       * What the three percentages mean comes third, which is the last slot New
       * reaches (round 27). It is ahead of the anchor and the raise lines on
       * purpose: the percentages are the plainest number in the block and the
       * one a beginner will read first, and two things about them cannot be
       * guessed — a hand the dealer does not qualify for is a win, and a fold is
       * a loss. A percentage a player has to guess the meaning of is worse than
       * no percentage. The anchor line moves down a place and is still read at
       * Intermediate and Advanced.
       */
      fixed.push(['odds', 'ret.helpOdds']);
      fixed.push(['anchor', 'ret.helpFold']);
      if (returns.example && returns.example.kind === 'river') {
        fixed.push(['river', 'ret.helpRiver']);
      } else {
        fixed.push(['raise', 'ret.helpRaise']);
      }
      fixed.push(['stake', 'ret.helpUthStake']);
    }
    const depth = window.EVLevel ? window.EVLevel.helpDepth() : fixed.length;

    const values = (key) =>
      key === 'ret.helpRiver'
        ? {
            win: wholePercent(returns.example.win),
            tie: wholePercent(returns.example.tie),
            value: figure(returns.example.value),
          }
        : undefined;

    for (const [, key] of fixed.slice(0, depth)) box.appendChild(say(key, values(key)));

    /*
     * And the part Idan asked for: every action, in every hand, with its own
     * numbers and an arithmetic that closes on the figure beside it. Shown at
     * every level — a beginner needs the working more than an expert does.
     */
    for (const work of returns.worked || []) {
      const line = workedLine(work, feedback);
      if (line) box.appendChild(line);
    }
    return box;
  }

  /**
   * One action's working: a sentence naming the action and its condition, and
   * the sum on its own line underneath.
   *
   * The sum is never allowed to wrap. A line break through the middle of
   * `2 × 23% = +0.460` is unreadable in either direction and worse in Hebrew,
   * so it sits on its own line, left to right, and scrolls rather than breaks.
   */
  function workedLine(work, feedback) {
    if (!work) return null;
    const row = (feedback.ranked || []).find((entry) => entry.action === work.action);
    if (!row) return null;
    // An action whose only content is its percentages still earns a line: how
    // often a hand wins is worth saying even where no arithmetic can be shown.
    const oddsOnly = work.kind === 'uthOddsOnly';

    /*
     * The terms are printed to as many decimals as the session worked out the
     * sum needs — usually three, sometimes four — and the *same* string is used
     * in the sentence and in the sum. `2 × 26% = +0.526` invites a reader to
     * check it and then fails his check; `2 × 26.3%` does not.
     */
    const digits = work.digits === null || work.digits === undefined ? 3 : work.digits;
    const pct = (value) => {
      if (typeof value !== 'number') return undefined;
      const text = (value * 100).toFixed(Math.max(0, digits - 2));
      // 23.0% is the same number as 23%, and one of them reads like a figure
      // somebody typed by hand. Only a decimal part is trimmed: trimming "20" to
      // "2" would be a different number altogether.
      const trimmed = text.indexOf('.') < 0 ? text : text.replace(/0+$/, '').replace(/\.$/, '');
      return `${trimmed}%`;
    };
    const money = (value) => {
      if (typeof value !== 'number') return undefined;
      const text = Math.abs(value).toFixed(digits);
      const signed = Number(text) === 0 ? `0.${'0'.repeat(digits)}` : `${value < 0 ? '−' : '+'}${text}`;
      return document.documentElement.getAttribute('dir') === 'rtl' ? `⁦${signed}⁩` : signed;
    };
    /** A magnitude: no sign, because the sentence around it carries the sign. */
    const amount = (value) => {
      if (typeof value !== 'number') return undefined;
      const text = Math.abs(value).toFixed(digits);
      return document.documentElement.getAttribute('dir') === 'rtl' ? `⁦${text}⁩` : text;
    };
    const params = {
      action: row.label,
      // The right-hand side is the figure on the bar, written the way the bar
      // writes it.
      value: figure(work.value),
      win: pct(work.win),
      push: pct(work.push),
      bust: pct(work.bust),
      survive: pct(work.survive),
      surviveValue: money(work.surviveValue),
      oneCard: money(work.oneCard),
      perHand: money(work.perHand),
      ten: pct(work.ten),
      // Ultimate's terms (round 19): counts of endings, and what one of them
      // pays. `winPay` and `losePay` are averages over the solve's own sums, so
      // the line is the arithmetic the grade came from.
      wins: count(work.wins),
      ties: count(work.ties),
      losses: count(work.losses),
      outcomes: count(work.outcomes),
      boards: count(work.boards),
      playBoards: count(work.playBoards),
      foldBoards: count(work.foldBoards),
      // What a win pays and what a loss costs are magnitudes: the sum already
      // adds the first and subtracts the second, and "− 246 × +3.000" asks a
      // reader to hold two signs for one quantity.
      winPay: amount(work.winPay),
      losePay: amount(work.losePay),
      playValue: money(work.playValue),
      // Before the flop: the flops that are raised, the flops that are checked
      // again, and what each group is worth (round 20).
      flops: count(work.flops),
      flopRaises: count(work.flopRaises),
      flopChecks: count(work.flopChecks),
      raiseValue: money(work.raiseValue),
      checkValue: money(work.checkValue),
      // How the endings fall (round 27). Whole percentages, already rounded by
      // the session so the three add to exactly 100 — never rounded here, where
      // a second rounding is how two numbers on one card come to disagree.
      oddsWin: typeof work.oddsWin === 'number' ? `${work.oddsWin}%` : undefined,
      oddsTie: typeof work.oddsTie === 'number' ? `${work.oddsTie}%` : undefined,
      oddsLose: typeof work.oddsLose === 'number' ? `${work.oddsLose}%` : undefined,
      // Idan's calculation (round 28): the two chances as percentages, and what
      // each is worth. The shares are fractions here and `pct` prints them the
      // way every other share in this file is printed.
      shareWin: pct(work.shareWin),
      shareLose: pct(work.shareLose),
    };

    const holder = document.createElement('div');
    holder.className = 'worked';
    if (!oddsOnly) {
      const sentence = document.createElement('p');
      sentence.className = 'worked-say';
      rich(sentence, T(`work.${work.kind}`, params));
      holder.appendChild(sentence);
    } else {
      const sentence = document.createElement('p');
      sentence.className = 'worked-say';
      rich(sentence, T('work.oddsOnly', params));
      holder.appendChild(sentence);
    }
    const sum = T(`work.${work.kind}.sum`, params);
    if (sum && sum !== `work.${work.kind}.sum`) {
      const line = document.createElement('p');
      line.className = 'worked-sum';
      line.dir = 'ltr';
      rich(line, sum);
      holder.appendChild(line);
    }
    /*
     * And how the endings fall (round 27). One line, the same shape for every
     * action at every street, under the arithmetic it describes — because it is
     * about the same endings the arithmetic divides by.
     */
    if (params.oddsWin !== undefined) {
      const odds = document.createElement('p');
      odds.className = 'worked-odds';
      /*
       * The tie is dropped below 5% (Idan, round 28), and the line that replaces
       * it says why the two that remain do not reach 100 — a tie gives the bets
       * back, so it changes nothing. Without that sentence two percentages
       * adding to 96 read as an arithmetic mistake.
       */
      rich(odds, T(work.oddsTieHidden ? 'work.oddsNoTie' : 'work.odds', params));
      holder.appendChild(odds);
    }
    return holder;
  }

  /**
   * The same decision in chips (round 19).
   *
   * Idan's observation, and it is the missing half of the card: in Ultimate the
   * unclear part is not the odds, it is how much is on the table. Raising 4x is
   * an Ante, a Blind and four more — six units — and a check is two. So each
   * action states what it puts out now, what is at risk once it has, and what
   * comes back on average, in the chips this hand is being played for.
   *
   * Nothing here is computed in the page: the session sends all three, because
   * a figure worked out beside another figure is how two numbers on one screen
   * come to disagree.
   */
  function moneyTable(feedback) {
    const rows = (feedback.ranked || []).filter((row) => row && row.money);
    if (rows.length === 0) return null;

    const box = document.createElement('section');
    box.className = 'money';
    const title = document.createElement('p');
    title.className = 'money-title';
    title.textContent = T('ret.money.title');
    box.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'money-grid';
    const cell = (text, className, column, row) => {
      const node = document.createElement('span');
      node.className = className;
      node.textContent = text;
      node.style.gridColumn = String(column);
      node.style.gridRow = String(row);
      grid.appendChild(node);
    };
    cell('', 'money-head', 1, 1);
    [T('ret.money.puts'), T('ret.money.risk'), T('ret.money.back')].forEach((head, index) => {
      cell(head, 'money-head', index + 2, 1);
    });
    rows.forEach((row, index) => {
      const line = index + 2;
      cell(row.label, 'money-name' + (row.action === feedback.chosen ? ' chosen' : ''), 1, line);
      cell(chips(row.money.puts), 'money-fig', 2, line);
      cell(chips(row.money.risk), 'money-fig', 3, line);
      cell(chips(row.money.back), 'money-fig money-back', 4, line);
    });
    box.appendChild(grid);

    const note = document.createElement('p');
    note.className = 'money-note';
    rich(note, T('ret.money.note'));
    box.appendChild(note);
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
    // One control, big enough to hit: it opens the explanation and — far more
    // often, now that the panel is open by default — closes it (round 15).
    const why = document.createElement('button');
    why.type = 'button';
    why.className = 'returns-why';
    why.setAttribute('aria-controls', helpId);
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

    const money = moneyTable(feedback);
    if (money) section.appendChild(money);

    /*
     * How big the answer is (round 19, Ultimate's pre-flop figure).
     *
     * A lookup with nothing behind it on screen reads like an opinion. This is
     * the number that makes it a computation: two billion endings for one pair
     * of hole cards, run once because it cannot be run while somebody waits.
     * Advanced only — it belongs with the breakdown, and a beginner is not
     * helped by it.
     */
    if (returns.scale && window.EVLevel && window.EVLevel.breakdown()) {
      const scale = document.createElement('p');
      scale.className = 'ret-scale';
      rich(scale, T('ret.scale', { outcomes: count(returns.scale) }));
      section.appendChild(scale);
    }

    const help = helpPanel(feedback, { ...opts, helpId });
    let open = helpOpen();
    const apply = () => {
      help.hidden = !open;
      why.setAttribute('aria-expanded', String(open));
      why.textContent = open ? '×' : '?';
      why.setAttribute('aria-label', T(open ? 'ret.helpClose' : 'ret.helpAria'));
    };
    apply();
    why.addEventListener('click', () => {
      open = !open;
      writePreference(open ? 'open' : 'closed');
      // Counted: whether people open the explanation, and — now that it opens
      // by default — whether they close it (round 15).
      if (window.EVCount) window.EVCount.bump(open ? 'help' : 'helpShut');
      apply();
    });
    section.appendChild(help);
    return section;
  }

  window.EVReturns = { block, rich, HELP_KEY, NEW_PLAYER_DECISIONS };
})();
