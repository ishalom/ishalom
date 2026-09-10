/**
 * Name plus a four-digit code.
 *
 * The rule that matters most is negative: **a wrong code never creates a second
 * player with the same name.** That is the failure this whole mechanism exists
 * to prevent — silently making a new record is precisely how one person became
 * three, each starting again at 1200.
 *
 * `decideIdentity` is pure, so every branch is checked here without a network,
 * a database or a browser. It is lifted out of the shipped file rather than
 * copied, so this tests what runs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Load the identity module as the page will run it. */
function loadIdentity(): Record<string, any> {
  const source = readFileSync(join(HERE, '..', 'artifact', 'identity.js'), 'utf8');
  const out: Record<string, any> = {};
  new Function(
    '__out',
    `${source}\n__out.nameKey = nameKey; __out.isValidCode = isValidCode;` +
      '__out.pinHash = pinHash; __out.decideIdentity = decideIdentity;',
  )(out);
  return out;
}

const { nameKey, isValidCode, pinHash, decideIdentity } = loadIdentity();

let counter = 0;
const newId = () => `new-${++counter}`;

test('two spellings of the same name are the same player', () => {
  assert.equal(nameKey('  Idan '), 'idan');
  assert.equal(nameKey('IDAN'), 'idan');
  assert.equal(nameKey('Idan  Shalom'), 'idan shalom');
  // Hebrew is the language this is played in, and it must fold the same way.
  assert.equal(nameKey(' שלום '), 'שלום');
  assert.equal(nameKey('שלום'), nameKey('שלום '));
  // Different people stay different.
  assert.notEqual(nameKey('idan'), nameKey('eliav'));
});

test('a code is four digits and nothing else', () => {
  for (const good of ['0000', '1234', '9999']) assert.ok(isValidCode(good), good);
  for (const bad of ['', '123', '12345', 'abcd', '12 4', '１２３４', null, undefined]) {
    assert.ok(!isValidCode(bad as never), String(bad));
  }
});

test('the code is never stored, and two people with the same code differ', async () => {
  const hash = await pinHash('player-a', '1234');
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!hash.includes('1234'), 'the code is recoverable from the hash');

  // The id is mixed in, so the same code chosen by two people does not produce
  // the same hash — otherwise either could recognise the other's.
  assert.notEqual(await pinHash('player-b', '1234'), hash);
  assert.equal(await pinHash('player-a', '1234'), hash, 'not deterministic');
});

test('a name nobody holds creates a player', async () => {
  const decision = await decideIdentity('Dana', '4242', [], newId);
  assert.equal(decision.action, 'create');
  assert.equal(decision.pinHash, await pinHash(decision.id, '4242'));
});

test('the right code adopts the existing player, and makes no new row', async () => {
  const id = 'idan-1';
  const rows = [{ id, name: 'Idan', pinHash: await pinHash(id, '7777'), lifetimeDecisions: 400 }];

  const decision = await decideIdentity('  idan ', '7777', rows, newId);
  assert.equal(decision.action, 'adopt');
  assert.equal(decision.id, id, 'adopted the wrong record');
});

test('the wrong code is refused — never a second player with that name', async () => {
  const id = 'idan-1';
  const rows = [{ id, name: 'Idan', pinHash: await pinHash(id, '7777'), lifetimeDecisions: 400 }];

  const decision = await decideIdentity('Idan', '1111', rows, newId);
  assert.equal(decision.action, 'refuse');
  assert.equal(decision.reason, 'wrong-code');
  assert.equal(decision.id, undefined, 'a refusal handed back an id');
  assert.equal(decision.pinHash, undefined);
});

test('a player from before codes existed is claimed by the first person to arrive', async () => {
  // Every row in the table predates this feature, so this is the path all of
  // them take once. It adopts the record rather than orphaning it.
  const rows = [{ id: 'old-1', name: 'שלום', pinHash: null, lifetimeDecisions: 75 }];
  const decision = await decideIdentity('שלום', '2468', rows, newId);
  assert.equal(decision.action, 'claim');
  assert.equal(decision.id, 'old-1');
  assert.equal(decision.pinHash, await pinHash('old-1', '2468'));
});

test('duplicates answer with the record that has the most behind it', async () => {
  // The unique index prevents new ones, but rows that predate the migration can
  // still be there. The same rule the migration uses applies here.
  const rows = [
    { id: 'small', name: 'שלום', pinHash: null, lifetimeDecisions: 15 },
    { id: 'big', name: 'שלום', pinHash: null, lifetimeDecisions: 75 },
    { id: 'empty', name: 'שלום', pinHash: null, lifetimeDecisions: 0 },
  ];
  const decision = await decideIdentity('שלום', '1357', rows, newId);
  assert.equal(decision.id, 'big', 'claimed the wrong one of the duplicates');
});

test('a merged row does not answer for its name', async () => {
  // Once merged, the row it points at is the one that speaks for the name —
  // otherwise a merge would be undone by the next person through the door.
  const rows = [
    { id: 'dead', name: 'שלום', pinHash: null, lifetimeDecisions: 900, mergedInto: 'alive' },
  ];
  const decision = await decideIdentity('שלום', '1357', rows, newId);
  assert.equal(decision.action, 'create', 'a merged row was treated as live');
  assert.notEqual(decision.id, 'dead');
});

test('an empty name or a malformed code gets in nowhere', async () => {
  assert.equal((await decideIdentity('', '1234', [], newId)).reason, 'no-name');
  assert.equal((await decideIdentity('   ', '1234', [], newId)).reason, 'no-name');
  assert.equal((await decideIdentity('Dana', '12', [], newId)).reason, 'bad-code');
  assert.equal((await decideIdentity('Dana', 'abcd', [], newId)).reason, 'bad-code');
});

test('the honest limits are written down where they will be read', () => {
  // This is not authentication and the file must keep saying so. The table is
  // world-readable and there are ten thousand codes; anyone relying on this for
  // secrecy has misread it, and the comment is what prevents that.
  const source = readFileSync(join(HERE, '..', 'artifact', 'identity.js'), 'utf8');
  assert.match(source, /not authentication/i);
  assert.match(source, /ten thousand codes/i);
});
