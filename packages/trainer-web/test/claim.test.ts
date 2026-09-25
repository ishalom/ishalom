/**
 * Claiming a name that has no code, the first time (round 33).
 *
 * Idan: choosing a code for the first time takes the account over. The path
 * was already there — `decideIdentity` answers `claim` for a live row with no
 * proof — and what it lacked was saying so: somebody who types a name and a
 * code and silently inherits a record should be told, in one line, that it is
 * now his and carries its history. And a name that has a code is never taken
 * this way.
 *
 * Both sides are driven through the door of the page GitHub serves, against a
 * store that answers the way PostgREST does.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

import { loadHosted } from './helpers/hosted-page.ts';

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(done: () => boolean, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline) await settle(40);
}

/** The players table, enough of it: `eq.` filters, POST upserts, PATCH returning what changed. */
function fakePlayers(rows: Record<string, unknown>[]) {
  const writes: Array<Record<string, unknown>> = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk as Buffer));
    request.on('end', () => {
      const json = (status: number, body: unknown) =>
        response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (!url.pathname.endsWith('/players')) return json(200, []);
      const matches = (row: Record<string, unknown>) => {
        for (const [column, rule] of url.searchParams) {
          if (!rule.startsWith('eq.')) continue;
          if (String(row[column]) !== decodeURIComponent(rule.slice(3))) return false;
        }
        return true;
      };
      if (request.method === 'GET') return json(200, rows.filter(matches));
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      for (const change of Array.isArray(body) ? body : [body]) {
        writes.push(change);
        const row = rows.find((entry) => entry.id === change.id);
        if (row) Object.assign(row, change);
        else rows.push(change);
      }
      return json(201, Array.isArray(body) ? body : [body]);
    });
  });
  return { server, writes };
}

async function atTheDoor(rows: Record<string, unknown>[]) {
  const { server, writes } = fakePlayers(rows);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const page = loadHosted('', [['ev:locale', 'he']], { url: origin, key: 'k' });
  await page.booted;
  const wrap = page.document.getElementById('app').children[0];
  return { page, wrap, writes, close: () => (server.closeAllConnections(), server.close()) };
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

test('a name with no code is claimed by the first code typed, and the player is told, once', async () => {
  const rows: Record<string, unknown>[] = [
    { id: 'row-dana', name: 'Dana', name_key: 'dana', pin_hash: null, merged_into: null, lifetime_decisions: 412, decisions: 400 },
  ];
  const door = await atTheDoor(rows);
  try {
    door.wrap.querySelector('#welcome-name').value = 'Dana';
    door.wrap.querySelector('#welcome-code').value = '4321';
    for (const submit of door.wrap.querySelector('#welcome-form').listeners.submit) submit({ preventDefault() {} });
    await until(() => door.page.screen() === 'home');
    assert.equal(door.page.screen(), 'home', 'the claim did not let her in');
    assert.equal(door.page.storage().get('ev:playerId'), 'row-dana', 'she was not given the existing record');

    // Told: one line on the home screen, naming the name and its history.
    const line = door.page.document.getElementById('claimed');
    await until(() => line.hidden === false);
    assert.equal(line.hidden, false, 'nothing said the record is now hers');
    assert.match(line.textContent, /Dana/);
    assert.match(line.textContent, /412/, 'the line does not say the history came with it');
    assert.equal(door.page.storage().get('ev:claimed'), '', 'the line would be said again');

    // And the row now carries her proof — the same hash the door will check next time.
    await until(() => rows[0]!.pin_hash !== null);
    assert.equal(rows[0]!.pin_hash, sha('row-dana:4321'), 'the claim did not set the code on the row');
  } finally {
    door.page.stopWatching();
    door.close();
  }
});

test('a name that has a code is never taken this way: the wrong code is refused, and nothing is written', async () => {
  const rows: Record<string, unknown>[] = [
    {
      id: 'row-ruth',
      name: 'Ruth',
      name_key: 'ruth',
      pin_hash: sha('row-ruth:1111'),
      merged_into: null,
      lifetime_decisions: 90,
      decisions: 90,
    },
  ];
  const door = await atTheDoor(rows);
  try {
    door.wrap.querySelector('#welcome-name').value = 'Ruth';
    door.wrap.querySelector('#welcome-code').value = '2222';
    for (const submit of door.wrap.querySelector('#welcome-form').listeners.submit) submit({ preventDefault() {} });
    const error = door.wrap.querySelector('#welcome-error');
    await until(() => error.hidden === false);
    assert.equal(error.hidden, false, 'a wrong code was not refused');
    assert.notEqual(door.page.screen(), 'home', 'a wrong code got in');
    assert.notEqual(door.page.storage().get('ev:playerId'), 'row-ruth', 'the record was handed over');
    assert.ok(!door.page.storage().get('ev:claimed'), 'a refusal was told as a claim');
    assert.equal(rows[0]!.pin_hash, sha('row-ruth:1111'), 'the code on the row was changed');
    assert.equal(door.writes.filter((w) => w.id === 'row-ruth').length, 0, 'something was written to her row');
  } finally {
    door.page.stopWatching();
    door.close();
  }
});
