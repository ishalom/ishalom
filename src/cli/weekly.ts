import { planWeek } from '../actions.js';

const autoConfirm = process.argv.includes('--auto-confirm');
const run = await planWeek({ verbose: true, autoConfirm });
console.log('\n' + run.text.trim());
process.exit(run.ok ? 0 : 1);
