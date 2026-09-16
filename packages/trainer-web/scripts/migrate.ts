/**
 * Run the shared table's migrations (round 12).
 *
 * Idan should never have to run one of these again. Until now a migration meant
 * him opening Supabase, finding the SQL editor, pasting a file he has said he
 * does not understand, and reading the result. From here it is one command:
 *
 *   npm run migrate              apply anything not yet applied, then check
 *   npm run migrate -- --check   count the table and change nothing
 *   npm run migrate -- --dry-run say what would run, and stop
 *
 * **The credential.** The connection string lives in `.env.local` at the root of
 * the repository, as `DATABASE_URL`, and nowhere else. That file is ignored by
 * git (see `.gitignore`), is never read by the build, and never reaches
 * `docs/index.html`, the handoff folder, or this script's output: everything
 * printed here goes through `safe()`, which prints the host and the database and
 * never the password. It is the narrowest credential that can do the job — it
 * reaches that one database, not the rest of Idan's Supabase account, which is
 * what a personal access token would have done.
 *
 * **Zero dependencies, like everything else here.** Postgres' wire protocol is
 * spoken directly: a TLS connection, SCRAM-SHA-256 authentication (RFC 5802 and
 * 7677), and the simple query protocol. About two hundred lines, and no supply
 * chain. `scripts/postgres-scram.ts` does that arithmetic, and
 * `test/postgres-scram.test.ts` holds it to the RFC's own test vectors.
 *
 * **What it does to the table.** Each migration runs inside one transaction, and
 * the file's name is written into `public.ev_migrations` in the same
 * transaction, so a migration can never be applied twice and a failure leaves
 * nothing half-done. Migrations themselves add and fill; none of them deletes
 * or resets anything (§12), and the counts printed before and after are the
 * proof.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { connect as tlsConnect } from 'node:tls';
import { createConnection } from 'node:net';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scram } from './postgres-scram.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const MIGRATIONS = join(HERE, '..', 'artifact', 'migrations');

// --- The connection string ---------------------------------------------------------

/** `DATABASE_URL`, from the environment or from `.env.local` at the repository root. */
function connectionString(): string {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  let file = '';
  try {
    file = readFileSync(join(ROOT, '.env.local'), 'utf8');
  } catch {
    throw new Error(
      'No database connection string. Put it in .env.local at the root of the repository as\n' +
        '  DATABASE_URL=postgresql://…\n' +
        'That file is ignored by git. See handoff/from-code.md for where to copy it from.',
    );
  }
  for (const line of file.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const value = match[1]!.trim().replace(/^["']|["']$/g, '');
    if (value) return value;
  }
  throw new Error('.env.local has no DATABASE_URL line.');
}

interface Target {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function parseTarget(url: string): Target {
  const parsed = new URL(url);
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new Error('DATABASE_URL must start with postgresql://');
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'postgres',
  };
}

/** What may be printed about a connection: never the password. */
const safe = (t: Target) => `${t.user.replace(/\..*$/, '.…')}@${t.host}:${t.port}/${t.database}`;

// --- The wire protocol -------------------------------------------------------------

interface Result {
  command: string;
  fields: string[];
  rows: string[][];
}

const int32 = (value: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(value);
  return b;
};

/** A message: one type byte, then its length, then its body. */
const message = (type: string, body: Buffer): Buffer =>
  Buffer.concat([Buffer.from(type, 'ascii'), int32(body.length + 4), body]);

const cString = (text: string): Buffer => Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([0])]);

/** The fields of an ErrorResponse or NoticeResponse, by their one-letter keys. */
function fieldsOf(body: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let at = 0;
  while (at < body.length && body[at] !== 0) {
    const key = String.fromCharCode(body[at]!);
    const end = body.indexOf(0, at + 1);
    out[key] = body.toString('utf8', at + 1, end);
    at = end + 1;
  }
  return out;
}

class Postgres {
  private socket: import('node:net').Socket | import('node:tls').TLSSocket | null = null;
  private buffer = Buffer.alloc(0);
  private waiting: Array<(m: { type: string; body: Buffer }) => void> = [];
  private failure: Error | null = null;

  private readonly target: Target;

  constructor(target: Target) {
    this.target = target;
  }

  async connect(): Promise<void> {
    const plain = createConnection({ host: this.target.host, port: this.target.port });
    plain.setTimeout(30_000);
    await new Promise<void>((resolve, reject) => {
      plain.once('connect', resolve);
      plain.once('error', reject);
      plain.once('timeout', () => reject(new Error(`Timed out connecting to ${this.target.host}`)));
    });

    // Ask for TLS before saying anything else: Supabase refuses plaintext, and
    // a password must never cross an unencrypted socket anyway.
    plain.write(Buffer.concat([int32(8), int32(80877103)]));
    const answer = await new Promise<Buffer>((resolve, reject) => {
      plain.once('data', resolve);
      plain.once('error', reject);
    });
    if (answer.toString('ascii', 0, 1) !== 'S') throw new Error('The server refused TLS');

    const secure = tlsConnect({ socket: plain, servername: this.target.host });
    await new Promise<void>((resolve, reject) => {
      secure.once('secureConnect', resolve);
      secure.once('error', reject);
    });
    this.socket = secure;
    secure.on('data', (chunk) => this.take(chunk));
    secure.on('error', (error) => this.fail(error));
    secure.on('close', () => this.fail(new Error('The connection closed')));

    this.send(
      Buffer.concat([
        int32(0),
        int32(196608),
        cString('user'),
        cString(this.target.user),
        cString('database'),
        cString(this.target.database),
        Buffer.from([0]),
      ]),
      true,
    );
    await this.authenticate();
  }

  private fail(error: Error): void {
    this.failure = error;
    for (const resolve of this.waiting.splice(0)) resolve({ type: '!', body: Buffer.alloc(0) });
  }

  private take(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 5) return;
      const length = this.buffer.readInt32BE(1);
      if (this.buffer.length < length + 1) return;
      const type = String.fromCharCode(this.buffer[0]!);
      const body = this.buffer.subarray(5, length + 1);
      this.buffer = this.buffer.subarray(length + 1);
      const resolve = this.waiting.shift();
      if (resolve) resolve({ type, body });
      else if (type === 'E') this.failure = new Error(fieldsOf(body).M ?? 'server error');
    }
  }

  private send(body: Buffer, startup = false): void {
    if (!this.socket) throw new Error('Not connected');
    if (startup) {
      const framed = Buffer.from(body);
      framed.writeInt32BE(body.length, 0);
      this.socket.write(framed);
      return;
    }
    this.socket.write(body);
  }

  private next(): Promise<{ type: string; body: Buffer }> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve) => this.waiting.push(resolve)).then((m) => {
      const received = m as { type: string; body: Buffer };
      if (received.type === '!') throw this.failure ?? new Error('The connection closed');
      if (received.type === 'E') {
        const f = fieldsOf(received.body);
        const error = new Error(`${f.S ?? 'ERROR'}: ${f.M ?? 'unknown'}${f.D ? ` — ${f.D}` : ''}`);
        (error as { code?: string }).code = f.C;
        throw error;
      }
      return received;
    });
  }

  /** SCRAM-SHA-256 (RFC 5802, RFC 7677). No channel binding: the TLS above carries it. */
  private async authenticate(): Promise<void> {
    const request = await this.next();
    if (request.type !== 'R') throw new Error('The server did not ask for authentication');
    const method = request.body.readInt32BE(0);
    if (method === 0) return void (await this.untilReady());
    if (method !== 10) throw new Error(`Unsupported authentication method ${method}`);
    const mechanisms = request.body.toString('utf8', 4).split('\0').filter(Boolean);
    if (!mechanisms.includes('SCRAM-SHA-256')) throw new Error(`No SCRAM-SHA-256; server offered ${mechanisms.join(', ')}`);

    const nonce = randomBytes(18).toString('base64');
    const firstBare = `n=,r=${nonce}`;
    this.send(
      message('p', Buffer.concat([cString('SCRAM-SHA-256'), int32(Buffer.byteLength(`n,,${firstBare}`)), Buffer.from(`n,,${firstBare}`, 'utf8')])),
    );

    const challenge = await this.next();
    if (challenge.type !== 'R' || challenge.body.readInt32BE(0) !== 11) throw new Error('Expected a SCRAM challenge');
    const serverFirst = challenge.body.toString('utf8', 4);
    const parts = Object.fromEntries(serverFirst.split(',').map((piece) => [piece.slice(0, 1), piece.slice(2)]));
    if (!parts.r?.startsWith(nonce)) throw new Error('The server changed the nonce');

    const finalWithoutProof = `c=biws,r=${parts.r}`;
    // The arithmetic lives in postgres-scram.ts, where the RFC's own vectors check it.
    const { proof, serverSignature } = scram(
      this.target.password,
      Buffer.from(parts.s!, 'base64'),
      Number(parts.i),
      firstBare,
      serverFirst,
      finalWithoutProof,
    );
    this.send(message('p', Buffer.from(`${finalWithoutProof},p=${proof.toString('base64')}`, 'utf8')));

    const final = await this.next();
    if (final.type !== 'R' || final.body.readInt32BE(0) !== 12) throw new Error('Expected the SCRAM result');
    const given = Buffer.from(final.body.toString('utf8', 4).replace(/^v=/, ''), 'base64');
    if (given.length !== serverSignature.length || !timingSafeEqual(given, serverSignature)) {
      throw new Error('The server failed to prove it knows the password');
    }
    const ok = await this.next();
    if (ok.type !== 'R' || ok.body.readInt32BE(0) !== 0) throw new Error('Authentication did not complete');
    await this.untilReady();
  }

  private async untilReady(): Promise<void> {
    for (;;) {
      const m = await this.next();
      if (m.type === 'Z') return;
    }
  }

  /** One or more statements, in the simple query protocol. */
  async query(sql: string): Promise<Result[]> {
    this.send(message('Q', cString(sql)));
    const results: Result[] = [];
    let fields: string[] = [];
    let rows: string[][] = [];
    for (;;) {
      const m = await this.next();
      if (m.type === 'T') {
        fields = [];
        const count = m.body.readInt16BE(0);
        let at = 2;
        for (let i = 0; i < count; i++) {
          const end = m.body.indexOf(0, at);
          fields.push(m.body.toString('utf8', at, end));
          at = end + 1 + 18;
        }
        rows = [];
      } else if (m.type === 'D') {
        const count = m.body.readInt16BE(0);
        const row: string[] = [];
        let at = 2;
        for (let i = 0; i < count; i++) {
          const size = m.body.readInt32BE(at);
          at += 4;
          if (size < 0) {
            row.push('');
            continue;
          }
          row.push(m.body.toString('utf8', at, at + size));
          at += size;
        }
        rows.push(row);
      } else if (m.type === 'C') {
        results.push({ command: m.body.toString('utf8', 0, m.body.length - 1), fields, rows });
        fields = [];
        rows = [];
      } else if (m.type === 'Z') {
        return results;
      }
    }
  }

  async close(): Promise<void> {
    try {
      this.send(message('X', Buffer.alloc(0)));
    } catch {
      // Already gone; nothing to say goodbye to.
    }
    this.socket?.end();
    this.socket = null;
  }
}

// --- The migrations ------------------------------------------------------------------

const CHECK = `select count(*) as rows,
       count(*) filter (where merged_into is null) as live,
       count(*) filter (where rating > 0) as rated_in_blackjack,
       count(*) filter (where uth_rating is not null) as rated_in_ultimate
  from public.players`;

/** The same counts, for a table that has not had 003 yet (no uth_rating column). */
const CHECK_BEFORE_003 = `select count(*) as rows,
       count(*) filter (where merged_into is null) as live,
       count(*) filter (where rating > 0) as rated_in_blackjack
  from public.players`;

const args = process.argv.slice(2);
const only = (flag: string) => args.includes(flag);

async function counts(db: Postgres): Promise<Record<string, string>> {
  const has003 = (await db.query(
    "select count(*) as n from information_schema.columns where table_name = 'players' and column_name = 'uth_rating'",
  ))[0]!.rows[0]![0] !== '0';
  const result = (await db.query(has003 ? CHECK : CHECK_BEFORE_003))[0]!;
  return Object.fromEntries(result.fields.map((field, i) => [field, result.rows[0]![i]!]));
}

const say = (label: string, row: Record<string, string>) =>
  console.log(`  ${label}: ${Object.entries(row).map(([k, v]) => `${k} ${v}`).join(', ')}`);

async function main(): Promise<void> {
  const target = parseTarget(connectionString());
  const db = new Postgres(target);
  console.log(`connecting to ${safe(target)}`);
  await db.connect();
  try {
    const before = await counts(db);
    say('before', before);
    if (only('--check')) return;

    /*
     * What has been applied. The table is created here rather than by a
     * migration, because it has to exist before the first one runs. A table that
     * already carries 002's columns has had 002 applied — Idan ran it by hand —
     * so it is recorded rather than run again.
     */
    await db.query(
      'create table if not exists public.ev_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const applied = new Set(
      (await db.query('select name from public.ev_migrations order by name'))[0]!.rows.map((row) => row[0]!),
    );
    const had002 =
      (await db.query(
        "select count(*) as n from information_schema.columns where table_name = 'players' and column_name = 'name_key'",
      ))[0]!.rows[0]![0] !== '0';
    if (had002 && !applied.has('002-name-code.sql')) {
      await db.query("insert into public.ev_migrations (name) values ('002-name-code.sql') on conflict do nothing");
      applied.add('002-name-code.sql');
      console.log('  002-name-code.sql: already in the table, recorded as applied');
    }

    const pending = readdirSync(MIGRATIONS)
      .filter((file) => file.endsWith('.sql'))
      .sort()
      .filter((file) => !applied.has(file));
    if (pending.length === 0) console.log('  nothing pending');
    for (const file of pending) {
      const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
      if (only('--dry-run')) {
        console.log(`  would run ${file} (${sql.split(/\r?\n/).length} lines)`);
        continue;
      }
      console.log(`  running ${file}`);
      // One transaction per migration, with its name written in the same one:
      // it can never be applied twice, and a failure leaves nothing half-done.
      await db.query(
        `begin;\n${sql}\ninsert into public.ev_migrations (name) values ('${file.replace(/'/g, "''")}');\ncommit;`,
      );
      console.log(`  applied ${file}`);
    }

    const after = await counts(db);
    say('after', after);
    for (const key of ['rows', 'live', 'rated_in_blackjack']) {
      if (before[key] !== undefined && before[key] !== after[key]) {
        throw new Error(`${key} changed from ${before[key]} to ${after[key]} — a migration was supposed to add, not change`);
      }
    }
    console.log('nothing was reset: every count that existed before reads the same after');
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(`migrate: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
