import fs from 'node:fs';
import path from 'node:path';
import { skillsDir } from './paths.js';

/**
 * Skills are the instructions the user iterates on (spec 2). The host loads the
 * requested SKILL.md and hands it to the agent verbatim, so a scheduled run
 * always executes the skill instead of deciding whether to.
 */
export function loadSkill(name: string): string {
  const file = path.join(skillsDir, name, 'SKILL.md');
  if (!fs.existsSync(file)) {
    const available = fs.existsSync(skillsDir)
      ? fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
      : [];
    throw new Error(`Skill "${name}" not found at ${file}. Available: ${available.join(', ') || 'none'}`);
  }
  return fs.readFileSync(file, 'utf8');
}
