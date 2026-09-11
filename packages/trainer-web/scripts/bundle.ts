/**
 * Flatten the engines into one script the browser can run.
 *
 * The repo has no build step on purpose: Node runs the TypeScript directly and
 * the server hands the client plain files. A browser cannot do either, so the
 * shareable build needs the sources folded into a single classic script.
 *
 * This is deliberately not a general bundler. It exploits three things that are
 * true of this codebase and checked here rather than assumed:
 *
 *   1. Every module is ESM with relative `./x.ts` specifiers, or the workspace
 *      name `@evtrainer/ev-engine`, and nothing else. There are no runtime
 *      dependencies to resolve.
 *   2. `erasableSyntaxOnly` is on, so `module.stripTypeScriptTypes` — the same
 *      stripper the Node runtime uses — turns each file into valid JavaScript by
 *      blanking characters in place. Nothing moves; nothing is rewritten.
 *   3. No two modules declare the same top-level name. That is what makes it
 *      safe to drop every import and concatenate into one shared scope, and it
 *      is verified below: a collision fails the build rather than shadowing a
 *      function somebody else is calling.
 *
 * The result is byte-for-byte the same logic the tests run against, which is the
 * whole point — a hand-ported copy of the solver would be a second engine to
 * keep correct, and there is only one thing in this product that must not drift.
 */

import { stripTypeScriptTypes } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const EV_ENGINE = join(ROOT, 'packages', 'ev-engine', 'src');

/** Bare specifiers that resolve inside the bundle rather than to a package. */
const WORKSPACE: Record<string, string> = {
  '@evtrainer/ev-engine': join(EV_ENGINE, 'blackjack-browser.ts'),
  '@evtrainer/ev-engine/uth': join(EV_ENGINE, 'uth-entry.ts'),
  '@evtrainer/game-engine': join(ROOT, 'packages', 'game-engine', 'src', 'index.ts'),
};

const IMPORT_RE = /^\s*import\s[\s\S]*?from\s*['"]([^'"]+)['"];?\s*$/gm;
const BARE_IMPORT_RE = /^\s*import\s*['"]([^'"]+)['"];?\s*$/gm;
const EXPORT_FROM_RE = /^\s*export\s+(?:\*|\{[\s\S]*?\})\s+from\s*['"]([^'"]+)['"];?\s*$/gm;

function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const re of [IMPORT_RE, BARE_IMPORT_RE, EXPORT_FROM_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) found.push(m[1]!);
  }
  return found;
}

function resolveSpecifier(from: string, spec: string): string | null {
  if (WORKSPACE[spec]) return WORKSPACE[spec];
  if (!spec.startsWith('.')) return null; // node: builtins and the like
  return resolve(dirname(from), spec);
}

/** Depth-first, post-order: a module is emitted after everything it imports. */
function collect(entry: string, seen = new Set<string>(), order: string[] = []): string[] {
  if (seen.has(entry)) return order;
  seen.add(entry);
  const source = readFileSync(entry, 'utf8');
  for (const spec of specifiers(source)) {
    const target = resolveSpecifier(entry, spec);
    if (target) collect(target, seen, order);
  }
  order.push(entry);
  return order;
}

/**
 * A renamed import: `{ Shoe as Composition }`.
 *
 * Dropping the import statement is only safe while a module refers to what it
 * imported by the name it was declared under. A rename breaks that — the code
 * says `Composition` and the bundle only ever declares `Shoe` — so each rename
 * has to leave an alias behind. This shipped broken once: the aliased name was
 * reached only on the insurance path, so every other hand worked and the
 * published page threw the moment a dealer showed an ace.
 */
function aliasesIn(source: string): Array<[string, string]> {
  const aliases: Array<[string, string]> = [];
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(source)) !== null) {
    const braces = /\{([\s\S]*?)\}/.exec(m[0]);
    if (!braces) continue;
    for (const part of braces[1]!.split(',')) {
      const renamed = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)\s*$/.exec(part);
      // A type-only rename erases with the types; only value renames need one.
      if (renamed && !/^\s*type\s/.test(part)) aliases.push([renamed[2]!, renamed[1]!]);
    }
  }
  return aliases;
}

/**
 * Strip the module wrapper: imports become nothing (one scope), and `export`
 * becomes nothing (everything is already visible). Re-export barrels collapse to
 * nothing at all, since what they re-export is in scope by then.
 */
function demodularise(source: string, alias: Map<string, string>): string {
  /* Two modules can rename the same export, and both then need the alias in
     scope — but only the first may declare it. The bundle is in dependency
     order, so the first emission always precedes every use. */
  const lines: string[] = [];
  for (const [as, original] of aliasesIn(source)) {
    const existing = alias.get(as);
    if (existing === undefined) {
      alias.set(as, original);
      lines.push(`const ${as} = ${original};`);
    } else if (existing !== original) {
      throw new Error(`${as} is an alias for both ${existing} and ${original}`);
    }
  }
  let out = stripTypeScriptTypes(source, { mode: 'strip' });
  out = out.replace(EXPORT_FROM_RE, '');
  out = out.replace(IMPORT_RE, '');
  out = out.replace(BARE_IMPORT_RE, '');
  // `export { a, b };` with no `from` — the names are already declared above it.
  out = out.replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
  out = out.replace(/^(\s*)export\s+(default\s+)?/gm, '$1');
  return lines.length > 0 ? `${lines.join('\n')}\n${out}` : out;
}

/**
 * Every value a module imports must be declared somewhere in the bundle.
 *
 * This is the check that would have caught the alias bug before it was
 * published. It is cheap and it is total: collect what each module asked for by
 * name, and refuse to emit a bundle that cannot supply one of them.
 */
function importedNames(source: string): string[] {
  const names: string[] = [];
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(source)) !== null) {
    if (/^\s*import\s+type\s/.test(m[0])) continue;
    const braces = /\{([\s\S]*?)\}/.exec(m[0]);
    if (!braces) continue;
    for (const part of braces[1]!.split(',')) {
      if (/^\s*type\s/.test(part) || part.trim() === '') continue;
      const renamed = /\s+as\s+([A-Za-z_$][\w$]*)\s*$/.exec(part);
      names.push(renamed ? renamed[1]! : part.trim());
    }
  }
  return names;
}

/** Top-level declarations, for the collision check. */
function declaredNames(js: string): string[] {
  const names: string[] = [];
  const re = /^(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(js)) !== null) names.push(m[1]!);
  return names;
}

export function bundle(entries: readonly string[]): string {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const entry of entries) collect(entry, seen, order);

  const owner = new Map<string, string>();
  const parts: string[] = [];
  const collisions: string[] = [];

  const wanted: Array<[string, string]> = [];
  const alias = new Map<string, string>();

  for (const file of order) {
    const source = readFileSync(file, 'utf8');
    const js = demodularise(source, alias);
    const short = relative(ROOT, file).replace(/\\/g, '/');
    for (const name of declaredNames(js)) {
      const previous = owner.get(name);
      if (previous !== undefined) collisions.push(`${name}: ${previous} and ${short}`);
      else owner.set(name, short);
    }
    for (const name of importedNames(source)) wanted.push([name, short]);
    parts.push(`/* ===== ${short} ===== */\n${js.trim()}\n`);
  }

  const missing = wanted
    .filter(([name]) => !owner.has(name))
    .map(([name, from]) => `${name} (wanted by ${from})`);
  if (missing.length > 0) {
    throw new Error(
      `The bundle refers to names nothing in it declares, so the page would ` +
        `throw the first time one is reached:\n  ${[...new Set(missing)].join('\n  ')}`,
    );
  }

  if (collisions.length > 0) {
    throw new Error(
      `Two modules declare the same top-level name, so flattening them into one ` +
        `scope would silently shadow one of them:\n  ${collisions.join('\n  ')}`,
    );
  }

  return parts.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const entries = process.argv.slice(2).map((a) => resolve(a));
  if (entries.length === 0) throw new Error('usage: bundle.ts <entry.ts> [...]');
  const out = bundle(entries);
  const target = join(HERE, '..', 'build', 'engine.js');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, out, 'utf8');
  console.log(`${out.length.toLocaleString()} bytes -> ${relative(ROOT, target)}`);
}
