import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { loadEnv } from '../env.js';
import { ensureOutDirs, readCachedBrief, readCurrentBrief, withStaleBanner } from '../cache.js';
import { publicDir } from '../paths.js';
import { startClean } from '../actions.js';

loadEnv();
ensureOutDirs();

const { config } = loadConfig();
const port = Number(process.env.PORT ?? config.brief.port);
const host = process.env.HOST ?? '0.0.0.0';

/** One agent action at a time — the TV button must not be able to fan out. */
let actionInFlight: Promise<unknown> | undefined;

const PLACEHOLDER = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${config.brief.refresh_seconds}">
<title>מורנינג בריף</title><link rel="stylesheet" href="/brief.css"></head>
<body><main class="brief"><section class="section"><h2>עדיין אין בריף</h2>
<p class="empty">הבריף הראשון ייווצר בהרצה הבאה.</p></section></main></body></html>`;

function isLocalRequest(remote: string | undefined): boolean {
  if (!remote) return false;
  const address = remote.replace(/^::ffff:/, '');
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address.startsWith('10.') ||
    address.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address)
  );
}

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveBrief(res: http.ServerResponse): void {
  const current = readCurrentBrief();
  if (current) return sendHtml(res, 200, current.html);
  const cached = readCachedBrief();
  if (cached) return sendHtml(res, 200, withStaleBanner(cached.html, cached.renderedAt));
  sendHtml(res, 200, PLACEHOLDER);
}

function serveStatic(res: http.ServerResponse, name: string): void {
  const file = path.join(publicDir, name);
  if (!file.startsWith(publicDir) || !fs.existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  const type = name.endsWith('.css')
    ? 'text/css; charset=utf-8'
    : name.endsWith('.js')
      ? 'text/javascript; charset=utf-8'
      : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
  res.end(fs.readFileSync(file));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /' || route === 'GET /index.html') return serveBrief(res);
  if (route === 'GET /brief.css') return serveStatic(res, 'brief.css');
  if (route === 'GET /brief.js') return serveStatic(res, 'brief.js');
  if (route === 'GET /healthz') {
    const current = readCurrentBrief();
    return sendJson(res, 200, {
      ok: true,
      brief_rendered_at: current?.renderedAt.toISOString() ?? null,
      action_in_flight: Boolean(actionInFlight),
    });
  }

  if (route === 'POST /action/clean') {
    if (!isLocalRequest(req.socket.remoteAddress)) {
      return sendJson(res, 403, { ok: false, message: 'הפעולה זמינה רק מהרשת הביתית' });
    }
    if (actionInFlight) {
      return sendJson(res, 409, { ok: false, message: 'פעולה כבר רצה, רגע' });
    }
    const run = startClean()
      .then((result) => {
        sendJson(res, result.ok ? 200 : 502, {
          ok: result.ok,
          message: result.text.trim() || (result.ok ? 'הופעל' : 'לא הצלחתי להפעיל את הרובוט'),
        });
      })
      .catch((error: unknown) => {
        console.error('[clean]', error);
        sendJson(res, 500, { ok: false, message: 'לא הצלחתי להפעיל את הרובוט' });
      })
      .finally(() => {
        actionInFlight = undefined;
      });
    actionInFlight = run;
    return;
  }

  // Free-text chat from the TV is phase 2 (spec 9).
  if (route === 'POST /chat') {
    return sendJson(res, 501, { ok: false, message: "צ'אט חופשי יגיע בשלב 2" });
  }

  res.writeHead(404).end('not found');
});

server.listen(port, host, () => {
  console.log(`morning-brief server on http://${host}:${port} (TV: kiosk this URL)`);
});
