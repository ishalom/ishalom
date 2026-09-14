/*
 * How a figure is written on screen (round 8).
 *
 * Results add up in binary. A 6:5 blackjack pays 1.2, and 1.2 − 1 is
 * 0.19999999999999996 to a computer; Idan's strip read +1.4000000000000004. The
 * arithmetic underneath stays exactly as it is — this is how a figure is shown,
 * nothing more — and every units or chips figure a player reads goes through
 * here, so one hand reads the same on the strip, the track and the log.
 *
 * The rule: at most two decimals, trailing zeros dropped. Every real result is a
 * whole number, a half, or a multiple of 0.1 (a 6:5 natural), and chips are
 * those times a whole bet, so two decimals never drop anything a player won:
 * +1.2 stays +1.2, −0.5 stays −0.5, and the binary remainder goes. A real minus
 * sign, a plus only where the sign is the point, and one left-to-right piece in
 * Hebrew so the sign stays beside its number.
 *
 * Lives on `window.EVFigure`. `src/figure.ts` is the same rule for the prose the
 * sessions compose, and a test holds the two to the same output.
 */
(function () {
  /** The figure a player reads, as a number: at most two decimals. */
  function round(value) {
    return Math.round(value * 100) / 100;
  }

  /** The figure as text, without an isolate: "+1.2", "−0.5", "0", "37.5". */
  function plain(value, signed) {
    const rounded = round(value);
    const sign = rounded < 0 ? '−' : signed && rounded > 0 ? '+' : '';
    return `${sign}${String(Math.abs(rounded))}`;
  }

  /** The figure as it goes on screen: kept in one piece inside right-to-left text. */
  function units(value, signed) {
    const text = plain(value, signed);
    return document.documentElement.getAttribute('dir') === 'rtl' ? `⁦${text}⁩` : text;
  }

  window.EVFigure = { round, plain, units };
})();
