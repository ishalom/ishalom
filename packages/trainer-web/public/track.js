/*
 * The decision track (round 6).
 *
 * The last twelve hands, newest first: one dot for each decision in its grade's
 * colour, a hollow dash for a hand that ended on the deal, and the hand's result
 * at the end of the row — smaller and muted, because the dots are how the hand
 * was played and the figure is only how it ended (§3.1).
 *
 * Shared by both tables. It draws what the session sends and decides nothing.
 * Every row is drawn the same way whatever came before it: nothing marks a run
 * of green, and nothing grows with one (§16).
 *
 * Everything lives on `window.EVTrack`. The pages are classic scripts sharing
 * one global scope, and each already declares its own `T` and `el`.
 */
(function () {
  const T = (key, params) => (window.EV ? window.EV.t(key, params) : key);
  const OPEN_KEY = 'ev:openHand';

  /** A result as the track prints it: +1, −2, +1.5, 0 — the one figure rule (figure.js). */
  function figure(net) {
    return window.EVFigure.units(net, true);
  }

  function label(row) {
    const net = figure(row.net);
    if (row.dots.length === 0) return T('track.rowNone', { net });
    if (row.dots.length === 1) return T('track.rowOne', { net });
    return T('track.row', { n: row.dots.length, net });
  }

  /**
   * Draw the track into `box`.
   *
   * @param rows the session's `track`, newest first
   * @param game 'bj' or 'uth', so a tap opens the right game's log
   */
  function render(box, rows, game) {
    if (!box) return;
    box.replaceChildren();
    const list = rows || [];

    const title = document.createElement('p');
    title.className = 'track-title';
    title.textContent = T('track.title');
    box.appendChild(title);

    // Kept on screen with a note before the first hand, so the felt does not
    // jump down the moment the first hand ends.
    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'track-empty';
      empty.textContent = T('track.empty');
      box.appendChild(empty);
      return;
    }

    const items = document.createElement('div');
    items.className = 'track-rows';
    for (const row of list) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'track-row';
      button.dataset.game = game;
      button.dataset.index = String(row.index);
      button.dataset.handId = String(row.id);
      button.setAttribute('aria-label', label(row));

      const dots = document.createElement('span');
      dots.className = 'track-dots';
      if (row.dots.length === 0) {
        const dash = document.createElement('span');
        dash.className = 'track-dash';
        dots.appendChild(dash);
      }
      for (const tier of row.dots) {
        const dot = document.createElement('span');
        dot.className = `track-dot ${tier}`;
        dots.appendChild(dot);
      }

      const net = document.createElement('span');
      net.className = 'track-net';
      net.textContent = figure(row.net);

      button.append(dots, net);
      button.addEventListener('click', () => open(game, row.index, row.id));
      items.appendChild(button);
    }
    box.appendChild(items);
  }

  /**
   * Open a hand in the log, which lives on the home screen.
   *
   * The request is left where home will find it — in storage, which the local
   * app needs because it is three pages, and on `window`, for a browser with
   * storage switched off. The built page is one document whose screens live in
   * the hash; the local app walks to another page.
   */
  function open(game, index, id) {
    const value = `${game}:${index}:${id}`;
    window.__evOpenHand = value;
    try {
      localStorage.setItem(OPEN_KEY, value);
    } catch {
      // Storage switched off; the value on window still carries it.
    }
    if (typeof HOME_HTML === 'string') location.hash = '#home';
    else location.href = '/home.html';
  }

  /** The hand the track asked for, once: reading it clears it. */
  function takeOpened() {
    let value = window.__evOpenHand || null;
    try {
      value = value || localStorage.getItem(OPEN_KEY);
      localStorage.removeItem(OPEN_KEY);
    } catch {
      // Storage switched off; only the value on window can have been set.
    }
    window.__evOpenHand = null;
    if (!value) return null;
    const [game, index, id] = String(value).split(':');
    if ((game !== 'bj' && game !== 'uth') || !Number.isInteger(Number(index))) return null;
    return { game, index: Number(index), id: Number(id) };
  }

  window.EVTrack = { render, open, takeOpened, figure };
})();
