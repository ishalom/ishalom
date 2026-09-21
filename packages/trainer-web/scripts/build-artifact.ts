/**
 * Assemble the shareable single-page build.
 *
 * Everything here already exists somewhere else and is read rather than
 * retyped: the engines come through `bundle.ts`, the stylesheet and the two
 * screen scripts come from `public/` exactly as the local app serves them, and
 * the copy comes from the same catalogue. The only files written by hand for
 * this build are `artifact/shell.js` (which stands where the server stood) and
 * `artifact/ui.js` (screens, language, and the two shared panels).
 *
 * Two edits are made to the screen scripts on the way through, both of them
 * mechanical and both checked:
 *
 *   - their `api()` is removed, so the one in `shell.js` answers instead;
 *   - each is wrapped in a function, so the two can share a page without their
 *     top-level names or their element ids ever meeting.
 *
 * Anything less mechanical would mean maintaining a second copy of the client,
 * and the day the two drifted, one of them would be teaching the wrong play.
 */

import { execSync } from 'node:child_process';
import { copyFileSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bundle } from './bundle.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const ROOT = resolve(PKG, '..', '..');
const PUBLIC = join(PKG, 'public');
const ARTIFACT = join(PKG, 'artifact');

const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8');

/** The `<body>` of a page, minus its script tags — those are wired up here. */
function bodyOf(html: string): string {
  const match = /<body[^>]*>([\s\S]*)<\/body>/.exec(html);
  if (!match) throw new Error('no body element');
  return match[1]!.replace(/<script[\s\S]*?<\/script>/g, '').trim();
}

/**
 * The doors, rewritten for a single page.
 *
 * The local app is three pages and the browser walks between them, so its links
 * are root-relative: `/home.html`, `/table.html`, `/ultimate.html`. The built
 * page is one document served from `/ishalom/`, and `ui.js` intercepts a plain
 * click — so an ordinary click worked and everything else did not. Middle-click,
 * ctrl-click, "open in new tab", a long press on a phone, and "copy link" all
 * use the href itself, which went to the site root and 404'd. Idan found it by
 * sharing a link.
 *
 * A hash cannot leave the page, and it carries the screen with it, so a copied
 * link opens where the person who copied it was standing.
 */
const DOORS: ReadonlyArray<[RegExp, string]> = [
  [/href="\/home\.html"/g, 'href="#home"'],
  [/href="\/analyse\.html"/g, 'href="#analyse"'],
  [/href="\/table\.html"/g, 'href="#table"'],
  [/href="\/ultimate\.html"/g, 'href="#ultimate"'],
  [/href="\/shared\.html"/g, 'href="#shared"'],
];

function localLinks(html: string, where: string): string {
  let out = html;
  for (const [pattern, replacement] of DOORS) out = out.replace(pattern, replacement);
  // Anything still absolute is a link off the site, and the next one added
  // should fail the build rather than the share.
  const stray = /href="\/[^"]*"/.exec(out);
  if (stray) {
    throw new Error(
      `${where}: ${stray[0]} points at the host root, which is not where this page lives. ` +
        'Give it an in-page target, or add it to DOORS.',
    );
  }
  return out;
}

/** Strip a page script's own `api()`, and wrap what is left in a named function. */
function screenScript(source: string, name: string): string {
  const API = /\nasync function api\(path, body\) \{[\s\S]*?\n\}\n/;
  if (!API.test(source)) {
    throw new Error(`${name}: could not find the api() to replace — check public/ for changes`);
  }
  const body = source.replace(API, '\n');
  return `function ${name}() {\n${body}\n}\n`;
}

function jsString(value: string): string {
  return JSON.stringify(value);
}

const engine = bundle([
  join(PKG, 'src', 'session.ts'),
  join(PKG, 'src', 'uth-session.ts'),
  // The hand analyser (round 16): a pure function, folded in beside the two
  // sessions so the page can answer a query without one.
  join(PKG, 'src', 'analyse.ts'),
  // The shared table's derivation and the one seat's view of it (round 22).
  // Bundled rather than reimplemented: two phones showing the same shoe is the
  // one thing in this product that cannot survive a second copy of the rules.
  join(PKG, 'src', 'shared-screen.ts'),
]);
const styles = read(PUBLIC, 'styles.css') + read(ARTIFACT, 'extra.css');
const homeHtml = localLinks(bodyOf(read(PUBLIC, 'home.html')), 'home.html');
const tableHtml = localLinks(bodyOf(read(PUBLIC, 'table.html')), 'table.html');
const ultimateHtml = localLinks(bodyOf(read(PUBLIC, 'ultimate.html')), 'ultimate.html');
// The hand analyser: a screen worth opening without playing (round 16).
const analyseHtml = localLinks(bodyOf(read(PUBLIC, 'analyse.html')), 'analyse.html');
// The shared table (round 22): the screen two people sit at.
const sharedHtml = localLinks(bodyOf(read(PUBLIC, 'shared.html')), 'shared.html');
const homeJs = screenScript(read(PUBLIC, 'home.js'), 'initHome');
const tableJs = screenScript(read(PUBLIC, 'app.js'), 'initTable');
const ultimateJs = screenScript(read(PUBLIC, 'ultimate.js'), 'initUltimate');
const analyseJs = screenScript(read(PUBLIC, 'analyse.js'), 'initAnalyse');
const sharedJs = screenScript(read(PUBLIC, 'shared.js'), 'initShared');
// What a seat does to a shared table: read it, write its own row, count votes.
const sharedDriver = read(ARTIFACT, 'shared.js');
// How every units and chips figure is written, loaded before anything that writes one (round 8).
const figureJs = read(PUBLIC, 'figure.js');
// Shared by both tables, and read by home to open the hand a row names.
const trackJs = read(PUBLIC, 'track.js');
// The bet rail, the moving chips and their one click, shared by both tables.
const chipsJs = read(PUBLIC, 'chips.js');
// The dock's settle-in hold, shared by both tables (round 7).
const dockJs = read(PUBLIC, 'dock.js');
// What comes back to you: the decision block, shared by both tables (round 13).
const returnsJs = read(PUBLIC, 'returns.js');
// Said once, before a player's first hand ever (round 13); the level question
// joined it in round 14.
const introJs = read(PUBLIC, 'intro.js');
// How much the app explains, and the arrow that says there is more (round 14).
const levelJs = read(PUBLIC, 'level.js');
const arrowJs = read(PUBLIC, 'arrow.js');
// Which explanations get opened: counters, not logs (round 15).
const countJs = read(PUBLIC, 'count.js');
const identity = read(ARTIFACT, 'identity.js');
const backends = read(ARTIFACT, 'backends.js');
// The usage page: who has played, how much, and who came back (round 9).
const usage = read(ARTIFACT, 'usage.js');
const shell = read(ARTIFACT, 'shell.js');
const ui = read(ARTIFACT, 'ui.js');

/**
 * Where the shared table lives, for the copy that is served as a plain page.
 *
 * The published artifact ignores this and uses the store the viewer gives it.
 * A page on any other host has no such thing, so it is built with a project to
 * talk to — or with none, in which case it plays perfectly and simply has no
 * leaderboard.
 *
 * The key here is the publishable anonymous key. It belongs in the page: it
 * names the project rather than a person, and the table's own policies decide
 * what it is allowed to do.
 */
interface BackendConfig {
  url: string;
  key: string;
  table?: string;
}

function backendConfig(): BackendConfig | null {
  try {
    const raw = read(ARTIFACT, 'backend.json');
    const parsed = JSON.parse(raw) as BackendConfig;
    return parsed.url && parsed.key ? parsed : null;
  } catch {
    return null;
  }
}

const config = backendConfig();

/**
 * Which commit a built page came from.
 *
 * Both outputs are committed files served by something else — GitHub Pages for
 * one, the artifact host for the other — so "is the live page current?" is a
 * question that gets asked, and answering it by eye means diffing 340 KB of
 * bundled JavaScript. A meta tag answers it with one fetch and no guessing.
 *
 * A dirty tree is stamped as such, because a stamp that quietly claims a clean
 * commit it does not match is worse than no stamp at all.
 */
function buildStamp(): { commit: string; at: string } {
  const run = (cmd: string) => {
    try {
      return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return '';
    }
  };
  const commit = run('git rev-parse HEAD') || 'unknown';
  const dirty = run('git status --porcelain') !== '';
  return { commit: dirty ? `${commit}-dirty` : commit, at: new Date().toISOString() };
}

const stamp = buildStamp();

/** The scripts, in the order they have to run. Shared by both outputs. */
const scripts = `<script>
/* The engines, folded into one scope by scripts/bundle.ts. Byte-for-byte the
   logic the test suite runs against — test/bundle.test.ts holds them to it. */
${engine}
</script>

<script>
/* Screen markup, lifted from the pages the local app serves. */
const HOME_HTML = ${jsString(homeHtml)};
const TABLE_HTML = ${jsString(tableHtml)};
const ULTIMATE_HTML = ${jsString(ultimateHtml)};
const ANALYSE_HTML = ${jsString(analyseHtml)};
const SHARED_HTML = ${jsString(sharedHtml)};

/* How a figure is written on screen, for every page (round 8). */
${figureJs}

/* The decision track, shared by both tables (round 6). */
${trackJs}

/* Chips: the bet rail, the moving chips and their one click (round 6b). */
${chipsJs}

/* The dock's settle-in hold, shared by both tables (round 7). */
${dockJs}

/* What comes back to you: the decision block, both tables (round 13). */
${returnsJs}

/* How much the app explains, both tables (round 14). */
${levelJs}

/* There is more below: the arrow, both tables (round 14). */
${arrowJs}

/* Which explanations get opened, per player (round 15). */
${countJs}

/* What this app is, and how much it should explain (rounds 13 and 14). */
${introJs}

/* The three screen scripts, unchanged but for their transport. */
${homeJs}
${tableJs}
${ultimateJs}
${analyseJs}
${sharedJs}

${identity}

${backends}

/* The shared table's driver, which the routes in the shell call (round 22). */
${sharedDriver}

${shell}

${usage}

${ui}
</script>`;

const head = `<title>EV Trainer</title>
<meta name="ev-build-commit" content="${stamp.commit}" />
<meta name="ev-build-at" content="${stamp.at}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Rubik:wght@300..900&display=swap" />
<style>
${styles}
</style>`;

/*
 * Two outputs from one build.
 *
 * The artifact is a fragment: claude.ai supplies the document around it, and
 * emitting our own <html> there would be wrong. The hosted copy is a complete
 * document and carries a backend configuration, because it has no viewer to
 * hand it a store.
 *
 * Both are produced together, from the same engine and the same screens, so the
 * two can never quietly become different products.
 */
const artifactPage = `${head}

<div id="app"></div>

${scripts}
`;

/*
 * What makes the hosted page installable (round 5).
 *
 * A manifest, an original icon, a theme colour, and a service worker that keeps
 * the page for offline play. Only the hosted copy gets these: the artifact is a
 * fragment inside claude.ai's own document, where a manifest link and a service
 * worker registration would be someone else's page claiming to be an app.
 *
 * Every path is relative. The site lives under /ishalom/, and round 3 found what
 * a root-relative href does there.
 */
const THEME = '#12161c';
const installTags = `<link rel="manifest" href="manifest.webmanifest" />
    <meta name="theme-color" content="${THEME}" />
    <link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="icons/apple-touch-icon.png" />
    <meta name="application-name" content="EV Trainer" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black" />
    <meta name="apple-mobile-web-app-title" content="EV Trainer" />`;

const registerWorker = `<script>
    /* Offline play for the installed app. Secure pages only, which is what the
       browser requires; a page opened from disk simply plays online. */
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    }
    /* Opened from the home screen: ask that what is saved here is never cleared
       to make room (round 9). Chrome grants it to an installed app and Safari to
       a home-screen app, without asking the player. In a browser tab it is not
       asked, because some browsers would ask the player, and a prompt about
       storage on a first visit is a reason to leave. The record is in the shared
       table too, so this guards the copy on the phone, not the only copy. */
    if (navigator.storage && navigator.storage.persist &&
        ((typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true)) {
      navigator.storage.persist().catch(() => {});
    }
    </script>`;

const manifest = {
  // Who the app is to the phone. Resolved against start_url, so it names the same
  // app every install already has (round 9).
  id: './',
  name: 'EV Trainer',
  short_name: 'EV Trainer',
  description: 'Blackjack and Ultimate Texas Hold’em: play real hands and see what the maths says about every decision.',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  background_color: THEME,
  theme_color: THEME,
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

const hostedPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="description" content="Play real blackjack hands and find out what the maths says about every decision you make." />
    <meta name="color-scheme" content="dark" />
    ${installTags}
    ${head}
    ${registerWorker}
  </head>
  <body>
    <div id="app"></div>
    <script>
    ${config === null ? '/* Built with no shared table: every player keeps their own record. */' : `const BACKEND_CONFIG = ${JSON.stringify(config)};`}
    </script>
    ${scripts}
  </body>
</html>
`;

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

const artifactTarget = join(PKG, 'build', 'artifact.html');
mkdirSync(dirname(artifactTarget), { recursive: true });
writeFileSync(artifactTarget, artifactPage, 'utf8');

// GitHub Pages serves this directory from the default branch.
const hostedTarget = join(ROOT, 'docs', 'index.html');
mkdirSync(dirname(hostedTarget), { recursive: true });
writeFileSync(hostedTarget, hostedPage, 'utf8');

const siteDir = dirname(hostedTarget);
writeFileSync(join(siteDir, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
// Each build gets its own cache, named by the stamp, so a deploy replaces the old one.
const buildId = `${stamp.commit.slice(0, 12)}-${stamp.at.replace(/[^0-9]/g, '').slice(0, 14)}`;
// The first build replaced the token in the comment and left the constant alone,
// so every deploy would have shared one cache. The token is now unique, and the
// build refuses a worker that still carries it.
const worker = read(ARTIFACT, 'sw.js').replaceAll('__EV_BUILD_ID__', buildId);
if (worker.includes('__EV_BUILD_ID__') || !worker.includes(`ev-trainer-${buildId}`)) {
  throw new Error('sw.js: the cache name was not stamped with this build');
}
writeFileSync(join(siteDir, 'sw.js'), worker, 'utf8');
const iconsFrom = join(PUBLIC, 'icons');
mkdirSync(join(siteDir, 'icons'), { recursive: true });
for (const file of readdirSync(iconsFrom).filter((f) => f.endsWith('.png'))) {
  copyFileSync(join(iconsFrom, file), join(siteDir, 'icons', file));
}

console.log(
  `${relative(ROOT, artifactTarget)}  ${kb(artifactPage.length)}\n` +
    `${relative(ROOT, hostedTarget)}  ${kb(hostedPage.length)}  ` +
    `(shared table: ${config === null ? 'not configured' : config.url})\n` +
    `  engine ${kb(engine.length)}, styles ${kb(styles.length)}, ` +
      `screens ${kb(homeJs.length + tableJs.length + ultimateJs.length)}`,
);
