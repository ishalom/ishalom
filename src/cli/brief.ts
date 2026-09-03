import { renderBrief } from '../actions.js';
import { loadConfig, envelopesAreMapped } from '../config.js';
import { briefPath } from '../paths.js';

const trigger = process.argv[2] ?? 'manual';

const { config } = loadConfig();
if (!envelopesAreMapped(config)) {
  console.error('! config.yaml still has placeholder envelope ids — run `npm run envelopes` first.');
  console.error('  The brief will render, but the money section will not match your budget.\n');
}

const run = await renderBrief({ trigger, verbose: true });

console.log('\n' + run.text.trim());
console.log(
  `\n${run.rendered ? 'rendered' : run.servedFromCache ? 'FELL BACK to cached brief' : 'NO OUTPUT'} → ${briefPath}` +
    ` · ${run.turns} turns · ${(run.durationMs / 1000).toFixed(1)}s · $${run.costUsd.toFixed(3)}`,
);
if (Object.keys(run.skipped).length > 0) {
  for (const [name, reason] of Object.entries(run.skipped)) console.log(`  skipped ${name}: ${reason}`);
}
process.exit(run.rendered || run.servedFromCache ? 0 : 1);
