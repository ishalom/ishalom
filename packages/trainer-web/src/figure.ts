/**
 * How a figure is written in the prose the sessions compose (round 8).
 *
 * The same rule as `public/figure.js`, which writes the figures the pages draw:
 * at most two decimals, trailing zeros dropped, a real minus sign, and a plus
 * only when asked for. Results add up in binary — 1.2 − 1 is
 * 0.19999999999999996 — and the arithmetic stays as it is; this is only how a
 * figure is shown. A test holds the two versions to the same output, so a hand
 * reads the same in a settlement line as on the strip, the track and the log.
 *
 * No isolate here: the sessions add their own, in the language on screen.
 */
export function displayFigure(value: number, signed = false): string {
  const rounded = Math.round(value * 100) / 100;
  const sign = rounded < 0 ? '−' : signed && rounded > 0 ? '+' : '';
  return `${sign}${String(Math.abs(rounded))}`;
}
