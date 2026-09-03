import { dumpEnvelopes } from '../actions.js';

const monthArg = process.argv.find((arg) => /^(current|previous|\d{4}-\d{2})$/.test(arg));
const run = await dumpEnvelopes({ month: monthArg, verbose: true });
console.log('\n' + run.text.trim());
process.exit(run.ok ? 0 : 1);
