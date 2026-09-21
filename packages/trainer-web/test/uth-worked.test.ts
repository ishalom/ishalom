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
import { UthSession, wholePercents } from '../src/uth-session.ts';
import { PREFLOP_OUTCOMES, UTH_STAKE, uthTieHidden } from '../src/uth-worked.ts';

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
    // Idan's, round 28: the chance of winning times what a win pays, less the
    // chance of losing times what a loss costs. A tie pushes and adds nothing.
    case 'uthShares':
      return 1 + (work.shareWin * work.winPay - work.shareLose * work.losePay) / UTH_STAKE;
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

// --- Win, tie and lose (round 27) ------------------------------------------------------------

test('a tie of 5.0% is hidden and 5.1% is shown, decided before rounding', () => {
  /*
   * Idan's rule, round 28, and the threshold is read off the **unrounded**
   * share on purpose: 5.04% would print as "5%" and is below the line, so the
   * decision cannot be about how a number happens to round.
   */
  const shown = withOddsFor(51, 949);
  const hidden = withOddsFor(50, 950);
  assert.equal(hidden.oddsTieHidden, true, 'a tie of exactly 5.0% was shown');
  assert.equal(shown.oddsTieHidden, false, 'a tie of 5.1% was hidden');

  /*
   * And the pair that makes "unrounded" mean something: 4.96% and 5.04% both
   * print as "5%", and they fall on opposite sides of the line. Rounding first
   * would have made the rule depend on the display rather than on the fact.
   */
  assert.equal(withOddsFor(496, 9504).oddsTieHidden, true, '4.96% was shown');
  assert.equal(withOddsFor(504, 9496).oddsTieHidden, false, '5.04% was hidden');
});

test('when the tie is hidden the two shares still account for it, and the copy says so', () => {
  const hidden = withOddsFor(30, 970);
  assert.equal(hidden.oddsTieHidden, true);
  assert.equal(
    hidden.oddsWin + hidden.oddsLose + hidden.oddsTie,
    100,
    'win + lose + the hidden tie does not come to 100',
  );
  assert.ok(hidden.oddsWin + hidden.oddsLose < 100, 'nothing was actually hidden');

  for (const locale of ['en', 'he'] as const) {
    const line = catalogue(locale)['work.oddsNoTie']!;
    assert.ok(line.includes('{oddsWin}') && line.includes('{oddsLose}'), `${locale}: the line lost a share`);
    assert.ok(!line.includes('{oddsTie}'), `${locale}: the hidden-tie line still prints a tie`);
    // And it explains itself, so two percentages short of 100 do not read as a bug.
    assert.ok(line.length > 60, `${locale}: the hidden-tie line says nothing about why`);
  }
});

test('a tie above the line is shown, and then the three add to 100', () => {
  const shown = withOddsFor(200, 800);
  assert.equal(shown.oddsTieHidden, false);
  assert.equal(shown.oddsWin + shown.oddsTie + shown.oddsLose, 100);
});

test('every action that can be counted carries win, tie and lose, and they add to 100', () => {
  /*
   * Idan asked for the percentages in the block, and the rule every worked line
   * already obeys applies here: what is printed must be checkable. A player who
   * adds three percentages — and some will — must not catch the page out by one.
   */
  let seen = 0;
  const byPhase = new Map<string, number>();
  for (const seed of [7, 19, 33]) {
    for (const { work, phase } of lines(seed, 30)) {
      if (work.oddsWin === undefined) continue;
      seen++;
      byPhase.set(`${phase}:${work.action}`, (byPhase.get(`${phase}:${work.action}`) ?? 0) + 1);
      assert.equal(
        work.oddsWin + work.oddsTie + work.oddsLose,
        100,
        `${phase} ${work.action}: ${work.oddsWin} + ${work.oddsTie} + ${work.oddsLose}`,
      );
      for (const share of [work.oddsWin, work.oddsTie, work.oddsLose]) {
        assert.ok(Number.isInteger(share) && share >= 0 && share <= 100, `${share} is not a percentage`);
      }
    }
  }
  assert.ok(seen > 40, `only ${seen} actions carried percentages`);

  /* And they reach every street, not only the one that was easiest. */
  const streets = new Set([...byPhase.keys()].map((key) => key.split(':')[0]));
  for (const street of ['preflop', 'flop', 'river']) {
    assert.ok(streets.has(street), `no action at the ${street} carries percentages`);
  }
});

test('folding ends every hand the same way, and says so', () => {
  for (const { work } of lines(11, 20)) {
    if (work.kind !== 'uthFold') continue;
    assert.equal(work.oddsWin, 0, 'folding won something');
    assert.equal(work.oddsTie, 0, 'folding tied something');
    assert.equal(work.oddsLose, 100, 'folding did not lose everything');
  }
});

test('checking the flop counts the boards it folds away as losses, not as nothing', () => {
  /*
   * The check branch reaches a showdown on most boards and folds the river on
   * the rest. Those folds are losses — the money is gone — so the lose share of
   * checking must be at least the share of boards that are folded away, and the
   * three must still add to 100.
   */
  let checked = 0;
  for (const seed of [7, 19]) {
    for (const { work, phase } of lines(seed, 30)) {
      if (phase !== 'flop' || work.kind !== 'uthFlopCheck' || work.oddsWin === undefined) continue;
      checked++;
      const foldShare = (work.foldBoards / work.boards) * 100;
      assert.ok(
        work.oddsLose >= Math.floor(foldShare),
        `checking loses ${work.oddsLose}% but folds ${foldShare.toFixed(1)}% of boards away`,
      );
      assert.equal(work.oddsWin + work.oddsTie + work.oddsLose, 100);
    }
  }
  assert.ok(checked > 0, 'no flop check was seen at all');
});

test('the percentages a player reads on the page are the ones that add to 100', async () => {
  /*
   * Off the screen, not off the object: the object could be right and the copy
   * could still print something else, and what a player checks is the copy.
   */
  const page = loadHosted('#ultimate', [
    ['ev:playerName', 'Dana'],
    ['ev:introSeen', '1'],
    ['ev:level', 'advanced'],
  ]);
  await page.booted;
  const en = catalogue('en');
  const template = en['work.odds']!;
  assert.ok(
    template.includes('{oddsWin}') && template.includes('{oddsTie}') && template.includes('{oddsLose}'),
    'the odds line stopped naming its three shares',
  );

  let read = 0;
  for (const { work } of lines(5, 25)) {
    if (work.oddsWin === undefined) continue;
    const printed = template
      .replace('{oddsWin}', `${work.oddsWin}%`)
      .replace('{oddsTie}', `${work.oddsTie}%`)
      .replace('{oddsLose}', `${work.oddsLose}%`);
    const shares = [...printed.matchAll(/(\d+)%/g)].map((match) => Number(match[1]));
    assert.equal(shares.length, 3, `the printed line does not carry three shares: ${printed}`);
    assert.equal(shares[0]! + shares[1]! + shares[2]!, 100, `as printed: ${printed}`);
    read++;
  }
  assert.ok(read > 20, `only ${read} lines were read off the copy`);
  page.stopWatching();
});

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
      ? ['uthFlopCheck', 'uthFlopPlay', 'uthFold', 'uthRiverPlay', 'uthShares']
      : [
          'uthFlopCheck',
          'uthFlopPlay',
          'uthFold',
          'uthPreflopCheck',
          'uthPreflopPlay',
          'uthRiverPlay',
          // Idan's calculation, round 28: every action with counts says the
          // same figure a second way, from the two chances.
          'uthShares',
        ],
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
    assert.ok(
      ['uthPreflopPlay', 'uthPreflopCheck', 'uthShares'].includes(work.kind),
      `pre-flop line of kind ${work.kind}`,
    );
    // The shares line is the same figure said differently; the two tests below
    // are about the counted lines, which carry the counts.
    if (work.kind === 'uthShares') continue;
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

// --- The room the card is given (round 20) -----------------------------------------------------

test('the card’s ceiling is measured in the viewport, not in the document', () => {
  const js = source('ultimate.js');
  const from = js.indexOf('function uthFitCard(');
  const fit = js.slice(from, js.indexOf(String.fromCharCode(10) + '}', from));
  const code = fit.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  /*
   * `getBoundingClientRect()` is already measured from the top of the viewport.
   * Adding `window.scrollY` to it mixed two coordinate systems and made the
   * card shrink as the player scrolled — sixty pixels of card lost for sixty
   * pixels of scroll, which is how the pre-flop block came to lose a row.
   */
  assert.ok(!code.includes('scrollY'), 'the card’s room is measured against the scroll position again');
  assert.ok(code.includes('window.innerHeight'), 'the card’s room is not measured against the viewport');
});

test('at 360px the seat header keeps to one line, and the board loses its label', () => {
  const js = source('ultimate.js');
  const fn = js.slice(js.indexOf('function uthSeatHands('), js.indexOf('// --- The strip'));
  assert.match(fn, /window\.innerWidth > 380/, 'the five ranks are shown at every width again');
  const css = source('styles.css');
  const narrow = css.slice(css.indexOf('@media (max-width: 380px)'), css.indexOf('}', css.indexOf('.uth-board .seat-title')));
  assert.ok(narrow.includes('.uth-board .seat-title'), 'the board keeps its label on the narrowest screen');
  // And the section keeps its name for anything that is not looking at pixels.
  assert.ok(source('ultimate.html').includes('aria-label:uth.board'), 'the board lost its accessible name');
});


/* --- Idan's calculation, built from the percentages (round 28) ----------------------------- */

test('every action with counts carries the calculation, and it rebuilds the printed figure', () => {
  let seen = 0;
  const streets = new Set<string>();
  for (const seed of [7, 19, 33]) {
    for (const { work, phase } of lines(seed, 30)) {
      if (work.kind !== 'uthShares') continue;
      seen++;
      streets.add(phase);
      assert.notEqual(work.digits, null, `${phase} ${work.action}: no decimals make the sum come out`);

      /*
       * Rebuilt here rather than by the code under test: the chance of winning
       * times what a win pays, less the chance of losing times what a loss
       * costs, on terms rounded to the decimals the copy prints.
       */
      const round = (value: number) => Number(value.toFixed(work.digits));
      const rebuilt =
        1 + (round(work.shareWin) * round(work.winPay) - round(work.shareLose) * round(work.losePay)) / UTH_STAKE;
      assert.equal(
        returnFigure(rebuilt),
        returnFigure(work.value),
        `${phase} ${work.action}: the calculation does not reach the figure it explains`,
      );
    }
  }
  assert.ok(seen > 30, `only ${seen} calculations were seen`);
  for (const street of ['preflop', 'flop', 'river']) {
    assert.ok(streets.has(street), `no calculation at the ${street}`);
  }
});

test('the calculation says its amounts are averages, and leaves the tie out of the sum', () => {
  for (const locale of ['en', 'he'] as const) {
    const say = catalogue(locale)['work.uthShares']!;
    const sum = catalogue(locale)['work.uthShares.sum']!;
    // A win's size varies with the paytable and with the dealer qualifying, so
    // printing one amount as if it were fixed would be false.
    assert.ok(/average|בממוצע/.test(say), `${locale}: the calculation does not say the amounts are averages`);
    assert.ok(!sum.includes('{shareTie}'), `${locale}: a tie appears in the sum, where its term is zero`);
    assert.ok(sum.includes('{shareWin}') && sum.includes('{shareLose}'), `${locale}: the sum lost a share`);
  }
});

test('folding and the pre-flop check carry no calculation, because neither has one', () => {
  for (const { work, phase } of lines(11, 25)) {
    if (work.kind !== 'uthShares') continue;
    assert.notEqual(work.action, 'fold', 'folding was given a chance of winning');
    assert.ok(
      !(phase === 'preflop' && work.action === 'check'),
      'checking before the flop was given a calculation it has no counts for',
    );
  }
});

/**
 * The odds as the block would carry them, for a chosen tie share.
 *
 * Built from the same two functions the screen uses — `uthTieHidden` decides,
 * `wholePercents` rounds — rather than from a copy of their logic here, which
 * would prove only that the test agrees with itself.
 */
function withOddsFor(ties: number, rest: number) {
  const wins = Math.round(rest / 2);
  const losses = rest - wins;
  const [oddsWin, oddsTie, oddsLose] = wholePercents([wins, ties, losses]);
  return {
    oddsWin: oddsWin!,
    oddsTie: oddsTie!,
    oddsLose: oddsLose!,
    oddsTieHidden: uthTieHidden(wins, ties, losses),
  };
}
