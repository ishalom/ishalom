/*
 * The dock's settle-in hold (round 7).
 *
 * The buttons along the bottom are replaced in place whenever what they offer
 * changes: Take and Decline become Hit and Stand, Stand becomes Deal, Check
 * before the flop becomes Check on it. A quick second tap — a double press, or
 * one tap that registers twice — then lands on the new button under the same
 * finger and plays something the player never chose. Idan hit it on the
 * insurance buttons: the second tap stood the hand, or dealt the next one.
 *
 * So for a moment after the dock starts offering something different, its
 * buttons ignore presses. Long enough to absorb a double press, which lands
 * about 150–250 ms after the first; short enough that nobody reading a new set
 * of buttons before choosing is held up by it. Presses among the same set of
 * buttons are never held, so hitting twice on purpose still hits twice.
 *
 * Shared by both tables. Lives on `window.EVDock`.
 */
(function () {
  const HOLD_MS = 450;
  let mode = null;
  let since = -Infinity;
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  /** Say what the dock offers now. A change starts the hold; the same offer again does not. */
  function enter(next) {
    if (next === mode) return;
    mode = next;
    since = now();
  }

  /** Whether a press on the dock should count yet. */
  function ready() {
    return now() - since >= HOLD_MS;
  }

  window.EVDock = { enter, ready, HOLD_MS };
})();
