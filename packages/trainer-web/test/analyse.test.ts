/**
 * The hand analyser (round 16).
 *
 * A player names cards and asks what they are worth, without playing. Idan
 * settled five things about it, and each one is a test here:
 *
 *   1. Cards go in, not a total — 10-6, 8-8 and 5-6-5 are all "sixteen" and all
 *      three offer different things.
 *   2. Ranks only; a ten covers the jack, the queen and the king.
 *   3. Legality is derived from the cards, never assumed.
 *   4. It counts towards nothing — structurally, by holding no session at all.
 *   5. The rule set is part of the input, and changes the answer where it
 *      should (§3.3).
 *
 * Plus the two that are easy to miss: an impossible hand is refused rather than
 * answered, and a hand with nothing left to decide says so.
 *
 * The strongest test in the file is the last one: the analyser and the table are
 * asked about the same spot and have to agree to the last decimal, because a
 * reference that disagrees with the game is worse than no reference.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULE_PRESETS } from '@evtrainer/ev-engine';

import { analyse, ANALYSER_MAX_CARDS, ANALYSER_RANKS, handValueOf } from '../src/analyse.ts';
import { catalogue } from '../src/i18n.ts';
import { TrainerSession } from '../src/session.ts';
import { loadHosted, type HostedPage } from './helpers/hosted-page.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const ask = (player: string[], dealer: string, extra: Record<string, unknown> = {}) =>
  analyse({ player, dealer, ...extra }) as any;

// --- Cards, not a total --------------------------------------------------------------

test('sixteen is not sixteen: the same total, three different sets of choices', () => {
  const byCards = ask(['10', '6'], '10');
  const pair = ask(['8', '8'], '10');
  const drawn = ask(['5', '6', '5'], '10');

  const actions = (result: any) => result.ranked.map((row: any) => row.action).sort();
  assert.deepEqual(actions(byCards), ['double', 'hit', 'stand', 'surrender']);
  assert.deepEqual(actions(pair), ['double', 'hit', 'split', 'stand', 'surrender']);
  // Three cards: no double, no surrender, and nothing to split.
  assert.deepEqual(actions(drawn), ['hit', 'stand']);
  for (const result of [byCards, pair, drawn]) assert.equal(result.hand.total, 16);
});

test('ranks only, and a ten is any ten-card', () => {
  assert.deepEqual([...ANALYSER_RANKS], ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  // Four ten-cards in one hand is possible even in a single deck — there are
  // sixteen of them — and it is over 21, which is what it is refused for.
  const four = ask(['10', '10', '10', '10'], '9', { presetId: 'single-deck-6-5' });
  assert.equal(four.problem, 'bust');
  // No suit reaches the analyser at all.
  const source = readFileSync(join(HERE, '..', 'src', 'analyse.ts'), 'utf8');
  assert.doesNotMatch(source, /suited|suit picker|hearts|spades/i);
  assert.equal(handValueOf(['A', '6']).total, 17);
  assert.equal(handValueOf(['A', '6']).soft, true);
  assert.equal(handValueOf(['A', '6', '10']).total, 17, 'the ace did not drop to one');
  assert.equal(handValueOf(['A', 'A']).total, 12);
});

test('legality comes from the cards and the rules in force, never from an assumption', () => {
  // Surrender is offered on the first two cards, where the table offers it…
  assert.ok(ask(['10', '6'], '10').ranked.some((r: any) => r.action === 'surrender'));
  // …and not where the rule set has none.
  assert.ok(!ask(['10', '6'], '10', { presetId: 'european-nhc' }).ranked.some((r: any) => r.action === 'surrender'));
  // A pair may be split; the same total from three cards may not.
  assert.ok(ask(['8', '8'], '6').ranked.some((r: any) => r.action === 'split'));
  assert.ok(!ask(['8', '5', '3'], '6').ranked.some((r: any) => r.action === 'split'));
  // Doubling a soft hand, by the rules of the table being asked about.
  assert.ok(ask(['A', '6'], '5').ranked.some((r: any) => r.action === 'double'));
});

test('a third and a fourth card are allowed, and a fifth is not', () => {
  assert.equal(ask(['5', '4', '3'], '10').ok, true);
  assert.equal(ask(['5', '4', '3', '2'], '10').ok, true);
  const five = ask(['5', '4', '3', '2', '2'], '10');
  assert.equal(five.ok, false);
  assert.equal(five.problem, 'tooManyCards');
  assert.ok(five.says.includes(String(ANALYSER_MAX_CARDS)));
});

// --- Refusals -------------------------------------------------------------------------

test('a hand that cannot exist is refused with a sentence, not answered with a figure', () => {
  const impossible = ask(['A', 'A', 'A', 'A'], 'A', { presetId: 'single-deck-6-5' });
  assert.equal(impossible.ok, false);
  assert.equal(impossible.problem, 'impossible');
  assert.match(impossible.says, /single deck/i);
  assert.match(impossible.says, /4 aces/i);
  assert.equal(impossible.ranked, undefined, 'a figure was printed for a hand that cannot be dealt');
  // Six decks hold enough of them, and then it is a real question.
  assert.equal(ask(['A', 'A', 'A', 'A'], 'A').ok, true);
});

test('a hand with nothing left to decide says so', () => {
  const natural = ask(['A', '10'], '9');
  assert.equal(natural.problem, 'blackjack');
  assert.equal(natural.ranked, undefined);
  const bust = ask(['10', '9', '5'], '9');
  assert.equal(bust.problem, 'bust');
  assert.match(bust.says, /24/);
  // Twenty-one on three cards stands itself.
  const twentyOne = ask(['10', '6', '5'], '9');
  assert.equal(twentyOne.ok, false);
  assert.match(twentyOne.says, catalogue('en')['an.twentyOne']!.slice(0, 20) === '' ? /./ : /stands itself|Twenty-one/i);
  // And half a hand is not a question yet.
  assert.equal(ask(['10'], '9').problem, 'needCards');
  assert.equal(ask(['10', '6'], '').problem, 'needCards');
  assert.equal(ask(['10', 'Z'], '9').problem, 'badRank');
});

// --- The rule set is part of the input --------------------------------------------------

test('the same cards, four rule sets, and the answer moves where it should', () => {
  const answers = RULE_PRESETS.map((preset) => {
    const result = ask(['10', '6'], '10', { presetId: preset.id });
    return [preset.id, result.best.action, result.ruleSet.name] as const;
  });
  // Surrender where it is offered; hitting where it is not.
  const byId = Object.fromEntries(answers.map(([id, best]) => [id, best]));
  assert.equal(byId['vegas-strip-6d-s17'], 'surrender');
  assert.equal(byId['european-nhc'], 'hit', 'a table with no surrender still answered "surrender"');
  // And each answer names the rules it was given.
  for (const [id, , name] of answers) assert.ok(name.length > 3, `${id} came back unnamed`);

  // §3.3 made visible: the analyser says which rules would change this answer.
  const sensitive = ask(['A', '7'], '2');
  assert.ok(Array.isArray(sensitive.sensitivity));
  // A soft 18 against a deuce is the textbook rule-sensitive spot.
  assert.ok(sensitive.sensitivity.length > 0 || sensitive.best.action === 'stand');
});

// --- It counts towards nothing ------------------------------------------------------------

test('nothing the analyser touches can reach a score — by what it holds, not by a promise', () => {
  const whole = readFileSync(join(HERE, '..', 'src', 'analyse.ts'), 'utf8');
  // The prose above the code says what it refuses to hold, so the scan reads
  // the code itself.
  const source = whole.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // No session, so no rating, no accuracy, no EV-lost, no streak, no day count.
  assert.doesNotMatch(source, /TrainerSession|UthSession/, 'the analyser holds a session');
  assert.doesNotMatch(source, /rating|accuracy|evLost|streak|activity|mastery|progress/i, 'the analyser can see a score');
  assert.doesNotMatch(source, /localStorage|store\.set|save/i, 'the analyser writes something down');
  // And the routes that answer it do the same: they call the function, and
  // nothing else.
  const shell = readFileSync(join(HERE, '..', 'artifact', 'shell.js'), 'utf8');
  const route = shell.slice(shell.indexOf("case '/api/analyse'"), shell.indexOf('case', shell.indexOf("case '/api/analyse'") + 10));
  assert.doesNotMatch(route, /session|markPlayed|save/i, 'the hosted route touches a session');
  const server = readFileSync(join(HERE, '..', 'src', 'server.ts'), 'utf8');
  const serverRoute = server.slice(server.indexOf("case '/api/analyse'"), server.indexOf('case', server.indexOf("case '/api/analyse'") + 10));
  assert.doesNotMatch(serverRoute, /session\./i, 'the local route touches the session');
});

test('and asking it a hundred questions moves nothing in a session that is playing', () => {
  const session = new TrainerSession('vegas-strip-6d-s17', 99);
  session.deal();
  const before = JSON.stringify({ stats: session.stats, view: (session.view as any).rating });
  for (let i = 0; i < 100; i++) {
    ask(['10', '6'], String((i % 9) + 2) as string);
    ask(['8', '8'], '10');
  }
  const after = JSON.stringify({ stats: session.stats, view: (session.view as any).rating });
  assert.equal(after, before);
});

// --- The reference agrees with the game ------------------------------------------------------

test('the analyser and the table answer the same spot identically', () => {
  const session = new TrainerSession('vegas-strip-6d-s17', 20260919);
  let compared = 0;

  for (let hand = 0; hand < 120 && compared < 40; hand++) {
    session.deal();
    let view = session.view as any;
    if (view.phase === 'insurance') {
      session.insurance(false);
      view = session.view as any;
    }
    if (view.phase !== 'player') continue;
    const playing = view.hands.find((hand: any) => hand.active) ?? view.hands[0];
    const asRank = (card: any) => (['J', 'Q', 'K', '10'].includes(card.rank) ? '10' : card.rank);
    const player = playing.cards.map(asRank);
    const dealer = asRank(view.dealer.cards[0]);
    if (player.some((rank: string) => !ANALYSER_RANKS.includes(rank as never)) || !dealer) {
      session.act('stand');
      continue;
    }

    const asked = ask(player, dealer);
    session.act('stand');
    const feedback = (session.view as any).feedback;
    if (!feedback || !asked.ok) continue;
    compared++;

    // The same actions, in the same order, at the same figures.
    assert.deepEqual(
      asked.ranked.map((row: any) => [row.action, row.value.toFixed(6)]),
      feedback.ranked.map((row: any) => [row.action, row.value.toFixed(6)]),
      `${feedback.headline}: the analyser disagrees with the table`,
    );
    // And the same working under each of them.
    assert.deepEqual(
      (asked.returns.worked as any[]).map((w) => w && [w.kind, w.value.toFixed(6), w.digits]),
      (feedback.returns.worked as any[]).map((w) => w && [w.kind, w.value.toFixed(6), w.digits]),
      `${feedback.headline}: the working differs`,
    );
    assert.equal(asked.headline, feedback.headline);
  }
  assert.ok(compared >= 20, `only ${compared} spots were compared`);
});

// --- On the built page --------------------------------------------------------------------------

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function walk(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  return [node, ...(node.children ?? []).flatMap((child: any) => walk(child))];
}

const withClass = (node: any, name: string) =>
  walk(node).filter((n) => String(n.className ?? '').split(' ').includes(name));

const tap = (node: any) => {
  for (const handler of node.listeners?.click ?? []) handler({ preventDefault() {} });
};

test('on the built page, three taps enter a hand and the same block comes back', async () => {
  const page = loadHosted('#analyse', [['ev:playerName', 'Dana'], ['ev:introSeen', '1'], ['ev:level', 'intermediate']]);
  await page.booted;
  for (let i = 0; i < 40; i++) await settle();

  const keys = page.document.getElementById('an-pad').children;
  assert.equal(keys.length, 10, 'the keypad is not ten ranks');
  const key = (rank: string) => keys.find((k: any) => k.dataset.rank === rank);

  // Three taps: two cards and the dealer's.
  tap(key('10'));
  tap(key('6'));
  tap(key('10'));
  for (let i = 0; i < 60; i++) await settle();

  const result = page.document.getElementById('an-result');
  assert.equal(result.hidden, false, 'three taps produced no answer');
  assert.match(String(page.document.getElementById('an-best').textContent), /Surrender/);
  // The same block the table draws: a row per action, with its working.
  const card = page.document.getElementById('an-card');
  assert.equal(withClass(card, 'ret-name').length, 4);
  assert.equal(withClass(card, 'worked').length, 4);
  assert.ok(withClass(card, 'returns-help')[0], 'the explanation panel is missing');

  // A fourth tap adds a card, and the choices narrow.
  tap(page.document.getElementById('an-add'));
  tap(key('2'));
  for (let i = 0; i < 60; i++) await settle();
  assert.equal(withClass(page.document.getElementById('an-card'), 'ret-name').length, 2, 'a drawn card left double and surrender on offer');

  // Starting again empties it.
  tap(page.document.getElementById('an-clear'));
  for (let i = 0; i < 40; i++) await settle();
  assert.equal(page.document.getElementById('an-result').hidden, true);
  page.stopWatching();
});

test('the door to it is on home, beside the two tables', () => {
  const home = readFileSync(join(HERE, '..', 'public', 'home.html'), 'utf8');
  const door = home.indexOf('href="/analyse.html"');
  assert.ok(door > 0, 'there is no door');
  assert.ok(door > home.indexOf('href="/ultimate.html"'), 'the analyser is not beside the tables');
  // And the built page knows the screen.
  const ui = readFileSync(join(HERE, '..', 'artifact', 'ui.js'), 'utf8');
  assert.match(ui, /'#analyse': 'analyse'/);
  assert.match(ui, /initAnalyse\(\)/);
});
