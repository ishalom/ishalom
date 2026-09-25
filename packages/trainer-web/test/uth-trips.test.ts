/**
 * Trips (round 11; spec A as approved).
 *
 * An optional bet on the player's own seven cards, paid by paytable I
 * (3-4-7-8-30-40-50), stated as a cost and never graded. Held here:
 *
 *   - it touches no grade in any direction: the same hands played with and
 *     without Trips give identical grades, rating movement, stats, track and
 *     hand figures — only the stack differs, by exactly what Trips paid;
 *   - it pays by paytable I on every category, and loses below three of a kind;
 *   - it settles after a fold, as the published rule says;
 *   - the stack arithmetic covers Ante + Blind + 4× + Trips;
 *   - it is empty by default, holds any amount inside the table limits, and
 *     stays for the next hand;
 *   - the cost sentence appears once a sitting; the Stats row adds up;
 *   - it is saved and comes back; a part saved before it opens with nothing on it;
 *   - nothing about it moves or sounds.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyseTrips, parseCards, TRIPS_PAYTABLES } from '@evtrainer/ev-engine/uth';

import { catalogue } from '../src/i18n.ts';
import { UthSession } from '../src/uth-session.ts';
import { loadHosted } from './helpers/hosted-page.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const EN = catalogue('en');
type Action = { action: string };

/** A session with a deep stack, so a long run never needs the rebuy. */
function deep(seed: number): UthSession {
  const session = new UthSession(seed);
  session.restore({ ...session.progress, balance: 100000 });
  return session;
}

function putOnTrips(session: UthSession, chips: number): void {
  for (const chip of [100, 25, 5, 1]) {
    while (chips >= chip) {
      session.placeBet('add', chip, 'trips');
      chips -= chip;
    }
  }
}

/** Play one hand with the given actions, in order, as long as each is legal. */
function playHand(session: UthSession, pick: (legal: string[], step: number) => string): any {
  let view: any = session.deal();
  let step = 0;
  while (view.legalActions.length > 0) {
    view = session.act(pick(view.legalActions.map((a: Action) => a.action), step++) as never);
  }
  return view;
}

const tableOf = (session: UthSession) => (session as any).table;

// --- It touches no grade ------------------------------------------------------------

test('the same hands with and without Trips: identical grades, rating movement, stats, track and hand figures', () => {
  const plain = deep(31415);
  const withTrips = deep(31415);
  putOnTrips(withTrips, 25);
  let paid = 0;

  const policy = (legal: string[], step: number) =>
    legal.includes('check') && step % 3 !== 2 ? 'check' : legal.includes('raise1x') && step % 2 === 0 ? 'raise1x' : legal.includes('fold') ? 'fold' : legal[0]!;

  for (let hand = 0; hand < 60; hand++) {
    let a: any = plain.deal();
    let b: any = withTrips.deal();
    let step = 0;
    while (a.legalActions.length > 0) {
      const action = policy(a.legalActions.map((x: Action) => x.action), step++);
      a = plain.act(action as never);
      b = withTrips.act(action as never);
      assert.deepEqual(b.rating, a.rating, `hand ${hand}: the rating moved differently`);
      // Everything on the card but how long the flop solve took, which is a clock, not a grade.
      const card = (v: any) => v.feedback && { ...v.feedback, solveMs: undefined };
      assert.deepEqual(card(b), card(a), `hand ${hand}: the card graded differently`);
    }
    assert.deepEqual(b.stats, a.stats, `hand ${hand}: the stats differ`);
    assert.deepEqual(b.track, a.track, `hand ${hand}: the track differs`);
    assert.equal(b.stack.lastNet, a.stack.lastNet, `hand ${hand}: the hand's own figure took Trips in`);
    assert.equal(b.settlement.net, a.settlement.net);
    assert.deepEqual(b.settlement.lines.slice(0, a.settlement.lines.length), a.settlement.lines);
    paid += withTrips.progress.history[0]!.trips!.bet * withTrips.progress.history[0]!.trips!.multiple;
  }
  const grades = (s: UthSession) => s.progress.history.flatMap((h) => h.decisions.map((d) => [d.evCost, d.severityTier, d.chosenAction]));
  assert.deepEqual(grades(withTrips), grades(plain));
  assert.equal(
    (withTrips.view as any).stack.balance - (plain.view as any).stack.balance,
    paid,
    'the stacks differ by more than Trips paid',
  );
});

// --- What it pays --------------------------------------------------------------------

const HANDS: Array<[string, string, number]> = [
  ['below three of a kind', 'Js 2d As Ad Kc Qh 9s 4d 3c', -1],
  ['three of a kind', '7s 7d As Ad 7h Kc 2d 9s 4c', 3],
  ['a straight', '8s 9d 2c 2h Td Jc Qh 3s 4d', 4],
  ['a flush', 'Ah 2h Kc Kd 5h 9h Jh 3c 4s', 7],
  ['a full house', 'Ks Kd 2c 3d Kh 9s 9d 4c 6h', 8],
  ['four of a kind', 'Qs Qd 2c 3d Qh Qc 9d 4c 6h', 30],
  ['a straight flush', '9s Ts 2c 3d Js Qs Ks 4c 6h', 40],
  ['a royal flush', 'As Ks 2c 3d Qs Js Ts 4c 6h', 50],
];

test('paytable I on every category, and a loss below three of a kind', () => {
  assert.deepEqual(
    [TRIPS_PAYTABLES[0]!.threeOfAKind, TRIPS_PAYTABLES[0]!.straight, TRIPS_PAYTABLES[0]!.flush, TRIPS_PAYTABLES[0]!.fullHouse,
      TRIPS_PAYTABLES[0]!.fourOfAKind, TRIPS_PAYTABLES[0]!.straightFlush, TRIPS_PAYTABLES[0]!.royalFlush],
    [3, 4, 7, 8, 30, 40, 50],
  );
  for (const [name, cards, multiple] of HANDS) {
    const plain = deep(7);
    const withTrips = deep(7);
    putOnTrips(withTrips, 10);
    tableOf(plain).stackNextHand(parseCards(cards));
    tableOf(withTrips).stackNextHand(parseCards(cards));
    const pick = (legal: string[]) => (legal.includes('check') ? 'check' : 'raise1x');
    const a = playHand(plain, pick);
    const b = playHand(withTrips, pick);
    assert.equal(b.stack.balance - a.stack.balance, 10 * multiple, `${name}: Trips did not pay ${multiple}`);
    assert.equal(withTrips.progress.history[0]!.trips!.multiple, multiple);
    const line = b.settlement.lines.at(multiple > 0 ? -2 : -2);
    assert.ok(b.settlement.lines.some((l: string) => (multiple > 0 ? l.startsWith('Trips pays') : l.startsWith('Trips loses'))), `${name}: no Trips line in ${JSON.stringify(b.settlement.lines)} ${line}`);
  }
});

test('Trips still settles after a fold: three of a kind pays on the player’s own seven cards', () => {
  const plain = deep(9);
  const withTrips = deep(9);
  putOnTrips(withTrips, 10);
  const cards = '7s 2d As Ad 7h 7c Kd 9s 4c';
  tableOf(plain).stackNextHand(parseCards(cards));
  tableOf(withTrips).stackNextHand(parseCards(cards));
  const pick = (legal: string[]) => (legal.includes('check') ? 'check' : 'fold');
  const a = playHand(plain, pick);
  const b = playHand(withTrips, pick);
  assert.equal(b.settlement.net, a.settlement.net);
  assert.match(a.settlement.lines[0], /You folded/);
  assert.equal(b.stack.balance - a.stack.balance, 30, 'a fold forfeited Trips');
  assert.ok(b.settlement.lines.some((l: string) => l.startsWith('Trips pays 3 to 1 on three sevens')), JSON.stringify(b.settlement.lines));
});

test('the stack covers Ante + Blind + 4× + Trips, exactly, from a stack that cannot', () => {
  const session = new UthSession(6);
  session.restore({ ...session.progress, balance: 10, bet: 5, lastBet: 5 });
  putOnTrips(session, 10);
  tableOf(session).stackNextHand(parseCards('Js 2d As Ad Kc Qh 9s 4d 3c'));
  const dealt = session.deal() as any;
  assert.equal(dealt.stack.balance, -10, 'Ante 5 + Blind 5 + Trips 10 from 10');
  assert.equal(dealt.trips.onFelt, 10);
  const view = session.act('raise4x') as any;
  assert.equal(view.stack.balance, -30);
  assert.equal(view.stack.lastNet, -30, 'the hand’s own figure is the play’s');
  assert.deepEqual(view.settlement.lines, [
    'Dealer qualifies with a pair or better — Ante −5',
    'Play 4× loses −20',
    'Blind loses −5',
    'Trips loses −10 — below three of a kind',
    EN['uth.line.tripsCost']!.replace('{edge}', '3.50%'),
  ]);
  assert.equal(view.chips.needsRebuy, true);
});

// --- The bet -----------------------------------------------------------------------------

test('empty by default, any amount inside the limits, and it stays for the next hand', () => {
  const session = deep(3);
  assert.equal((session.view as any).trips.bet, 0);
  putOnTrips(session, 100);
  assert.equal((session.view as any).trips.bet, 100);
  assert.throws(() => session.placeBet('add', 1, 'trips'), /maximum/);
  session.placeBet('clear', undefined, 'trips');
  putOnTrips(session, 15);
  // The Ante is its own: Trips never moved it.
  assert.equal((session.view as any).chips.bet, 1);
  playHand(session, (legal) => (legal.includes('check') ? 'check' : 'fold'));
  assert.equal((session.view as any).trips.bet, 15, 'Trips did not stay for the next hand');
  assert.equal((session.view as any).trips.canRepeat, false, 'Repeat offered for the bet already there');
  session.placeBet('removeLast', undefined, 'trips');
  assert.equal((session.view as any).trips.bet, 10);
});

test('the cost sentence comes once a sitting, on the first Trips hand; the Stats row adds up', () => {
  const session = deep(12);
  putOnTrips(session, 20);
  const cost = EN['uth.line.tripsCost']!.replace('{edge}', '3.50%');
  const first = playHand(session, (legal) => (legal.includes('check') ? 'check' : 'fold'));
  assert.ok(first.settlement.lines.includes(cost), 'no cost sentence on the first Trips hand');
  let net = session.progress.history[0]!.trips!.multiple * 20;
  for (let i = 0; i < 5; i++) {
    const later = playHand(session, (legal) => (legal.includes('check') ? 'check' : 'fold'));
    assert.ok(!later.settlement.lines.includes(cost), 'the cost sentence came back within the sitting');
    net += session.progress.history[0]!.trips!.multiple * 20;
  }
  const stats = (session.view as any).tripsStats;
  assert.equal(stats.hands, 6);
  assert.equal(stats.wagered, 120);
  assert.equal(stats.net, net);
  assert.equal(stats.expectedCost, Math.round(120 * analyseTrips(TRIPS_PAYTABLES[0]!).houseEdgePercent) / 100);
  // A new sitting says it once more.
  const next = new UthSession(13);
  next.restore(session.progress);
  const again = playHand(next, (legal) => (legal.includes('check') ? 'check' : 'fold'));
  assert.ok(again.settlement.lines.includes(cost));
});

test('Trips is saved and comes back; a part saved before it opens with nothing on Trips', () => {
  const session = deep(21);
  putOnTrips(session, 30);
  playHand(session, (legal) => (legal.includes('check') ? 'check' : 'raise1x'));
  const reopened = new UthSession(22);
  reopened.restore(session.progress);
  assert.equal((reopened.view as any).trips.bet, 30);
  assert.deepEqual((reopened.view as any).tripsStats, (session.view as any).tripsStats);

  const old = { ...session.progress } as any;
  delete old.trips;
  const before = new UthSession(23);
  before.restore(old);
  assert.equal((before.view as any).trips.bet, 0);
  assert.equal((before.view as any).tripsStats.hands, 0);
});

test('the settlement reads in Hebrew with its figures kept in one piece', () => {
  const session = deep(5);
  session.setLocale('he');
  putOnTrips(session, 10);
  tableOf(session).stackNextHand(parseCards('Ks Kd 2c 3d Kh 9s 9d 4c 6h'));
  const view = playHand(session, (legal) => (legal.includes('check') ? 'check' : 'raise1x'));
  const line = view.settlement.lines.find((l: string) => l.startsWith('טריפס משלם'));
  assert.ok(line, JSON.stringify(view.settlement.lines));
  assert.match(line, /⁦\+80⁩/);
  assert.deepEqual(line.match(/[A-Za-z]{2,}/g) ?? [], []);
});

// --- Quiet -------------------------------------------------------------------------------

test('nothing about Trips moves or sounds: the settle moves only the Ante, Blind and Play, by the play’s figure', () => {
  const ultimate = readFileSync(join(HERE, '..', 'public', 'ultimate.js'), 'utf8');
  const settle = ultimate.slice(ultimate.indexOf('const settleChips = () =>'), ultimate.indexOf('if (uthState.cardToken === token)'));
  assert.match(settle, /\['ante', 'blind', 'play'\]/);
  assert.match(settle, /view\.stack\.lastNet/);
  assert.doesNotMatch(settle, /trips/i);
  for (const call of ultimate.matchAll(/EVChips\.(?:place|fly|settle|click)\([^;]*/g)) {
    assert.doesNotMatch(call[0], /trips/i, `a chip movement touches Trips: ${call[0]}`);
  }
});

test('on the built page, the circle a chip goes on is the one chosen', async () => {
  const page = loadHosted('#ultimate', [['ev:playerName', 'Dana']]);
  await page.booted;
  let view = await page.api('/api/uth/bet', { op: 'add', chip: 5, spot: 'trips' });
  assert.equal(view.trips.bet, 5);
  assert.equal(view.chips.bet, 1);
  view = await page.api('/api/uth/bet', { op: 'add', chip: 5 });
  assert.equal(view.chips.bet, 6, 'a bet with no circle named went to Trips');
  assert.equal(view.trips.bet, 5);
  page.stopWatching();
});
