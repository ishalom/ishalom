/**
 * What comes back to you (round 13).
 *
 * Idan's decision: every figure a player reads about an action becomes what one
 * unit already at risk comes back, rather than what the action is worth net of
 * that stake. Surrender reads +0.500 instead of −0.500, folding in Ultimate
 * reads 0.000, and 1.000 is break-even.
 *
 * The claim that makes it safe is that nothing but the reading changes, so that
 * is what most of this file checks: the same order, the same gaps, the same
 * grade. `grading-unchanged.test.ts` checks it again from the other end, on a
 * recorded run of hands.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULE_PRESETS } from '@evtrainer/ev-engine';

import { chartFor } from '../src/sensitivity.ts';
import {
  RETURN_EVEN,
  RETURN_SCALE_MAX,
  barShare,
  equivalentGroups,
  returnFigure,
  returned,
  sameFigure,
} from '../src/returns.ts';
import { TrainerSession } from '../src/session.ts';
import { UthSession } from '../src/uth-session.ts';
import { loadHosted, type HostedPage } from './helpers/hosted-page.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (file: string) => readFileSync(join(HERE, '..', 'public', file), 'utf8');

/** The page's own copy of the rule, run the way the browser runs it. */
function pageFigure(rtl = false) {
  const win: any = {};
  const doc = { documentElement: { getAttribute: (name: string) => (name === 'dir' && rtl ? 'rtl' : null) } };
  new Function('window', 'document', source('figure.js'))(win, doc);
  return win.EVFigure as { ret(value: number): string };
}

// --- The scale ---------------------------------------------------------------------------------

test('the figures a player can check without trusting anything', () => {
  // Surrender: half the bet comes back, always.
  assert.equal(returnFigure(returned(-0.5, 1)), '+0.500');
  // Folding in Ultimate: the Ante and the Blind are gone and nothing comes back.
  assert.equal(returnFigure(returned(-2, 2)), '0.000');
  // Break-even, in every spot: the stake comes back and no more.
  assert.equal(returnFigure(returned(0, 1)), '+1.000');
  assert.equal(returnFigure(returned(0, 2)), '+1.000');
  assert.equal(returnFigure(returned(0, 0.5)), '+1.000');
  assert.equal(RETURN_EVEN, 1);
  // Standing on twenty against a six, and doubling it — the hand the fixed
  // scale was chosen for, and the one that goes below zero.
  assert.equal(returnFigure(returned(0.703, 1)), '+1.703');
  assert.equal(returnFigure(returned(-1.71, 1)), '−0.710');
  // Insurance stakes half a unit, so its figure is per unit of *that*: a bet
  // that loses about seven and a half cents in every chip put on it.
  assert.equal(returnFigure(returned(-0.0377, 0.5)), '+0.925');
});

test('nothing prints as minus zero, and every figure keeps three decimals', () => {
  assert.equal(returnFigure(-0.0001), '0.000');
  assert.equal(returnFigure(0), '0.000');
  assert.equal(returnFigure(1), '+1.000');
  for (let n = -2000; n <= 4000; n += 7) {
    assert.match(returnFigure(n / 1000), /^(?:0\.000|[+−]\d+\.\d{3})$/);
  }
});

test('the page writes a return exactly as the sessions do, and keeps it in one piece in Hebrew', () => {
  const page = pageFigure();
  for (let n = -2500; n <= 4000; n += 3) {
    const value = n / 1000;
    assert.equal(page.ret(value), returnFigure(value), `${value}`);
  }
  assert.equal(pageFigure(true).ret(0.5), '⁦+0.500⁩');
  assert.equal(pageFigure(true).ret(-0.71), '⁦−0.710⁩');
});

// --- What must not move ------------------------------------------------------------------------

test('over every cell of every rule set: the order and the gaps are the ones the engine graded', () => {
  let cells = 0;
  for (const preset of RULE_PRESETS) {
    for (const [key, cell] of chartFor(preset.rules).cells) {
      cells++;
      const rows = Object.entries(cell.evByAction).map(([action, ev]) => ({ action, ev: ev as number }));
      const byEv = [...rows].sort((a, b) => b.ev - a.ev).map((r) => r.action);
      const byValue = [...rows]
        .sort((a, b) => returned(b.ev, 1) - returned(a.ev, 1))
        .map((r) => r.action);
      assert.deepEqual(byValue, byEv, `${preset.id} ${key}: the scale reordered the actions`);
      for (const a of rows) {
        for (const b of rows) {
          // A gap on the card is the gap the grade was taken from, over the stake.
          const shown = returned(a.ev, 1) - returned(b.ev, 1);
          assert.ok(Math.abs(shown - (a.ev - b.ev)) < 1e-12, `${key}: ${a.action}−${b.action} moved`);
        }
      }
    }
  }
  assert.equal(cells, 311 * RULE_PRESETS.length, 'the chart is not the size this test walked');
});

test('the same holds for Ultimate, where a unit staked is the Ante and the Blind', () => {
  const session = new UthSession(20260917);
  for (let hand = 0; hand < 40; hand++) {
    session.deal();
    let view = session.view as any;
    let guard = 0;
    while ((view.legalActions ?? []).length > 0 && guard++ < 6) {
      const legal = (view.legalActions as Array<{ action: string }>).map((a) => a.action);
      session.act(legal[guard % legal.length] as never);
      view = session.view as any;
      const feedback = view.feedback;
      if (!feedback) continue;
      const ranked = feedback.ranked as Array<{ action: string; ev: number; value: number }>;
      assert.equal(feedback.returns.stake, 2);
      for (const row of ranked) {
        assert.ok(Math.abs(row.value - (1 + row.ev / 2)) < 1e-12, `${row.action} is not per unit staked`);
      }
      // Best first, by the stored EV, exactly as it was before.
      const evs = ranked.map((r) => r.ev);
      assert.deepEqual(evs, [...evs].sort((a, b) => b - a), 'the order changed');
      const fold = ranked.find((r) => r.action === 'fold');
      if (fold) assert.equal(returnFigure(fold.value), '0.000', 'folding comes back as something');
    }
  }
});

// --- Two actions that come out equal -----------------------------------------------------------

test('equivalent actions are grouped, and only when their figures really print the same', () => {
  assert.deepEqual(
    equivalentGroups([
      { action: 'hit', value: 0.5401 },
      { action: 'stand', value: 0.5399 },
      { action: 'double', value: 0.1 },
    ]),
    [['hit', 'stand']],
  );
  assert.deepEqual(equivalentGroups([{ action: 'a', value: 1 }, { action: 'b', value: 0.9 }]), []);
  assert.deepEqual(
    equivalentGroups([{ action: 'a', value: 1 }, { action: 'b', value: 1 }, { action: 'c', value: 1 }]),
    [['a', 'b', 'c']],
  );
  assert.ok(sameFigure(1.00049, 1.0001) && !sameFigure(1.0009, 1.0004));
});

test('which spots the engine actually produces them in, so the wording covers all of them', () => {
  const found: string[] = [];
  for (const preset of RULE_PRESETS) {
    for (const [key, cell] of chartFor(preset.rules).cells) {
      const rows = Object.entries(cell.evByAction)
        .map(([action, ev]) => ({ action, value: returned(ev as number, 1) }))
        .sort((a, b) => b.value - a.value);
      for (const group of equivalentGroups(rows)) found.push(`${preset.id} ${key} ${group.join('=')}`);
    }
  }
  // One cell in 1,244: hitting and doubling a soft 17 against a 2 where the
  // dealer hits his own soft 17. Both come to +0.926.
  assert.deepEqual(found, ['downtown-h17 bj:soft17:vs2 hit=double']);
});

// --- The worked example behind the `?` ----------------------------------------------------------

test('the example always rebuilds the figure it explains, on every hand it appears on', () => {
  const session = new TrainerSession('vegas-strip-6d-s17', 4242);
  let seen = 0;
  for (let hand = 0; hand < 120; hand++) {
    session.deal();
    let view = session.view as any;
    if (view.phase === 'insurance') {
      session.insurance(false);
      // An insurance spot is a bet on the hole card: no stand, and no example.
      assert.equal((session.view as any).feedback.returns.example, null);
      view = session.view as any;
    }
    let guard = 0;
    while (view.phase === 'player' && guard++ < 8) {
      const legal = view.legalActions as string[];
      session.act((legal.includes('stand') ? 'stand' : legal[0]) as never);
      const feedback = (session.view as any).feedback;
      view = session.view as any;
      const example = feedback?.returns?.example;
      if (!example) continue;
      seen++;
      // A win returns two units and a push returns one. That is the whole sum,
      // and it comes out to the figure on the bar exactly.
      assert.ok(
        Math.abs(2 * example.win + example.push - example.value) < 1e-12,
        `${feedback.headline}: ${example.win} × 2 + ${example.push} ≠ ${example.value}`,
      );
      assert.ok(example.win >= 0 && example.win <= 1, `an impossible win rate: ${example.win}`);
      // A stiff hand cannot tie, and that is what makes its example one number.
      if (example.kind === 'bust') assert.equal(example.push, 0);
      const stand = feedback.ranked.find((r: { action: string }) => r.action === 'stand');
      assert.equal(example.value, stand.value, 'the example explains a figure that is not on screen');
    }
  }
  assert.ok(seen > 60, `only ${seen} hands carried the example`);
});

// --- The pills are gone ------------------------------------------------------------------------

test('nothing draws the four EV pills any more, in either game or in the stylesheet', () => {
  for (const file of ['app.js', 'ultimate.js']) {
    const code = source(file);
    assert.doesNotMatch(code, /chipDigits|ChipDigits/i, `${file} still decides chip decimals`);
    assert.doesNotMatch(code, /className = 'evs'/, `${file} still builds the pill row`);
    assert.doesNotMatch(code, /'ev' \+ \(index === 0/, `${file} still builds a pill`);
    assert.match(code, /window\.EVReturns\.block\(/, `${file} does not draw the block`);
  }
  const css = source('styles.css');
  assert.doesNotMatch(css, /^\.ev \{/m, 'the pill still has a style');
  assert.doesNotMatch(css, /^\.evs \{/m, 'the pill row still has a style');
  assert.match(css, /\.ret-bar \{/, 'the bar has no style');
});

test('the block writes no figure of its own: every one goes through the rule', () => {
  const code = source('returns.js');
  assert.match(code, /const figure = \(value\) => window\.EVFigure\.ret\(value\);/);
  // The only `toFixed` in the file is the CSS length of a bar, which is not a
  // figure anybody reads.
  const fixed = [...code.matchAll(/toFixed\((\d)\)/g)].map((m) => m[1]);
  assert.deepEqual(fixed, ['2'], 'the block rounds a figure itself');
  assert.doesNotMatch(code, /\.ev\b/, 'the block reads the stored EV rather than the return');
});

// --- On the built page -------------------------------------------------------------------------

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const PAST_HOLD = 520;

function dockButtons(page: HostedPage): any[] {
  return page.document.getElementById('actions').children.flatMap((row: any) => row.children ?? []);
}

async function press(page: HostedPage, action: string) {
  for (let i = 0; i < 200 && !dockButtons(page).some((b) => b.dataset?.action === action); i++) await settle(5);
  await settle(PAST_HOLD);
  const node = dockButtons(page).find((b) => b.dataset?.action === action);
  assert.ok(node, `no ${action}`);
  for (const handler of node.listeners.click ?? []) handler({ preventDefault() {} });
  for (let i = 0; i < 20; i++) await settle();
}

/** Every node under one, depth first — the stub keeps children, not a tree walker. */
function walk(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  return [node, ...(node.children ?? []).flatMap((child: any) => walk(child))];
}

const withClass = (node: any, name: string) =>
  walk(node).filter((n) => String(n.className ?? '').split(' ').includes(name));

async function playOneHand(stored: Array<[string, string]> = []) {
  const page = loadHosted('#table', [['ev:playerName', 'Dana'], ['ev:showAll', '1'], ...stored]);
  await page.booted;
  // You 10-6 against a ten: the stiff hand the worked example is about.
  page.session().table.shoe.stack(page.parseCards('Ts Td 6h 7c'));
  await press(page, 'deal');
  await press(page, 'stand');
  return page;
}

test('the card draws one row per legal action, on the fixed scale, with the two lines', async () => {
  const page = await playOneHand();
  const card = page.document.getElementById('quickcard');
  const feedback = (page.session().view as any).feedback;

  const names = withClass(card, 'ret-name').map((n: any) => n.textContent);
  assert.deepEqual(names, feedback.ranked.map((r: any) => r.label), 'a row per legal action, best first');

  const figures = withClass(card, 'ret-fig').map((n: any) => n.textContent);
  assert.deepEqual(figures, feedback.ranked.map((r: any) => returnFigure(r.value)));
  assert.ok(figures.includes('+0.500'), `surrender reads its own figure: ${figures.join(' ')}`);

  // Every bar is drawn on the same 0–2.0 scale, never on the hand's own range.
  const bars = withClass(card, 'ret-bar');
  assert.equal(bars.length, feedback.ranked.length);
  bars.forEach((bar: any, index: number) => {
    const wanted = barShare(feedback.ranked[index].value) * 100;
    assert.equal(bar.style.getPropertyValue('--len'), `${wanted.toFixed(2)}%`);
  });
  assert.equal(RETURN_SCALE_MAX, 2);

  // Two lines, drawn once, spanning every row: break-even sits at half of a
  // scale that ends at 2.0, and the other marks where the best action reaches.
  const lines = withClass(card, 'ret-lines')[0];
  assert.ok(lines, 'no lines');
  assert.equal(lines.style.gridRow, `1 / span ${feedback.ranked.length}`);
  const even = withClass(card, 'ret-even')[0];
  const best = withClass(card, 'ret-best')[0];
  assert.equal(even.style.getPropertyValue('--at'), '50.00%');
  assert.equal(best.style.getPropertyValue('--at'), `${(barShare(feedback.returns.best) * 100).toFixed(2)}%`);

  // And nothing on the block says the player was wrong: the grade said it once.
  assert.equal(withClass(card, 'wrong').length + withClass(card, 'error').length, 0);
  page.stopWatching();
});

test('the ? explains the figures with this hand’s own numbers, and remembers being closed', async () => {
  const page = await playOneHand();
  const card = page.document.getElementById('quickcard');
  const help = withClass(card, 'returns-help')[0];
  assert.ok(help, 'no explanation');
  // Open by default now, for everyone, until closed (round 15).
  assert.equal(help.hidden, false);

  // The copy's own markup — bold, and figures set in the display face — is
  // stripped, so the assertions are about the words rather than the spans.
  const text = walk(help).map((n: any) => String(n.innerHTML ?? '').replace(/<[^>]*>/g, '')).join(' ');
  assert.match(text, /half the bet back, always/i, 'surrender is no longer the figure that needs no arithmetic');
  assert.match(text, /break-even/i);
  const example = (page.session().view as any).feedback.returns.example;
  assert.match(text, new RegExp(`${Math.round(example.win * 100)}%`), 'the example is not this hand’s');
  assert.match(text, /× 2/, 'the example is not a sum the player can redo');
  // `worked-lines.test.ts` holds every action's line to its own arithmetic.

  // Closing it is remembered, for this player and the next hand.
  const why = withClass(card, 'returns-why')[0];
  for (const handler of why.listeners.click ?? []) handler({ preventDefault() {} });
  assert.equal(help.hidden, true);
  assert.equal(page.storage().get('ev:returnsHelp'), 'closed');
  page.stopWatching();

  const later = await playOneHand([['ev:returnsHelp', 'closed']]);
  const stillClosed = withClass(later.document.getElementById('quickcard'), 'returns-help')[0];
  assert.equal(stillClosed.hidden, true, 'the explanation reopened itself after being closed');
  later.stopWatching();
});

test('a new player is told what this is, and can find it again under How to play', async () => {
  // Round 14 moved the passage out of its dialog and onto the first screen,
  // where the level question follows it; `level.test.ts` covers that flow. What
  // matters here is that the words survived the move, and are still reachable.
  const page = loadHosted('#table', [['ev:playerName', 'Dana']]);
  await page.booted;
  for (let i = 0; i < 40; i++) await settle();
  const body = page.document.getElementById('intro-body');
  assert.match(String(body.innerHTML), /not a blackjack game/i);
  assert.match(String(body.innerHTML), /<b>.*that is the point.*<\/b>/i, 'the point is not the emphasis');

  for (const handler of page.document.getElementById('open-howto').listeners.click ?? []) handler({ preventDefault() {} });
  assert.match(String(page.document.getElementById('howto-lead').innerHTML), /not a blackjack game/i);
  page.stopWatching();
});
