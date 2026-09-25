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
  const wallClock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  let now = wallClock;

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

  /**
   * Run the hold on a clock the caller supplies, or back on the wall clock.
   *
   * The hold is a length of time, so a test that waits it out in real time is
   * really testing how busy the machine is: round 11's full run failed one of
   * these once, with a browser probe loading the machine, and passed it alone a
   * moment later. A test that hands in its own clock and moves it deliberately
   * measures the hold itself, which is the thing worth measuring.
   *
   * The page never calls this. Called with nothing, the wall clock comes back.
   */
  function useClock(fn) {
    now = typeof fn === 'function' ? fn : wallClock;
    mode = null;
    since = -Infinity;
  }

  window.EVDock = { enter, ready, useClock, HOLD_MS };
})();
