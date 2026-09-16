/**
 * The migration runner's authentication, against the RFC's own numbers (round 12).
 *
 * `scripts/migrate.ts` speaks Postgres' wire protocol directly rather than
 * taking a dependency, which means its authentication is ours to get right.
 * RFC 7677 §3 publishes a complete SCRAM-SHA-256 exchange — user, password,
 * nonces, salt, iteration count, and the exact proof and server signature they
 * produce. If this passes, the arithmetic is right; if it fails, no password of
 * Idan's is involved, because none of this touches a database.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scram } from '../scripts/postgres-scram.ts';

// RFC 7677 §3, the SCRAM-SHA-256 example exchange.
const PASSWORD = 'pencil';
const CLIENT_FIRST_BARE = 'n=user,r=rOprNGfwEbeRWgbNEkqO';
const SERVER_FIRST = 'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096';
const CLIENT_FINAL_WITHOUT_PROOF = 'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
const PROOF = 'dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=';
const SERVER_SIGNATURE = '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=';

test('SCRAM-SHA-256 produces the RFC’s proof and server signature', () => {
  const { proof, serverSignature } = scram(
    PASSWORD,
    Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64'),
    4096,
    CLIENT_FIRST_BARE,
    SERVER_FIRST,
    CLIENT_FINAL_WITHOUT_PROOF,
  );
  assert.equal(proof.toString('base64'), PROOF);
  assert.equal(serverSignature.toString('base64'), SERVER_SIGNATURE);
});

test('a wrong password proves nothing', () => {
  const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
  const wrong = scram('pencil2', salt, 4096, CLIENT_FIRST_BARE, SERVER_FIRST, CLIENT_FINAL_WITHOUT_PROOF);
  assert.notEqual(wrong.proof.toString('base64'), PROOF);
  assert.notEqual(wrong.serverSignature.toString('base64'), SERVER_SIGNATURE);
});

test('the proof is bound to this exchange, not reusable from another', () => {
  const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
  const otherNonce = scram(
    PASSWORD,
    salt,
    4096,
    'n=user,r=someoneElsesNonce',
    SERVER_FIRST,
    CLIENT_FINAL_WITHOUT_PROOF,
  );
  assert.notEqual(otherNonce.proof.toString('base64'), PROOF);
});

test('the runner never prints a password, and reads the credential from one ignored file', async () => {
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../scripts/migrate.ts', import.meta.url), 'utf8'),
  );
  // Everything printed about a connection goes through safe(), which shows the
  // host and the database only.
  assert.match(source, /const safe = \(t: Target\) =>/);
  assert.doesNotMatch(source, /console\.(log|error)\([^)]*\bpassword\b/i);
  assert.doesNotMatch(source, /console\.(log|error)\([^)]*connectionString\(\)/);
  // The credential comes from the environment or .env.local, and nowhere else.
  assert.match(source, /process\.env\.DATABASE_URL/);
  assert.match(source, /'\.env\.local'/);
});
