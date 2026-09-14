/*
 * Chips (round 6b): the rail a bet is built on, the chips that move, and the
 * one sound they make.
 *
 * Shared by both tables, like the decision track. It draws what the session
 * sends — the bet, the limits, which controls are allowed — and decides none of
 * it: the session is what refuses a bet over the table maximum.
 *
 * Three lines it holds:
 *
 *   - Money never changes the grade. Nothing here reads a verdict, and the
 *     bet only ever reaches the stack.
 *   - Money is silent in spirit (§3.1). Placing, collecting and paying make the
 *     same click, and the click takes no arguments, so nothing about a hand can
 *     reach it: a win and a loss are indistinguishable.
 *   - Nothing presses a longer session (§16). The rebuy is one plain line and
 *     one button: no timer, no offer, no count.
 *
 * Everything lives on `window.EVChips`; the pages share one global scope.
 */
(function () {
  const T = (key, params) => (window.EV ? window.EV.t(key, params) : key);

  /** The colour every table uses for each value, as the rail already draws them. */
  const FACE = { 1: 'white', 5: 'red', 25: 'green', 100: 'black' };

  const rtl = () => document.documentElement.getAttribute('dir') === 'rtl';
  const isolate = (text) => (rtl() ? `⁦${text}⁩` : text);

  /** A chip figure, by the one figure rule (figure.js): short, a real minus, one piece in Hebrew. */
  function figure(value, signed) {
    return window.EVFigure.units(value, signed);
  }

  // --- Sound ---------------------------------------------------------------------

  function soundOn() {
    try {
      return localStorage.getItem('ev:sound') === '1';
    } catch {
      return false;
    }
  }

  /** The table's one audio context, made only once sound is asked for. Shared with app.js. */
  function audio() {
    if (!soundOn()) return null;
    try {
      if (!window.__evAudio) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        const ctx = new Ctx();
        const master = ctx.createGain();
        master.gain.value = 0.25;
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

  /**
   * One chip click. The same for placing a bet, for the dealer collecting it and
   * for the dealer paying — no parameters, so no outcome can make it louder,
   * longer or different.
   */
  function click() {
    const held = audio();
    if (!held) return;
    const { ctx, master } = held;
    const at = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 1900;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.3, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + 0.04);
  }

  // --- Motion ----------------------------------------------------------------------

  function still() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  const centre = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

  /**
   * A chip crossing the felt, from a place on screen to an element.
   *
   * Nothing is created at all when the player has asked for less motion, and the
   * animation itself lives inside the stylesheet's reduced-motion guard as well,
   * so stillness is the default twice over.
   */
  function fly(from, to, value) {
    if (still() || !from || !to || typeof to.getBoundingClientRect !== 'function') return;
    const start = centre(typeof from.getBoundingClientRect === 'function' ? from.getBoundingClientRect() : from);
    const end = centre(to.getBoundingClientRect());
    const chip = document.createElement('span');
    chip.className = `chip chip-${FACE[value] || 'white'} chip-flight`;
    chip.setAttribute('aria-hidden', 'true');
    chip.style.left = `${end.x}px`;
    chip.style.top = `${end.y}px`;
    chip.style.setProperty('--fly-x', `${start.x - end.x}px`);
    chip.style.setProperty('--fly-y', `${start.y - end.y}px`);
    document.body.appendChild(chip);
    const done = () => chip.remove();
    chip.addEventListener('animationend', done);
    setTimeout(done, 450);
  }

  /** A bet placed: one click, one chip to the spot. */
  function place(from, to, value) {
    click();
    fly(from, to, value);
  }

  /**
   * A hand's chips going where the result sends them, after the reveal.
   *
   * The click comes first and unconditionally: collecting and paying sound the
   * same. Only the direction of the chips differs, which is what a table shows.
   */
  function settle(net, spots, bank, dealer) {
    click();
    const from = spots.filter(Boolean);
    if (net > 0) {
      fly(dealer, bank, 25);
      for (const spot of from) fly(spot, bank, 5);
    } else if (net < 0) {
      for (const spot of from) fly(spot, dealer, 5);
    } else {
      for (const spot of from) fly(spot, bank, 5);
    }
  }

  // --- The rail ----------------------------------------------------------------------

  function button(label, action, disabled, handler) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'action bet-control';
    node.dataset.action = action;
    node.disabled = Boolean(disabled);
    if (typeof label === 'string') node.textContent = label;
    else node.append(label);
    // The dock's hold (dock.js): a tap that arrived with the last one is not a bet.
    node.addEventListener('click', (event) => {
      if (window.EVDock && !window.EVDock.ready()) return;
      handler(event);
    });
    return node;
  }

  function row(box, nodes, extra) {
    const line = document.createElement('div');
    line.className = 'action-row' + (extra ? ` ${extra}` : '');
    line.style.setProperty('--cols', String(nodes.length));
    line.append(...nodes);
    box.appendChild(line);
  }

  /**
   * The controls between hands, into the page's action bar.
   *
   * Below the table minimum it is the rebuy and nothing else: one line saying
   * what it is, and one button. Otherwise the four chips, then Clear, Repeat and
   * Double; the page adds Deal under them.
   *
   * @param bet    (op, chip) => Promise, sending one change to the session
   * @param rebuy  () => Promise
   * @param spot   () => the element a placed chip flies to
   * @param compact  true while the last hand's card is still up
   * @returns 'rebuy' when only the rebuy is shown, 'compact' when the chips wait behind `toggle`
   */
  function controls(box, chips, bet, rebuy, spot, busy, compact) {
    if (chips.needsRebuy) {
      const line = document.createElement('p');
      line.className = 'rebuy-line';
      line.textContent = T('rebuy.line', { n: figure(chips.startingChips) });
      box.appendChild(line);
      row(box, [
        button(T('rebuy.button', { n: figure(chips.startingChips) }), 'rebuy', busy, () => rebuy()),
      ]);
      return 'rebuy';
    }

    /*
     * With the last hand's card still up, the bar stays one row: Deal at the same
     * bet, and the chips one tap away. Three rows of chips under the card covered
     * the player's own cards on a phone at showdown — the five the card rings.
     */
    if (compact) return 'compact';

    row(
      box,
      chips.values.map((value, i) => {
        const face = document.createElement('span');
        face.className = `chip chip-${FACE[value] || 'white'}`;
        face.textContent = value;
        const node = button(face, `chip-${value}`, busy || !chips.canAdd[i], async () => {
          const from = node.getBoundingClientRect();
          await bet('add', value);
          place(from, spot(), value);
        });
        node.classList.add('chip-button');
        node.setAttribute('aria-label', T('bet.chip', { value }));
        return node;
      }),
      'bet-chips',
    );
    row(
      box,
      [
        button(T('bet.clear'), 'bet-clear', busy || !chips.canClear, () => bet('clear')),
        button(T('bet.repeat', { bet: figure(chips.lastBet) }), 'bet-repeat', busy || !chips.canRepeat, () => bet('repeat')),
        button(T('bet.double', { bet: figure(chips.lastBet * 2) }), 'bet-double', busy || !chips.canDouble, () => bet('double')),
      ],
      'bet-tools',
    );
    return 'chips';
  }

  /** The bet as it stands, which opens the chips when tapped. */
  function toggle(chips, open, busy) {
    return button(T('bet.change', { bet: figure(chips.bet) }), 'bet-open', busy, () => open());
  }

  /** Make a bet spot on the felt take its last chip back when tapped, between hands. */
  function spot(node, chips, bet) {
    if (!node || !chips || chips.needsRebuy) return;
    node.classList.add('bet-spot');
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-label', T('bet.spot', { bet: figure(chips.bet) }));
    if (!chips.canRemove) {
      node.setAttribute('aria-disabled', 'true');
      return;
    }
    const take = () => bet('removeLast');
    node.addEventListener('click', take);
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        take();
      }
    });
  }

  /** The limits, printed on the felt as a table prints them. */
  function limits(chips) {
    const line = document.createElement('p');
    line.className = 'table-limits';
    line.textContent = T('bet.limits', { range: isolate(`${chips.limits.min}–${chips.limits.max}`) });
    return line;
  }

  window.EVChips = { controls, toggle, spot, limits, place, settle, fly, click, figure, FACE };
})();
