/*
 * Who is playing, on more than one device.
 *
 * The app used to identify a player by a random id in one browser's storage,
 * with the name only a label on it. Typing the same name on a second device
 * therefore created a second player, starting again at 1200 — which is what
 * Idan hit, and it makes the rating, the one number here that is earned slowly,
 * worthless the moment anybody opens the link on their phone.
 *
 * So a player is now a name and a four-digit code. The name is the handle; the
 * code is the proof that the person typing it is the same person as last time.
 *
 * SAY PLAINLY WHAT THIS IS NOT. It is not authentication. The shared table is
 * open by design (see docs/decisions.md), so anyone who can read it can read
 * every `pin_hash` in it, and there are only ten thousand codes to try. Nothing
 * here would stop somebody who wanted to take a name; it stops two family
 * members from colliding by accident, and stops the same person from becoming
 * three players by using three browsers. That is the whole claim, and it is the
 * trade Idan accepted.
 *
 * A forgotten code is not recoverable from inside the app. It is cleared by
 * hand in the Supabase dashboard — see the README.
 */

/**
 * The form of a name that decides whether two people are the same person.
 *
 * Case-folded and trimmed, with runs of inner whitespace collapsed, so
 * "  Idan " and "idan" are one player rather than three. Unicode-normalised
 * first, because Hebrew can be typed with combining marks that look identical
 * and compare differently.
 */
function nameKey(name) {
  return String(name ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

/** A code is exactly four digits. Nothing else is offered and nothing else is taken. */
function isValidCode(code) {
  return /^\d{4}$/.test(String(code ?? ''));
}

/**
 * The stored proof: SHA-256 of "<id>:<code>".
 *
 * The id is in there so that the same code chosen by two people does not
 * produce the same hash, which would let one of them recognise the other's.
 * The code itself is never stored, and never leaves the device in plain form.
 */
async function pinHash(id, code) {
  const bytes = new TextEncoder().encode(`${id}:${code}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * What should happen when someone enters a name and a code.
 *
 * Pure: it is handed the rows that already exist under that name and returns a
 * decision, so every branch can be tested without a network or a database. The
 * caller does the writing.
 *
 * Returns one of:
 *   { action: 'create', id, pinHash }   — nobody has this name yet
 *   { action: 'claim',  id, pinHash }   — one row, no code on it yet; take it
 *   { action: 'adopt',  id }            — the code matches; this is them
 *   { action: 'refuse', reason }        — it does not match, or the code is malformed
 */
async function decideIdentity(name, code, rows, newId) {
  if (nameKey(name).length === 0) return { action: 'refuse', reason: 'no-name' };
  if (!isValidCode(code)) return { action: 'refuse', reason: 'bad-code' };

  // A row that has been merged into another is not a candidate; the row it
  // points at is the one that answers for that name.
  const live = (rows ?? []).filter((row) => !row.mergedInto && !row.merged_into);

  if (live.length === 0) {
    const id = newId();
    return { action: 'create', id, pinHash: await pinHash(id, code) };
  }

  /*
   * More than one row for a name should be impossible once the unique index is
   * in place, but the index is added by a migration and old data predates it.
   * The row with the most decisions behind it is the one worth answering with —
   * the same rule the migration uses when it merges.
   */
  const best = [...live].sort(
    (a, b) => (b.lifetimeDecisions ?? b.decisions ?? 0) - (a.lifetimeDecisions ?? a.decisions ?? 0),
  )[0];

  const stored = best.pinHash ?? best.pin_hash ?? null;
  if (!stored) {
    // An existing player from before codes existed. The first person to type
    // the name sets its code and takes the row — which is the only thing that
    // can be done without asking someone who is not here.
    return { action: 'claim', id: best.id, pinHash: await pinHash(best.id, code) };
  }

  const offered = await pinHash(best.id, code);
  if (offered === stored) return { action: 'adopt', id: best.id };

  // Never create a second player with the same name. A wrong code is a wrong
  // code, and silently making a new player is how duplicates happen.
  return { action: 'refuse', reason: 'wrong-code' };
}
