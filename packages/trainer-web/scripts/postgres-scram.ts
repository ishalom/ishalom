/**
 * SCRAM-SHA-256, the way Postgres asks for a password (RFC 5802, RFC 7677).
 *
 * Its own module so it can be checked against the RFC's published test vectors
 * without a database, a network or a password of Idan's
 * (`test/postgres-scram.test.ts`). `scripts/migrate.ts` does the talking; this
 * does the arithmetic.
 *
 * The password itself never leaves this function: what crosses the wire is a
 * proof derived from it, which is the point of the mechanism.
 */

import { createHash, createHmac, pbkdf2Sync } from 'node:crypto';

export interface ScramProof {
  /** `p=` on the client's final message. */
  proof: Buffer;
  /** What the server must answer with in `v=`, or it does not know the password. */
  serverSignature: Buffer;
}

export function scram(
  password: string,
  salt: Buffer,
  iterations: number,
  clientFirstBare: string,
  serverFirst: string,
  clientFinalWithoutProof: string,
): ScramProof {
  const saltedPassword = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const authMessage = `${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;
  const clientSignature = createHmac('sha256', storedKey).update(authMessage).digest();
  const serverKey = createHmac('sha256', saltedPassword).update('Server Key').digest();
  return {
    proof: Buffer.from(clientKey.map((byte, i) => byte ^ clientSignature[i]!)),
    serverSignature: createHmac('sha256', serverKey).update(authMessage).digest(),
  };
}
