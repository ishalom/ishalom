import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { Config, McpServerSpec } from './config.js';
import { projectRoot } from './paths.js';
import { envOrUndefined, loadEnv } from './env.js';

export interface ServerWiring {
  /** Servers that are configured and have their secrets present. */
  servers: Record<string, McpServerConfig>;
  /** name -> human-readable reason it was left out, so sections can degrade honestly. */
  skipped: Record<string, string>;
}

const INTERPOLATION = /\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g;

/** Expands `${VAR}` and `${VAR:-default}` against the process environment. */
function interpolate(value: string): string | undefined {
  let missing = false;
  const expanded = value.replace(INTERPOLATION, (_match, name: string, fallback?: string) => {
    const fromEnv = envOrUndefined(name);
    if (fromEnv !== undefined) return fromEnv;
    if (fallback !== undefined) return fallback;
    missing = true;
    return '';
  });
  return missing ? undefined : expanded;
}

function buildOne(name: string, spec: McpServerSpec): McpServerConfig | string {
  if (!spec.enabled) return 'disabled in config.yaml';

  const missingSecrets = spec.requires_env.filter((key) => envOrUndefined(key) === undefined);
  if (missingSecrets.length > 0) return `missing ${missingSecrets.join(', ')} in .env`;

  const command = interpolate(spec.command);
  if (command === undefined) return `unresolved variable in command "${spec.command}"`;

  const args: string[] = [];
  for (const arg of spec.args) {
    const resolved = interpolate(arg);
    if (resolved === undefined) return `unresolved variable in args entry "${arg}"`;
    args.push(resolved);
  }

  // Optional env entries whose variable is unset are dropped rather than passed empty.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(spec.env)) {
    const resolved = interpolate(value);
    if (resolved !== undefined && resolved !== '') env[key] = resolved;
  }

  return {
    type: 'stdio',
    command,
    args,
    env,
    ...(spec.timeout_ms ? { timeout: spec.timeout_ms } : {}),
  } satisfies McpServerConfig;
}

/**
 * Turns the `mcp_servers` block of config.yaml into Agent SDK server configs.
 * Every data source is an MCP server (spec 0.1) — nothing here talks to an API.
 */
export function buildMcpServers(config: Config, only?: string[]): ServerWiring {
  loadEnv();
  // Servers are launched from the repo root so relative paths (e.g. the
  // Roborock package) resolve the same way from any caller.
  process.env.PROJECT_ROOT ??= projectRoot;

  const servers: Record<string, McpServerConfig> = {};
  const skipped: Record<string, string> = {};

  for (const [name, spec] of Object.entries(config.mcp_servers)) {
    if (only && !only.includes(name)) continue;
    const built = buildOne(name, spec);
    if (typeof built === 'string') skipped[name] = built;
    else servers[name] = built;
  }

  if (only) {
    for (const name of only) {
      if (!(name in servers) && !(name in skipped)) skipped[name] = 'not defined in config.yaml';
    }
  }

  return { servers, skipped };
}
