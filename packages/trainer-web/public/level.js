/*
 * How much the app explains (round 14).
 *
 * The player says, once, how much explanation he wants, and can change it
 * whenever he likes. Three levels: `new`, `intermediate`, `advanced`.
 *
 * TWO RULES HOLD THIS TOGETHER.
 *
 * 1. A LEVEL IS NOT A DIFFICULTY. The grade, the figures, what a mistake cost,
 *    accuracy, EV lost and the rating are identical at all three, and every one
 *    of them is computed and saved at all three. Nothing here reaches a session:
 *    the engines answer in full whatever the level is, and this file only says
 *    how much of that answer is drawn. A player who moves up a level in a month
 *    finds his whole history waiting, measured the same way.
 *
 * 2. ONE EXPLANATION, THREE DEPTHS. Not three texts — three texts drift apart
 *    and start contradicting each other. Every rule below is a *prefix*: a
 *    beginner is shown the first part of the same explanation an expert reads,
 *    never a different one. `test/level.test.ts` checks that literally, as a
 *    subset, so a well-meant "simpler wording for beginners" fails the build.
 *
 * The level is remembered on the device and saved with the player's record, so
 * it follows him to another phone. Lives on `window.EVLevel`.
 */
(function () {
  const KEY = 'ev:level';
  const LEVELS = ['new', 'intermediate', 'advanced'];
  /**
   * What an unanswered app does. The question is asked before the first hand,
   * so this is only reached by a player who arrived before round 14 — and the
   * middle is what he has been reading until now.
   */
  const DEFAULT = 'intermediate';

  const known = (value) => (LEVELS.indexOf(value) >= 0 ? value : null);

  /** The level as stored, or null when the player has never been asked. */
  function read() {
    try {
      return known(localStorage.getItem(KEY));
    } catch {
      return null;
    }
  }

  /** The level to draw by, answered or not. */
  const get = () => read() ?? DEFAULT;

  function set(level) {
    const value = known(level);
    if (!value) return get();
    try {
      localStorage.setItem(KEY, value);
    } catch {
      // Storage off: the choice lasts as long as the page does, which is worse
      // than remembering it and much better than refusing to take it.
    }
    if (window.EVCount) window.EVCount.bump('level');
    // The strip, the walkthrough and the breakdown all redraw off this.
    try {
      window.dispatchEvent(new CustomEvent('ev:level', { detail: value }));
    } catch {
      /* an environment without CustomEvent still gets the stored value */
    }
    return value;
  }

  const rank = (level) => Math.max(0, LEVELS.indexOf(known(level) ?? get()));

  /**
   * How many of the walkthrough's three steps are drawn.
   *
   * The steps are written as an argument in order — the dealer's card, then the
   * hand, then the two together and what follows from them — so the last one is
   * the conclusion and stands on its own. A beginner reads the conclusion; the
   * other two levels read the argument that reaches it.
   */
  const steps = (level) => (rank(level) === 0 ? 1 : 3);

  /**
   * How many of the explanation's *fixed* paragraphs are drawn, in the order
   * the panel builds them: what the figure is, what the two lines mean, and
   * then — on Ultimate only — the anchor and the two notes that stand in for
   * the worked lines Blackjack has (round 15).
   *
   * The worked lines themselves are outside this count and are shown at every
   * level: a beginner needs the working more than an expert does, and they are
   * this hand's own numbers rather than another paragraph of prose.
   */
  const helpDepth = (level) => [3, 5, 5][rank(level)];

  /** Which cells of the stat strip are shown, in the order the strip has them. */
  const CELLS = ['accuracy', 'evLost', 'edge', 'units'];
  const cells = (level) => [['accuracy', 'units'], ['accuracy', 'evLost', 'units'], CELLS][rank(level)];

  /** The full breakdown of the spot — advanced only, and nowhere else. */
  const breakdown = (level) => rank(level) === 2;

  /**
   * How much of the game itself a level is taught (round 15).
   *
   * Idan played at the beginner setting and found no explanation of how
   * blackjack is played — the order of play, what each action does, when he
   * wins. Three lines under a menu was not it. A player who chose "explain
   * everything" is taught the whole thing; the middle keeps the one line that
   * carries the most, which is the dealer having no choices; a player who asked
   * for the numbers is not told how blackjack works.
   *
   * The list is in reading order, and each level's share is a subset of the one
   * above it — the same rule as everything else the level decides.
   */
  const PRIMER = ['order', 'cards', 'dealerRule', 'hit', 'stand', 'double', 'split', 'surrender', 'insurance', 'win', 'point'];
  const primer = (level) => [PRIMER, ['dealerRule'], []][rank(level)];

  /** The same measure, in words somebody who arrived today already owns. */
  const PLAIN = { accuracy: 'ui.plain.accuracy', evLost: 'ui.plain.evLost', units: 'ui.plain.units' };

  /** The label inside a strip cell, however the page around it is built. */
  function labelOf(node) {
    if (!node || typeof node !== 'object') return null;
    if (String(node.className || '').split(' ').indexOf('stat-label') >= 0) return node;
    for (const child of node.children || []) {
      const found = labelOf(child);
      if (found) return found;
    }
    return null;
  }

  /**
   * The strip, drawn for a level: fewer cells, and a plainer word for each one
   * that stays. The figures behind them are the same figures, still computed
   * and still saved — only the cells a player is shown change.
   */
  function applyStrip(strip, level) {
    if (!strip) return;
    const T = (key) => (window.EV ? window.EV.t(key) : key);
    const at = level ?? get();
    const wanted = cells(at);
    const plain = rank(at) < 2;
    strip.dataset.cells = String(wanted.length);
    for (const button of strip.children || []) {
      const cell = button.dataset ? button.dataset.cell : null;
      if (!cell) continue;
      button.hidden = wanted.indexOf(cell) < 0;
      const label = labelOf(button);
      if (!label || !label.dataset || !label.dataset.i18n) continue;
      const simple = plain ? PLAIN[cell] : null;
      label.textContent = T(simple || label.dataset.i18n);
    }
  }

  window.EVLevel = {
    KEY,
    LEVELS,
    DEFAULT,
    read,
    get,
    set,
    rank,
    steps,
    helpDepth,
    cells,
    breakdown,
    primer,
    PRIMER,
    applyStrip,
  };
})();
