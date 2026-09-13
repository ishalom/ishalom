/**
 * The decision track (round 6).
 *
 * The last twelve hands beside the table: one dot per decision in the card's
 * tier colours, a hollow dash for a hand with no decision, the result smaller
 * and quieter after them, and a tap that opens the hand in the log. Tested where
 * each promise is made: the rows in both sessions, the drawing in track.js, the
 * screens that carry it, and the tap arriving at the right hand on the home
 * screen of the built page.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCards } from '@evtrainer/ev-engine/uth';

import { TrainerSession } from '../src/session.ts';
import { TRACK_HANDS, trackDot } from '../src/track.ts';
import { UthSession } from '../src/uth-session.ts';
import { loadHosted } from './helpers/hosted-page.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');
const source = (file: string) => readFileSync(join(PUBLIC, file), 'utf8');

function playBlackjack(session: TrainerSession, hands: number): void {
  for (let i = 0; i < hands; i++) {
    session.deal();
    let view = session.view as any;
    while (view.phase === 'insurance' || view.phase === 'player') {
      if (view.phase === 'insurance') session.insurance(false);
      else session.act(view.legalActions.includes('stand') ? 'stand' : view.legalActions[0]);
      view = session.view;
    }
  }
}

function playUth(session: UthSession, hands: number): any {
  let view: any = null;
  for (let i = 0; i < hands; i++) {
    view = session.deal();
    while (view.legalActions.length > 0) {
      const legal = view.legalActions.map((a: { action: string }) => a.action);
      view = session.act(legal.includes('check') ? 'check' : 'raise1x');
    }
  }
  return view;
}

// --- The rows ------------------------------------------------------------------------

test('a close call is grey whatever its grade; every other decision is its tier', () => {
  assert.equal(trackDot('optimal', true), 'close');
  assert.equal(trackDot('blunder', true), 'close');
  for (const tier of ['optimal', 'negligible', 'minor', 'significant', 'blunder'] as const) {
    assert.equal(trackDot(tier, false), tier);
  }
});

test('Blackjack: the last twelve hands, newest first, one dot per decision, and a natural has none', () => {
  const session = new TrainerSession('vegas-strip-6d-s17', 11);
  playBlackjack(session, 14);
  // A player natural against a dealer 16: the hand ends on the deal.
  (session as any).table.shoe.stack(parseCards('As 9d Kh 7c'));
  playBlackjack(session, 1);

  const view = session.view as any;
  assert.equal(view.track.length, TRACK_HANDS);
  view.track.forEach((row: any, i: number) => {
    const hand = view.history[i];
    assert.equal(row.index, i);
    assert.equal(row.id, hand.id);
    assert.equal(row.net, hand.netUnits);
    assert.deepEqual(
      row.dots,
      hand.decisions.map((d: any) => (d.closeCall ? 'close' : d.severity)),
    );
  });
  assert.deepEqual(view.track[0].dots, [], 'the natural should have no dots');
  assert.equal(view.track[0].net, 1.5);
});

test('Ultimate: the last twelve hands, one dot per decision, close calls by the same gap', () => {
  const session = new UthSession(5);
  playUth(session, 15);
  const view = session.view as any;
  const saved = session.progress.history;
  assert.equal(view.track.length, TRACK_HANDS);
  view.track.forEach((row: any, i: number) => {
    const hand = saved[i]!;
    assert.equal(row.index, i);
    assert.equal(row.id, hand.id);
    assert.equal(row.net, hand.settlement.net);
    assert.equal(row.dots.length, hand.decisions.length);
    hand.decisions.forEach((d, k) => {
      const evs = d.legalActions.map((a) => d.evByAction[a] ?? 0).sort((a, b) => b - a);
      const close = evs.length > 1 && evs[0]! - evs[1]! < 0.01;
      assert.equal(row.dots[k], close ? 'close' : d.severityTier);
    });
  });
});

// --- The drawing ---------------------------------------------------------------------------

function fakeNode(): any {
  const n: any = {
    children: [] as any[],
    dataset: {} as Record<string, string>,
    attributes: {} as Record<string, string>,
    listeners: {} as Record<string, Function[]>,
    className: '',
    textContent: '',
    replaceChildren(...c: any[]) {
      n.children = c;
    },
    appendChild(c: any) {
      n.children.push(c);
      return c;
    },
    append(...c: any[]) {
      n.children.push(...c);
    },
    setAttribute(k: string, v: string) {
      n.attributes[k] = v;
    },
    addEventListener(type: string, fn: Function) {
      (n.listeners[type] ??= []).push(fn);
    },
  };
  return n;
}

function loadTrack(options: { rtl?: boolean; inApp?: boolean } = {}) {
  const storage = new Map<string, string>();
  const win: any = {};
  const doc = {
    createElement: () => fakeNode(),
    documentElement: { getAttribute: (name: string) => (name === 'dir' && options.rtl ? 'rtl' : null) },
  };
  const loc: any = { hash: '', href: '' };
  const local = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  };
  const params = ['window', 'document', 'localStorage', 'location'];
  const args: unknown[] = [win, doc, local, loc];
  if (options.inApp) {
    params.push('HOME_HTML');
    args.push('<div></div>');
  }
  new Function(...params, source('track.js'))(...args);
  return { track: win.EVTrack, storage, loc, win };
}

const ROWS = [
  { index: 0, id: 21, dots: [], net: 1.5 },
  { index: 1, id: 20, dots: ['optimal', 'close', 'blunder'], net: -2 },
  { index: 2, id: 19, dots: ['minor'], net: 0 },
  { index: 3, id: 18, dots: ['significant', 'negligible'], net: 1 },
];

test('a row draws one dot per decision, a hollow dash for none, and the result after them', () => {
  const { track } = loadTrack();
  const box = fakeNode();
  track.render(box, ROWS, 'bj');
  const [title, items] = box.children;
  assert.equal(title.className, 'track-title');
  assert.equal(items.children.length, 4);

  const [natural, three, one, two] = items.children;
  const dotsOf = (row: any) => row.children[0].children.map((d: any) => d.className);
  assert.deepEqual(dotsOf(natural), ['track-dash']);
  assert.deepEqual(dotsOf(three), ['track-dot optimal', 'track-dot close', 'track-dot blunder']);
  assert.deepEqual(dotsOf(one), ['track-dot minor']);
  assert.deepEqual(dotsOf(two), ['track-dot significant', 'track-dot negligible']);

  // The figure comes last in the row, in its own quiet element.
  const nets = items.children.map((row: any) => row.children[1]);
  assert.ok(nets.every((n: any) => n.className === 'track-net'));
  assert.deepEqual(nets.map((n: any) => n.textContent), ['+1.5', '−2', '0', '+1']);

  // Every row says what it is to a screen reader, dash included.
  assert.equal(natural.attributes['aria-label'], 'track.rowNone');
  assert.equal(three.attributes['aria-label'], 'track.row');
  assert.equal(one.attributes['aria-label'], 'track.rowOne');
});

test('in Hebrew each figure is kept in one piece', () => {
  const { track } = loadTrack({ rtl: true });
  const box = fakeNode();
  track.render(box, ROWS, 'uth');
  const nets = box.children[1].children.map((row: any) => row.children[1].textContent);
  assert.deepEqual(nets, ['⁦+1.5⁩', '⁦−2⁩', '⁦0⁩', '⁦+1⁩']);
});

test('before the first hand the track keeps its place with a note', () => {
  const { track } = loadTrack();
  const box = fakeNode();
  track.render(box, [], 'bj');
  assert.deepEqual(box.children.map((c: any) => c.className), ['track-title', 'track-empty']);
});

test('a tap asks for that hand and goes to the home screen, in the built page and the local app', () => {
  const app = loadTrack({ inApp: true });
  const box = fakeNode();
  app.track.render(box, ROWS, 'uth');
  box.children[1].children[1].listeners.click[0]();
  assert.equal(app.loc.hash, '#home');
  assert.equal(app.storage.get('ev:openHand'), 'uth:1:20');
  assert.deepEqual(app.track.takeOpened(), { game: 'uth', index: 1, id: 20 });
  assert.equal(app.track.takeOpened(), null, 'a request is read once');

  const local = loadTrack();
  const other = fakeNode();
  local.track.render(other, ROWS, 'bj');
  other.children[1].children[3].listeners.click[0]();
  assert.equal(local.loc.href, '/home.html');
  assert.deepEqual(local.track.takeOpened(), { game: 'bj', index: 3, id: 18 });
});

// --- The screens -----------------------------------------------------------------------------------

test('both tables carry the track between the strip and the felt, and UTH no longer carries a hand list', () => {
  for (const [page, id] of [['table.html', 'bj-track'], ['ultimate.html', 'uth-track']] as const) {
    const html = source(page);
    const track = html.indexOf(`id="${id}"`);
    assert.ok(track > 0, `${page} has no track`);
    assert.ok(track > html.indexOf('class="stats"'), `${page}: the track is above the strip`);
    assert.ok(track < html.indexOf('<main'), `${page}: the track is below the felt`);
    assert.match(html, /<script src="\/track\.js"><\/script>/);
  }
  const uth = source('ultimate.html');
  assert.doesNotMatch(uth, /uth-log-panel|id="uth-hands"/);
  assert.doesNotMatch(source('ultimate.js'), /uthRenderLog/);
  // The hands are reviewed on the home screen, which reads both games.
  assert.match(source('home.html'), /<script src="\/track\.js"><\/script>/);
  assert.match(source('home.js'), /api\('\/api\/uth\/state'\)/);
});

test('the track never gives away a grade or a result early', () => {
  // Blackjack: the hand being revealed stays off the track until the reveal is done.
  const app = source('app.js');
  const from = app.indexOf('function renderTrack');
  const body = app.slice(from, app.indexOf('\n}\n', from));
  assert.match(body, /revealComplete\(\)/);
  assert.match(body, /rows\.slice\(1\)/);
  // Ultimate: the newest figure is held back with the rest of the result.
  const uth = source('ultimate.js');
  const at = uth.indexOf('function uthRenderTrack');
  assert.match(uth.slice(at, uth.indexOf('\n}\n', at)), /uth-late/);
  assert.ok(uth.indexOf('uthRenderTrack(view);') < uth.indexOf('uthRenderCard(view);'));
});

test('nothing celebrates: no motion on the track, and the result is smaller and muted', () => {
  const css = source('styles.css');
  const from = css.indexOf('/* --- The decision track (round 6)');
  assert.ok(from > 0);
  // Rules only: the section's own comment says what it leaves out.
  const until = css.indexOf('/* --- Chips (round 6b)', from);
  const rules = css.slice(from, until > from ? until : undefined).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /animation|transition|@keyframes/);
  assert.doesNotMatch(source('track.js'), /streak|milestone|animate/i);
  const net = /\.track-net \{([^}]*)\}/.exec(rules)![1]!;
  const dot = /\.track-dot \{([^}]*)\}/.exec(rules)![1]!;
  assert.match(net, /color: var\(--muted\)/);
  assert.ok(Number(/font-size: ([\d.]+)px/.exec(net)![1]) < 12);
  assert.doesNotMatch(rules, /\.track-net\.(win|loss)/, 'the result is not coloured by winning');
  assert.match(dot, /border-radius: 50%/);
});

// --- A tap on the built page ------------------------------------------------------------------------------

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('on the built page, a row opens that hand in the log on the home screen', async () => {
  const page = loadHosted('#ultimate', [['ev:playerName', 'Dana'], ['ev:playerId', 'dana-track']]);
  await page.booted;
  for (let i = 0; i < 3; i++) {
    let view = await page.api('/api/uth/deal');
    while (view.legalActions.length > 0) {
      const legal = view.legalActions.map((a: { action: string }) => a.action);
      view = await page.api('/api/uth/act', { action: legal.includes('check') ? 'check' : 'raise1x' });
    }
  }
  const state = await page.api('/api/uth/state');
  const wanted = state.track[1];

  // The tap itself is tested above; this is where it lands.
  (globalThis as any).EVTrack.open('uth', wanted.index, wanted.id);
  assert.equal(page.screen(), 'home');
  for (let i = 0; i < 30; i++) await settle();

  const shown = page.document.getElementById('hands').children;
  assert.equal(shown[0].textContent, 'Ultimate', 'the hands are not under their game');
  const steps = shown.filter((node: any) => node.className === 'log-steps');
  assert.equal(steps.length, 3);
  assert.deepEqual(
    steps.map((node: any) => node.hidden),
    [true, false, true],
    'the hand asked for is not the one opened',
  );
  assert.equal(page.storage().get('ev:tab'), 'hands');
  page.stopWatching();
});
