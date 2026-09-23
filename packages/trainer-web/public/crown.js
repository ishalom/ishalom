/*
 * The crown (round 33): a badge on a player's current run of right decisions.
 *
 * Small from 7 in a row, medium from 14, large from 21 — the same drawing at
 * three sizes, the large one with a stone in it. It sits beside the player's
 * name while the run lasts and is simply not drawn once a mistake ends it:
 * nothing is said when it goes. Nothing about it moves or sounds (§16).
 *
 * One drawing for all three tables, on `window.EVCrown`, so the private
 * Blackjack table, the private Ultimate table and the shared table cannot drift
 * apart. The run itself is worked out by the sessions and the derivation; this
 * file only draws the size it is handed.
 */
(function () {
  const SIZES = { small: 14, medium: 18, large: 23 };
  const NS = 'http://www.w3.org/2000/svg';

  /** A crown for `{ tier, run }`, or null when there is none to wear. */
  function node(crown) {
    if (!crown || !crown.tier || !SIZES[crown.tier]) return null;
    const size = SIZES[crown.tier];
    const wrap = document.createElement('span');
    wrap.className = `crown crown-${crown.tier}`;
    wrap.dataset.crown = crown.tier;
    wrap.setAttribute('role', 'img');
    // Said as the run it stands for, in the words the private card already uses.
    const label = window.EV ? window.EV.t('fb.streak', { n: crown.run }) : String(crown.run);
    wrap.setAttribute('aria-label', label);
    wrap.title = label;

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 18');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(Math.round((size * 18) / 24)));
    svg.setAttribute('aria-hidden', 'true');
    const body = document.createElementNS(NS, 'path');
    // Three points and a band: the shape reads as a crown at 14 px.
    body.setAttribute('d', 'M2 5 L7 10 L12 2 L17 10 L22 5 L20 15 H4 Z');
    body.setAttribute('fill', '#f2c14e');
    body.setAttribute('stroke', '#a87b12');
    body.setAttribute('stroke-width', '1.2');
    body.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(body);
    if (crown.tier === 'large') {
      const stone = document.createElementNS(NS, 'circle');
      stone.setAttribute('cx', '12');
      stone.setAttribute('cy', '12');
      stone.setAttribute('r', '2');
      stone.setAttribute('fill', '#c0392b');
      svg.appendChild(stone);
    }
    wrap.appendChild(svg);
    return wrap;
  }

  /** Put the crown into `slot`, or empty it when the run has none. */
  function show(slot, crown) {
    if (!slot) return;
    const drawn = node(crown);
    slot.replaceChildren(...(drawn ? [drawn] : []));
    slot.hidden = !drawn;
  }

  window.EVCrown = { node, show };
})();
