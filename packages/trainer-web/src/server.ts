/**
 * A local web client for the EV Trainer.
 *
 * Zero dependencies, like everything else here: a plain Node HTTP server serving
 * static files and a small JSON API over the session controller. The engines are
 * TypeScript that Node strips at load, so they run here rather than in the
 * browser, and the browser gets plain JavaScript with no build step.
 *
 * This is a test harness for the engines and a working prototype of the §10
 * screens — not the shipping client, which §12 puts in React Native or Flutter
 * with the engine compiled in. Nothing below this line knows that.
 *
 *   npm start --workspace @evtrainer/trainer-web
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULE_PRESETS, type BlackjackAction } from '@evtrainer/ev-engine';
import { TrainerSession } from './session.ts';
import { uthPreview } from './uth.ts';
import { catalogue, LOCALES, type Locale } from './i18n.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT ?? 5173);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// One session, because this is a local single-player harness. A real deployment
// would key these by user and persist them (spec §11).
let session = new TrainerSession();

async function readBody(request: import('node:http').IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  const json = (body: unknown, status = 200): void => {
    const text = JSON.stringify(body);
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(text);
  };

  try {
    if (url.pathname.startsWith('/api/')) {
      const body = request.method === 'POST' ? await readBody(request) : {};

      switch (url.pathname) {
        case '/api/state':
          return json(session.view);

        case '/api/presets':
          return json(
            RULE_PRESETS.map((preset) => ({
              id: preset.id,
              name: preset.name,
              note: preset.note ?? null,
            })),
          );

        case '/api/session': {
          const presetId = typeof body.presetId === 'string' ? body.presetId : undefined;
          session = new TrainerSession(presetId);
          return json(session.view);
        }

        case '/api/deal':
          session.deal();
          return json(session.view);

        case '/api/act': {
          const action = body.action as BlackjackAction;
          session.act(action);
          return json(session.view);
        }

        case '/api/insurance':
          session.insurance(Boolean(body.take));
          return json(session.view);

        case '/api/chart':
          return json(session.chart);

        case '/api/weak-spots':
          return json(session.weakSpots);

        case '/api/profile':
          return json(session.profile);

        case '/api/coach':
          return json(session.coach);

        case '/api/uth/preview':
          return json(uthPreview());

        case '/api/player': {
          if (typeof body.name === 'string') session.setPlayerName(body.name);
          if (typeof body.mode === 'string') session.setMode(body.mode as never);
          if (typeof body.locale === 'string') session.setLocale(body.locale as Locale);
          return json(session.profile);
        }

        default:
          return json({ error: 'no such endpoint' }, 404);
      }
    }

    /*
     * The catalogue, as a classic script the pages can load before anything
     * else. Generated rather than stored in public/ so that src/i18n.ts stays
     * the only file a string is ever written in — the browser and the sentence
     * generator read the same table.
     */
    if (url.pathname === '/i18n.js') {
      const messages = Object.fromEntries(LOCALES.map((l) => [l.code, catalogue(l.code as Locale)]));
      const body = `window.EV_LOCALES=${JSON.stringify(LOCALES)};
window.EV_MESSAGES=${JSON.stringify(messages)};
`;
      response.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      return void response.end(body);
    }

    // Static files. `normalize` plus the prefix check keeps `..` from escaping.
    const requested = url.pathname === '/' ? '/home.html' : url.pathname;
    const path = normalize(join(ROOT, requested));
    if (!path.startsWith(ROOT)) return json({ error: 'forbidden' }, 403);

    const file = await readFile(path);
    const type = extname(path);
    response.writeHead(200, {
      'content-type': TYPES[type] ?? 'application/octet-stream',
      'cache-control': type === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-store',
    });
    response.end(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return json({ error: 'not found' }, 404);
    // Rule violations from the engine are the client's fault, not a crash.
    json({ error: message }, 400);
  }
});

server.listen(PORT, () => {
  process.stdout.write(`EV Trainer running at http://localhost:${PORT}\n`);
  process.stdout.write(`Rule set: ${session.ruleSet.name} — ${session.ruleSet.badge}\n`);
  process.stdout.write(
    `House edge under perfect play: ${session.ruleSet.edgePercent.toFixed(2)}%\n`,
  );
});
