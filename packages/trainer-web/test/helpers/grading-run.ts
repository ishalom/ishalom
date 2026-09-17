/**
 * A fixed run of hands, graded — the record round 13 must not move.
 *
 * Round 13 changes what a figure on screen *means* (net of the stake becomes
 * what comes back per unit staked) and nothing else. That claim is only worth
 * anything if it can be checked, so this replays the same hands, with the same
 * deliberately mixed decisions, and records everything the change must leave
 * alone: the grade, what the mistake cost, the rating movement, the track and
 * the hand log. The stored EVs are in it too, because they stay net.
 *
 * Deterministic in every part: the shoe comes from a fixed seed, and the
 * decisions come from a small generator of our own rather than Math.random.
 */

import { TrainerSession } from '../../src/session.ts';
import { UthSession } from '../../src/uth-session.ts';

/** A 32-bit generator, so the run is the same on every machine and every day. */
function decisions(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export interface GradedRun {
  decisions: Array<Record<string, unknown>>;
  track: Array<{ dots: string[]; net: number }>;
  log: number[];
  rating: { rating: number; peak: number; ratedDecisions: number };
  stats: { hands: number; decisions: number; correct: number; evLost: number; netUnits: number };
}

/**
 * Play `hands` hands, choosing among the legal actions with the generator so
 * that both right and wrong decisions — and close calls — are in the record.
 */
export function gradedRun(hands = 60, seed = 20260917): GradedRun {
  const session = new TrainerSession('vegas-strip-6d-s17', seed);
  const roll = decisions(seed);
  const decisionRows: Array<Record<string, unknown>> = [];

  for (let hand = 0; hand < hands; hand++) {
    session.deal();
    let view = session.view as any;
    if (view.phase === 'insurance') {
      session.insurance(roll() < 0.5);
      record(view);
      view = session.view as any;
    }
    let guard = 0;
    while (view.phase === 'player' && guard++ < 24) {
      const legal = view.legalActions as string[];
      if (legal.length === 0) break;
      session.act(legal[Math.floor(roll() * legal.length)] as never);
      record(session.view as any);
      view = session.view as any;
    }
  }

  function record(view: any): void {
    const feedback = view.feedback;
    if (!feedback) return;
    decisionRows.push({
      headline: feedback.headline,
      chosen: feedback.chosen,
      optimal: feedback.optimal,
      correct: feedback.correct,
      severity: feedback.severity,
      closeCall: feedback.closeCall,
      evCost: feedback.evCost,
      ratingDelta: feedback.ratingDelta,
      // The stored EVs stay net, in units of the wager — the whole point.
      ranked: feedback.ranked.map((entry: any) => [entry.action, entry.ev]),
      steps: feedback.steps,
    });
  }

  const view = session.view as any;
  const stats = session.stats;
  return {
    decisions: decisionRows,
    track: view.track.map((row: any) => ({ dots: row.dots, net: row.net })),
    log: session.hands_.map((h) => h.netUnits),
    rating: {
      rating: view.rating.rating,
      peak: view.rating.peak,
      ratedDecisions: view.rating.ratedDecisions,
    },
    stats: {
      hands: stats.hands,
      decisions: stats.decisions,
      correct: stats.correct,
      evLost: stats.evLost,
      netUnits: stats.netUnits,
    },
  };
}

export interface UthGradedRun {
  decisions: Array<Record<string, unknown>>;
  log: number[];
  rating: { rating: number; peak: number; ratedDecisions: number };
  stats: Record<string, number>;
}

/** The same idea for Ultimate, whose card gets the same treatment. */
export function gradedUthRun(hands = 40, seed = 20260917): UthGradedRun {
  const session = new UthSession(seed);
  const roll = decisions(seed);
  const rows: Array<Record<string, unknown>> = [];

  for (let hand = 0; hand < hands; hand++) {
    session.deal();
    let view = session.view as any;
    let guard = 0;
    while ((view.legalActions ?? []).length > 0 && guard++ < 6) {
      const legal = (view.legalActions as Array<{ action: string }>).map((a) => a.action);
      session.act(legal[Math.floor(roll() * legal.length)] as never);
      view = session.view as any;
      const feedback = view.feedback;
      if (feedback) {
        rows.push({
          headline: feedback.headline,
          verdict: feedback.verdict,
          chosen: feedback.chosen,
          correct: feedback.correct,
          severity: feedback.severity,
          evCost: feedback.evCost,
          ranked: feedback.ranked.map((entry: any) => [entry.action, entry.ev]),
        });
      }
    }
  }

  const view = session.view as any;
  const stats: Record<string, number> = {};
  for (const [key, value] of Object.entries(session.stats)) {
    if (typeof value === 'number') stats[key] = value;
  }
  return {
    decisions: rows,
    log: (session as any).history.map((hand: any) => hand.net ?? hand.netUnits ?? 0),
    rating: {
      rating: view.rating.rating,
      peak: view.rating.peak,
      ratedDecisions: view.rating.ratedDecisions,
    },
    stats,
  };
}
