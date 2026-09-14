/**
 * Chip betting (round 6b). Named for the betting; `chips.test.ts` is the EV chips.
 *
 * The line that must not move comes first: a mistake costs the same rating, the
 * same EV and the same accuracy at a bet of 100 as at a bet of 1. Then the rest
 * of what a player sees:
 *   - a bet built from chips, inside the table limits;
 *   - a bet that stays until the player changes it;
 *   - a hand that needs more than the stack still plays (Idan's option B), and
 *     the stack shows the exact figure;
 *   - one free rebuy, and nothing counting it;
 *   - the track and the log in chips at the bet each hand was played at;
 *   - the stack and the bet surviving a tab close and reaching a second device;
 *   - one click for chips moving, the same for a win and a loss, and no motion
 *     for a player who asked for less.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCards } from '@evtrainer/ev-engine/uth';
import type { UthTable } from '@evtrainer/game-engine';

import {
  CHIP_VALUES,
  STARTING_CHIPS,
  TABLE_LIMITS,
  applyBet,
  chipsFor,
  newChipBook,
  readChipBook,
  rebuyBook,
} from '../src/chips.ts';
import { catalogue } from '../src/i18n.ts';
import { TrainerSession } from '../src/session.ts';
import { UthSession } from '../src/uth-session.ts';
import { loadHosted, type HostedPage } from './helpers/hosted-page.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');
const SRC = join(HERE, '..', 'src');
const source = (file: string) => readFileSync(join(PUBLIC, file), 'utf8');

const bet = (session: TrainerSession | UthSession, value: number) => {
  session.placeBet('clear');
  for (const chip of chipsFor(value)) session.placeBet('add', chip);
};

function finishBlackjack(session: TrainerSession, choose: (view: any) => string = () => 'stand') {
  let view = session.view as any;
  while (view.phase === 'insurance' || view.phase === 'player') {
    if (view.phase === 'insurance') session.insurance(false);
    else {
      const wanted = choose(view);
      session.act((view.legalActions.includes(wanted) ? wanted : view.legalActions[0]) as never);
    }
    view = session.view;
  }
  return view;
}

function finishUth(session: UthSession, choose: (legal: string[]) => string) {
  let view = session.view as any;
  while (view.legalActions.length > 0) {
    const legal = view.legalActions.map((a: { action: string }) => a.action);
    view = session.act(choose(legal) as never);
  }
  return view;
}

// --- Building a bet ---------------------------------------------------------------------

test('a bet is built from 1, 5, 25 and 100, inside the table limits', () => {
  assert.deepEqual([...CHIP_VALUES], [1, 5, 25, 100]);
  assert.deepEqual({ ...TABLE_LIMITS }, { min: 1, max: 100 });

  let book = applyBet(newChipBook(), 'clear');
  assert.equal(book.bet, 0);
  for (const chip of [25, 25, 25, 5, 5, 5, 5, 1, 1, 1, 1, 1]) book = applyBet(book, 'add', chip);
  assert.equal(book.bet, 100);
  assert.throws(() => applyBet(book, 'add', 1), /maximum is 100/, 'the maximum was not enforced');
  assert.throws(() => applyBet(book, 'add', 50), /No such chip/);

  // A tap on the spot takes back the last chip placed, one at a time.
  book = applyBet(book, 'removeLast');
  assert.equal(book.bet, 99);
  book = applyBet(applyBet(book, 'removeLast'), 'removeLast');
  assert.equal(book.bet, 97);
  assert.throws(() => applyBet(applyBet(book, 'clear'), 'removeLast'), /no chip/);

  // Repeat and Double read the last bet dealt; Double stops at the limit.
  const dealtAt = { ...newChipBook(), bet: 0, lastBet: 30, placed: [] };
  assert.equal(applyBet(dealtAt, 'repeat').bet, 30);
  assert.equal(applyBet(dealtAt, 'double').bet, 60);
  assert.throws(() => applyBet({ ...dealtAt, lastBet: 60 }, 'double'), /maximum is 100/);
  assert.deepEqual(chipsFor(137), [100, 25, 5, 5, 1, 1]);
});

test('the bet stays for the next hand, and changes only when the player changes it', () => {
  const session = new TrainerSession('vegas-strip-6d-s17', 3);
  bet(session, 25);
  for (let i = 0; i < 4; i++) {
    session.deal();
    finishBlackjack(session);
    const chips = (session.view as any).chips;
    assert.equal(chips.bet, 25, `the bet moved by itself after hand ${i + 1}`);
    assert.equal(chips.lastBet, 25);
  }
  session.placeBet('clear');
  session.placeBet('repeat');
  assert.equal((session.view as any).chips.bet, 25);
  session.placeBet('double');
  assert.equal((session.view as any).chips.bet, 50);

  // Nothing about the bet can change during a hand.
  session.deal();
  const view = session.view as any;
  if (view.phase === 'player' || view.phase === 'insurance') {
    assert.throws(() => session.placeBet('add', 5), /until the hand is over/);
    assert.equal(view.chips.canDeal, false);
  }
});

test('no deal without a bet inside the limits, and the rebuy is only for a stack below the minimum', () => {
  const session = new TrainerSession('vegas-strip-6d-s17', 4);
  session.placeBet('clear');
  assert.equal((session.view as any).chips.canDeal, false);
  assert.throws(() => session.deal(), /between 1 and 100/);

  assert.throws(() => session.rebuy(), /below the table minimum/, 'a rebuy was handed out on a full stack');
  session.restore({ ...session.progress, chips: { stack: 0.5, bet: 10, lastBet: 10, limits: { min: 1, max: 100 } } });
  const low = (session.view as any).chips;
  assert.equal(low.needsRebuy, true);
  assert.equal(low.canDeal, false);
  assert.throws(() => session.deal(), /free rebuy/);
  session.rebuy();
  const after = (session.view as any).chips;
  assert.equal(after.stack, STARTING_CHIPS);
  assert.equal(after.bet, 10, 'the rebuy changed the bet');
  assert.equal(rebuyBook({ ...newChipBook(), stack: -65 }).stack, 200);
});

// --- Option B: a hand that needs more than the stack still plays ------------------------------------

test('Blackjack, worst case: four split hands doubled plus insurance, from a stack that cannot cover it', () => {
  const session = new TrainerSession('vegas-strip-6d-s17', 5);
  session.restore({ ...session.progress, chips: { stack: 20, bet: 10, lastBet: 10, limits: { min: 1, max: 100 } } });
  // You 8-8 against an ace with a nine under it: split three times, double all four.
  (session as any).table.shoe.stack(parseCards('8s As 8d 9c 8h 8c 3d 5h 3s 5d 3h 5c 3c 5s'));
  session.deal();
  assert.equal((session.view as any).phase, 'insurance');
  session.insurance(true);
  for (let i = 0; i < 3; i++) session.act('split');
  assert.equal((session.view as any).hands.length, 4, 'the hand did not split to four');
  for (let i = 0; i < 4; i++) session.act('double');

  const view = session.view as any;
  assert.equal(view.phase, 'settled', 'the hand did not play out');
  assert.equal(view.history[0].netUnits, -8.5);
  // 4 × 2 units + half a unit of insurance, at 10 chips a unit, from 20 chips.
  assert.equal(view.stack.balance, -65, 'the stack is not the exact figure');
  assert.equal(view.stack.lastNet, -85);
  assert.equal(view.track[0].net, -85);
  assert.equal(view.chips.needsRebuy, true);
});

test('Ultimate, worst case: Ante + Blind + 4× from a stack that cannot cover it', () => {
  const session = new UthSession(6);
  session.restore({ ...session.progress, balance: 10, bet: 5, lastBet: 5 });
  // J-2 against a pair of aces on K-Q-9-4-3: the dealer qualifies and wins.
  (session as unknown as { table: UthTable }).table.stackNextHand(parseCards('Js 2d As Ad Kc Qh 9s 4d 3c'));
  const dealt = session.deal() as any;
  // An Ante of 5 makes the Blind 5, and the stack is already at zero.
  assert.deepEqual(dealt.stake, { ante: 5, blind: 5, play: 0, total: 10 });
  assert.equal(dealt.stack.balance, 0);

  const view = session.act('raise4x') as any;
  assert.equal(view.stake.play, 20, 'the pre-flop 4× on an Ante of 5 is not 20');
  assert.equal(view.phase, 'settled');
  assert.equal(view.stack.balance, -20, 'the stack is not the exact figure');
  assert.equal(view.stack.lastNet, -30);
  assert.deepEqual(view.settlement.lines, [
    'Dealer qualifies with a pair or better — Ante −5',
    'Play 4× loses −20',
    'Blind loses −5',
  ]);
  assert.equal(view.settlement.net, 'Hand −30 chips');
  assert.equal(view.chips.needsRebuy, true);
});

// --- The line that must not move ----------------------------------------------------------------------

test('Blackjack: the same mistakes at a bet of 100 and a bet of 1 cost the same rating, EV and accuracy', () => {
  const one = new TrainerSession('vegas-strip-6d-s17', 77);
  const hundred = new TrainerSession('vegas-strip-6d-s17', 77);
  bet(hundred, 100);
  const deltas: Array<[unknown, unknown]> = [];
  let stackMoves = 0;

  for (let hand = 0; hand < 40; hand++) {
    if ((hundred.view as any).chips.needsRebuy) hundred.rebuy();
    const before = (hundred.view as any).stack.balance;
    one.deal();
    hundred.deal();
    // Hit whenever hitting is legal, stand otherwise: plenty of mistakes.
    for (const session of [one, hundred]) {
      let view = session.view as any;
      while (view.phase === 'insurance' || view.phase === 'player') {
        if (view.phase === 'insurance') session.insurance(true);
        else session.act((view.legalActions.includes('hit') && view.hands.length === 1 && view.hands[0].total < 17 ? 'hit' : 'stand') as never);
        view = session.view;
        if (session === hundred) deltas[deltas.length - 1]![1] = view.rating.lastDelta;
        else deltas.push([view.rating.lastDelta, null]);
      }
    }
    const units = (one.view as any).history[0].netUnits;
    assert.equal((hundred.view as any).stack.balance, before + units * 100, `hand ${hand + 1}: the stack moved by the wrong amount`);
    stackMoves++;
  }

  assert.ok(stackMoves === 40);
  assert.deepEqual(one.stats, hundred.stats, 'the stats differ between a bet of 1 and a bet of 100');
  assert.deepEqual(one.progress.ratings, hundred.progress.ratings, 'the rating differs');
  assert.deepEqual(one.progress.bySeverity, hundred.progress.bySeverity);
  assert.equal(one.progress.evLost, hundred.progress.evLost);
  assert.ok(one.stats.decisions > 40 && one.stats.correct < one.stats.decisions, 'the run made no mistakes to compare');
});

test('Ultimate: the same mistakes at an Ante of 100 and an Ante of 1 cost the same EV and accuracy', () => {
  const one = new UthSession(88);
  const hundred = new UthSession(88);
  bet(hundred, 100);
  // Raise 3× every hand: never the best play, so every hand carries a mistake.
  for (let hand = 0; hand < 25; hand++) {
    if ((hundred.view as any).chips.needsRebuy) hundred.rebuy();
    one.deal();
    hundred.deal();
    finishUth(one, (legal) => (legal.includes('raise3x') ? 'raise3x' : legal[0]!));
    finishUth(hundred, (legal) => (legal.includes('raise3x') ? 'raise3x' : legal[0]!));
  }
  assert.deepEqual(one.stats, hundred.stats);
  assert.equal(one.progress.evLost, hundred.progress.evLost);
  assert.ok(one.stats.evLost > 0);
});

// --- Chips in the track and the log ---------------------------------------------------------------------

test('the track and the log are in chips at the bet each hand was played at', () => {
  const blackjack = new TrainerSession('vegas-strip-6d-s17', 9);
  bet(blackjack, 25);
  (blackjack as any).table.shoe.stack(parseCards('As 9d Kh 7c'));
  blackjack.deal();
  bet(blackjack, 5); // A later change must not rewrite a finished hand.
  const view = blackjack.view as any;
  assert.equal(view.history[0].bet, 25);
  assert.equal(view.track[0].net, 37.5, 'a natural at 25 pays 37.5 chips');

  const uth = new UthSession(9);
  bet(uth, 5);
  (uth as unknown as { table: UthTable }).table.stackNextHand(parseCards('Js 2d As Ad Kc Qh 9s 4d 3c'));
  uth.deal();
  uth.act('raise4x');
  bet(uth, 1);
  const played = uth.view as any;
  assert.equal(played.track[0].net, -30);
  assert.equal(played.history[0].netLine, 'Hand −30 chips');
  assert.ok(played.history[0].lines.includes('Play 4× loses −20'));
});

// --- Saving ------------------------------------------------------------------------------------------------------

test('the stack, the bet and the limits are saved, and an older save opens at a bet of 1', () => {
  const blackjack = new TrainerSession('vegas-strip-6d-s17', 12);
  bet(blackjack, 40);
  blackjack.deal();
  finishBlackjack(blackjack);
  const saved = JSON.parse(JSON.stringify(blackjack.progress));
  assert.equal(saved.version, 4);
  assert.deepEqual(saved.chips.limits, { min: 1, max: 100 });
  const reopened = new TrainerSession('vegas-strip-6d-s17', 13);
  reopened.restore(saved);
  assert.deepEqual((reopened.view as any).chips, (blackjack.view as any).chips);

  const uth = new UthSession(12);
  bet(uth, 15);
  uth.deal();
  finishUth(uth, (legal) => (legal.includes('check') ? 'check' : 'raise1x'));
  const part = JSON.parse(JSON.stringify(uth.progress));
  assert.equal(part.version, 2);
  assert.equal(part.bet, 15);
  const back = new UthSession(1);
  back.restore(part);
  assert.deepEqual((back.view as any).chips, (uth.view as any).chips);
  assert.equal((back.view as any).stack.balance, (uth.view as any).stack.balance);

  // Before round 6b: the stack a version 3 player last saw, and a bet of 1.
  const old = new TrainerSession('vegas-strip-6d-s17', 1);
  old.restore({ version: 3, name: null, hands: 30, decisions: 31, netUnits: -12 } as never);
  assert.equal((old.view as any).chips.stack, 188);
  assert.equal((old.view as any).chips.bet, 1);
  const oldUth = new UthSession(1);
  oldUth.restore({ version: 1, balance: 173 });
  assert.equal((oldUth.view as any).stack.balance, 173);
  assert.equal((oldUth.view as any).chips.bet, 1);

  // A half-written record opens rather than failing.
  assert.equal(readChipBook({ bet: 'lots', lastBet: 900 }, Number.NaN).bet, 1);
});

async function playBlackjackPage(page: HostedPage): Promise<any> {
  let view = await page.api('/api/deal');
  while (view.phase === 'insurance' || view.phase === 'player') {
    view = view.phase === 'insurance'
      ? await page.api('/api/insurance', { take: false })
      : await page.api('/api/act', { action: 'stand' });
  }
  return view;
}

async function playUthPage(page: HostedPage): Promise<any> {
  let view = await page.api('/api/uth/deal');
  while (view.legalActions.length > 0) {
    const legal = view.legalActions.map((a: { action: string }) => a.action);
    view = await page.api('/api/uth/act', { action: legal.includes('check') ? 'check' : 'raise1x' });
  }
  return view;
}

test('on the built page, the stack and the bet survive closing the tab, in both games', async () => {
  const first = loadHosted('#table', [['ev:playerName', 'Dana']]);
  await first.booted;
  await first.api('/api/bet', { op: 'clear' });
  await first.api('/api/bet', { op: 'add', chip: 25 });
  const blackjack = await playBlackjackPage(first);
  await first.api('/api/uth/bet', { op: 'clear' });
  await first.api('/api/uth/bet', { op: 'add', chip: 5 });
  const uth = await playUthPage(first);
  // A change after the last hand is kept too.
  const changed = await first.api('/api/bet', { op: 'add', chip: 1 });
  first.stopWatching();

  const saved = JSON.parse(first.storage().get('ev:progress') ?? 'null');
  assert.equal(saved.version, 4);
  assert.equal(saved.chips.bet, 26);
  assert.equal(saved.uth.bet, 5);

  const reopened = loadHosted('#table', [...first.storage().entries()]);
  await reopened.booted;
  const state = await reopened.api('/api/state');
  assert.equal(state.chips.bet, 26);
  assert.equal(state.stack.balance, blackjack.stack.balance);
  assert.equal(state.stack.balance, changed.stack.balance);
  const uthState = await reopened.api('/api/uth/state');
  assert.equal(uthState.chips.bet, 5);
  assert.equal(uthState.stack.balance, uth.stack.balance);
  reopened.stopWatching();
});

test('the home log shows a Blackjack hand in chips at its bet, like the track row that opens it', async () => {
  const page = loadHosted('#table', [['ev:playerName', 'Dana']]);
  await page.booted;
  await page.api('/api/bet', { op: 'clear' });
  await page.api('/api/bet', { op: 'add', chip: 25 });
  page.session().table.shoe.stack(page.parseCards('As 9d Kh 7c'));
  const view = await playBlackjackPage(page);
  assert.equal(view.track[0].net, 37.5);

  page.go('#home');
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  const logged = page.document.getElementById('hands').children.filter((n: any) => n.className === 'log-row');
  assert.ok(logged.length > 0, 'the home log is empty');
  assert.ok(String(logged[0].innerHTML).includes('+37.5'), `the log row is not in chips: ${logged[0].innerHTML}`);
  page.stopWatching();
});

let server: Server;
let port = 0;
let rows: any[] = [];

before(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (c) => chunks.push(c));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (request.method === 'POST') {
        const incoming = raw ? JSON.parse(raw) : null;
        for (const row of Array.isArray(incoming) ? incoming : [incoming]) {
          rows = [...rows.filter((r) => r.id !== row.id), row];
        }
        response.writeHead(201).end();
        return;
      }
      if (request.method === 'PATCH') {
        response.writeHead(204).end();
        return;
      }
      const url = new URL(request.url ?? '/', 'http://x');
      const id = url.searchParams.get('id');
      const wanted = id ? rows.filter((r) => `eq.${r.id}` === id) : rows;
      const columns = (url.searchParams.get('select') ?? '').split(',').filter(Boolean);
      const projected = wanted.map((row) =>
        columns.length === 0 ? row : Object.fromEntries(columns.map((c) => [c, row[c] ?? null])),
      );
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(projected));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

test('a second device with the same player sees the same stack and bet', async () => {
  rows = [];
  const config = { url: `http://127.0.0.1:${port}`, key: 'anon-key-for-the-test' };
  const deviceA = loadHosted('#table', [['ev:playerName', 'Dana'], ['ev:playerId', 'dana-chips']], config);
  await deviceA.booted;
  await deviceA.api('/api/bet', { op: 'clear' });
  await deviceA.api('/api/bet', { op: 'add', chip: 100 });
  const blackjack = await playBlackjackPage(deviceA);
  await deviceA.api('/api/uth/bet', { op: 'clear' });
  await deviceA.api('/api/uth/bet', { op: 'add', chip: 25 });
  const uth = await playUthPage(deviceA);
  for (let i = 0; i < 100 && rows.find((r) => r.id === 'dana-chips')?.progress?.uth?.hands !== 1; i++) {
    await settle();
  }
  deviceA.stopWatching();
  const row = rows.find((r) => r.id === 'dana-chips');
  assert.ok(row, 'device A never reached the shared table');
  assert.equal(row.progress.chips.bet, 100);
  assert.equal(row.progress.uth.bet, 25);

  const deviceB = loadHosted('#table', [['ev:playerName', 'Dana'], ['ev:playerId', 'dana-chips']], config);
  await deviceB.booted;
  for (let i = 0; i < 5; i++) await settle(0);
  const state = await deviceB.api('/api/state');
  assert.equal(state.chips.bet, 100);
  assert.equal(state.stack.balance, blackjack.stack.balance);
  const uthState = await deviceB.api('/api/uth/state');
  assert.equal(uthState.chips.bet, 25);
  assert.equal(uthState.stack.balance, uth.stack.balance);
  deviceB.stopWatching();
});

// --- Sound, motion and the rebuy on the page --------------------------------------------------------------------------

function fakeNode(log: string[]): any {
  const n: any = {
    children: [] as any[],
    dataset: {},
    attributes: {} as Record<string, string>,
    listeners: {} as Record<string, Function[]>,
    style: { setProperty() {} },
    classList: { add() {} },
    className: '',
    textContent: '',
    disabled: false,
    replaceChildren(...c: any[]) { n.children = c; },
    appendChild(c: any) { n.children.push(c); if (c.className.includes('chip-flight')) log.push('flight'); return c; },
    append(...c: any[]) { n.children.push(...c); },
    setAttribute(k: string, v: string) { n.attributes[k] = v; },
    addEventListener(type: string, fn: Function) { (n.listeners[type] ??= []).push(fn); },
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 20, height: 20 }),
    remove() {},
  };
  return n;
}

function loadChips(options: { sound: boolean; reduced: boolean }) {
  const log: string[] = [];
  let contexts = 0;
  class Ctx {
    currentTime = 0;
    state = 'running';
    destination = {};
    constructor() { contexts++; }
    resume() {}
    createGain() {
      return {
        gain: {
          set value(v: number) { log.push(`gain ${v}`); },
          setValueAtTime: (...a: number[]) => log.push(`set ${a.join(',')}`),
          exponentialRampToValueAtTime: (...a: number[]) => log.push(`ramp ${a.join(',')}`),
        },
        connect: (next: any) => next,
      };
    }
    createOscillator() {
      return {
        set type(v: string) { log.push(`type ${v}`); },
        frequency: { set value(v: number) { log.push(`frequency ${v}`); } },
        connect: (next: any) => next,
        start: (t: number) => log.push(`start ${t}`),
        stop: (t: number) => log.push(`stop ${t}`),
      };
    }
  }
  const body = fakeNode(log);
  const win: any = {
    AudioContext: Ctx,
    matchMedia: (query: string) => ({ matches: options.reduced && query.includes('reduce') }),
  };
  const doc = {
    body,
    createElement: () => fakeNode(log),
    documentElement: { getAttribute: () => null },
  };
  const storage = { getItem: (k: string) => (k === 'ev:sound' && options.sound ? '1' : null) };
  // The figure rule first, as every page loads it (round 8).
  new Function('window', 'document', source('figure.js'))(win, doc);
  new Function('window', 'document', 'localStorage', 'setTimeout', source('chips.js'))(win, doc, storage, () => 0);
  return { chips: win.EVChips, log, contexts: () => contexts, node: () => fakeNode(log) };
}

test('one click for placing, collecting and paying: a win and a loss sound exactly the same', () => {
  const page = loadChips({ sound: true, reduced: false });
  const spot = page.node();
  const bank = page.node();
  const dealer = page.node();
  // The first sound builds the context (a master gain of 0.25); compare what follows.
  page.chips.click();
  const sounds = (fn: () => void) => {
    page.log.length = 0;
    fn();
    return page.log.filter((entry) => entry !== 'flight');
  };
  const win = sounds(() => page.chips.settle(35, [spot], bank, dealer));
  const loss = sounds(() => page.chips.settle(-85, [spot], bank, dealer));
  const push = sounds(() => page.chips.settle(0, [spot], bank, dealer));
  const placing = sounds(() => page.chips.place(bank, spot, 25));
  assert.ok(win.length > 0, 'nothing sounded with sound on');
  assert.deepEqual(loss, win, 'a loss sounds different from a win');
  assert.deepEqual(push, win);
  assert.deepEqual(placing, win, 'placing sounds different from collecting and paying');

  // The click takes nothing it could vary on, and settling clicks before it looks at the result.
  const code = source('chips.js');
  assert.match(code, /function click\(\) \{/);
  const from = code.indexOf('function settle(');
  const body = code.slice(from, code.indexOf('\n  }\n', from));
  assert.equal([...body.matchAll(/click\(\)/g)].length, 1);
  assert.ok(body.indexOf('click()') < body.indexOf('net >'), 'the click depends on the result');
  assert.ok(!/click\([^)]/.test(code), 'a click is given something to vary on');
});

test('sound is off by default: no audio at all until it is asked for', () => {
  const page = loadChips({ sound: false, reduced: false });
  page.chips.settle(10, [page.node()], page.node(), page.node());
  page.chips.place(page.node(), page.node(), 5);
  assert.equal(page.contexts(), 0);
});

test('chips move only for a player who has not asked for less motion', () => {
  const moving = loadChips({ sound: false, reduced: false });
  moving.chips.place(moving.node(), moving.node(), 5);
  assert.equal(moving.log.filter((e) => e === 'flight').length, 1);

  const still = loadChips({ sound: false, reduced: true });
  still.chips.place(still.node(), still.node(), 5);
  still.chips.settle(10, [still.node()], still.node(), still.node());
  assert.equal(still.log.filter((e) => e === 'flight').length, 0, 'a chip moved under reduced motion');

  // And the flight itself lives inside the stylesheet's reduced-motion guard.
  const css = source('styles.css');
  const at = css.indexOf('.chip-flight { animation:');
  assert.ok(at > 0);
  assert.ok(css.lastIndexOf('@media (prefers-reduced-motion: no-preference)', at) > css.lastIndexOf('}\n}\n', at) - 400);
});

test('with the last card up the bar is one row: Deal at the same bet, and the chips a tap away', () => {
  const page = loadChips({ sound: false, reduced: false });
  const chips = {
    needsRebuy: false,
    values: [1, 5, 25, 100],
    canAdd: [true, true, true, true],
    canClear: true,
    canRepeat: false,
    canDouble: true,
    bet: 30,
    lastBet: 30,
    startingChips: 200,
  };
  const box = page.node();
  assert.equal(page.chips.controls(box, chips, () => {}, () => {}, () => null, false, true), 'compact');
  assert.equal(box.children.length, 0, 'the chips were drawn under the card');
  let opened = false;
  const toggle = page.chips.toggle(chips, () => { opened = true; }, false);
  assert.equal(toggle.dataset.action, 'bet-open');
  toggle.listeners.click[0]();
  assert.ok(opened, 'the toggle does not open the chips');
  const open = page.node();
  assert.equal(page.chips.controls(open, chips, () => {}, () => {}, () => null, false, false), 'chips');
  assert.equal(open.children.length, 2, 'the chips and the tools');
  // Both tables pass the card's presence, and reopen the chips only on a tap.
  assert.match(source('app.js'), /const compact = Boolean\(view\.feedback && state\.reveal\) && !state\.betOpen;/);
  assert.match(source('ultimate.js'), /const compact = Boolean\(view\.feedback\) && !uthState\.betOpen;/);
});

test('out of chips: one plain line and one button, and nothing anywhere counts rebuys', () => {
  const page = loadChips({ sound: false, reduced: false });
  const box = page.node();
  const shown = page.chips.controls(
    box,
    { needsRebuy: true, startingChips: 200 },
    () => Promise.resolve(),
    () => Promise.resolve(),
    () => null,
    false,
  );
  assert.equal(shown, 'rebuy');
  assert.equal(box.children.length, 2, 'more than the line and the button');
  assert.equal(box.children[0].className, 'rebuy-line');
  assert.equal(box.children[1].children.length, 1, 'more than one button');
  assert.equal(box.children[1].children[0].dataset.action, 'rebuy');

  assert.match(catalogue('en')['rebuy.line']!, /free, as often as you like/);
  for (const dir of [PUBLIC, SRC]) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.js') || f.endsWith('.ts'))) {
      assert.doesNotMatch(readFileSync(join(dir, file), 'utf8'), /rebuys|rebuyCount/, `${file} counts rebuys`);
    }
  }
  // No currency, anywhere a player reads.
  for (const locale of ['en', 'he'] as const) {
    for (const [key, text] of Object.entries(catalogue(locale))) {
      assert.doesNotMatch(text, /[₪$€£]/, `${locale} ${key} reads like money`);
    }
  }
});

test('a negative stack is drawn like any other figure', () => {
  const page = loadChips({ sound: false, reduced: false });
  assert.equal(page.chips.figure(-65), '−65');
  assert.equal(page.chips.figure(37.5, true), '+37.5');
  // Neither table colours or flags the stack for being below zero.
  for (const file of ['app.js', 'ultimate.js']) {
    assert.doesNotMatch(source(file), /balance\s*<\s*0|negative/i, `${file} treats a negative stack specially`);
  }
  const rules = source('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /\b(negative|debt|owed)\b/i);
});
