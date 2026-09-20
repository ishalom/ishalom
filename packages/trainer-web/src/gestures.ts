/**
 * The gestures (round 20; spec B as approved).
 *
 * Idan asked for something from the app when a player improves — "like giving
 * chips". Chips are the currency of the *outcome*, and paying a decision in them
 * would break the three figures that are supposed to tell the truth, so what the
 * app gives instead is evidence: **"you did X" beats "well done"**, because it is
 * true, it cannot be argued with, and every one of these was already computed.
 *
 * THE TEST EVERY GESTURE PASSES. If it could only fire on a won hand it rewards
 * luck and does not belong. Three of the four below fire when a decision is
 * graded, before a single card of the outcome is turned; the fourth fires only on
 * a hand that **lost**, which is the inverse of the same test and the reason it is
 * allowed to sit at settlement where nothing else may.
 *
 * WHAT THIS FILE MAY DO, AND WHAT IT MAY NOT. It reads a snapshot and returns a
 * gesture or nothing. It imports nothing that can grade, rate, rank or record —
 * no session, no chart, no rating — so a gesture cannot reach a score even by
 * accident, and a test proves that by what this file can see. The one piece of
 * state the feature keeps is the streak's record, and the session owns it.
 *
 * RARITY IS PART OF THE DESIGN, NOT A SETTING. A gesture that fires every hand is
 * wallpaper within a quarter of an hour: at most one a hand, two a sitting, in the
 * fixed order below, and the fiftieth looks exactly like the first.
 */

/** When a cell of the mastery grid lights: attempts, of which correct, ending in a run. */
export const MASTERY = { attempts: 5, correct: 4, lastTwo: 2 } as const;

/** A run this long on one spot, with mistakes behind it, is worth saying out loud. */
export const IMPROVED_RUN = 5;
/** And only when the player really did used to get it wrong. */
export const IMPROVED_MISTAKES = 2;
/** Below this, "a new personal best" is a sentence about nothing. */
export const RECORD_FLOOR = 5;
/** What one sitting may show. */
export const PER_SITTING = 2;

/** What the grid knows about one spot. Exactly `ScenarioStat`, minus what is not needed. */
export interface SpotRecord {
  attempts: number;
  correct: number;
  consecutiveCorrect: number;
  /** What was played when it was wrong, by action. */
  confusion: Record<string, number>;
}

/**
 * Whether a spot counts as mastered: five played, four of them right, and the
 * last two right.
 *
 * The three conditions answer three different objections. Five attempts stop a
 * cell lighting on one lucky guess; four correct allow an old mistake without
 * keeping a cell dark for ever; the run means the player can do it *now*, which
 * is the thing the grid claims.
 */
export function mastered(stat: SpotRecord | null | undefined): boolean {
  if (!stat) return false;
  return (
    stat.attempts >= MASTERY.attempts &&
    stat.correct >= MASTERY.correct &&
    stat.consecutiveCorrect >= MASTERY.lastTwo
  );
}

/** Met, mastered, or never seen — what a cell of the grid draws. */
export function masteryState(stat: SpotRecord | null | undefined): 'none' | 'met' | 'mastered' {
  if (!stat || stat.attempts === 0) return 'none';
  return mastered(stat) ? 'mastered' : 'met';
}

export interface GestureSnapshot {
  /** The decision just graded. */
  correct: boolean;
  /** Its spot's record, as it stands *after* the decision. */
  stat: SpotRecord | null;
  /** The live run, the record it is measured against, and whether it was announced. */
  streak: { current: number; record: number; announcedThisRun: boolean };
  /** What this sitting has already shown, and whether this hand has had one. */
  shown: { sitting: number; thisHand: boolean };
}

export type Gesture =
  | { kind: 'improved'; run: number; wrongs: number; played: string | null; playedCount: number }
  | { kind: 'record'; streak: number; previous: number }
  | { kind: 'rightAndLost'; decisions: number };

/**
 * The gesture a graded decision has earned, or nothing — which is the usual
 * answer and is meant to be.
 */
export function gestureForDecision(snapshot: GestureSnapshot): Gesture | null {
  if (snapshot.shown.thisHand || snapshot.shown.sitting >= PER_SITTING) return null;
  if (!snapshot.correct) return null;

  const improved = improvedGesture(snapshot.stat);
  if (improved) return improved;

  const streak = snapshot.streak;
  if (
    !streak.announcedThisRun &&
    streak.record >= RECORD_FLOOR &&
    streak.current > streak.record
  ) {
    return { kind: 'record', streak: streak.current, previous: streak.record };
  }
  return null;
}

/**
 * "You used to get this wrong."
 *
 * The strongest of them and the one nothing else does: improvement shown on the
 * spot where it happened, out of the player's own history of that spot, and
 * unreachable by luck. It fires the moment the run *reaches* five, so it says its
 * piece once and then goes quiet however long the run goes on.
 */
function improvedGesture(stat: SpotRecord | null): Gesture | null {
  if (!stat) return null;
  const wrongs = stat.attempts - stat.correct;
  if (stat.consecutiveCorrect !== IMPROVED_RUN || wrongs < IMPROVED_MISTAKES) return null;
  // What he used to play instead: the mistake he made most often on this spot.
  let played: string | null = null;
  let playedCount = 0;
  for (const [action, count] of Object.entries(stat.confusion)) {
    if (count > playedCount) {
      played = action;
      playedCount = count;
    }
  }
  return { kind: 'improved', run: stat.consecutiveCorrect, wrongs, played, playedCount };
}

/**
 * A hand played perfectly and lost — the one Cowork wanted most, and the only
 * one that reads the outcome.
 *
 * It is allowed to because of what it says: a hand that *won* can never produce
 * it, so it cannot reward luck in either direction. It arrives at the moment the
 * player feels worst and says the thing the whole app is for.
 */
export function gestureForSettlement(input: {
  net: number;
  decisions: number;
  allOptimal: boolean;
  shown: { sitting: number; thisHand: boolean; rightAndLostThisSitting: boolean };
}): Gesture | null {
  if (input.shown.thisHand || input.shown.sitting >= PER_SITTING) return null;
  if (input.shown.rightAndLostThisSitting) return null;
  if (!(input.net < 0) || input.decisions === 0 || !input.allOptimal) return null;
  return { kind: 'rightAndLost', decisions: input.decisions };
}

/**
 * The sentence at the end of a sitting: what was played, what it cost, and the
 * one spot that cost the most.
 *
 * A reward and a lesson in one line, and the lesson is the half that lasts. The
 * leak is the spot with the largest total cost among those played wrong more than
 * once — one mistake is not a leak, it is a mistake.
 */
export function sittingSummary(input: {
  decisions: number;
  mistakes: number;
  spots: Array<{ scenarioKey: string; attempts: number; correct: number; evCostTotal: number }>;
}): { decisions: number; mistakes: number; leak: string | null; leakCount: number } | null {
  if (input.decisions < 10) return null;
  let leak: string | null = null;
  let leakCost = 0;
  let leakCount = 0;
  for (const spot of input.spots) {
    const wrongs = spot.attempts - spot.correct;
    if (wrongs < 2 || spot.evCostTotal <= leakCost) continue;
    leak = spot.scenarioKey;
    leakCost = spot.evCostTotal;
    leakCount = wrongs;
  }
  return { decisions: input.decisions, mistakes: input.mistakes, leak, leakCount };
}
