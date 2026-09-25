/**
 * Crowns (round 33): a badge on the current run, not a remark.
 *
 * Idan: a crown is dynamic to the player's active run; a mistake takes it away
 * and the run starts again. So these hold a state rather than an event:
 *
 *   - small from 7 right in a row, medium from 14, large from 21 — read off the
 *     run, whatever else happened;
 *   - a mistake ends the run and the crown with it; a close call does neither;
 *   - at the shared table a forfeit ends it, leaving on purpose does not, and an
 *     insurance nobody was asked is not a decision;
 *   - both games, both tables, one run rule;
 *   - it reaches no score, and the ticker never says it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeRng, type UthAction, type UthTable } from '@evtrainer/game-engine';

import { advanceRun, crownFor, isCloseCall } from '../src/gestures.ts';
import { advanceStreak, TrainerSession } from '../src/session.ts';
import { sharedScreen } from '../src/shared-screen.ts';
import { deriveTable, playTable, seatView, wasAsked, type SeatMove, type TableRecord } from '../src/shared-table.ts';
import { UTH_PRESET_ID } from '../src/shared-uth.ts';
import { UthSession } from '../src/uth-session.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (...parts: string[]) => readFileSync(join(HERE, '..', ...parts), 'utf8');

test('the crown is read off the run: small from 7, medium from 14, large from 21, nothing below', () => {
  const expected = (run: number) => (run >= 21 ? 'large' : run >= 14 ? 'medium' : run >= 7 ? 'small' : null);
  for (let run = 0; run <= 40; run++) assert.equal(crownFor(run), expected(run), `a run of ${run}`);
});

test('one run rule: a right decision extends it, a wrong one ends it, a close call does neither', () => {
  assert.equal(advanceRun(6, { correct: true, closeCall: false }), 7);
  assert.equal(advanceRun(20, { correct: false, closeCall: false }), 0);
  assert.equal(advanceRun(13, { correct: false, closeCall: true }), 13);
  assert.equal(advanceRun(13, { correct: true, closeCall: true }), 13);
  // The private Blackjack table's own rule is this one, not a copy of it.
  for (const outcome of [
    { correct: true, closeCall: false },
    { correct: false, closeCall: false },
    { correct: true, closeCall: true },
    { correct: false, closeCall: true },
  ]) {
    assert.equal(advanceStreak(9, outcome), advanceRun(9, outcome));
  }
  assert.equal(isCloseCall({ hit: 0.1, stand: 0.095 }), true);
  assert.equal(isCloseCall({ hit: 0.1, stand: 0.05 }), false);
  assert.equal(isCloseCall({ stand: 0.1 }), false);
});

test('it reaches no score: the rule reads nothing that scores, and nothing saved carries a crown', () => {
  const code = source('src', 'gestures.ts');
  assert.doesNotMatch(code, /^import /m, 'gestures.ts imports something');
  const session = new TrainerSession('vegas-strip-6d-s17', 7);
  session.deal();
  assert.ok(!JSON.stringify(session.progress).includes('crown'), 'a crown was saved into the Blackjack record');
  const uth = new UthSession(7);
  uth.deal();
  assert.ok(!JSON.stringify(uth.progress).includes('crown'), 'a crown was saved into the Ultimate record');
  // And the ticker cannot say it: none of its kinds is a crown.
  assert.doesNotMatch(source('src', 'shared-screen.ts').split('export type TickerItem')[1]!.split(';\n')[0]!, /crown/);
});

// --- The private Blackjack table ---------------------------------------------------------------

test('private Blackjack: the crown follows the run up, and a mistake takes it away quietly', () => {
  const session = new TrainerSession('vegas-strip-6d-s17', 2026);
  const wore = new Set<string>();
  let removed = false;
  for (let hand = 0; hand < 120 && !removed; hand++) {
    session.deal();
    let view = session.view as any;
    if (view.phase === 'insurance') {
      session.insurance(false);
      view = session.view as any;
    }
    let guard = 0;
    while (view.phase === 'player' && guard++ < 10) {
      // The best play, asked of the table the session grades on.
      const evaluation = (session as unknown as { table: { currentEvaluation(): any } }).table.currentEvaluation();
      const best: string = evaluation.optimalAction;
      const legal: string[] = view.legalActions ?? [];
      const before = (session.view as any).crown;
      // Right until a medium crown has been worn; then one real mistake.
      const wrong = wore.has('medium')
        ? legal.find((a: string) => (evaluation.evByAction[best] ?? 0) - (evaluation.evByAction[a] ?? -9) > 0.05)
        : undefined;
      session.act((wrong ?? best) as never);
      view = session.view as any;
      const run = view.feedback.streak.current;
      assert.deepEqual(view.crown, { tier: crownFor(run), run }, 'the crown is not the run\'s');
      if (view.crown.tier) wore.add(view.crown.tier);
      if (wrong && !view.feedback.correct && !view.feedback.closeCall) {
        assert.ok(before.tier, 'there was no crown to lose');
        assert.deepEqual(view.crown, { tier: null, run: 0 }, 'a mistake left the crown on');
        assert.equal(view.feedback.gesture ?? null, null, 'losing the crown was announced');
        removed = true;
        break;
      }
    }
  }
  assert.ok(wore.has('small') && wore.has('medium'), `the crowns worn: ${[...wore]}`);
  assert.ok(removed, 'no mistake was ever made to take the crown away');
});

// --- The private Ultimate table ----------------------------------------------------------------

test('private Ultimate: the same crown on the same run, and a mistake takes it away', () => {
  const session = new UthSession(33);
  const table = (session as unknown as { table: UthTable }).table;
  let wore = false;
  let removed = false;
  for (let hand = 0; hand < 80 && !removed; hand++) {
    session.deal();
    while (table.legalActions().length > 0) {
      const evaluation = table.evaluate();
      const before = (session.view as any).crown;
      const wrong = before.tier
        ? table.legalActions().find((a) => (evaluation.evByAction[evaluation.optimalAction]! - evaluation.evByAction[a]!) > 0.05)
        : undefined;
      session.act((wrong ?? evaluation.optimalAction) as UthAction);
      const view = session.view as any;
      assert.equal(view.crown.tier, crownFor(view.crown.run));
      if (view.crown.tier) wore = true;
      if (wrong) {
        assert.deepEqual(view.crown, { tier: null, run: 0 }, 'a mistake left the Ultimate crown on');
        removed = true;
        break;
      }
    }
  }
  assert.ok(wore, 'no Ultimate crown was ever worn');
  assert.ok(removed, 'no mistake was made to take it away');
});

// --- The shared table --------------------------------------------------------------------------

/** An Ultimate table where each seat plays right, except where `wrongAt` says. */
function playedRight(seats: number, hands: number, wrongAt: (seat: number, hand: number) => boolean): TableRecord {
  const record: TableRecord = {
    id: 'crowns',
    seed: 404,
    presetId: UTH_PRESET_ID,
    restrictions: { noSurrender: false, likeRanksOnly: false },
    seats: Array.from({ length: seats }, (_, seat) => ({
      seat,
      playerId: `p${seat}`,
      name: `P${seat}`,
      bet: 1,
      moves: [] as SeatMove[],
      events: [{ kind: 'join' as const, seat, hand: 0 }],
    })),
  };
  for (let hand = 0; hand < hands; hand++) {
    record.seats.forEach((seat) => (seat.hands = hand + 1));
    for (let guard = 0; guard < 20; guard++) {
      const waiting = seatView(record, null).waitingFor;
      if (waiting.length === 0) break;
      for (const seat of waiting) {
        const { legal, round } = seatView(record, seat);
        const row = record.seats[seat]!;
        let chosen: string | null = null;
        for (const action of legal) {
          row.moves.push({ hand, round, action: action as SeatMove['action'] });
          const decision = deriveTable(record)
            .hands.find((h) => h.hand === hand)!
            .decisions.find((d) => d.seat === seat && d.round === round)!;
          row.moves.pop();
          const right = decision.evCost <= 0 && !isCloseCall(decision.evByAction);
          if (wrongAt(seat, hand) ? decision.evCost > 0.05 : right || decision.evCost <= 0) {
            chosen = action;
            if (wrongAt(seat, hand) || right) break;
          }
        }
        row.moves.push({ hand, round, action: (chosen ?? legal[0]) as SeatMove['action'] });
      }
    }
  }
  return record;
}

/** A seat's run as the rule counts it, over every decision it was asked. */
function runOf(record: TableRecord, seat: number): number {
  let run = 0;
  for (const hand of deriveTable(record).hands) {
    for (const d of hand.decisions) {
      if (d.seat !== seat || !wasAsked(record, seat, d)) continue;
      run = advanceRun(run, { correct: d.evCost <= 0, closeCall: isCloseCall(d.evByAction) });
    }
  }
  return run;
}

test('shared Ultimate: each seat wears its own crown on its own row, and a mistake takes it away', () => {
  const record = playedRight(2, 9, (seat, hand) => seat === 1 && hand === 8);
  const screen = sharedScreen(record, 0);
  const mine = screen.seats.find((s) => s.seat === 0)!;
  const theirs = screen.seats.find((s) => s.seat === 1)!;
  assert.ok(mine.crown.tier, `nine hands played right wore no crown (run ${mine.crown.run})`);
  assert.deepEqual(mine.crown, { tier: crownFor(runOf(record, 0)), run: runOf(record, 0) });
  // The neighbour's crown is his, on his row: he made a mistake on the last hand.
  assert.deepEqual(theirs.crown, { tier: null, run: 0 }, 'the mistake left his crown on');
  // And the ticker says nothing about any of it.
  assert.ok(screen.ticker.every((item) => !JSON.stringify(item).includes('crown')));
});

test('shared: a forfeit ends the run, leaving on purpose does not', () => {
  const base = playedRight(2, 8, () => false);
  const run = sharedScreen(base, 0).seats[0]!.crown.run;
  assert.ok(run >= 7, `the run was only ${run}`);

  const left = JSON.parse(JSON.stringify(base)) as TableRecord;
  left.seats[0]!.events = [...left.seats[0]!.events!, { kind: 'drop', seat: 0, hand: 8, why: 'left' }];
  left.seats.forEach((seat) => (seat.hands = 9));
  assert.equal(sharedScreen(left, 1).seats[0]!.crown.run, run, 'leaving on purpose ended the run');

  const forfeited = JSON.parse(JSON.stringify(base)) as TableRecord;
  forfeited.seats.forEach((seat) => (seat.hands = 9));
  forfeited.seats[1]!.vote = { hand: 8, against: 0, at: 0, needs: 1 };
  assert.deepEqual(sharedScreen(forfeited, 1).seats[0]!.crown, { tier: null, run: 0 }, 'a forfeit left the crown on');
});

test('shared: a neighbour\'s crown cannot say how he played this hand before I have played mine', () => {
  const record = playedRight(2, 8, () => false);
  record.seats.forEach((seat) => (seat.hands = 9));
  const before = sharedScreen(record, 0).seats[1]!.crown;
  // He answers the new hand wrongly; I have not played it yet.
  const { legal, round } = seatView(record, 1);
  record.seats[1]!.moves.push({ hand: 8, round, action: legal[legal.length - 1] as SeatMove['action'] });
  assert.deepEqual(sharedScreen(record, 0).seats[1]!.crown, before, 'his crown changed before I played');
});

test('shared Blackjack: the crown on every seat is the run the rule counts', () => {
  const rng = makeRng(12);
  const record: TableRecord = {
    id: 'bj',
    seed: 31,
    presetId: 'vegas-strip-6d-s17',
    restrictions: { noSurrender: false, likeRanksOnly: false },
    seats: [0, 1].map((seat) => ({
      seat,
      playerId: `p${seat}`,
      name: `P${seat}`,
      bet: 1,
      moves: [] as SeatMove[],
      events: [{ kind: 'join' as const, seat, hand: 0 }],
    })),
  };
  // Mostly standing on what the chart stands on is enough to reach a crown sometimes; the point is agreement.
  playTable(record, 40, ({ legal }) => (legal.includes('stand') && rng.nextInt(4) > 0 ? 'stand' : legal[rng.nextInt(legal.length)]) as SeatMove['action']);
  for (const seat of [0, 1]) {
    const run = runOf(record, seat);
    assert.deepEqual(sharedScreen(record, seat).seats[seat]!.crown, { tier: crownFor(run), run });
  }
});
