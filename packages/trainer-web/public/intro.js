/*
 * The first screen: what this app is, and how much it should explain.
 *
 * Round 13 put one passage before a player's first hand ever — this is not a
 * blackjack game, you will lose hands playing perfectly. Round 14 adds the
 * question that has to follow it: how much explanation do you want? A player
 * has to know what the app is before he can say how much of it he wants
 * explained, so the two are one screen, in that order, and it takes over the
 * table rather than floating over it.
 *
 * The question is about what he wants to see, never about how good he is.
 * Nobody's pride is involved in choosing how much explanation they want, and a
 * casino player asked "how good are you?" picks "advanced" and then misses the
 * very thing this app exists to show him.
 *
 * The passage is shown once, ever. The question is asked once and is then in
 * the rule panel for good. Shared by both tables; lives on `window.EVIntro`.
 */
(function () {
  const SEEN_KEY = 'ev:introSeen';
  const T = (key, params) => (window.EV ? window.EV.t(key, params) : key);

  function seen() {
    try {
      return localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      // Storage off: it cannot be remembered, and showing it every visit would
      // be worse than not showing it at all.
      return true;
    }
  }

  function markSeen() {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* nothing to do */
    }
  }

  /** Write the passage into a node, in the language on screen. */
  function passage(node) {
    if (node) window.EVReturns.rich(node, T('intro.body'));
  }

  /** The three choices, built from the one list the rest of the app reads. */
  function choices(into, onPick, current) {
    if (!into) return;
    into.replaceChildren();
    for (const level of window.EVLevel.LEVELS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'level-choice' + (level === current ? ' current' : '');
      button.dataset.level = level;
      const title = document.createElement('span');
      title.className = 'level-title';
      title.textContent = T(`level.${level}.title`);
      const body = document.createElement('span');
      body.className = 'level-body';
      body.textContent = T(`level.${level}.body`);
      button.append(title, body);
      button.addEventListener('click', () => onPick(level));
      into.appendChild(button);
    }
  }

  /**
   * The game itself, written out for whoever asked to be taught it (round 15).
   *
   * Headings only where a heading is earned: the order of play, what each
   * choice does, when you win, and what this is. Whatever level asks for it
   * reads the same words — a level takes fewer of them, never different ones.
   *
   * @param into  where to draw it
   * @param level whose share to draw; defaults to the level in force
   * @param pays  what a blackjack pays at this table, so the one figure in it
   *              is this table's own rather than a guess
   */
  function primer(into, level, pays) {
    if (!into) return 0;
    into.replaceChildren();
    const items = window.EVLevel.primer(level ?? window.EVLevel.get());
    const HEADS = { order: 'prime.headOrder', hit: 'prime.headActions', win: 'prime.headWin', point: 'prime.headPoint' };
    for (const item of items) {
      // A heading belongs to the item that opens its section, and only when
      // that item is actually being shown.
      if (HEADS[item]) {
        const head = document.createElement('h3');
        head.className = 'primer-head';
        head.textContent = T(HEADS[item]);
        into.appendChild(head);
      }
      const line = document.createElement('p');
      line.className = 'primer-line';
      rich(line, T(`prime.${item}`, { pays: pays || '3:2' }));
      into.appendChild(line);
    }
    return items.length;
  }

  /** Everything else on the screen, hidden while the question stands. */
  function siblings(node) {
    const parent = node && node.parentElement;
    return parent ? [...(parent.children || [])].filter((child) => child !== node) : [];
  }

  /**
   * Show the first screen if there is anything on it to say.
   *
   * @returns whether it took over the screen
   */
  function firstRun(ids, onDone, opts) {
    const welcome = document.getElementById(ids.welcome);
    if (!welcome) return false;
    passage(document.getElementById(ids.body));

    const asked = window.EVLevel.read() !== null;
    const told = seen();
    if (asked && told) {
      // Nothing left to say. Said explicitly rather than left to the markup, so
      // that a screen rebuilt by the shell cannot come back holding the
      // question a player answered months ago.
      welcome.hidden = true;
      return false;
    }

    // A player who has read the passage before is only asked the question.
    const passageBlock = document.getElementById(ids.passage);
    if (passageBlock) passageBlock.hidden = told;

    /*
     * Put the table away — with `display`, not with `hidden`.
     *
     * The rules bar, the strip and the felt are all laid out by the stylesheet
     * with a `display` of their own, and any such rule beats the `[hidden]`
     * default. Setting the attribute left the question sitting on top of a
     * fully drawn table, which is exactly the modal-over-a-felt this screen
     * exists not to be.
     */
    const hidden = siblings(welcome).filter((node) => !node.hidden);
    for (const node of hidden) {
      node.hidden = true;
      if (node.style) node.style.display = 'none';
    }
    welcome.hidden = false;

    const finish = (level) => {
      welcome.hidden = true;
      for (const node of hidden) {
        node.hidden = false;
        if (node.style) node.style.display = '';
      }
      if (onDone) onDone(level);
    };

    choices(document.getElementById(ids.choices), (level) => {
      window.EVLevel.set(level);
      markSeen();
      /*
       * A player who chose "explain everything" has just *asked* to be taught
       * the game. Sending him to find it behind a menu is the opposite of an
       * answer, so it is on the next screen, and the table waits.
       */
      const teach = document.getElementById(ids.primer);
      if (teach && window.EVLevel.primer(level).length > 2) {
        const question = document.getElementById(ids.ask);
        const choiceBox = document.getElementById(ids.choices);
        for (const node of [question, choiceBox, document.getElementById(ids.note), document.getElementById(ids.passage)]) {
          if (node) node.hidden = true;
        }
        primer(document.getElementById(ids.primerBody), level, opts && opts.pays);
        teach.hidden = false;
        const start = document.getElementById(ids.start);
        if (start) start.addEventListener('click', () => finish(level), { once: true });
        return;
      }
      finish(level);
    });
    return true;
  }

  /**
   * The same three choices inside the rule panel, so the answer can be changed
   * at any time — which is the difference between a question and a verdict.
   */
  function settings(into, onPick) {
    const draw = () => {
      choices(
        into,
        (level) => {
          window.EVLevel.set(level);
          draw();
          if (onPick) onPick(level);
        },
        window.EVLevel.get(),
      );
    };
    draw();
  }

  window.EVIntro = { firstRun, settings, passage, primer, SEEN_KEY };
})();
