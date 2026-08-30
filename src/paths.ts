import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, resolved from this file both under tsx (src/) and after tsc (dist/). */
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const skillsDir = path.join(projectRoot, 'skills');
export const publicDir = path.join(projectRoot, 'public');
export const outDir = path.join(projectRoot, 'out');
export const cacheDir = path.join(outDir, 'cache');

/** The rendered brief the TV shows. Written by the agent, served by the local server. */
export const briefPath = path.join(outDir, 'brief.html');
/** Disposable copy of the last brief that rendered successfully (spec 0.2). */
export const cachedBriefPath = path.join(cacheDir, 'last-brief.html');

export const configPath = process.env.MORNING_BRIEF_CONFIG
  ? path.resolve(process.env.MORNING_BRIEF_CONFIG)
  : path.join(projectRoot, 'config.yaml');
