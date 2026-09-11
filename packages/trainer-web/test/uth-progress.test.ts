/**
 * Ultimate is something you keep (round 4b).
 *
 * Until now the UTH stack and every decision lived for the life of the tab. This
 * file holds the saved record to four things: an old save still opens, with UTH
 * at zero; a new save comes back exactly; a hand left on the felt costs nothing;
 * and none of it can move a Blackjack figure.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCards } from '@evtrainer/ev-engine/uth';
import type { UthTable } from '@evtrainer/game-engine';

import { catalogue, type Locale } from '../src/i18n.ts';
import { TrainerSession } from '../src/session.ts';
import { UthSession, uthPerfectPlayEdgePercent } from '../src/uth-session.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(HERE, 'fixtures', name), 'utf8')) as Record<string, any>;

/** Play Blackjack hands deterministically. */
function playBlackjack(session: TrainerSession, hands: number): void {
  for (let i = 0; i < hands; i++) {
    session.deal();
    let view = session.view as any;
    if (view.phase === 'insurance') {
      session.insurance(false);
      view = session.view as any;
    }
    let guard = 0;
    while (view.phase === 'player' && guard++ < 20) {
      session.act((view.legalActions.includes('double') ? 'double' : 'stand') as never);
      view = session.view as any;
    }
  }
}

/** Play UTH hands down a spread of paths. */
function playUth(session: UthSession, hands: number): void {
  const paths = [['raise4x'], ['check', 'raise2x'], ['check', 'check', 'fold'], ['raise3x'], ['check', 'check', 'raise1x']];
  for (let i = 0; i < hands; i++) {
    session.deal();
    for (const action of paths[i % paths.length]!) {
      const view = session.view as any;
      const legal = view.legalActions.map((a: { action: string }) => a.action);
      if (legal.length === 0) break;
      session.act((legal.includes(action) ? action : legal[0]) as never);
    }
    let view = session.view as any;
    while (view.legalActions.length > 0) view = session.act(view.legalActions[0].action as never);
  }
}

// --- Old saves ----------------------------------------------------------------

test('a real version 2 save opens: Blackjack exactly as it was, UTH at zero', () => {
  const v2 = fixture('progress-v2.json');
  assert.equal(v2.version, 2, 'the fixture is not a version 2 save');
  assert.equal(v2.uth, undefined, 'a version 2 save has no UTH part');

  const blackjack = new TrainerSession('vegas-strip-6d-s17', 1);
  blackjack.restore(v2 as never);
  const stats = blackjack.stats;
  assert.equal(stats.hands, v2.hands);
  assert.equal(stats.decisions, v2.decisions);
  assert.equal((blackjack.view as any).rating.rating, v2.ratings.basic.rating);
  assert.equal(blackjack.progress.lifetimeDecisions, v2.lifetimeDecisions);

  const uth = new UthSession(1);
  uth.restore(v2.uth);
  assert.equal((uth.view as any).stack.balance, 200);
  assert.equal(uth.stats.hands, 0);
  assert.equal(uth.stats.decisions, 0);
  assert.equal((uth.view as any).history.length, 0);
});

test('a version 1 save still opens, and UTH starts at zero there too', () => {
  const v1 = fixture('progress-v1.json');
  const blackjack = new TrainerSession('vegas-strip-6d-s17', 1);
  blackjack.restore(v1 as never);
  assert.equal(blackjack.stats.hands, v1.hands);
  const uth = new UthSession(1);
  uth.restore((v1 as any).uth);
  assert.equal((uth.view as any).stack.balance, 200);
});

test('a save is now version 3', () => {
  assert.equal(new TrainerSession('vegas-strip-6d-s17', 1).progress.version, 3);
});

// --- New saves ------------------------------------------------------------------

test('close the tab and reopen: the UTH stack, stats and log come back exactly', () => {
  const blackjack = new TrainerSession('vegas-strip-6d-s17', 7);
  const uth = new UthSession(7);
  playBlackjack(blackjack, 12);
  playUth(uth, 23);

  // What the browser and the player's row hold: one record, through JSON.
  const record = JSON.parse(JSON.stringify({ ...blackjack.progress, uth: uth.progress }));
  assert.equal(record.version, 3);

  const reopenedBlackjack = new TrainerSession('vegas-strip-6d-s17', 99);
  const reopenedUth = new UthSession(99);
  reopenedBlackjack.restore(record);
  reopenedUth.restore(record.uth);

  const before = uth.view as any;
  const after = reopenedUth.view as any;
  assert.equal(after.stack.balance, before.stack.balance);
  assert.deepEqual(reopenedUth.stats, uth.stats);
  assert.equal(after.history.length, before.history.length);
  assert.deepEqual(after.history, before.history, 'the log reads differently after a reopen');
  assert.deepEqual(reopenedBlackjack.stats, blackjack.stats);
});

test('a hand left on the felt when the tab closes costs nothing', () => {
  const uth = new UthSession(3);
  playUth(uth, 5);
  const between = uth.progress;

  uth.deal();
  uth.act('check');                         // pre-flop, graded, flop on the table
  const mid = uth.progress;
  assert.equal(mid.balance, between.balance, 'the Ante and Blind of an unfinished hand were saved as lost');
  assert.equal(mid.decisions, between.decisions, 'a decision in an unfinished hand was saved');
  assert.equal(mid.lifetimeDecisions, between.lifetimeDecisions);
  assert.equal(mid.evLost, between.evLost);
  assert.deepEqual(mid.bySeverity, between.bySeverity);
  assert.equal(mid.history.length, between.history.length);

  uth.act('raise2x');                       // a raise on the table as well
  // Settled now, so it counts.
  assert.equal(uth.progress.decisions, between.decisions + 2);
});

test('the log keeps the last 40 hands, like Blackjack', () => {
  const uth = new UthSession(11);
  playUth(uth, 45);
  assert.equal(uth.progress.history.length, 40);
  assert.equal((uth.view as any).history.length, 40);
  assert.equal(uth.stats.hands, 45, 'the counters must not be capped with the log');
});

test('a save that is not a UTH record, or is half-written, opens at zero rather than failing', () => {
  for (const junk of [null, undefined, 7, 'x', {}, { version: 2 }, { version: 1, balance: 'lots' }]) {
    const uth = new UthSession(1);
    assert.doesNotThrow(() => uth.restore(junk));
    assert.equal((uth.view as any).stack.balance, 200, `balance after ${JSON.stringify(junk)}`);
  }
});

test('restoring during a hand is refused, not half-applied', () => {
  const uth = new UthSession(1);
  uth.deal();
  assert.throws(() => uth.restore({ version: 1, balance: 500 }), /between hands/);
});

// --- The strip's maths ------------------------------------------------------------

test('the perfect-play edge comes from the solved table: 2.185% of the Ante', () => {
  assert.equal(uthPerfectPlayEdgePercent().toFixed(3), '2.185');
});

test('the UTH strip uses Blackjack’s arithmetic', () => {
  const uth = new UthSession(21);
  playUth(uth, 60);
  const s = uth.stats;
  const p = uth.progress;
  assert.ok(s.decisions > 60);
  assert.equal(s.evLostPer100, (p.evLost / p.hands) * 100);
  assert.ok(Math.abs(s.effectiveHouseEdgePercent - (uthPerfectPlayEdgePercent() + s.evLostPer100)) < 1e-9);
  // Close calls leave the denominator, as they do in Blackjack.
  const graded = p.decisions - p.closeCalls;
  assert.equal(s.accuracy, graded === 0 ? 1 : (p.correct - p.closeCallsCorrect) / graded);
  assert.equal(s.accuracyIncludingCloseCalls, p.correct / p.decisions);
  assert.equal(s.closeCallsExcluded, p.closeCalls);
});

// --- The hand log -----------------------------------------------------------------

test('the log has one header per decision and the result after them, in both languages', () => {
  for (const locale of ['en', 'he'] as Locale[]) {
    const uth = new UthSession(5);
    uth.setLocale(locale);
    const table = (uth as unknown as { table: UthTable }).table;
    table.stackNextHand(parseCards('7s 2d As Ad Qs Jh 3d 8c 5s'));
    uth.deal();
    uth.act('check');
    uth.act('check');
    uth.act('fold');
    const hand = (uth.view as any).history[0];
    assert.equal(hand.decisions.length, 3, `${locale}: not one block per decision`);
    for (const decision of hand.decisions) {
      assert.ok(decision.header.includes('→'), `${locale}: a header names no best play: ${decision.header}`);
      assert.ok(decision.sentence.length > 10);
    }
    assert.equal(hand.lines.length, 3, `${locale}: the result is not three lines`);
    assert.ok(hand.netLine.includes('2'), `${locale}: ${hand.netLine}`);
    // The row describes the hand, not one decision in it.
    assert.ok(!hand.decisions.some((d: { header: string }) => hand.summary === d.header));
  }
});

test('nothing in the Hebrew UTH log or How to play is English', () => {
  const uth = new UthSession(8);
  uth.setLocale('he');
  playUth(uth, 10);
  const view = uth.view as any;
  const shown = [
    ...view.howTo,
    ...view.history.flatMap((h: any) => [h.summary, ...h.lines, h.netLine, ...h.decisions.flatMap((d: any) => [d.header, d.sentence])]),
  ].join(' ');
  const words = shown.replace(/\b[2-9TJQKA]{2}[so]?\b/g, '').match(/[A-Za-z]{2,}/g) ?? [];
  // The hint keys (C, F, N) are single letters and pass; any word does not.
  assert.deepEqual([...new Set(words)], [], `English in the Hebrew UTH log: ${words.join(', ')}`);
});

// --- Trips ------------------------------------------------------------------------

test('How to play says Trips is not offered, and costs 3.50% under the default table', () => {
  for (const locale of ['en', 'he'] as Locale[]) {
    const uth = new UthSession(1);
    uth.setLocale(locale);
    const trips = (uth.view as any).howTo.find((line: string) => line.includes('3.50%'));
    assert.ok(trips, `${locale}: no Trips line with 3.50%`);
    assert.ok(catalogue(locale)['uth.howto.trips'], `${locale} has no Trips line`);
  }
});

// --- Blackjack stays out of it ------------------------------------------------------

test('saving and restoring UTH never moves a Blackjack figure', () => {
  const blackjack = new TrainerSession('vegas-strip-6d-s17', 13);
  playBlackjack(blackjack, 15);
  const alone = JSON.stringify(blackjack.progress);

  const uth = new UthSession(13);
  playUth(uth, 30);
  const record = JSON.parse(JSON.stringify({ ...blackjack.progress, uth: uth.progress }));

  const reopened = new TrainerSession('vegas-strip-6d-s17', 14);
  reopened.restore(record);
  assert.equal(JSON.stringify(reopened.progress), alone, 'the UTH part changed the Blackjack record');
});
