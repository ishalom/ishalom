/**
 * Merge one player's row into another, and replay a shared table's decisions
 * into the survivor's rating (round 31).
 *
 *   node scripts/merge-player.ts <survivor-id> <retired-id> --table <id> --seat <n> [--write]
 *
 * Written for Idan's own rows: he played the first two-phone night as `Shalom`,
 * a second row, while his record lives on `שלום`. Round 1.4's merge only
 * *marked* the losing row, which adds nothing; Idan asked for the play to count
 * (*"להריץ בטח להריץ"*), so this does it through the app's own code and nothing
 * else:
 *
 *   - **The rating moves through `TrainerSession.absorbRated`**, the one path a
 *     shared decision takes into a rating (`rateOneDecision` underneath). The
 *     decisions are the table's own ordered list, `seatRatable`, minus the
 *     insurances nobody was asked — the shared table has no insurance button,
 *     and round 30 found the derivation declining it for every seat under an
 *     ace. They were never decisions.
 *   - **The rest of the retired row's play** (whatever it holds beyond that
 *     table) has no ordered record, only the mastery grid's per-spot totals. It
 *     is added to the lifetime count and to the grid, and it cannot move the
 *     rating — there is nothing to replay it from. The report says how much.
 *   - Nothing else of the survivor's record changes. The rest of the stored
 *     record (the Ultimate session, the day count, the level) is carried over
 *     untouched.
 *
 * Without `--write` it only reads and prints what it would do. With it, the
 * survivor is written first and only if nobody has saved it since it was read
 * (`updated_at` is the guard), then the retired row is marked, never deleted.
 * It reads and writes through the same public API and key the app uses; it
 * never reads `pin_hash`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { TrainerSession, type ScenarioStat } from '../src/session.ts';
import { rulesFor, seatRatable, wasAsked, type TableRecord } from '../src/shared-table.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(HERE, '..', 'artifact', 'backend.json'), 'utf8')) as {
  url: string;
  key: string;
};
const headers = { apikey: config.key, Authorization: `Bearer ${config.key}`, 'content-type': 'application/json' };
const rest = (path: string) => `${config.url.replace(/\/$/, '')}/rest/v1/${path}`;

const COLUMNS =
  'id,name,name_key,merged_into,hands,decisions,lifetime_decisions,rating,peak,provisional,mode,progress,updated_at';

async function get(path: string): Promise<any[]> {
  const response = await fetch(rest(path), { headers });
  if (!response.ok) throw new Error(`GET ${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as any[];
}

async function patch(path: string, body: unknown): Promise<any[]> {
  const response = await fetch(rest(path), {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`PATCH ${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as any[];
}

async function player(id: string) {
  const rows = await get(`players?id=eq.${encodeURIComponent(id)}&select=${COLUMNS}`);
  if (rows.length !== 1) throw new Error(`player ${id}: ${rows.length} rows`);
  return rows[0];
}

async function table(id: string): Promise<TableRecord> {
  const [row] = await get(`tables?id=eq.${encodeURIComponent(id)}&select=*`);
  if (!row) throw new Error(`table ${id}: not found`);
  const seats = await get(`table_seats?table_id=eq.${encodeURIComponent(id)}&select=*&order=seat.asc`);
  return {
    id: row.id,
    seed: row.seed,
    presetId: row.preset_id,
    restrictions: row.restrictions ?? {},
    seats: seats.map((seat) => ({
      seat: seat.seat,
      playerId: seat.player_id,
      name: seat.name,
      bet: Number(seat.bet) || 1,
      moves: seat.moves ?? [],
      hands: seat.hands ?? 0,
      vote: seat.vote ?? null,
      events: seat.events ?? [],
      reactions: seat.reactions ?? {},
      ratedDecisions: seat.rated_decisions ?? 0,
    })),
  } as TableRecord;
}

const statsOf = (progress: any): Map<string, ScenarioStat> =>
  new Map(((progress?.scenarioStats ?? []) as ScenarioStat[]).map((stat) => [stat.scenarioKey, stat]));

async function main() {
  const [survivorId, retiredId] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const flag = (name: string) => {
    const at = process.argv.indexOf(`--${name}`);
    return at === -1 ? null : process.argv[at + 1];
  };
  const tableId = flag('table');
  const seat = Number(flag('seat'));
  const write = process.argv.includes('--write');
  if (!survivorId || !retiredId || !tableId || !Number.isInteger(seat)) {
    throw new Error('usage: merge-player.ts <survivor> <retired> --table <id> --seat <n> [--write]');
  }

  const survivor = await player(survivorId);
  const retired = await player(retiredId);
  if (survivor.merged_into) throw new Error('the survivor is itself merged');
  if (retired.merged_into) throw new Error(`the retired row is already merged into ${retired.merged_into}`);
  const record = await table(tableId);
  const seatRow = record.seats.find((entry) => entry.seat === seat);
  if (seatRow?.playerId !== retiredId) throw new Error(`seat ${seat} is not the retired row's`);

  const P = survivor.progress;
  const R = retired.progress;
  const rules = rulesFor(record);

  // The survivor's record, restored through the app's own code. It must come
  // back exactly as stored, or the write would change more than the merge.
  const session = new TrainerSession();
  session.restore(P);
  const roundTrip = session.progress as unknown as Record<string, unknown>;
  const drift = Object.keys(roundTrip).filter((key) => key in P && !isDeepStrictEqual(roundTrip[key], P[key]));
  if (drift.length > 0) throw new Error(`the survivor does not survive a restore unchanged: ${drift.join(', ')}`);

  // What the table put into the retired row, exactly as it went in.
  const all = seatRatable(record, seat);
  if (all.length !== seatRow.ratedDecisions) {
    throw new Error(`the table lists ${all.length} decisions and the seat's mark is ${seatRow.ratedDecisions}`);
  }
  const replay = all.filter((decision) => wasAsked(record, seat, decision));

  // The retired row's play beyond this table: its grid minus what the table put there.
  const asAbsorbed = new TrainerSession();
  asAbsorbed.absorbRated(rules, all);
  const tableStats = statsOf(asAbsorbed.progress);
  const rest = new Map<string, { attempts: number; correct: number; evCostTotal: number; confusion: Record<string, number> }>();
  for (const [key, stat] of statsOf(R)) {
    const from = tableStats.get(key);
    const diff = {
      attempts: stat.attempts - (from?.attempts ?? 0),
      correct: stat.correct - (from?.correct ?? 0),
      evCostTotal: stat.evCostTotal - (from?.evCostTotal ?? 0),
      confusion: Object.fromEntries(
        Object.entries(stat.confusion ?? {})
          .map(([action, count]) => [action, count - (from?.confusion?.[action] ?? 0)] as const)
          .filter(([, count]) => count !== 0),
      ),
    };
    if (diff.attempts < 0 || diff.correct < 0 || Object.values(diff.confusion).some((count) => count < 0)) {
      throw new Error(`the retired row holds less at ${key} than the table put there`);
    }
    if (diff.attempts > 0) rest.set(key, diff);
  }
  for (const key of tableStats.keys()) {
    if (!statsOf(R).has(key)) throw new Error(`the table put ${key} into the retired row and it is not there`);
  }
  const restCount = [...rest.values()].reduce((sum, diff) => sum + diff.attempts, 0);
  const restLifetime = Number(R.lifetimeDecisions) - all.length;
  if (restLifetime !== restCount) {
    throw new Error(`the retired row's lifetime beyond the table (${restLifetime}) is not its grid's (${restCount})`);
  }

  // The replay, through the one path.
  const mode = session.progress.mode;
  const before = { ...session.progress.ratings[mode], lifetime: session.progress.lifetimeDecisions };
  const owed = session.progress.owed;
  const moved = session.absorbRated(rules, replay);
  const after = session.progress;

  const scenarioStats = after.scenarioStats.map((stat) => ({ ...stat, confusion: { ...stat.confusion } }));
  for (const [key, diff] of rest) {
    let stat = scenarioStats.find((entry) => entry.scenarioKey === key);
    if (!stat) {
      stat = { scenarioKey: key, attempts: 0, correct: 0, consecutiveCorrect: 0, evCostTotal: 0, confusion: {}, lastAttemptAt: 0 };
      scenarioStats.push(stat);
    }
    stat.attempts += diff.attempts;
    stat.correct += diff.correct;
    stat.evCostTotal += diff.evCostTotal;
    for (const [action, count] of Object.entries(diff.confusion)) {
      stat.confusion[action] = (stat.confusion[action] ?? 0) + count;
    }
  }

  const progress = {
    ...P,
    ...after,
    // A replay is not a moment to congratulate anybody: gestures it would
    // have owed are not handed out on his next screen.
    owed,
    lifetimeDecisions: after.lifetimeDecisions + restLifetime,
    scenarioStats,
  };
  const rating = progress.ratings[mode];
  const columns = {
    rating: rating.ratedDecisions > 0 ? Math.round(rating.rating) : 0,
    peak: Math.round(rating.peak),
    provisional: Boolean(rating.provisional),
    lifetime_decisions: progress.lifetimeDecisions,
  };

  const summary = {
    survivor: { id: survivor.id, name: survivor.name, mode, updated_at: survivor.updated_at },
    retired: { id: retired.id, name: retired.name, lifetime: R.lifetimeDecisions, ratings: R.ratings },
    table: { id: record.id, seat, listed: all.length, unaskedInsurance: all.length - replay.length, replayed: replay.length, rated: moved },
    restOfRetired: { decisions: restLifetime, spots: rest.size },
    before: { rating: before.rating, peak: before.peak, ratedDecisions: before.ratedDecisions, lifetime: before.lifetime },
    after: { rating: rating.rating, peak: rating.peak, ratedDecisions: rating.ratedDecisions, lifetime: progress.lifetimeDecisions },
    columnsBefore: {
      rating: survivor.rating,
      peak: survivor.peak,
      provisional: survivor.provisional,
      lifetime_decisions: survivor.lifetime_decisions,
      hands: survivor.hands,
      decisions: survivor.decisions,
    },
    columnsAfter: columns,
    gridAttempts: {
      before: (P.scenarioStats as ScenarioStat[]).reduce((sum, stat) => sum + stat.attempts, 0),
      after: scenarioStats.reduce((sum, stat) => sum + stat.attempts, 0),
    },
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!write) return;

  const written = await patch(
    `players?id=eq.${encodeURIComponent(survivorId)}&updated_at=eq.${encodeURIComponent(survivor.updated_at)}&select=id,lifetime_decisions,rating`,
    { ...columns, progress, updated_at: new Date().toISOString() },
  );
  if (written.length !== 1) throw new Error('the survivor was saved by a device after it was read; nothing written, run again');
  const marked = await patch(
    `players?id=eq.${encodeURIComponent(retiredId)}&merged_into=is.null&select=id,merged_into`,
    { merged_into: survivorId },
  );
  if (marked.length !== 1) throw new Error('the retired row could not be marked');
  console.log(JSON.stringify({ written, marked }));
}

main().catch((error) => {
  console.error(String(error?.message ?? error));
  process.exit(1);
});
