/*
 * "There is more below" (round 14).
 *
 * This is Idan's own answer to the problem that started the last three rounds:
 * players miss the commentary entirely. They read the grade in the dock, play
 * the next hand, and never scroll to the reasoning that is the whole point of
 * the app.
 *
 * So: an arrow, and only when there is something to say and the player cannot
 * see it. It is a state, not a decoration — driven by whether the commentary
 * has content *and* whether it is already on screen, never by a timer and never
 * by a guess. It goes the moment he reaches the commentary and does not come
 * back for the same hand. It moves twice and stops, because something that
 * never stops moving is nagging, and it honours reduced motion.
 *
 * Where it sits matters: above the dock, out of the bottom third, never over
 * the buttons (§10.1).
 *
 * Shared by both tables; lives on `window.EVArrow`.
 */
(function () {
  /**
   * Watch a commentary section and put an arrow on screen while it has
   * something in it that the player has not seen.
   *
   * @param target the commentary element
   * @param opts   `token()` — what identifies the current content, so the
   *               arrow can come back for the next hand but not for this one
   */
  function watch(target, opts) {
    if (!target) return null;
    const token = (opts && opts.token) || (() => '');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'more-below';
    button.hidden = true;
    button.textContent = '↓';
    button.setAttribute('aria-label', (opts && opts.label) || 'More below');
    button.addEventListener('click', () => {
      if (window.EVCount) window.EVCount.bump('arrow');
      reached = token();
      button.hidden = true;
      if (target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    (document.body || document.documentElement).appendChild(button);

    /** The content the player has already reached; never nagged about twice. */
    let reached = null;

    const hasContent = () =>
      !target.hidden && String(target.textContent || '').trim().length > 0;

    /** On screen, in the part of it the dock is not covering. */
    function visible() {
      if (!target.getBoundingClientRect) return true;
      const box = target.getBoundingClientRect();
      if (box.height === 0) return false;
      const dock = document.querySelector('.dock');
      const floor = window.innerHeight - (dock ? dock.getBoundingClientRect().height : 0);
      // Enough of it to be reading, not one pixel of its top edge.
      return box.top < floor - 24 && box.bottom > 0;
    }

    function update() {
      const here = token();
      if (visible() && hasContent()) reached = here;
      button.hidden = !(hasContent() && !visible() && reached !== here);
      // Above the dock, measured rather than guessed: the dock's height moves
      // with what the card is saying, and a fixed offset that clears it on one
      // hand sits over the figures on the next (§10.1).
      const dock = document.querySelector('.dock');
      if (dock && dock.getBoundingClientRect) {
        button.style.bottom = `${Math.round(dock.getBoundingClientRect().height) + 12}px`;
      }
    }

    // Both of the things it depends on: what the page drew, and where the page
    // is scrolled to.
    if (typeof MutationObserver === 'function') {
      new MutationObserver(update).observe(target, { childList: true, subtree: true, attributes: true });
    }
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
    return { update, button };
  }

  window.EVArrow = { watch };
})();
