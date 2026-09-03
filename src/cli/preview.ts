/**
 * Renders the brief from samples/week.json instead of the MCP servers.
 *
 * The point is to iterate on layout and Hebrew wording without credentials,
 * a network or a real budget: edit samples/week.json (or the skill), run this,
 * look at out/preview.html. Nothing here touches the real brief.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runSkill } from '../agent.js';
import { loadConfig } from '../config.js';
import { ensureOutDirs } from '../cache.js';
import { outDir, projectRoot } from '../paths.js';

interface SampleEvent {
  day_offset: number;
  time?: string;
  all_day?: boolean;
  title: string;
}

const samplePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(projectRoot, 'samples', 'week.json');

if (!fs.existsSync(samplePath)) {
  console.error(`sample not found: ${samplePath}`);
  process.exit(1);
}

const { config } = loadConfig();
const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8')) as Record<string, unknown>;

// day_offset is relative so the preview always reads as "today".
const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: config.timezone }));
const events = ((sample['events'] as SampleEvent[] | undefined) ?? []).map((event) => {
  const date = new Date(today);
  date.setDate(date.getDate() + event.day_offset);
  return {
    date: date.toLocaleDateString('en-CA'),
    weekday: date.toLocaleDateString('en-US', { weekday: 'long' }),
    start: event.all_day ? 'all-day' : event.time,
    title: event.title,
  };
});

const previewPath = path.join(outDir, 'preview.html');
ensureOutDirs();

const run = await runSkill({
  skill: 'morning-brief',
  task: [
    'PREVIEW RUN. No MCP servers are wired this run. Instead, the block below is a',
    'captured set of source responses — treat it exactly as if the tools had returned',
    'it, and do not call any tool other than Write. Every source counts as available,',
    'so no section should say לא זמין.',
    '',
    'The envelope ids match the keys in config.yaml, so read each envelope\'s name,',
    'role and tone from there. Balances follow the skill: originalAmount - balancedAmount.',
    '',
    '<sample-data>',
    JSON.stringify({ ...sample, events, _comment: undefined }, null, 2),
    '</sample-data>',
    '',
    `Render it per the skill's layout contract to ${previewPath}, then reply with the`,
    'English console summary as usual.',
  ].join('\n'),
  tools: ['Write'],
  writablePaths: [previewPath],
  verbose: true,
});

console.log('\n' + run.text.trim());
console.log(`\npreview → ${previewPath} · ${run.turns} turns · $${run.costUsd.toFixed(3)}`);
process.exit(fs.existsSync(previewPath) ? 0 : 1);
