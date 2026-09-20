/**
 * Ultimate's worked lines, its money lines and its seat headers (round 19).
 *
 * Blackjack has had a line per action since round 15, and the standard there is
 * the one that matters: **the sum has to come out**, printed as a player reads
 * it. Ultimate had two paragraphs of prose instead, and Idan rejected them.
 *
 * What is checked here, over hundreds of real hands:
 *
 *   - every Ultimate worked line rebuilds its own figure, both exactly and as
 *     printed, with the terms rounded to the decimals the copy will print;
 *   - no line is left without a sum, which is what `digits: null` would mean;
 *   - the counts are the solve's own — the wins, ties and losses add up to the
 *     outcomes enumerated, and the units average back to the EV that was graded;
 *   - the money lines are arithmetic a player can check: at risk is the Ante,
 *     the Blind and the Play bet, and what comes back is that plus what the
 *     choice is worth, so folding brings back nothing;
 *   - a seat header names the hand the engine evaluated, and the dealer's waits
 *     for his cards to be turned over;
 *   - changing the Trips pay table moves nothing that is graded.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TRIPS_PAYTABLES, evaluateCards, parseCards, preflopRow, categoryOf } from '@evtrainer/ev-engine/uth';
import type { UthTable } from '@evtrainer/game-engine';

import { catalogue } from '../src/i18n.ts';
import { loadHosted, type HostedPage } from './helpers/hosted-page.ts';
import { returnFigure } from '../src/returns.ts';
import { UthSession } from '../src/uth-session.ts';
import { PREFLOP_OUTCOMES, UTH_STAKE } from '../src/uth-worked.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (file: string) => readFileSync(join(HERE, '..', 'public', file), 'utf8');

/**
 * The arithmetic each kind of line claims, written out here rather than
 * imported — a test that reuses the code it checks proves only that the code
 * agrees with itself. Each returns what comes back per unit of the Ante and the
 * Blind, which is the figure on the bar.
 */
function rebuild(work: any): number | null {
  switch (work.kind) {
    case 'uthRiverPlay':
    case 'uthFlopPlay':
      return 1 + (work.wins * work.winPay - work.losses * work.losePay) / work.outcomes / UTH_STAKE;
    case 'uthFlopCheck':
      return 1 + (work.playBoards * work.playValue + work.foldBoards * -2) / work.boards / UTH_STAKE;
    case 'uthPreflopPlay':
      return 1 + (work.wins * work.winPay - work.losses * work.losePay) / work.outcomes / UTH_STAKE;
    case 'uthPreflopCheck':
      return 1 + (work.flopRaises * work.raiseValue + work.flopChecks * work.checkValue) / work.flops / UTH_STAKE;
    case 'uthFold':
      return 0;
    default:
      return null;
  }
}

/** Play a varied session and keep every decision the card would draw. */
function play(seed: number, hands = 40) {
  const session = new UthSession(seed);
  const seen: Array<{ feedback: any; view: any }> = [];
  for (let hand = 0; hand < hands; hand++) {
    session.deal();
    let view = session.view as any;
    let guard = 0;
    while (view.legalActions.length > 0 && guard++ < 4) {
      const legal = view.legalActions.map((entry: any) => entry.action);
      // Vary the play so checks, raises and folds all come up.
      const action = legal[(hand + guard) % legal.length];
      session.act(action);
      view = session.view as any;
      if (view.feedback) seen.push({ feedback: view.feedback, view });
    }
  }
  return seen;
}

const lines = (seed: number, hands = 40) => {
  const out: Array<{ work: any; headline: string; phase: string }> = [];
  for (const { feedback } of play(seed, hands)) {
    for (const work of feedback.returns.worked ?? []) {
      if (work) out.push({ work, headline: feedback.headline, phase: feedback.phase });
    }
  }
  return out;
};

// --- The sums come out ----------------------------------------------------------------------

test('every Ultimate worked line rebuilds the figure it explains, exactly', () => {
  const kinds = new Set<string>();
  let checked = 0;
  for (const seed of [11, 404, 9091]) {
    for (const { work, headline } of lines(seed)) {
      const rebuilt = rebuild(work);
      assert.ok(rebuilt !== null, `${work.kind} has no arithmetic this test knows`);
      kinds.add(work.kind);
      checked++;
      assert.ok(
        Math.abs(rebuilt - work.value) < 1e-9,
        `${headline}: ${work.kind} works out to ${rebuilt} but the bar says ${work.value}`,
      );
      assert.equal(
        returnFigure(rebuilt),
        returnFigure(work.value),
        `${headline}: ${work.kind} prints a sum that does not match its figure`,
      );
    }
  }
  assert.ok(checked > 100, `only ${checked} lines were checked`);
  assert.deepEqual(
    [...kinds].sort(),
    preflopRow('AA').wins === undefined
      ? ['uthFlopCheck', 'uthFlopPlay', 'uthFold', 'uthRiverPlay']
      : ['uthFlopCheck', 'uthFlopPlay', 'uthFold', 'uthPreflopCheck', 'uthPreflopPlay', 'uthRiverPlay'],
    'a kind of line went unchecked',
  );
});

test('and it still comes out at the decimals the copy prints', () => {
  for (const { work, headline } of lines(31, 30)) {
    assert.ok(work.digits !== null, `${headline}: ${work.kind} carries no sum at all`);
    if (work.kind === 'uthFold') continue;
    // Exactly what the page prints: the money terms rounded to `digits`, the
    // counts left as the whole numbers they are.
    const asPrinted: Record<string, unknown> = { ...work };
    for (const [name, value] of Object.entries(work)) {
      if (typeof value === 'number') asPrinted[name] = Number(value.toFixed(work.digits));
    }
    const printed = rebuild(asPrinted);
    assert.equal(
      returnFigure(printed!),
      returnFigure(work.value),
      `${headline}: ${work.kind} printed to ${work.digits} decimals does not reach its own figure`,
    );
  }
});

test('the counts are the solve’s own, not a second calculation', () => {
  for (const { work, headline, phase } of lines(7, 30)) {
    if (work.kind === 'uthFold') continue;
    for (const [name, value] of Object.entries(work)) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value), `${headline}: ${work.kind}.${name} is ${value}`);
    }
    if (work.kind === 'uthRiverPlay') {
      // Forty-five unseen cards, taken two at a time, and nothing else.
      assert.equal(work.outcomes, 990, `${headline}: the river enumerated ${work.outcomes} holdings`);
      assert.equal(work.wins + work.ties + work.losses, 990, 'the river counts do not add up');
      assert.equal(phase, 'river');
    }
    if (work.kind === 'uthFlopPlay') {
      assert.equal(work.outcomes, 1070190, `${headline}: the flop enumerated ${work.outcomes} endings`);
      assert.equal(work.wins + work.ties + work.losses, work.outcomes, 'the flop counts do not add up');
    }
    if (work.kind === 'uthFlopCheck') {
      assert.equal(work.boards, 1081, `${headline}: ${work.boards} turn-and-river runouts`);
      assert.equal(work.playBoards + work.foldBoards, work.boards, 'the check branch does not add up');
      assert.ok(work.playValue >= -2, 'a board worth betting is worth less than folding');
    }
  }
});

test('before the flop: a line if the table counted, and no line if it did not', () => {
  /*
   * Round 20 gave the offline job three counters, so the pre-flop figure can be
   * said forward like the river's. A table solved before that carries none, and
   * then the card says nothing rather than deriving an approximation from the
   * answer — which is the trap round 15 removed. Both states are correct; what
   * is never correct is a line without counts behind it.
   */
  const counted = preflopRow('AA').wins !== undefined;
  let preflop = 0;
  for (const { work, phase } of lines(55, 30)) {
    if (phase !== 'preflop') continue;
    preflop++;
    assert.ok(counted, 'a pre-flop action carries a worked line derived from a lookup');
    assert.ok(['uthPreflopPlay', 'uthPreflopCheck'].includes(work.kind), `pre-flop line of kind ${work.kind}`);
    if (work.kind === 'uthPreflopPlay') {
      assert.equal(work.outcomes, PREFLOP_OUTCOMES);
      assert.equal(work.wins + work.ties + work.losses, PREFLOP_OUTCOMES, 'the pre-flop counts do not add up');
    } else {
      assert.equal(work.flops, 19600, `${work.flops} flops`);
      assert.equal(work.flopRaises + work.flopChecks, work.flops);
    }
  }
  if (counted) assert.ok(preflop > 0, 'the table has counts and the card says nothing');
  else assert.equal(preflop, 0, 'a line appeared with no counts behind it');
  // And the size of that lookup is stated instead — C(50,5) x C(45,2).
  assert.equal(PREFLOP_OUTCOMES, 2118760 * 990);
  for (const { feedback } of play(3, 6)) {
    assert.equal(
      feedback.returns.scale,
      feedback.phase === 'preflop' ? PREFLOP_OUTCOMES : null,
      'the scale line is on the wrong decision',
    );
  }
});

// --- The same decision in chips --------------------------------------------------------------

test('what an action puts out, what is at risk, and what comes back', () => {
  const MULTIPLE: Record<string, number> = { raise4x: 4, raise3x: 3, raise2x: 2, raise1x: 1, check: 0, fold: 0 };
  let folds = 0;
  for (const { feedback, view } of play(1234, 30)) {
    const bet = feedback.returns.bet;
    assert.ok(bet > 0, 'the money lines have no bet to be in');
    for (const row of feedback.ranked) {
      const money = row.money;
      assert.ok(money, `${row.action} has no money line`);
      assert.equal(money.puts, MULTIPLE[row.action]! * bet, `${row.action} puts out the wrong amount`);
      assert.equal(money.risk, (UTH_STAKE + MULTIPLE[row.action]!) * bet, `${row.action} risks the wrong amount`);
      assert.ok(
        Math.abs(money.back - (money.risk + row.ev * bet)) < 1e-9,
        `${row.action}: ${money.back} back is not ${money.risk} at risk plus what it is worth`,
      );
      // Folding forfeits the Ante and the Blind: nothing comes back, ever.
      if (row.action === 'fold') {
        folds++;
        assert.ok(Math.abs(money.back) < 1e-9, 'folding brings something back');
        assert.equal(money.risk, 2 * bet);
      }
    }
    assert.ok(view.stake.total >= 0);
  }
  assert.ok(folds > 0, 'no fold came up, so the anchor was never checked');
});

// --- The seat headers ------------------------------------------------------------------------

function stacked(cards: string, locale: 'en' | 'he' = 'en') {
  const session = new UthSession(1);
  session.setLocale(locale);
  (session as unknown as { table: UthTable }).table.stackNextHand(parseCards(cards));
  session.deal();
  return session;
}

test('a seat header names the hand the engine evaluated', () => {
  // Player A-9, dealer K-J, board Q-J-10-3-2: a straight for the player.
  const session = stacked('Ad 9s Kh Jc Qs Jh Ts 3d 2c');
  let view = session.view as any;
  assert.equal(view.seats.you, null, 'the header names a hand before the flop');
  assert.equal(view.seats.dealer, null, 'the dealer is named before his cards are turned over');

  session.act('check');
  view = session.view as any;
  assert.ok(view.seats.you, 'no header on the flop');
  assert.equal(view.seats.dealer, null, 'the dealer is named while his cards are down');

  session.act('check');
  view = session.view as any;
  const hole = view.hole.map((card: any) => card.code);
  const board = view.board.map((card: any) => card.code);
  const value = evaluateCards([...hole, ...board]);
  // The words come from the same evaluator the settlement was paid on.
  assert.equal(view.seats.you.value, value, 'the header names a hand the engine did not evaluate');
  assert.ok(view.seats.you.phrase.length > 0);

  session.act('raise1x');
  view = session.view as any;
  assert.ok(view.seats.dealer, 'the dealer has no header at showdown');
  assert.equal(view.seats.showFive, true, 'the five ranks are withheld at showdown');
  assert.equal(view.seats.you.five.split('-').length, 5, 'the header lists something other than five ranks');
  // And the hand named is the one the showdown pays on.
  assert.equal(view.seats.you.phrase, view.showdown.player.phrase);
  assert.equal(view.seats.dealer.phrase, view.showdown.dealer.phrase);
  assert.equal(categoryOf(view.seats.you.value), categoryOf(view.showdown.player.value));
});

test('the header says what the hand is and nothing about the decision', () => {
  const js = source('ultimate.js');
  const fn = js.slice(js.indexOf('function uthSeatHands('), js.indexOf('// --- The strip'));
  const code = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const word of ['correct', 'blunder', 'optimal', 'severity', 'evCost', 'grade', 'rating']) {
    assert.ok(!code.includes(word), `the seat header mentions ${word}`);
  }
  // Round 17's rule on the other table, kept here: the dealer's line waits.
  assert.ok(source('ultimate.html').includes('id="uth-dealer-hand"'));
  assert.ok(source('ultimate.html').includes('id="uth-you-hand"'));
});

// --- The Trips pay table is a setting, and can be one ----------------------------------------

test('changing the Trips pay table moves nothing that is graded', () => {
  const grades = (tripsId: string) => {
    const session = new UthSession(88);
    assert.equal(session.setTripsPaytable(tripsId), tripsId !== TRIPS_PAYTABLES[0]!.id);
    const seen: unknown[] = [];
    for (let hand = 0; hand < 12; hand++) {
      session.deal();
      let view = session.view as any;
      let guard = 0;
      while (view.legalActions.length > 0 && guard++ < 4) {
        session.act(view.legalActions[0].action);
        view = session.view as any;
        if (view.feedback) {
          seen.push({
            headline: view.feedback.headline,
            evCost: view.feedback.evCost,
            severity: view.feedback.severity,
            ranked: view.feedback.ranked.map((row: any) => [row.action, row.ev, row.value]),
          });
        }
      }
    }
    return { seen, rating: (session.view as any).rating.rating };
  };
  const one = grades('trips-a');
  const three = grades('trips-c');
  assert.deepEqual(three.seen, one.seen, 'a Trips pay table changed a graded decision');
  assert.equal(three.rating, one.rating, 'a Trips pay table moved the rating');

  // No solver can read it: the three that grade take the Blind pay table only.
  const engine = (file: string) =>
    readFileSync(join(HERE, '..', '..', 'ev-engine', 'src', 'uth', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const file of ['river.ts', 'flop.ts', 'preflop.ts']) {
    assert.ok(!/TripsPaytable/.test(engine(file)), `${file} reads the Trips pay table`);
  }
});

test('what it does reset is the Trips row, and only that', () => {
  const session = new UthSession(5);
  session.placeBet('add', 1, 'trips');
  session.deal();
  let view = session.view as any;
  let guard = 0;
  while (view.legalActions.length > 0 && guard++ < 4) {
    session.act(view.legalActions[0].action);
    view = session.view as any;
  }
  const before = view.stats.decisions;
  assert.ok((session.view as any).tripsStats.hands > 0, 'no Trips hand was played');
  assert.equal(session.setTripsPaytable('trips-b'), true);
  const after = session.view as any;
  assert.equal(after.tripsStats.hands, 0, 'the Trips row survived a change of pay table');
  assert.equal(after.tripsStats.wagered, 0);
  assert.equal(after.stats.decisions, before, 'changing a pay table threw away the session');
  assert.equal(after.rules.trips, 'trips-b');
  // Mid-hand it is refused outright.
  session.deal();
  assert.equal(session.setTripsPaytable('trips-c'), false, 'the pay table changed in the middle of a hand');
});

test('every pay table the panel offers states what it pays and what it costs', () => {
  const view = new UthSession(2).view as any;
  assert.equal(view.rules.tripsOptions.length, TRIPS_PAYTABLES.length);
  const messages = catalogue('he');
  for (const option of view.rules.tripsOptions) {
    assert.ok(/\d/.test(option.pays), `${option.id} does not say what it pays`);
    assert.ok(/%/.test(option.edge), `${option.id} does not say what it costs`);
    assert.ok(messages[`uth.trips.${option.id}`], `${option.id} has no Hebrew name`);
  }
  // The Blind pay table is stated and is not among the controls.
  assert.ok(view.rules.blindName.length > 0);
  assert.ok(view.rules.blindNote.length > 0);
  assert.ok(!source('ultimate.html').includes('name="uth-blind"'), 'the Blind pay table is offered as a control');
});

// --- Read off the screen, and worked out by hand ---------------------------------------------

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function dockButtons(page: HostedPage): any[] {
  return page.document.getElementById('uth-actions').children.flatMap((row: any) => row.children ?? []);
}

async function tap(page: HostedPage, action: string) {
  for (let i = 0; i < 200 && !dockButtons(page).some((b) => b.dataset?.action === action); i++) await settle(5);
  await settle(520);
  const node = dockButtons(page).find((b) => b.dataset?.action === action);
  assert.ok(node, `no ${action}`);
  for (const handler of node.listeners.click ?? []) handler({ preventDefault() {} });
  for (let i = 0; i < 20; i++) await settle();
}

function walk(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  return [node, ...(node.children ?? []).flatMap((child: any) => walk(child))];
}
const withClass = (node: any, name: string) =>
  walk(node).filter((n) => String(n.className ?? '').split(' ').includes(name));
const flat = (node: any) =>
  String(node?.innerHTML ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/**
 * Work out a printed sum the way a reader would, brackets and all.
 *
 * Ultimate's lines carry parentheses and two divisions — `1 + (905 × 2.000 −
 * 62 × 3.000) ÷ 990 ÷ 2` — so the flat left-to-right reader Blackjack's sums
 * need would get a different answer from the one on the page. This one honours
 * brackets and precedence, which is what a person doing it on paper does.
 */
function evaluate(text: string): number {
  const plain = text
    .replace(/[⁦⁩]/g, '')
    .replace(/−/g, '-')
    .replace(/,/g, '')
    .replace(/\s+/g, '');
  let at = 0;
  const peek = () => plain[at];
  const expr = (): number => {
    let value = term();
    for (;;) {
      if (peek() === '+') { at++; value += term(); }
      else if (peek() === '-') { at++; value -= term(); }
      else return value;
    }
  };
  const term = (): number => {
    let value = atom();
    for (;;) {
      if (peek() === '×') { at++; value *= atom(); }
      else if (peek() === '÷') { at++; value /= atom(); }
      else return value;
    }
  };
  const atom = (): number => {
    if (peek() === '(') {
      at++;
      const value = expr();
      assert.equal(plain[at], ')', `unbalanced brackets in "${text}"`);
      at++;
      return value;
    }
    const start = at;
    if (peek() === '-' || peek() === '+') at++;
    while (at < plain.length && /[\d.%]/.test(plain[at]!)) at++;
    const token = plain.slice(start, at);
    assert.ok(token.length > 0, `cannot read "${text}" at ${start}`);
    return token.endsWith('%') ? Number(token.slice(0, -1)) / 100 : Number(token);
  };
  const value = expr();
  assert.equal(at, plain.length, `"${text}" has something left over at ${at}`);
  return value;
}

test('a player who does the arithmetic on Ultimate’s screen gets the figure on screen', async () => {
  for (const locale of ['en', 'he'] as const) {
    const page = loadHosted('#ultimate', [
      ['ev:playerName', 'Dana'],
      ['ev:showAll', '1'],
      ['ev:introSeen', '1'],
      ['ev:locale', locale],
    ]);
    await page.booted;
    let checked = 0;
    for (let hand = 0; hand < 8; hand++) {
      await tap(page, 'deal');
      // Check to the flop, raise there on half the hands and go to the river on
      // the rest, so all four kinds of line come up.
      await tap(page, 'check');
      await tap(page, hand % 2 === 0 ? 'raise2x' : 'check');
      for (const holder of withClass(page.document.getElementById('uth-card'), 'worked')) {
        const sum = withClass(holder, 'worked-sum')[0];
        if (!sum) continue;
        const printed = flat(sum);
        const [lhs, rhs] = printed.split('=');
        if (!rhs) continue; // folding's line is a figure and no sum
        checked++;
        // One kind of minus on both sides: the page writes a real one (U+2212).
        const plain = (text: string) => text.replace(/[⁦⁩]/g, '').replace(/−/g, '-').trim();
        assert.equal(
          plain(returnFigure(evaluate(lhs!))),
          plain(rhs),
          `${locale}: "${printed}" does not come out`,
        );
      }
      if (hand % 2 !== 0) await tap(page, 'raise1x');
    }
    assert.ok(checked > 5, `${locale}: only ${checked} sums were read back`);
    page.stopWatching();
  }
});
