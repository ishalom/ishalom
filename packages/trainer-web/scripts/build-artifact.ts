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

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

const engine = bundle([join(PKG, 'src', 'session.ts')]);
const styles = read(PUBLIC, 'styles.css') + read(ARTIFACT, 'extra.css');
const homeHtml = bodyOf(read(PUBLIC, 'home.html'));
const tableHtml = bodyOf(read(PUBLIC, 'table.html'));
const homeJs = screenScript(read(PUBLIC, 'home.js'), 'initHome');
const tableJs = screenScript(read(PUBLIC, 'app.js'), 'initTable');
const shell = read(ARTIFACT, 'shell.js');
const ui = read(ARTIFACT, 'ui.js');

const page = `<title>EV Trainer</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Rubik:wght@300..900&display=swap" />
<style>
${styles}
</style>

<div id="app"></div>

<script>
/* The engines, folded into one scope by scripts/bundle.ts. Byte-for-byte the
   logic the test suite runs against — test/bundle.test.ts holds them to it. */
${engine}
</script>

<script>
/* Screen markup, lifted from the pages the local app serves. */
const HOME_HTML = ${jsString(homeHtml)};
const TABLE_HTML = ${jsString(tableHtml)};

/* The two screen scripts, unchanged but for their transport. */
${homeJs}
${tableJs}

${shell}

${ui}
</script>
`;

const target = join(PKG, 'build', 'artifact.html');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, page, 'utf8');

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
console.log(
  `${relative(ROOT, target)}  ${kb(page.length)} total ` +
    `(engine ${kb(engine.length)}, styles ${kb(styles.length)}, screens ${kb(homeJs.length + tableJs.length)})`,
);
