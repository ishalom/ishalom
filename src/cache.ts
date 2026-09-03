import fs from 'node:fs';
import { briefPath, cacheDir, cachedBriefPath, outDir } from './paths.js';
import { loadConfig } from './config.js';

export function ensureOutDirs(): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
}

export interface CachedBrief {
  html: string;
  renderedAt: Date;
}

/**
 * The one piece of assistant-only state the rules allow besides secrets: a
 * disposable copy of the last brief that rendered (spec 0.2). Deleting out/ is
 * always safe.
 */
export function saveBriefToCache(): void {
  if (!fs.existsSync(briefPath)) return;
  ensureOutDirs();
  fs.copyFileSync(briefPath, cachedBriefPath);
}

export function readCachedBrief(): CachedBrief | undefined {
  if (!fs.existsSync(cachedBriefPath)) return undefined;
  return {
    html: fs.readFileSync(cachedBriefPath, 'utf8'),
    renderedAt: fs.statSync(cachedBriefPath).mtime,
  };
}

export function readCurrentBrief(): CachedBrief | undefined {
  if (!fs.existsSync(briefPath)) return undefined;
  return {
    html: fs.readFileSync(briefPath, 'utf8'),
    renderedAt: fs.statSync(briefPath).mtime,
  };
}

/** Hebrew wording for "this is not today's data", honest about how old it is. */
export function staleLabel(renderedAt: Date, now = new Date()): string {
  const { config } = loadConfig();
  const day = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: config.timezone });
  const time = renderedAt.toLocaleTimeString(config.locale, {
    timeZone: config.timezone,
    hour: '2-digit',
    minute: '2-digit',
  });
  if (day(renderedAt) === day(now)) return `נתונים מ-${time}`;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (day(renderedAt) === day(yesterday)) return 'נתונים מאתמול';
  const date = renderedAt.toLocaleDateString(config.locale, {
    timeZone: config.timezone,
    day: 'numeric',
    month: 'numeric',
  });
  return `נתונים מ-${date}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'));
}

/** Prepends the staleness banner to a cached brief before it goes on the TV. */
export function withStaleBanner(html: string, renderedAt: Date): string {
  const banner = `<div class="stale-banner">${escapeHtml(staleLabel(renderedAt))}</div>`;
  if (html.includes('class="stale-banner"')) return html;
  const bodyOpen = html.match(/<body[^>]*>/i);
  if (!bodyOpen) return banner + html;
  const index = html.indexOf(bodyOpen[0]) + bodyOpen[0].length;
  return html.slice(0, index) + '\n' + banner + html.slice(index);
}
