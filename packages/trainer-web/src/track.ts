/**
 * The decision track (round 6): the last hands beside the table.
 *
 * One row per hand, one dot per decision in the grade's tier colour, and the
 * hand's result at the end of the row. Both games' sessions build their rows
 * here, so the two tracks cannot come to mean different things.
 *
 * Data only — tier ids and a figure. The page colours and words it, which is
 * what lets a language change redraw the track without the session.
 */

import { type SeverityTier } from '@evtrainer/ev-engine';

/** How many hands the track shows. */
export const TRACK_HANDS = 12;

/**
 * A dot's colour: the decision's tier, or grey for a close call whatever its
 * grade. A close call is the decision the accuracy figure leaves out in both
 * directions (§9.2), and a green or red dot for one would claim it counted.
 */
export type TrackDot = SeverityTier | 'close';

export interface TrackRow {
  /**
   * Where the hand sits in the session's history, newest first. With `id` it
   * names the hand the log opens: ids start again when a page is reloaded, so
   * an id alone can name two hands in a restored history.
   */
  index: number;
  id: number;
  /** Empty for a hand that ended on the deal; the page draws a hollow dash. */
  dots: TrackDot[];
  /** The hand's result, in units of the bet. */
  net: number;
}

export function trackDot(severity: SeverityTier, closeCall: boolean): TrackDot {
  return closeCall ? 'close' : severity;
}
