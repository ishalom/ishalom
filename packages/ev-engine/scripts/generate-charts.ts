/**
 * Offline chart generation (spec §6.5).
 *
 * Derives the full strategy chart for every preset in exact mode and writes it
 * to `charts/`. This is the build step the app ships the results of; nothing in
 * `src/` reads or writes files, which is what keeps the engine pure.
 *
 *   node scripts/generate-charts.ts [--fast] [--out DIR]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveChart, formatChart } from '../src/blackjack/chart.ts';
import { RULE_PRESETS } from '../src/blackjack/rules.ts';

const args = process.argv.slice(2);
const fast = args.includes('--fast');
const outIndex = args.indexOf('--out');
const outDir =
  outIndex >= 0 && args[outIndex + 1] !== undefined
    ? args[outIndex + 1]!
    : join(dirname(fileURLToPath(import.meta.url)), '..', 'charts');

mkdirSync(outDir, { recursive: true });

for (const preset of RULE_PRESETS) {
  const started = Date.now();
  const chart = deriveChart(preset.rules, {
    cardRemoval: fast ? 'static-dealer' : 'exact',
  });
  const path = join(outDir, `${preset.id}.txt`);
  writeFileSync(path, formatChart(chart));
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  process.stdout.write(`${preset.id}: ${chart.cells.size} cells in ${seconds}s -> ${path}\n`);
  if (preset.note) process.stdout.write(`  note: ${preset.note}\n`);
}
