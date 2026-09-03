import path from 'node:path';
import { query, type HookCallbackMatcher, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { loadConfig } from './config.js';
import { loadEnv } from './env.js';
import { buildMcpServers } from './mcp.js';
import { loadSkill } from './skills.js';
import { outDir, projectRoot } from './paths.js';

export interface RunSkillOptions {
  /** Directory name under skills/. Omit for a one-off task with no skill. */
  skill?: string;
  /** The concrete instruction for this run, in English. */
  task: string;
  /** MCP servers this run may use. Omit for every server in config.yaml. */
  servers?: string[];
  /** Built-in tools to allow. Default: none — the agent works through MCP only. */
  tools?: string[];
  /** Absolute paths the agent may write to. Anything else is denied by a hook. */
  writablePaths?: string[];
  maxTurns?: number;
  /** Print tool calls and assistant text as they happen. */
  verbose?: boolean;
}

export interface RunSkillResult {
  ok: boolean;
  /** The agent's final message. */
  text: string;
  turns: number;
  costUsd: number;
  durationMs: number;
  /** MCP servers left out of this run, with the reason. */
  skipped: Record<string, string>;
}

function houseRules(): string {
  return [
    'You are the brain of a personal assistant that runs unattended on a home PC.',
    '',
    'Rules that hold for every run:',
    '1. Every data source is an MCP server. Never guess or invent a number, an event or a',
    '   forecast: if a tool did not return it, you do not know it.',
    '2. You own no state. Anything the user decides is written back to the owning system',
    '   through its MCP (the calendar owns the schedule, RiseUp owns the budget).',
    '3. A failing source degrades its own section only. Never abort the whole run because',
    '   one tool errored — report the failure in the section that needed it and continue.',
    '4. All user-facing text is in Hebrew. Your reasoning and your notes to the console are',
    '   in English.',
    '5. No one is watching while you work. Never ask a question and wait; make the call the',
    '   rules imply, and if a rule is genuinely ambiguous, say so in the output.',
    '6. Work only through the tools you were given. Do not read or write files that the',
    '   skill did not ask for.',
  ].join('\n');
}

function runtimeFacts(skipped: Record<string, string>, servers: string[]): string {
  const { config } = loadConfig();
  const now = new Date();
  const lines = [
    `Now: ${now.toISOString()} (UTC)`,
    `Local time: ${now.toLocaleString(config.locale, { timeZone: config.timezone })} (${config.timezone})`,
    `Local date: ${now.toLocaleDateString('en-CA', { timeZone: config.timezone })}`,
    `Home: ${config.home.location} (${config.home.latitude}, ${config.home.longitude})`,
    `Project root: ${projectRoot}`,
    `Output directory: ${outDir}`,
    `MCP servers available this run: ${servers.length > 0 ? servers.join(', ') : 'none'}`,
  ];
  const unavailable = Object.entries(skipped);
  if (unavailable.length > 0) {
    lines.push('MCP servers NOT available this run (treat their sections as unavailable):');
    for (const [name, reason] of unavailable) lines.push(`  - ${name}: ${reason}`);
  }
  return lines.join('\n');
}

/**
 * The SDK spawns the Claude Code CLI, which picks up CLAUDE_* variables from its
 * environment. When this host itself runs inside Claude Code, those leak into the
 * child: CLAUDE_CODE_SESSION_ID in particular makes the run attach to the parent's
 * session, so it replays that session's system prompt and edits to the skill or to
 * config.yaml silently have no effect.
 *
 * Only the session and control variables are dropped. Provider and auth variables
 * are kept, since on some hosts they are how the CLI authenticates at all.
 */
const INHERITED_CONTROL_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_WORKER_EPOCH',
  'CLAUDE_CODE_DEBUG',
  'CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_AFTER_LAST_COMPACT',
  'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE',
  'CLAUDE_AUTO_BACKGROUND_TASKS',
  'AI_AGENT',
];

function subprocessEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of INHERITED_CONTROL_VARS) delete env[name];
  env['CLAUDE_AGENT_SDK_CLIENT_APP'] = 'morning-brief/0.1.0';
  return env;
}

/**
 * Belt-and-braces guard: the tool surface is already tiny, but this makes the
 * set of files a run can touch explicit rather than a matter of prompt discipline.
 */
function writeGuard(writablePaths: string[]): HookCallbackMatcher {
  const allowed = writablePaths.map((file) => path.resolve(file));
  return {
    matcher: 'Write|Edit|MultiEdit|NotebookEdit',
    hooks: [
      async (input) => {
        if (input.hook_event_name !== 'PreToolUse') return { continue: true };
        const target = (input.tool_input as { file_path?: string } | null)?.file_path;
        const resolved = target ? path.resolve(projectRoot, target) : undefined;
        if (resolved && allowed.includes(resolved)) return { continue: true };
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `This run may only write to: ${allowed.join(', ') || '(nothing)'}`,
          },
        };
      },
    ],
  };
}

export async function runSkill(options: RunSkillOptions): Promise<RunSkillResult> {
  loadEnv();
  const { config, raw } = loadConfig();
  const skill = options.skill ? loadSkill(options.skill) : undefined;
  const { servers, skipped } = buildMcpServers(config, options.servers);

  const systemPrompt = [
    houseRules(),
    '',
    '<runtime>',
    runtimeFacts(skipped, Object.keys(servers)),
    '</runtime>',
    '',
    '<config file="config.yaml">',
    raw.trim(),
    '</config>',
    ...(skill ? ['', `<skill name="${options.skill}">`, skill.trim(), '</skill>'] : []),
  ].join('\n');

  // Unattended run: nobody can answer a permission prompt, so every tool call is
  // decided here. Tools from the wired MCP servers and anything in `tools` are
  // allowed; everything else is denied rather than asked about. (Listing them in
  // `allowedTools` instead would auto-approve them before this callback runs.)
  const builtinTools = options.tools ?? [];

  const queryOptions: Options = {
    model: config.agent.model,
    ...(config.agent.fallback_model ? { fallbackModel: config.agent.fallback_model } : {}),
    systemPrompt,
    mcpServers: servers,
    tools: builtinTools,
    permissionMode: 'default',
    canUseTool: async (toolName, input) => {
      const permitted =
        builtinTools.includes(toolName) ||
        Object.keys(servers).some((name) => toolName.startsWith(`mcp__${name}`));
      return permitted
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: `${toolName} is not available in this run.` };
    },
    settingSources: [],
    env: subprocessEnv(),
    cwd: projectRoot,
    maxTurns: options.maxTurns ?? config.agent.max_turns,
    includePartialMessages: false,
    hooks: { PreToolUse: [writeGuard(options.writablePaths ?? [])] },
  };

  let text = '';
  let turns = 0;
  let costUsd = 0;
  let durationMs = 0;
  let ok = false;

  const startedAt = Date.now();
  try {
    for await (const message of query({ prompt: options.task, options: queryOptions })) {
      trace(message, options.verbose ?? false);
      if (message.type === 'result') {
        turns = message.num_turns;
        costUsd = message.total_cost_usd;
        durationMs = message.duration_ms;
        ok = message.subtype === 'success' && !message.is_error;
        text = message.subtype === 'success' ? message.result : `agent error: ${message.subtype}`;
      }
    }
  } catch (error) {
    // An overloaded API or a dead subprocess must not take the caller down: an
    // unattended run still has to reach its fallback (the cached brief).
    ok = false;
    durationMs = Date.now() - startedAt;
    text = `agent run failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`! ${text}`);
  }

  return { ok, text, turns, costUsd, durationMs, skipped };
}

function trace(message: SDKMessage, verbose: boolean): void {
  if (!verbose) return;
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text' && block.text.trim()) {
        console.error(`· ${block.text.trim().split('\n')[0]}`);
      } else if (block.type === 'tool_use') {
        console.error(`→ ${block.name}`);
      }
    }
  } else if (message.type === 'system' && message.subtype === 'init') {
    console.error(`· session ${message.session_id} · tools: ${message.tools.length}`);
  }
}
