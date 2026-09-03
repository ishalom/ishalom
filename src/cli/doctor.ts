import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { envelopesAreMapped, loadConfig } from '../config.js';
import { buildMcpServers } from '../mcp.js';
import { envOrUndefined, loadEnv } from '../env.js';
import { readCachedBrief, readCurrentBrief } from '../cache.js';
import { projectRoot, skillsDir } from '../paths.js';

loadEnv();

let failures = 0;
const ok = (msg: string) => console.log(`  ok    ${msg}`);
const warn = (msg: string) => console.log(`  warn  ${msg}`);
const fail = (msg: string) => {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
};

console.log('\nmorning-brief doctor\n');

console.log('runtime');
const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) ok(`node ${process.versions.node}`);
else fail(`node ${process.versions.node} — the Agent SDK needs node 20 or newer`);

console.log('\nsecrets (.env)');
if (envOrUndefined('ANTHROPIC_API_KEY')) ok('ANTHROPIC_API_KEY is set');
else fail('ANTHROPIC_API_KEY is missing — the agent cannot run');

console.log('\nconfig.yaml');
const { config, path: configFile } = loadConfig();
ok(`parsed ${path.relative(projectRoot, configFile)}`);
if (envelopesAreMapped(config)) ok(`${Object.keys(config.envelopes).length} envelopes mapped`);
else warn('envelope ids are still placeholders — run `npm run envelopes` and paste the block in');
const daily = Object.values(config.envelopes).filter((e) => e.role === 'daily').length;
ok(`${daily} daily envelopes · ${config.event_rules.length} event rules · ${config.prep_rules.length} prep rules`);

console.log('\nskills');
for (const name of ['morning-brief', 'weekly-planning']) {
  const file = path.join(skillsDir, name, 'SKILL.md');
  if (fs.existsSync(file)) ok(`${name} (${fs.readFileSync(file, 'utf8').split('\n').length} lines)`);
  else fail(`${name} is missing at ${file}`);
}

console.log('\nMCP servers');
const { servers, skipped } = buildMcpServers(config);
for (const [name, server] of Object.entries(servers)) {
  const stdio = server as { command: string; args?: string[] };
  ok(`${name} → ${stdio.command} ${(stdio.args ?? []).join(' ')}`);
}
for (const [name, reason] of Object.entries(skipped)) {
  if (name === 'roborock' || name === 'weather') warn(`${name} unavailable: ${reason} (its section is hidden)`);
  else fail(`${name} unavailable: ${reason}`);
}

if ('roborock' in servers) {
  const stdio = servers['roborock'] as { command: string };
  try {
    const version = execFileSync(stdio.command, ['--version'], { encoding: 'utf8', stdio: 'pipe' }).trim();
    ok(`python for the Roborock MCP: ${version}`);
  } catch {
    warn(`could not run "${stdio.command} --version" — check PYTHON_BIN in .env`);
  }
}

console.log('\noutput');
const current = readCurrentBrief();
if (current) ok(`out/brief.html last written ${current.renderedAt.toISOString()}`);
else warn('no brief rendered yet — run `npm run brief`');
const cached = readCachedBrief();
if (cached) ok(`cached fallback from ${cached.renderedAt.toISOString()}`);
else warn('no cached brief yet');

console.log(failures === 0 ? '\nall good.\n' : `\n${failures} problem(s) to fix.\n`);
process.exit(failures === 0 ? 0 : 1);
