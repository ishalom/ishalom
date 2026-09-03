import { startClean, stopClean } from '../actions.js';

const run = process.argv.includes('--stop')
  ? await stopClean({ verbose: true })
  : await startClean({ verbose: true });
console.log('\n' + run.text.trim());
process.exit(run.ok ? 0 : 1);
