/**
 * Links that stay inside the site, and the two things pinned to the edges.
 *
 * Idan copied the "Home" link off the live page and got
 * `https://ishalom.github.io/home.html`, which is a 404: the site lives under
 * `/ishalom/`. The local app is three pages and the browser walks between them,
 * so its links are root-relative, and `ui.js` intercepted a plain click — which
 * meant an ordinary click worked and nothing else did. Middle-click, ctrl-click,
 * "open in new tab", a long press and "copy link" all use the href itself.
 *
 * The rest of this file is the layout the same round pinned down: the stat strip
 * under the rules bar, and a way to reach the rules from the badge that states
 * them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalogue } from '../src/i18n.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PUBLIC = join(HERE, '..', 'public');

const hosted = () => readFileSync(join(ROOT, 'docs', 'index.html'), 'utf8');
const artifact = () =>
  readFileSync(join(HERE, '..', 'build', 'artifact.html'), 'utf8');

test('no link in a built page points at the host root', () => {
  for (const [name, html] of [['docs/index.html', hosted()], ['artifact.html', artifact()]]) {
    // Both the plain attributes and the ones embedded in the screen markup,
    // which is carried through the build as a JavaScript string literal.
    const stray = [
      ...html!.matchAll(/href="(\/[^"]*)"/g),
      ...html!.matchAll(/href=\\"(\/[^\\]*)\\"/g),
    ].map((m) => m[1]!);
    assert.deepEqual(stray, [], `${name} still links out of the site`);
  }
});

test('every door in a built page is an in-page target that the router knows', () => {
  const html = hosted();
  const targets = [...html.matchAll(/href=\\"(#[^\\]*)\\"/g)].map((m) => m[1]!);
  assert.ok(targets.length >= 3, `only ${targets.length} doors found`);

  // Round 4a opened the Ultimate door, so every door is now a screen.
  const routed = /const SCREENS = \{([^}]*)\}/.exec(html);
  assert.ok(routed, 'the screen table is gone from the page');
  const known = [...routed[1]!.matchAll(/'(#[a-z]+)'/g)].map((m) => m[1]!);
  assert.deepEqual(known.sort(), ['#home', '#table', '#ultimate']);
  for (const target of targets) {
    assert.ok(known.includes(target), `${target} is a door onto nothing`);
  }
});

test('the Ultimate door opens onto the game, not onto a preview', () => {
  /*
   * Until round 4a the door was locked, and a link to it landed on home. It now
   * mounts a playable screen, so the lock — and the line explaining it — must be
   * gone rather than merely unreached.
   */
  const html = hosted();
  assert.doesNotMatch(html, /door-locked/, 'the door is still being locked');
  // The line that explained the lock said the tables were "still being
  // computed". They are not, and a sentence that false must not be able to
  // reach a screen, so it is gone from the catalogue rather than just unused.
  assert.doesNotMatch(html, /notPlayableYet/, 'the page still carries the not-playable line');
  for (const locale of ['en', 'he'] as const) {
    assert.equal(catalogue(locale)['ui.notPlayableYet'], undefined);
  }
  assert.match(html, /const ULTIMATE_HTML = /, 'the Ultimate screen is not in the page');
  assert.match(html, /function initUltimate\(\)/, 'the Ultimate screen script is not in the page');
});

test('the local app keeps its own paths', () => {
  // The build rewrites; the source does not. A page served by the local server
  // really is at /home.html, and breaking that to fix the hosted copy would be
  // trading one broken link for another.
  for (const page of ['home.html', 'table.html', 'ultimate.html']) {
    const source = readFileSync(join(PUBLIC, page), 'utf8');
    assert.ok(source.includes('href="/styles.css"'), `${page} lost its stylesheet path`);
  }
  assert.ok(readFileSync(join(PUBLIC, 'table.html'), 'utf8').includes('href="/home.html"'));
});

test('the build refuses a link it does not know how to rewrite', () => {
  const source = readFileSync(join(HERE, '..', 'scripts', 'build-artifact.ts'), 'utf8');
  assert.match(source, /function localLinks/, 'the rewrite is gone');
  assert.match(
    source,
    /throw new Error\(\s*`\$\{where\}: \$\{stray\[0\]\}/,
    'the build no longer fails on a link that would leave the site',
  );
});

test('a copied link opens the screen it was copied from', async () => {
  /*
   * The point of the hash, rather than a tidier way to route. Someone who shares
   * the link they are looking at should be sharing what they are looking at.
   */
  const { loadHosted } = await import('./helpers/hosted-page.ts');
  const app = loadHosted('#table');
  await app.booted;
  assert.equal(app.screen(), 'table', 'a #table link did not open the table');

  const home = loadHosted('#home');
  await home.booted;
  assert.equal(home.screen(), 'home');

  const ultimate = loadHosted('#ultimate');
  await ultimate.booted;
  assert.equal(ultimate.screen(), 'ultimate', 'a copied #ultimate link did not open the game');

  // An unknown target lands on the home screen rather than on nothing.
  const nowhere = loadHosted('#nowhere');
  await nowhere.booted;
  assert.equal(nowhere.screen(), 'home');
});

test('the back button walks the screens instead of leaving the app', async () => {
  const { loadHosted } = await import('./helpers/hosted-page.ts');
  const app = loadHosted('#home');
  await app.booted;
  assert.equal(app.screen(), 'home');
  app.go('#table');
  assert.equal(app.screen(), 'table', 'a hash change did not move the screen');
  app.go('#home');
  assert.equal(app.screen(), 'home');
});

test('the stat strip is pinned, and its offset is measured rather than guessed', () => {
  const css = readFileSync(join(PUBLIC, 'styles.css'), 'utf8');
  const strip = /\.stats \{([^}]*)\}/.exec(css);
  assert.ok(strip, '.stats is gone');
  assert.match(strip[1]!, /position:\s*sticky/, 'the strip is not pinned');
  assert.match(strip[1]!, /top:\s*var\(--rules-h/, 'the strip guesses the bar height');

  const app = readFileSync(join(PUBLIC, 'app.js'), 'utf8');
  assert.match(app, /function pinStrip\(\)/, 'nothing measures the rules bar');
  assert.match(app, /--rules-h/, 'the measurement never reaches the stylesheet');
  // The bar is above the strip, so it has to win the overlap.
  const rules = /\.rules \{([^}]*)\}/.exec(css)!;
  const z = (block: string) => Number(/z-index:\s*(\d+)/.exec(block)?.[1] ?? 0);
  assert.ok(z(rules[1]!) > z(strip[1]!), 'the strip would cover the rules bar');
});

test('on a short screen the strip gives way before the cards do', () => {
  const css = readFileSync(join(PUBLIC, 'styles.css'), 'utf8');
  const short = /@media \(max-height: (\d+)px\) \{([\s\S]*?)\n\}/.exec(css);
  assert.ok(short, 'there is no short-screen rule');
  assert.ok(Number(short[1]) >= 768, `the rule starts at ${short[1]}px, below the 768px laptop`);

  const body = short[2]!;
  assert.match(body, /\.stat-label \{ display: none/, 'the labels do not fold away');
  assert.match(body, /\.stat \{ padding/, 'the strip does not get shorter');
  // Only the strip. The cards are the thing being taught with.
  assert.doesNotMatch(body, /\.card\b/, 'the cards shrink on a short screen');
  assert.doesNotMatch(body, /\.hand-total/, 'the hand total shrinks on a short screen');
});

test('the badge states the rules and the link beside it changes them', () => {
  const html = readFileSync(join(PUBLIC, 'table.html'), 'utf8');
  assert.match(html, /id="change-rules"/, 'there is no change link');
  // Still a statement: the badge itself is not a button.
  const badge = /<span class="rules-badge"[^>]*>/.exec(html);
  assert.ok(badge, 'the badge is gone');

  const app = readFileSync(join(PUBLIC, 'app.js'), 'utf8');
  assert.match(
    app,
    /el\('change-rules'\)\.addEventListener\('click', openSettings\)/,
    'the link does not open the Rules dialog',
  );
  for (const locale of ['en', 'he'] as const) {
    assert.ok(catalogue(locale)['ui.change'], `${locale} has no label for the change link`);
  }
  assert.notEqual(catalogue('he')['ui.change'], catalogue('en')['ui.change']);
});
