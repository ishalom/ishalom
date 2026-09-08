/**
 * Cross-platform test runner.
 *
 * npm runs scripts through `cmd.exe` on Windows and `sh` on everything else, and
 * the two disagree about both quoting and environment variables. Two npm scripts
 * written in POSIX shell syntax silently did the wrong thing on Windows: a
 * single-quoted glob reached Node with the quotes still attached, matched no
 * files, and made `npm test` exit 0 having run nothing — a suite that looks
 * green because it is empty. A `VAR=1 node ...` prefix is not a command at all
 * under `cmd.exe`.
 *
 * This script sidesteps the shell entirely. It finds the test files itself and
 * hands Node an explicit list, so neither shell quoting nor Node's own glob
 * support (still experimental on the oldest version this package claims to run
 * on) can change which tests execute.
 *
 *   node scripts/test.ts [--slow] [--update-golden] [file...]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = join(PACKAGE_ROOT, 'test');

function findTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...findTestFiles(path));
    else if (entry.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

const argv = process.argv.slice(2);
const slow = argv.includes('--slow');
const updateGolden = argv.includes('--update-golden');
const explicit = argv.filter((a) => !a.startsWith('--'));

const files = explicit.length > 0 ? explicit.map((f) => join(PACKAGE_ROOT, f)) : findTestFiles(TEST_DIR);

const missing = files.filter((f) => !existsSync(f));
if (missing.length > 0) {
  process.stderr.write(`No such test file: ${missing.map((f) => relative(PACKAGE_ROOT, f)).join(', ')}\n`);
  process.exit(1);
}
// Guard the failure mode that hid the original bug: running no tests must never
// look like a passing suite.
if (files.length === 0) {
  process.stderr.write('Found no test files — refusing to report success.\n');
  process.exit(1);
}

const env = { ...process.env };
if (slow) env.EV_ENGINE_SLOW_TESTS = '1';
if (updateGolden) env.UPDATE_GOLDEN = '1';

const args = ['--test'];
// The slow suite runs tens of millions of simulated hands; the default per-test
// timeout is nowhere near enough for it.
if (slow) args.push('--test-timeout=3600000');
args.push(...files);

const result = spawnSync(process.execPath, args, { stdio: 'inherit', env, cwd: PACKAGE_ROOT });
process.exit(result.status ?? 1);
