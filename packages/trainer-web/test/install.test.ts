/**
 * The site as an installed app (round 5).
 *
 * Three promises, each tested where a player meets it:
 *
 *   - the hosted page can be added to a home screen: a manifest, original icons
 *     that exist, a theme colour, `display: standalone`, all by relative path;
 *   - it plays offline, and when the shared table cannot be reached the
 *     leaderboard says so rather than showing an empty or stale table as live;
 *   - an app opened from its icon, with storage of its own, tells the player at
 *     the door that name and code bring their record back.
 *
 * The artifact is a fragment inside someone else's page and must carry none of
 * the install machinery.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalogue } from '../src/i18n.ts';
import { loadHosted } from './helpers/hosted-page.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const SITE = join(ROOT, 'docs');
const hosted = () => readFileSync(join(SITE, 'index.html'), 'utf8');

// --- Installable ---------------------------------------------------------------

test('the manifest makes a full-screen app, and every icon it names exists', () => {
  const manifest = JSON.parse(readFileSync(join(SITE, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './', 'the site lives under /ishalom/, so the start must be relative');
  assert.equal(manifest.scope, './');
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.ok(manifest.icons.some((i: any) => i.sizes === '192x192'));
  assert.ok(manifest.icons.some((i: any) => i.sizes === '512x512' && i.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    assert.ok(!icon.src.startsWith('/'), `${icon.src} would leave the site`);
    assert.ok(existsSync(join(SITE, icon.src)), `${icon.src} is named but not shipped`);
  }
  // Nothing in the app's name borrows a casino's.
  assert.equal(manifest.name, 'EV Trainer');
});

test('the hosted page links the manifest and the icons, and registers the worker, all relatively', () => {
  const html = hosted();
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest" \/>/);
  assert.match(html, /<meta name="theme-color" content="#[0-9a-f]{6}" \/>/i);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png" \/>/);
  assert.ok(existsSync(join(SITE, 'icons', 'apple-touch-icon.png')));
  assert.match(html, /navigator\.serviceWorker\.register\('sw\.js'\)/);
});

test('the artifact carries none of it: it is a fragment inside someone else’s page', () => {
  const artifact = readFileSync(join(HERE, '..', 'build', 'artifact.html'), 'utf8');
  assert.doesNotMatch(artifact, /rel="manifest"/);
  assert.doesNotMatch(artifact, /serviceWorker\.register/);
});

// --- Offline --------------------------------------------------------------------

test('the worker keeps the page for offline play and never touches the shared table', () => {
  const worker = readFileSync(join(SITE, 'sw.js'), 'utf8');
  assert.doesNotMatch(worker, /__EV_BUILD_ID__/, 'the cache name was not stamped');
  assert.match(worker, /const CACHE = 'ev-trainer-[0-9a-f]{6,}/);
  for (const file of ["'./index.html'", "'./manifest.webmanifest'", "'./icons/icon-192.png'"]) {
    assert.ok(worker.includes(file), `${file} is not kept for offline`);
  }
  // Live data is passed straight to the network: no cache, and nothing made up.
  assert.match(worker, /supabase\.co/);
  assert.match(worker, /if \(isLiveData\(url\)\) return;/);
});

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('when the shared table cannot be reached, the leaderboard says offline — and the game still plays', async () => {
  // A table configured at a port nothing listens on: exactly a phone with no signal.
  const page = loadHosted('#home', [['ev:playerName', 'Dana'], ['ev:playerId', 'dana-row']], {
    url: 'http://127.0.0.1:9',
    key: 'anon-key-for-the-test',
  });
  await page.booted;
  for (let i = 0; i < 40; i++) {
    await settle(25);
    const panel = page.document.getElementById('panel-table');
    const said = JSON.stringify(panel.children.map((c: any) => c.textContent));
    if (said.includes(catalogue('en')['social.offlineNow']!.slice(0, 20))) break;
  }
  const panel = page.document.getElementById('panel-table');
  const shown = panel.children.map((c: any) => c.textContent).join(' ');
  assert.ok(
    shown.includes(catalogue('en')['social.offlineNow']!),
    `the leaderboard did not say it was offline: ${shown}`,
  );
  assert.ok(!shown.includes(catalogue('en')['social.noPlayers']!), 'it claimed nobody has played');

  // And both games still deal and grade.
  const bj = await page.api('/api/deal');
  assert.ok(bj.hands.length > 0);
  const uth = await page.api('/api/uth/deal');
  assert.equal(uth.hole.length, 2);
  page.stopWatching();
});

// --- The door, opened from an icon ---------------------------------------------------

test('opened from a home-screen icon, the door says name and code bring the record back', async () => {
  const g = globalThis as any;
  const previous = g.matchMedia;
  g.matchMedia = (query: string) => ({ matches: query.includes('display-mode: standalone') });
  try {
    // No name stored: a first visit, as an iPhone home-screen app is.
    const page = loadHosted('', [], { url: 'http://127.0.0.1:9', key: 'k' });
    await page.booted;
    const app = page.document.getElementById('app');
    const door = app.children[0];
    assert.ok(door, 'the door was not shown');
    assert.ok(
      String(door.innerHTML).includes(catalogue('en')['welcome.installed']!),
      'the door does not explain name and code to an installed app',
    );
    page.stopWatching();

    // In a browser tab the line is not needed, and is not shown.
    g.matchMedia = () => ({ matches: false });
    const tab = loadHosted('', [], { url: 'http://127.0.0.1:9', key: 'k' });
    await tab.booted;
    const tabDoor = tab.document.getElementById('app').children[0];
    assert.ok(!String(tabDoor.innerHTML).includes(catalogue('en')['welcome.installed']!));
    tab.stopWatching();
  } finally {
    g.matchMedia = previous;
  }
});

test('the door line exists in both languages', () => {
  for (const locale of ['en', 'he'] as const) {
    assert.ok(catalogue(locale)['welcome.installed'], `${locale} has no installed-app line`);
    assert.ok(catalogue(locale)['social.offlineNow'], `${locale} has no offline line`);
  }
});
