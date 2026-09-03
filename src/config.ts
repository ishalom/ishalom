import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { configPath } from './paths.js';

const EnvelopeSchema = z.object({
  name: z.string().min(1),
  role: z.enum(['daily', 'track', 'hidden']),
  tone: z.enum(['encourage', 'quiet', 'reduce']).optional(),
});

const EventRuleSchema = z.object({
  match: z.array(z.string().min(1)).min(1),
  kind: z.string().min(1),
  envelope: z.string().optional(),
  /** null = split the envelope's remaining balance across the remaining spend events. */
  per_event: z.number().nullable().optional(),
});

const PrepRuleSchema = z.object({
  when: z.string().min(1),
  remind: z.string().min(1),
  once_per_week: z.boolean().optional(),
});

const McpServerSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  /** Env vars that must be present, or the server is skipped and its section degrades. */
  requires_env: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  timeout_ms: z.number().int().positive().optional(),
});

const ConfigSchema = z.object({
  timezone: z.string().default('Asia/Jerusalem'),
  locale: z.string().default('he-IL'),
  home: z.object({
    location: z.string().min(1),
    latitude: z.number(),
    longitude: z.number(),
  }),
  agent: z
    .object({
      model: z.string().default('claude-opus-5'),
      /** Tried when the primary model is overloaded, so a 529 does not cost a brief. */
      fallback_model: z.string().optional(),
      max_turns: z.number().int().positive().default(60),
    })
    .default({ model: 'claude-opus-5', max_turns: 60 }),
  brief: z
    .object({
      refresh_seconds: z.number().int().positive().default(300),
      track_threshold_pct: z.number().min(0).max(100).default(20),
      /** Whether a daily envelope's balance shows every day, or only when today spends from it. */
      show_daily_balances: z.enum(['on_expense', 'always']).default('on_expense'),
      calendar_days_ahead: z.number().int().positive().default(7),
      port: z.number().int().positive().default(8080),
    })
    .default({
      refresh_seconds: 300,
      track_threshold_pct: 20,
      show_daily_balances: 'on_expense',
      calendar_days_ahead: 7,
      port: 8080,
    }),
  roborock: z
    .object({ suggest_clean_after_days: z.number().int().positive().default(3) })
    .default({ suggest_clean_after_days: 3 }),
  envelopes: z.record(z.string(), EnvelopeSchema).default({}),
  event_rules: z.array(EventRuleSchema).default([]),
  prep_rules: z.array(PrepRuleSchema).default([]),
  mcp_servers: z.record(z.string(), McpServerSchema).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type McpServerSpec = z.infer<typeof McpServerSchema>;

export interface LoadedConfig {
  /** Parsed and validated rules. */
  config: Config;
  /** The raw YAML, handed to the agent verbatim — it is the rulebook it applies. */
  raw: string;
  path: string;
}

let cached: LoadedConfig | undefined;

export function loadConfig(): LoadedConfig {
  if (cached) return cached;
  if (!fs.existsSync(configPath)) {
    throw new Error(`config.yaml not found at ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = ConfigSchema.safeParse(parseYaml(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`config.yaml is invalid:\n${issues}`);
  }
  cached = { config: parsed.data, raw, path: configPath };
  return cached;
}

/** True once the placeholder envelope ids from the template have been replaced. */
export function envelopesAreMapped(config: Config): boolean {
  const ids = Object.keys(config.envelopes);
  return ids.length > 0 && !ids.some((id) => id.startsWith('<') || id.startsWith('riseup-id'));
}
