/*
 * What this app is, said once (round 13).
 *
 * Idan picked exactly one of the ten ideas on the table: before the very first
 * hand a player ever plays, one short passage saying what they are looking at.
 * Players arrive expecting a blackjack game, play on autopilot, and read a
 * grade on a hand they won as a mistake in the app rather than in the play.
 *
 * One passage, once, ever — not a tutorial and not a screen of bullets. It is
 * the same words at the head of "How to play", so a player who waved it away
 * can find it again in the one place they would look.
 *
 * Shared by both tables; lives on `window.EVIntro`.
 */
(function () {
  const SEEN_KEY = 'ev:introSeen';
  const T = (key, params) => (window.EV ? window.EV.t(key, params) : key);

  function seen() {
    try {
      return localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      // Storage switched off: it cannot be remembered, and showing it on every
      // visit would be worse than not showing it at all.
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

  /**
   * Show it if it has never been shown. Returns whether it opened, which is
   * what the tests read.
   */
  function showOnce(dialogId, bodyId) {
    const dialog = document.getElementById(dialogId);
    if (!dialog) return false;
    passage(document.getElementById(bodyId));
    if (seen()) return false;
    markSeen();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    return true;
  }

  window.EVIntro = { showOnce, passage, SEEN_KEY };
})();
