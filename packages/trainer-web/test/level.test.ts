/**
 * How much the app explains (round 14).
 *
 * The player says how much explanation he wants. Three things have to be true,
 * and the first is not negotiable:
 *
 *   1. A LEVEL IS NOT A DIFFICULTY. The grade, the figures, what a mistake
 *      cost, accuracy and the rating are identical at all three. If a level
 *      could move a score the leaderboard would mean nothing.
 *   2. ONE EXPLANATION, THREE DEPTHS. A beginner is shown *less* of the same
 *      words, never different ones — checked here as a literal subset, so a
 *      well-meant rewrite for beginners fails the build.
 *   3. CHANGEABLE AT ANY TIME, and saved with the player so it follows him.
 *
 * The first screen, the strip, the breakdown and the arrow all hang off it, and
 * are checked here too.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalogue } from '../src/i18n.ts';
import { gradedRun } from './helpers/grading-run.ts';
import { loadHosted, type HostedPage } from './helpers/hosted-page.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (file: string) => readFileSync(join(HERE, '..', 'public', file), 'utf8');

/** The level rule, run the way the browser runs it. */
function levels(stored: string | null = null) {
  const store = new Map<string, string>(stored ? [['ev:level', stored]] : []);
  const win: any = { dispatchEvent() {}, EV: null };
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
  new Function('window', 'document', 'localStorage', 'CustomEvent', source('level.js'))(
    win,
    { documentElement: { getAttribute: () => null } },
    storage,
    function CustomEvent(this: any) {},
  );
  return { level: win.EVLevel, store, win };
}

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

/** Every node under one, depth first. */
function walk(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  return [node, ...(node.children ?? []).flatMap((child: any) => walk(child))];
}

const withClass = (node: any, name: string) =>
  walk(node).filter((n) => String(n.className ?? '').split(' ').includes(name));

/** All the text under a node, markup stripped. */
function textOf(node: any): string {
  return walk(node)
    .map((n) => `${n.textContent ?? ''} ${String(n.innerHTML ?? '').replace(/<[^>]*>/g, ' ')}`)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- The rule itself ---------------------------------------------------------------------------

test('three levels, and an app that has never been asked draws the middle one', () => {
  const { level } = levels();
  assert.deepEqual(level.LEVELS, ['new', 'intermediate', 'advanced']);
  assert.equal(level.read(), null, 'an unasked app claims an answer');
  assert.equal(level.get(), 'intermediate');
  assert.equal(level.rank('new'), 0);
  assert.equal(level.rank('advanced'), 2);
  // Nonsense in storage is not a level.
  assert.equal(levels('expert').level.read(), null);
});

test('the answer is remembered, and reading it back is what the page draws by', () => {
  const { level, store } = levels();
  assert.equal(level.set('new'), 'new');
  assert.equal(store.get('ev:level'), 'new');
  assert.equal(level.read(), 'new');
  assert.equal(level.set('nonsense'), 'new', 'a bad value overwrote a good one');
});

test('less, never different: every level is shown a subset of the one above it', () => {
  const { level } = levels();
  const steps = ['the dealer', 'the hand', 'the two together'];
  const help = ['what', 'anchor', 'example', 'hit', 'double', 'lines'];

  const shownSteps = (at: string) => steps.slice(3 - level.steps(at));
  const shownHelp = (at: string) => help.slice(0, level.helpDepth(at));
  const shownCells = (at: string) => level.cells(at);

  for (const [lower, higher] of [['new', 'intermediate'], ['intermediate', 'advanced']] as const) {
    for (const shown of [shownSteps, shownHelp, shownCells]) {
      const less = shown(lower);
      const more = shown(higher);
      assert.ok(less.length <= more.length, `${lower} is shown more than ${higher}`);
      for (const item of less) {
        assert.ok(more.includes(item), `${lower} is shown "${item}", which ${higher} never shows`);
      }
    }
  }
  // And the ends of the scale are what they say they are.
  assert.deepEqual(shownSteps('new'), ['the two together'], 'a beginner reads more than the conclusion');
  assert.deepEqual(shownSteps('advanced'), steps);
  assert.equal(level.helpDepth('new'), 2);
  assert.equal(level.helpDepth('advanced'), help.length);
  assert.deepEqual(level.cells('new'), ['accuracy', 'units']);
  assert.deepEqual(level.cells('advanced'), ['accuracy', 'evLost', 'edge', 'units']);
  assert.equal(level.breakdown('advanced'), true);
  assert.equal(level.breakdown('intermediate'), false);
  assert.equal(level.breakdown('new'), false);
});

// --- A level may never touch a score -------------------------------------------------------------

test('nothing that grades, costs or rates can even see the level', () => {
  // The sessions are where every score comes from. If none of them reads the
  // level, no level can change one — which is a stronger statement than any
  // number of replayed hands, and it is checked over the whole of src/.
  for (const file of ['session.ts', 'uth-session.ts', 'explain.ts', 'difficulty.ts', 'returns.ts', 'server.ts']) {
    const code = readFileSync(join(HERE, '..', 'src', file), 'utf8');
    assert.doesNotMatch(code, /EVLevel|ev:level|\blevel\b\s*[:=]/i, `${file} reads the level`);
  }
  // And the record's level is a preference the shell carries, never something
  // a session restores.
  const shell = readFileSync(join(HERE, '..', 'artifact', 'shell.js'), 'utf8');
  assert.match(shell, /level: window\.EVLevel|EVLevel\.read\(\)/);
  assert.doesNotMatch(shell, /session\.restore\([^)]*level/);
});

/** Wait for the table to reach a phase, rather than for a number of ticks. */
async function until(page: HostedPage, phase: string) {
  for (let i = 0; i < 400; i++) {
    if ((page.session().view as any).phase === phase) return;
    await settle(5);
  }
  assert.fail(`the table never reached ${phase}`);
}

test('the same hands, played at all three levels, are graded identically', async () => {
  const played: Array<Record<string, unknown>> = [];
  for (const level of ['new', 'intermediate', 'advanced']) {
    const page = loadHosted('#table', [
      ['ev:playerName', 'Dana'],
      ['ev:showAll', '1'],
      ['ev:introSeen', '1'],
      ['ev:level', level],
    ]);
    await page.booted;
    // The same shoe and the same decisions, three times over. Every graded
    // decision is captured as it happens, so the comparison is of the grading
    // rather than of how far three differently-timed runs happened to get.
    // Nine cards, so that nothing in the script depends on what the shoe deals
    // next: a 16 that stands against a 17, then a 16 that hits into a king and
    // is over. A hosted page seeds its shoe from the clock, so anything left to
    // the shoe would differ between the three runs and have nothing to do with
    // the levels this test is about.
    page.session().table.shoe.stack(page.parseCards('Ts Td 6h 7c 9s 8d 7h 2c Ks'));
    const graded: unknown[] = [];
    const record = () => {
      const feedback = (page.session().view as any).feedback;
      if (!feedback) return;
      graded.push([
        feedback.headline,
        feedback.chosen,
        feedback.optimal,
        feedback.correct,
        feedback.severity,
        feedback.evCost,
        feedback.ratingDelta,
        feedback.closeCall,
        feedback.ranked.map((r: any) => [r.action, r.ev, r.value]),
        feedback.spot && [feedback.spot.rating, feedback.spot.band, feedback.spot.oneIn],
      ]);
    };

    await press(page, 'deal');
    await press(page, 'stand');
    record();
    await until(page, 'settled');
    await press(page, 'deal');
    await press(page, 'hit');
    record();
    await until(page, 'settled');

    const view = page.session().view as any;
    const stats = page.session().stats;
    played.push({
      level,
      graded,
      rating: [view.rating.rating, view.rating.peak, view.rating.ratedDecisions],
      stats: [stats.decisions, stats.correct, stats.evLost, stats.netUnits, stats.accuracy, stats.evLostPer100],
      // Every figure is computed and saved at every level, including the ones
      // the strip is not showing — otherwise moving up a level in a month finds
      // a hole where the history was.
      edge: stats.effectiveHouseEdgePercent,
      track: view.track.map((row: any) => [row.dots.join(''), row.net]),
      log: (page.session() as any).hands_.map((hand: any) => [hand.netUnits, hand.decisions.length]),
    });
    page.stopWatching();
  }
  const [beginner, middle, expert] = played;
  const without = (row: any) => ({ ...row, level: undefined });
  assert.deepEqual(without(beginner!), without(middle!), 'a beginner was graded differently');
  assert.deepEqual(without(middle!), without(expert!), 'an expert was graded differently');
  assert.equal((beginner!.graded as unknown[]).length, 2, 'the run graded nothing');
});

test('and the session itself is the same run whatever a page is drawing', () => {
  // The engine-side proof, beside the page-side one: the recorded run replays
  // identically, because nothing in it has a level to read.
  const a = gradedRun(20);
  const b = gradedRun(20);
  assert.deepEqual(a, b);
});

// --- The first screen ---------------------------------------------------------------------------

test('a new player meets the passage and the question, in that order, on one screen', async () => {
  const page = loadHosted('#table', [['ev:playerName', 'Dana']]);
  await page.booted;
  for (let i = 0; i < 60; i++) await settle();

  const welcome = page.document.getElementById('welcome');
  assert.equal(welcome.hidden, false, 'the first screen never opened');
  // The slogan, then what the app is, then the question — and not a modal over
  // a table: everything else on the screen is put away while it stands.
  const html = readFileSync(join(HERE, '..', 'public', 'table.html'), 'utf8');
  const slogan = html.indexOf('data-i18n="brand.slogan"');
  const passage = html.indexOf('id="intro-body"');
  const question = html.indexOf('data-i18n="level.question"');
  assert.ok(slogan > 0 && slogan < passage && passage < question, 'the screen is in the wrong order');
  // That it takes the screen rather than floating over it is a tree fact, and
  // the stub page here is a flat map of ids: it is checked in the source, and
  // measured on a real phone-sized Chrome in the round's probe.
  assert.match(source('intro.js'), /node\.style\.display = 'none'/, 'the table is only hidden by an attribute a stylesheet can beat');
  assert.doesNotMatch(source('table.html'), /<dialog id="intro"/, 'the passage is still a modal');

  const body = page.document.getElementById('intro-body');
  assert.match(String(body.innerHTML), /not a blackjack game/i);

  // Three choices, about what he wants to see — never about how good he is.
  const choices = page.document.getElementById('level-choices').children;
  assert.deepEqual(choices.map((c: any) => c.dataset.level), ['new', 'intermediate', 'advanced']);
  const words = textOf(page.document.getElementById('level-choices')).toLowerCase();
  for (const ego of ['beginner', 'expert', 'novice', 'how good']) {
    assert.ok(!words.includes(ego), `the question asks how good he is: "${ego}"`);
  }

  // Choosing puts the table back and remembers the answer.
  for (const handler of choices[1].listeners.click ?? []) handler({ preventDefault() {} });
  assert.equal(page.storage().get('ev:level'), 'intermediate');
  assert.equal(page.storage().get('ev:introSeen'), '1');
  assert.equal(welcome.hidden, true);
  assert.equal(page.document.getElementById('table').hidden, false, 'the felt did not come back');
  page.stopWatching();
});

test('a player who has answered is not asked again, and can change it from the panel', async () => {
  const page = loadHosted('#table', [
    ['ev:playerName', 'Dana'],
    ['ev:introSeen', '1'],
    ['ev:level', 'new'],
  ]);
  await page.booted;
  for (let i = 0; i < 40; i++) await settle();
  assert.equal(page.document.getElementById('welcome').hidden, true, 'a returning player was asked again');

  // The same three choices live in the rule panel, marked with the one in force.
  const settings = page.document.getElementById('level-settings');
  const options = settings.children;
  assert.equal(options.length, 3);
  assert.ok(String(options[0].className).includes('current'), 'the panel does not say which is in force');
  for (const handler of options[2].listeners.click ?? []) handler({ preventDefault() {} });
  assert.equal(page.storage().get('ev:level'), 'advanced');
  page.stopWatching();
});

// --- The strip, the walkthrough, the breakdown ----------------------------------------------------

async function playOne(level: string) {
  const page = loadHosted('#table', [
    ['ev:playerName', 'Dana'],
    ['ev:showAll', '1'],
    ['ev:introSeen', '1'],
    ['ev:level', level],
  ]);
  await page.booted;
  page.session().table.shoe.stack(page.parseCards('Ts Td 6h 7c'));
  await press(page, 'deal');
  await press(page, 'stand');
  return page;
}

test('the strip shows two cells, three or four, with a plainer word for each', () => {
  const { level, win } = levels();
  const english = catalogue('en');
  win.EV = { t: (key: string) => english[key] ?? key };
  const cell = (name: string, key: string) => ({
    hidden: false,
    dataset: { cell: name },
    children: [{ className: 'stat-label', dataset: { i18n: key }, textContent: key, children: [] }],
  });
  for (const [at, wanted, accuracyLabel] of [
    ['new', ['accuracy', 'units'], 'ui.plain.accuracy'],
    ['intermediate', ['accuracy', 'evLost', 'units'], 'ui.plain.accuracy'],
    ['advanced', ['accuracy', 'evLost', 'edge', 'units'], 'ui.decisionAccuracy'],
  ] as const) {
    const strip: any = {
      dataset: {},
      children: [
        cell('accuracy', 'ui.decisionAccuracy'),
        cell('evLost', 'ui.evLostPer100'),
        cell('edge', 'ui.yourEdge'),
        cell('units', 'ui.units'),
      ],
    };
    level.applyStrip(strip, at);
    const shown = strip.children.filter((c: any) => !c.hidden).map((c: any) => c.dataset.cell);
    assert.deepEqual(shown, wanted, `${at} shows the wrong cells`);
    assert.equal(strip.dataset.cells, String(wanted.length), `${at} did not tell the stylesheet`);
    assert.equal(strip.children[0].children[0].textContent, english[accuracyLabel], `${at} label`);
  }
});

test('and every figure is still computed and saved, shown or not', async () => {
  const page = await playOne('new');
  const stats = page.session().stats;
  // The two cells a beginner never sees are still measured on his hands.
  assert.ok(stats.evLostPer100 >= 0, 'EV lost stopped being measured');
  assert.ok(stats.effectiveHouseEdgePercent > 0, 'the house edge stopped being measured');
  assert.ok(stats.decisions > 0 && stats.evLost >= 0);
  page.stopWatching();
});

test('the walkthrough reads the conclusion at New and the whole argument above it', async () => {
  const texts: Record<string, string[]> = {};
  for (const level of ['new', 'intermediate', 'advanced']) {
    const page = await playOne(level);
    const steps = withClass(page.document.getElementById('feedback'), 'step');
    texts[level] = steps.map((step: any) => textOf(step).replace(/^\d+\s*/, ''));
    page.stopWatching();
  }
  assert.equal(texts.new!.length, 1, 'a beginner is walked through more than the conclusion');
  assert.equal(texts.intermediate!.length, 3);
  assert.deepEqual(texts.advanced, texts.intermediate, 'the expert reads different words');
  // The one step a beginner reads is the same step, word for word.
  assert.equal(texts.new![0], texts.intermediate![2], 'the beginner was given his own text');
});

test('the breakdown appears at Advanced only, and every number in it is the engine’s', async () => {
  for (const level of ['new', 'intermediate']) {
    const page = await playOne(level);
    assert.equal(withClass(page.document.getElementById('feedback'), 'breakdown').length, 0, `${level} got the breakdown`);
    page.stopWatching();
  }

  const page = await playOne('advanced');
  const feedback = (page.session().view as any).feedback;
  const box = withClass(page.document.getElementById('feedback'), 'breakdown')[0];
  assert.ok(box, 'no breakdown at Advanced');
  const text = textOf(box);

  // Everything the dealer can do with this upcard, adding up to one hand.
  const dealer = feedback.breakdown.dealer as Array<{ outcome: string; p: number }>;
  assert.ok(dealer.length >= 6, 'the dealer breakdown is not the whole distribution');
  assert.ok(Math.abs(dealer.reduce((sum, row) => sum + row.p, 0) - 1) < 1e-9, 'the outcomes do not add up');
  for (const row of dealer) assert.ok(text.includes(`${(row.p * 100).toFixed(1)}%`), `${row.outcome} is missing`);

  // The exact figures, past the three decimals the bars round to.
  for (const row of feedback.ranked) {
    assert.ok(text.includes(Math.abs(row.value).toFixed(4)), `${row.action} is not given exactly`);
  }
  // How rare the spot is, from the same difficulty table the rating uses.
  assert.ok(text.includes(String(feedback.spot.oneIn)) && text.includes(String(feedback.spot.rating)));
  // And what another rule set would answer (§3.3).
  const rules = catalogue('en')[feedback.sensitivity.length === 0 ? 'bd.rulesNone' : 'bd.rules']!;
  assert.ok(text.includes(rules.split('{')[0]!.trim()), 'the rule-set answer is missing');
  page.stopWatching();
});

// --- The dealer is gone ---------------------------------------------------------------------------

test('the dealer, her name, her bubble and her two questions are gone from the table', () => {
  const html = source('table.html');
  for (const trace of ['dealer-zone', 'class="avatar"', 'class="speech"', 'id="asks"', 'id="say"', 'id="answer"', 'ui.dealerName']) {
    assert.ok(!html.includes(trace), `the table still has ${trace}`);
  }
  const css = source('styles.css');
  for (const rule of ['.dealer-zone', '.avatar', '.speech', '.ask ']) {
    assert.ok(!css.includes(rule), `the stylesheet still styles ${rule}`);
  }
  const app = source('app.js');
  assert.doesNotMatch(app, /renderCoach|\/api\/coach|el\('asks'\)|el\('say'\)/, 'the page still talks to the dealer');
});

test('what she was the only one saying is still said, below the table', async () => {
  // A dealer's blackjack ends a hand before the player decides anything. It was
  // her line, and without it the screen goes straight back to "deal when ready"
  // and the hand looks as though it was skipped.
  const page = loadHosted('#table', [['ev:playerName', 'Dana'], ['ev:introSeen', '1'], ['ev:level', 'intermediate']]);
  await page.booted;
  // A ten showing, an ace beneath: the dealer peeks and the hand is over,
  // with no insurance offered to answer on the way.
  page.session().table.shoe.stack(page.parseCards('9s Kh 8d As'));
  await press(page, 'deal');
  for (let i = 0; i < 40; i++) await settle();
  const line = page.document.getElementById('table-talk');
  assert.equal(line.hidden, false, 'the table said nothing about a hand that was over before it began');
  assert.equal(line.textContent, catalogue('en')['dealer.dealerNatural']);
  // It is below the table and outside the dock, where the commentary is.
  const html = source('table.html');
  assert.ok(html.indexOf('id="table-talk"') > html.indexOf('</main>'), 'the line is not below the table');
  assert.ok(html.indexOf('id="table-talk"') < html.indexOf('class="dock"'), 'the line is in the dock');
  page.stopWatching();
});

// --- The arrow ------------------------------------------------------------------------------------

/** The arrow, driven by a page whose geometry this test decides. */
function arrow(options: { text: string; top: number; height?: number }) {
  const listeners: Record<string, Function[]> = {};
  const state = { ...options, hidden: false, token: 'one' };
  const target: any = {
    get hidden() {
      return state.text === '';
    },
    get textContent() {
      return state.text;
    },
    getBoundingClientRect: () => ({ top: state.top, bottom: state.top + (state.height ?? 120), height: state.height ?? 120 }),
    scrollIntoView() {
      state.top = 100;
    },
  };
  const button: any = { hidden: true, listeners: {} as Record<string, Function[]>, style: {}, dataset: {},
    setAttribute() {}, addEventListener(type: string, fn: Function) { (button.listeners[type] ??= []).push(fn); } };
  const win: any = {
    innerHeight: 800,
    addEventListener: (type: string, fn: Function) => void ((listeners[type] ??= []).push(fn)),
  };
  const doc: any = {
    createElement: () => button,
    querySelector: () => ({ getBoundingClientRect: () => ({ height: 200 }) }),
    body: { appendChild() {} },
  };
  new Function('window', 'document', 'MutationObserver', source('arrow.js'))(win, doc, undefined);
  const watcher = win.EVArrow.watch(target, { token: () => state.token, label: 'more' });
  return { state, button, watcher };
}

test('the arrow appears only when there is commentary the player cannot see', () => {
  // Commentary below the fold: shown.
  const below = arrow({ text: 'the reasoning', top: 780 });
  below.watcher.update();
  assert.equal(below.button.hidden, false, 'nothing said there was more below');

  // The same commentary, on screen: nothing.
  const onScreen = arrow({ text: 'the reasoning', top: 300 });
  onScreen.watcher.update();
  assert.equal(onScreen.button.hidden, true, 'the arrow pointed at something already on screen');

  // No commentary at all: nothing, whatever the scroll.
  const empty = arrow({ text: '', top: 900 });
  empty.watcher.update();
  assert.equal(empty.button.hidden, true, 'the arrow pointed at nothing');
});

test('it goes once he has reached it, and does not come back for the same hand', () => {
  const a = arrow({ text: 'the reasoning', top: 780 });
  a.watcher.update();
  assert.equal(a.button.hidden, false);

  // He scrolls to it.
  a.state.top = 300;
  a.watcher.update();
  assert.equal(a.button.hidden, true);

  // And scrolls away again: the same content does not nag him twice.
  a.state.top = 780;
  a.watcher.update();
  assert.equal(a.button.hidden, true, 'the arrow came back for commentary he had already read');

  // The next hand is different content, and may say so.
  a.state.token = 'two';
  a.watcher.update();
  assert.equal(a.button.hidden, false, 'the next hand got no arrow');
});

test('it does not nag, and never covers the buttons', () => {
  const css = source('styles.css');
  const rule = css.slice(css.indexOf('.more-below {'), css.indexOf('}', css.indexOf('.more-below {')));
  // Above the dock and out of the bottom third (§10.1).
  const bottom = /bottom: (\d+)vh/.exec(rule);
  assert.ok(bottom && Number(bottom[1]) >= 34, `the arrow sits at ${rule}`);
  assert.ok(rule.includes('position: fixed'));
  // And on the page it is lifted clear of the dock, whose height moves with
  // what the card is saying — measured, not guessed.
  assert.match(source('arrow.js'), /dock\.getBoundingClientRect\(\)\.height\) \+ 12/);

  // Motion at all only where motion is welcome, and it stops.
  const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference) {', css.indexOf('.more-below')));
  const animation = /animation: more-below-nudge [^;]*;/.exec(motion);
  assert.ok(animation, 'the arrow animates outside the reduced-motion guard');
  assert.doesNotMatch(animation[0], /infinite/, 'the arrow never stops moving');
  assert.doesNotMatch(css.slice(0, css.indexOf('@media (prefers-reduced-motion: no-preference) {', css.indexOf('.more-below'))).slice(css.indexOf('.more-below')), /animation:/);
});

// --- It follows the player ------------------------------------------------------------------------

test('the level rides in the saved record, and a device that has never been asked takes it', () => {
  const shell = readFileSync(join(HERE, '..', 'artifact', 'shell.js'), 'utf8');
  const full = shell.slice(shell.indexOf('function fullProgress()'), shell.indexOf('function readLocalProgress()'));
  assert.match(full, /level/, 'the record does not carry the level');
  // Taken from the record only when this device has no answer of its own: the
  // last answer given on the phone in his hand is the one he meant.
  assert.match(shell, /EVLevel\.read\(\) === null && remote\.progress\?\.level/);
  // And it is a preference, never a measure: nothing about it is merged,
  // counted or compared the way the day count is.
  assert.doesNotMatch(shell, /mergeLevel|level.*Math\.max/);
});
