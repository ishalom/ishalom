/**
 * Offline pre-flop EV table (spec §6.3, §6.5).
 *
 * Computes EV(4x) and EV(check) for each of the 169 hole-card classes and writes
 * them as a lookup asset. The spec is explicit that this is a build step: fully
 * exact is 2.1 billion outcomes per class, "a one-time cost of hours on a single
 * machine", re-run only when paytables or rules change.
 *
 * Because it runs for hours, it writes after every class and resumes from what
 * it finds. Killing it and restarting costs at most one class.
 *
 *   node scripts/generate-preflop.ts                     # all 169, resuming
 *   node scripts/generate-preflop.ts --classes AA,72o    # just these
 *   node scripts/generate-preflop.ts --out path.json
 *   node scripts/generate-preflop.ts --fresh             # ignore existing work
 *
 * Node needs headroom for the per-board tables: run it with
 * --max-old-space-size=4096 if the default heap is too small.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_BLIND_PAYTABLE } from '../src/uth/rules.ts';
import { allHoleClasses, solvePreflop, type PreflopResult } from '../src/uth/preflop.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = flag('--out') ?? join(packageRoot, 'assets', 'uth-preflop.json');
const fresh = args.includes('--fresh');
const only = flag('--classes')?.split(',').map((s) => s.trim()).filter(Boolean);

const classes = allHoleClasses().filter((c) => (only ? only.includes(c.label) : true));
if (only) {
  const missing = only.filter((label) => !classes.some((c) => c.label === label));
  if (missing.length > 0) throw new Error(`Unknown hole-card classes: ${missing.join(', ')}`);
}

interface Asset {
  generatedWith: string;
  blindPaytable: string;
  classes: Record<string, PreflopResult>;
}

let asset: Asset = {
  generatedWith: 'scripts/generate-preflop.ts',
  blindPaytable: DEFAULT_BLIND_PAYTABLE.name,
  classes: {},
};

if (!fresh && existsSync(outPath)) {
  const existing = JSON.parse(readFileSync(outPath, 'utf8')) as Asset;
  if (existing.blindPaytable === DEFAULT_BLIND_PAYTABLE.name) {
    asset = existing;
    const done = Object.keys(asset.classes).length;
    if (done > 0) process.stdout.write(`Resuming: ${done} of 169 classes already solved.\n`);
  } else {
    process.stdout.write('Existing table used a different blind paytable; starting fresh.\n');
  }
}

mkdirSync(dirname(outPath), { recursive: true });

const pending = classes.filter((c) => !(c.label in asset.classes));
process.stdout.write(`${pending.length} class(es) to solve.\n`);

const startedAll = Date.now();
let solved = 0;

for (const holeClass of pending) {
  const started = Date.now();
  const result = solvePreflop(holeClass, DEFAULT_BLIND_PAYTABLE);
  const seconds = (Date.now() - started) / 1000;
  solved++;

  asset.classes[holeClass.label] = result;
  // Written after every class: an eight-hour job must survive a laptop lid.
  writeFileSync(outPath, JSON.stringify(asset, null, 2));

  const elapsed = (Date.now() - startedAll) / 1000;
  const remaining = ((elapsed / solved) * (pending.length - solved)) / 60;
  process.stdout.write(
    `${holeClass.label.padEnd(4)} ` +
      `4x=${result.ev4x.toFixed(5).padStart(9)} ` +
      `check=${result.evCheck.toFixed(5).padStart(9)} ` +
      `-> ${result.optimalAction.padEnd(7)} ` +
      `[${seconds.toFixed(0)}s, ${solved}/${pending.length}, ~${remaining.toFixed(0)} min left]\n`,
  );
}

process.stdout.write(`\nWrote ${Object.keys(asset.classes).length} classes to ${outPath}\n`);
