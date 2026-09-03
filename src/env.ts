import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { projectRoot } from './paths.js';

let loaded = false;

/**
 * Loads `.env` from the repository root. Secrets are the one kind of
 * assistant-only state the architecture rules permit (spec 0.2).
 */
export function loadEnv(): void {
  if (loaded) return;
  loadDotenv({ path: path.join(projectRoot, '.env'), quiet: true });
  loaded = true;
}

export function envOrUndefined(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
}

export function requireEnv(name: string, hint: string): string {
  const value = envOrUndefined(name);
  if (!value) throw new Error(`Missing ${name} in .env — ${hint}`);
  return value;
}
