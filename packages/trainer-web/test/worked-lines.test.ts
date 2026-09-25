/**
 * Every action, worked out, with this hand's own numbers (round 15).
 *
 * Idan rejected the prose this replaces — "hitting has no single sum", "the
 * extra money is already inside the figure" — and asked for a line with real
 * figures for every option, in every hand. The standard round 13 set for the
 * stand example now applies to all of them: **the sum has to come out.** An
 * explanation whose whole point is that a player can check it is worth nothing
 * if the arithmetic does not close.
 *
 * So this file does the checking, for every action the engine can offer, over
 * hundreds of hands: the terms are real, the assumption is stated in the copy,
 * and the sum rebuilds the figure on the bar beside it — exactly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULE_PRESETS } from '@evtrainer/ev-engine';

import { catalogue, t } from '../src/i18n.ts';
import { returnFigure } from '../src/returns.ts';
import { TrainerSession } from '../src/session.ts';
import { loadHosted, type HostedPage } from './helpers/hosted-page.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (file: string) => readFileSync(join(HERE, '..', 'public', file), 'utf8');

/**
 * The arithmetic each kind of line claims, written out here rather than
 * imported — a test that reuses the code it checks proves only that the code
 * agrees with itself.
 */
function rebuild(work: any): number | null {
  switch (work.kind) {
    case 'stand':
      return 2 * work.win;
    case 'standPush':
      return 2 * work.win + work.push;
    case 'hit':
      return work.survive * work.surviveValue;
    case 'hitAlwaysBreaks':
      return 0;
    case 'double':
      return 2 * work.oneCard - 1;
    case 'split':
      return 2 * work.perHand - 1;
    case 'surrender':
      return 0.5;
    case 'insurance':
      return 3 * work.ten;
    case 'decline':
      return 1;
    default:
      return null;
  }
}

/** Play a long, deliberately varied session and collect every worked line. */
function workedLines(presetId: string, seed: number, hands = 120) {
  const session = new TrainerSession(presetId, seed);
  const seen: Array<{ work: any; headline: string; legal: string[] }> = [];
  const take = () => {
    const feedback = (session.view as any).feedback;
    if (!feedback?.returns?.worked) return;
    for (const work of feedback.returns.worked) {
      if (work) seen.push({ work, headline: feedback.headline, legal: feedback.ranked.map((r: any) => r.action) });
    }
  };
  for (let hand = 0; hand < hands; hand++) {
    session.deal();
    let view = session.view as any;
    if (view.phase === 'insurance') {
      session.insurance(hand % 2 === 0);
      take();
      view = session.view as any;
    }
    let guard = 0;
    while (view.phase === 'player' && guard++ < 8) {
      const legal = view.legalActions as string[];
      session.act(legal[(hand + guard) % legal.length] as never);
      take();
      view = session.view as any;
    }
  }
  return seen;
}

// --- The sums come out ---------------------------------------------------------------------------

test('every worked line rebuilds the figure it explains, exactly', () => {
  let checked = 0;
  const kinds = new Set<string>();
  for (const preset of RULE_PRESETS) {
    for (const { work, headline } of workedLines(preset.id, 4242)) {
      const rebuilt = rebuild(work);
      assert.ok(rebuilt !== null, `${work.kind} has no arithmetic this test knows`);
      kinds.add(work.kind);
      checked++;
      assert.ok(
        Math.abs(rebuilt - work.value) < 1e-9,
        `${preset.id} ${headline}: ${work.kind} works out to ${rebuilt} but the bar says ${work.value}`,
      );
      // And it still comes out when written the way a player reads it.
      assert.equal(
        returnFigure(rebuilt),
        returnFigure(work.value),
        `${headline}: ${work.kind} prints a sum that does not match its figure`,
      );
    }
  }
  assert.ok(checked > 1500, `only ${checked} lines were checked`);
  assert.deepEqual(
    [...kinds].sort(),
    ['decline', 'double', 'hit', 'insurance', 'split', 'stand', 'standPush', 'surrender'],
    'a kind of line went unchecked',
  );
});

test('every legal action carries one, including on a pair, where round 13 had none', () => {
  for (const { work, legal, headline } of workedLines('vegas-strip-6d-s17', 77, 60)) {
    assert.ok(legal.includes(work.action), `${headline}: a line for an action that was not offered`);
  }
  // Every action offered gets one: no silent gaps.
  const session = new TrainerSession('vegas-strip-6d-s17', 9);
  let pairs = 0;
  for (let hand = 0; hand < 200 && pairs < 5; hand++) {
    session.deal();
    let view = session.view as any;
    if (view.phase === 'insurance') {
      session.insurance(false);
      view = session.view as any;
    }
    if (view.phase !== 'player') continue;
    const legal = view.legalActions as string[];
    session.act('stand' as never);
    const feedback = (session.view as any).feedback;
    if (!feedback) continue;
    const worked = feedback.returns.worked.filter(Boolean);
    assert.deepEqual(
      worked.map((w: any) => w.action).sort(),
      [...legal].sort(),
      `${feedback.headline}: ${legal.length} actions, ${worked.length} worked lines`,
    );
    if (feedback.scenarioKey.includes('pair')) pairs++;
  }
  assert.ok(pairs >= 5, `only ${pairs} pair spots were reached`);
});

test('the numbers in a line are real, not decoration', () => {
  for (const { work, headline } of workedLines('vegas-strip-6d-s17', 31, 60)) {
    for (const [name, value] of Object.entries(work)) {
      if (typeof value !== 'number') continue;
      assert.ok(Number.isFinite(value), `${headline}: ${work.kind}.${name} is ${value}`);
    }
    // Probabilities are probabilities.
    for (const name of ['win', 'push', 'bust', 'survive', 'ten']) {
      const p = work[name];
      if (p === undefined) continue;
      assert.ok(p >= 0 && p <= 1, `${headline}: ${work.kind}.${name} is ${p}, which is not a chance`);
    }
    if (work.kind === 'hit') {
      assert.ok(Math.abs(work.bust + work.survive - 1) < 1e-12, 'breaking and surviving do not add up');
    }
  }
});

// --- The copy the sums are written into -----------------------------------------------------------

test('every kind has a sentence and a sum, in both languages, and the sum is language-neutral', () => {
  const kinds = ['stand', 'standPush', 'hit', 'hitAlwaysBreaks', 'double', 'split', 'surrender', 'insurance', 'decline'];
  for (const kind of kinds) {
    for (const locale of ['en', 'he'] as const) {
      const say = catalogue(locale)[`work.${kind}`];
      const sum = catalogue(locale)[`work.${kind}.sum`];
      assert.ok(say && say.length > 10, `${locale} has no sentence for ${kind}`);
      assert.ok(sum && sum.includes('{value}'), `${locale} has no sum for ${kind}`);
      // The sum is arithmetic: no prose, so it reads the same in both.
      assert.equal(sum, catalogue('en')[`work.${kind}.sum`], `${locale} rewrote the arithmetic of ${kind}`);
    }
  }
  // Hitting states its assumption, in both languages — it is the one line whose
  // figure depends on how the rest of the hand is played.
  assert.match(catalogue('en')['work.hit']!, /played as well as it can be/i);
  assert.match(catalogue('he')['work.hit']!, /בצורה הטובה ביותר/);
  // And the sentence names the action, as Idan's model does.
  assert.match(t('he', 'work.stand', { action: 'עצירה', win: '23%' }), /^בחירה ב\*\*עצירה\*\*/);
});

test('the prose Idan rejected is gone, and the break-even sentence is said once', () => {
  const english = catalogue('en');
  const hebrew = catalogue('he');
  for (const key of ['ret.helpHit', 'ret.helpDouble', 'ret.helpStandBust', 'ret.helpStandPush', 'ret.helpSurrender']) {
    assert.equal(english[key], undefined, `${key} is still in the catalogue`);
  }
  // "1.000 is break-even" belongs to the paragraph that defines the scale, and
  // to nothing else.
  for (const table of [english, hebrew]) {
    const says = Object.entries(table).filter(([key, value]) =>
      key.startsWith('ret.') && /break-even|נקודת האיזון/.test(value),
    );
    assert.deepEqual(says.map(([key]) => key), ['ret.helpWhat'], 'break-even is explained twice');
  }
});

// --- On the built page ------------------------------------------------------------------------------

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function dockButtons(page: HostedPage): any[] {
  return page.document.getElementById('actions').children.flatMap((row: any) => row.children ?? []);
}

async function press(page: HostedPage, action: string) {
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

const flat = (node: any) => String(node?.innerHTML ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

test('the panel draws one working per action, each with its sum on its own line', async () => {
  const page = loadHosted('#table', [
    ['ev:playerName', 'Dana'],
    ['ev:showAll', '1'],
    ['ev:introSeen', '1'],
    ['ev:level', 'new'],
  ]);
  await page.booted;
  // 10-6 against a ten: hit, stand, surrender — three different kinds of line.
  page.session().table.shoe.stack(page.parseCards('Ts Td 6h 7c'));
  await press(page, 'deal');
  await press(page, 'stand');

  const card = page.document.getElementById('quickcard');
  const feedback = (page.session().view as any).feedback;
  const worked = withClass(card, 'worked');
  assert.equal(worked.length, feedback.ranked.length, 'an action was left without its working');

  for (const holder of worked) {
    const say = withClass(holder, 'worked-say')[0];
    const sum = withClass(holder, 'worked-sum')[0];
    assert.ok(say && flat(say).length > 20, 'a working with no sentence');
    assert.ok(sum, 'a working whose sum is not on its own line');
    // The figure the sum ends on is a figure on a bar beside it.
    const printed = flat(sum);
    const figures = feedback.ranked.map((row: any) => returnFigure(row.value));
    assert.ok(figures.some((f: string) => printed.endsWith(f)), `${printed} ends on no figure from the card`);
    assert.ok(!printed.includes('\n'), 'the sum is broken across lines');
  }

  // Every level shows them: the working is what a beginner needs most.
  assert.equal(page.storage().get('ev:level'), 'new');
  page.stopWatching();
});

test('the explanation is open by default, and the control that closes it is a real target', async () => {
  const page = loadHosted('#table', [
    ['ev:playerName', 'Dana'],
    ['ev:showAll', '1'],
    ['ev:introSeen', '1'],
    ['ev:level', 'intermediate'],
  ]);
  await page.booted;
  page.session().table.shoe.stack(page.parseCards('Ts Td 6h 7c'));
  await press(page, 'deal');
  await press(page, 'stand');

  const card = page.document.getElementById('quickcard');
  const help = withClass(card, 'returns-help')[0];
  const why = withClass(card, 'returns-why')[0];
  assert.equal(help.hidden, false, 'the explanation did not open by itself');
  assert.equal(why.textContent, '×', 'the control does not say it closes');
  assert.equal(page.storage().get('ev:returnsHelp'), undefined, 'it needed a stored preference to open');

  for (const handler of why.listeners.click ?? []) handler({ preventDefault() {} });
  assert.equal(help.hidden, true);
  assert.equal(why.textContent, '?');
  assert.equal(page.storage().get('ev:returnsHelp'), 'closed');
  page.stopWatching();

  // A player who closed it keeps it closed; everyone else opens to it.
  const again = loadHosted('#table', [
    ['ev:playerName', 'Dana'],
    ['ev:showAll', '1'],
    ['ev:introSeen', '1'],
    ['ev:returnsHelp', 'closed'],
  ]);
  await again.booted;
  again.session().table.shoe.stack(again.parseCards('Ts Td 6h 7c'));
  await press(again, 'deal');
  await press(again, 'stand');
  assert.equal(withClass(again.document.getElementById('quickcard'), 'returns-help')[0].hidden, true);
  again.stopWatching();
});

/**
 * Read the printed sum the way a player would: left to right, doing what it
 * says. This is the whole promise of the feature — that somebody can check it —
 * so it is checked here on the string that actually reaches the screen, not on
 * the numbers behind it.
 */
function evaluateSum(text: string): { left: number; right: string } {
  const plain = text.replace(/[⁦⁩]/g, '').replace(/−/g, '-').replace(/\s+/g, ' ').trim();
  // Surrender's line, and the two other flat ones, are a figure and no sum:
  // there is nothing to work out, which is the point of them.
  if (plain.indexOf('=') < 0) return { left: Number(plain.replace('+', '')), right: plain };
  const [lhs, rhs] = plain.split('=').map((part) => part.trim());
  const num = (token: string) => (token.endsWith('%') ? Number(token.slice(0, -1)) / 100 : Number(token));
  const tokens = lhs!.split(' ');
  let left = num(tokens[0]!);
  for (let i = 1; i < tokens.length; i += 2) {
    const value = num(tokens[i + 1]!);
    if (tokens[i] === '×') left *= value;
    else if (tokens[i] === '+') left += value;
    else if (tokens[i] === '-') left -= value;
    else assert.fail(`${text}: what is "${tokens[i]}"?`);
  }
  return { left, right: rhs! };
}

test('a player who does the arithmetic on screen gets the figure on screen — in both languages', async () => {
  for (const locale of ['en', 'he'] as const) {
    const page = loadHosted('#table', [
      ['ev:playerName', 'Dana'],
      ['ev:showAll', '1'],
      ['ev:introSeen', '1'],
      ['ev:locale', locale],
    ]);
    await page.booted;
    let checked = 0;
    for (let hand = 0; hand < 12; hand++) {
      await press(page, 'deal');
      const view = page.session().view as any;
      if (view.phase === 'insurance') await press(page, 'declineInsurance');
      if ((page.session().view as any).phase === 'player') await press(page, 'stand');
      for (const holder of withClass(page.document.getElementById('quickcard'), 'worked')) {
        const sum = withClass(holder, 'worked-sum')[0];
        if (!sum) continue;
        const printed = flat(sum);
        const { left, right } = evaluateSum(printed);
        checked++;
        assert.equal(
          returnFigure(left).replace('−', '-'),
          right.replace(/[⁦⁩]/g, ''),
          `${locale}: "${printed}" does not come out`,
        );
      }
    }
    assert.ok(checked > 20, `${locale}: only ${checked} sums were read back`);
    page.stopWatching();
  }
});

test('the sum is laid out so that it cannot break, in either direction', () => {
  const css = source('styles.css');
  const rule = css.slice(css.indexOf('.worked-sum {'), css.indexOf('}', css.indexOf('.worked-sum {')));
  for (const needed of ['direction: ltr', 'white-space: nowrap', 'overflow-x: auto']) {
    assert.ok(rule.includes(needed), `.worked-sum is missing ${needed}`);
  }
  // Every number in the explanation is bold (Idan, round 15).
  assert.match(css, /\.returns-help \.num \{[^}]*font-weight: 700/);
  // And the control that closes it is big enough to hit.
  const sizes = [...css.matchAll(/\.returns-why \{([^}]*)\}/g)]
    .map((rule) => /width: (\d+)px/.exec(rule[1]!))
    .filter(Boolean);
  const biggest = Math.max(...sizes.map((size) => Number(size![1])));
  assert.ok(biggest >= 32, `the close control is ${biggest}px`);
});
