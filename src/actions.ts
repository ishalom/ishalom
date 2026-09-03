import fs from 'node:fs';
import { runSkill, type RunSkillResult } from './agent.js';
import { ensureOutDirs, readCachedBrief, saveBriefToCache, withStaleBanner } from './cache.js';
import { briefPath } from './paths.js';
import { loadConfig } from './config.js';

export interface BriefRun extends RunSkillResult {
  /** True when out/brief.html was (re)written by this run. */
  rendered: boolean;
  /** True when we fell back to the cached brief because the run produced nothing. */
  servedFromCache: boolean;
}

function mtimeOrZero(file: string): number {
  return fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
}

/**
 * The 07:00 / 12:00 / 18:00 job. The agent fetches through the MCP servers,
 * applies config.yaml and writes out/brief.html itself.
 */
export async function renderBrief(options: { trigger?: string; verbose?: boolean } = {}): Promise<BriefRun> {
  ensureOutDirs();
  // Clear the target first. The Write tool refuses to overwrite a file it has not
  // read, and these runs have no Read tool — so without this the 07:00 render would
  // succeed and every refresh after it would silently fail. The last good brief
  // lives in the cache, so nothing is lost if this run then writes nothing.
  fs.rmSync(briefPath, { force: true });
  const before = mtimeOrZero(briefPath);
  const trigger = options.trigger ?? 'manual';

  const result = await runSkill({
    skill: 'morning-brief',
    task: [
      `Run the morning-brief skill now. Trigger: ${trigger}.`,
      `Write the finished page to ${briefPath} (overwrite it) and then reply with a short`,
      'English summary for the console: what each section says, and which sources failed.',
    ].join(' '),
    tools: ['Write'],
    writablePaths: [briefPath],
    verbose: options.verbose,
  });

  const rendered = mtimeOrZero(briefPath) > before;
  if (rendered) {
    saveBriefToCache();
    return { ...result, rendered, servedFromCache: false };
  }

  // Nothing was written — keep the TV showing the last good brief, marked stale.
  const cached = readCachedBrief();
  if (cached) {
    fs.writeFileSync(briefPath, withStaleBanner(cached.html, cached.renderedAt), 'utf8');
    return { ...result, rendered: false, servedFromCache: true };
  }
  return { ...result, rendered: false, servedFromCache: false };
}

/** The Saturday 20:00 job. Writes the confirmed home/office days to the calendar. */
export async function planWeek(options: { verbose?: boolean; autoConfirm?: boolean } = {}): Promise<RunSkillResult> {
  const { config } = loadConfig();
  return runSkill({
    skill: 'weekly-planning',
    task: [
      'Run the weekly-planning skill for the coming week.',
      options.autoConfirm
        ? 'Nobody is available to confirm: write the proposal straight to the calendar and report what you wrote.'
        : 'Print the proposal in Hebrew and, unless a day is already marked, write it to the calendar as described in the skill.',
      `Plan ${config.brief.calendar_days_ahead} days ahead.`,
    ].join(' '),
    servers: ['google-calendar'],
    verbose: options.verbose,
  });
}

const REPLY_CONTRACT = [
  'Reply with exactly one line and nothing else:',
  '`OK <short Hebrew sentence>` when the robot accepted the command, or',
  '`FAIL <short Hebrew sentence>` when it did not, including when the tool was unavailable.',
].join(' ');

/**
 * A successful agent run is not a successful action — the agent can report a
 * failure perfectly well. The OK/FAIL prefix is what the button reads.
 */
function readActionReply(result: RunSkillResult): RunSkillResult {
  const line = result.text.trim();
  const match = /^(OK|FAIL)\b[:\s-]*(.*)$/is.exec(line);
  if (!match) return { ...result, ok: false };
  return { ...result, ok: result.ok && match[1]!.toUpperCase() === 'OK', text: (match[2] ?? '').trim() || line };
}

/** Phase-1 TV button: "התחל ניקוי". */
export async function startClean(options: { verbose?: boolean } = {}): Promise<RunSkillResult> {
  const result = await runSkill({
    task: ['Call the Roborock MCP to start a clean of the whole home.', REPLY_CONTRACT].join(' '),
    servers: ['roborock'],
    maxTurns: 8,
    verbose: options.verbose,
  });
  return readActionReply(result);
}

export async function stopClean(options: { verbose?: boolean } = {}): Promise<RunSkillResult> {
  const result = await runSkill({
    task: [
      'Call the Roborock MCP to stop the current clean and send the robot back to its dock.',
      REPLY_CONTRACT,
    ].join(' '),
    servers: ['roborock'],
    maxTurns: 8,
    verbose: options.verbose,
  });
  return readActionReply(result);
}

/** Phase 1: print the raw envelopes so config.yaml can be filled in. */
export async function dumpEnvelopes(options: { month?: string; verbose?: boolean } = {}): Promise<RunSkillResult> {
  const month = options.month ?? 'current';
  return runSkill({
    task: [
      `Call the RiseUp MCP get_budget tool with date "${month}".`,
      'Then print, in English:',
      '(a) the raw JSON of the response, unmodified and complete;',
      '(b) a table of every envelope: id, name field (say which field carried it, or "none"),',
      '    type, originalAmount, balancedAmount, and originalAmount - balancedAmount;',
      '(c) whether expense amounts came back positive or negative;',
      '(d) a ready-to-paste config.yaml `envelopes:` block keyed by the real ids, with the',
      '    roles and tones from the existing config matched by name where you can, and',
      '    role: track for anything you cannot match.',
      'Do not call any other tool.',
    ].join('\n'),
    servers: ['riseup'],
    maxTurns: 10,
    verbose: options.verbose,
  });
}
