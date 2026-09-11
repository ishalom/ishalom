/**
 * How hard the spot was.
 *
 * The engine has always known the difficulty of all 311 chart cells — it looks
 * the number up on every decision to move the rating, and used to throw it
 * away. Now it says so, and getting a genuinely hard hand right reads
 * differently from getting twenty-against-six right.
 *
 * Two properties keep that from becoming a prize to chase. The band is
 * absolute, so it means the same thing to everyone rather than flattering a
 * weak player; and the tag appears identically whether the hand was played
 * right or wrong, with only a trailing clause differing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TrainerSession, bandFor, type SpotBand } from '../src/session.ts';
import { catalogue } from '../src/i18n.ts';

const BANDS: SpotBand[] = ['routine', 'ordinary', 'tricky', 'brutal'];

function play(session: TrainerSession, hands: number): void {
  for (let i = 0; i < hands; i++) {
    session.deal();
    let view = session.view as any;
    if (view.phase === 'insurance') {
      session.insurance(false);
      view = session.view as any;
    }
    let guard = 0;
    while (view.phase === 'player' && guard++ < 20) {
      const legal = view.legalActions as string[];
      session.act((legal.includes('split') ? 'split' : 'stand') as never);
      view = session.view as any;
    }
  }
}

test('every rating falls in a band, and the bands only go up', () => {
  let previous = -1;
  for (let rating = 700; rating <= 2400; rating += 10) {
    const band = bandFor(rating);
    assert.ok(BANDS.includes(band), `${rating} produced ${band}`);
    const rank = BANDS.indexOf(band);
    assert.ok(rank >= previous, `bands went backwards at ${rating}`);
    previous = rank;
  }
  // All four are actually reachable — a band nothing lands in is dead copy.
  const seen = new Set<SpotBand>();
  for (let rating = 800; rating <= 2200; rating += 5) seen.add(bandFor(rating));
  assert.equal(seen.size, 4);
});

test('the bands are absolute, so they cannot be scaled to flatter anybody', () => {
  // The same spot must read the same to a beginner and to an expert. The
  // player-relative fact is carried separately, by `aboveYou`.
  assert.equal(bandFor(1200), 'routine');
  assert.equal(bandFor(1400), 'ordinary');
  assert.equal(bandFor(1600), 'tricky');
  assert.equal(bandFor(1800), 'brutal');
});

test('a played spot is either well-formed or honestly absent', () => {
  const session = new TrainerSession('vegas-strip-6d-s17', 20260916);
  play(session, 70);

  const decisions = (session.view as any).history.flatMap((hand: any) => hand.decisions);
  assert.ok(decisions.length > 30, `only ${decisions.length} decisions`);

  let described = 0;
  let absent = 0;
  for (const decision of decisions) {
    if (decision.spot === null || decision.spot === undefined) {
      absent++;
      continue;
    }
    described++;
    const spot = decision.spot;
    assert.ok(BANDS.includes(spot.band), `bad band ${spot.band}`);
    assert.ok(spot.rating >= 700 && spot.rating <= 2400, `rating out of range: ${spot.rating}`);
    assert.equal(spot.band, bandFor(spot.rating));
    assert.equal(spot.hard, spot.band === 'tricky' || spot.band === 'brutal');
    assert.ok(spot.oneIn >= 1, `impossible rarity: ${spot.oneIn}`);
  }

  assert.ok(described > 0, 'no spot was ever described');
  // Off-grid hands — hard 18 through 21 — have no cell, and saying nothing
  // about them is what makes the tag mean something when it does appear.
  assert.ok(absent > 0, 'nothing was left undescribed, so the tag is not selective');
});

test('the description survives a change of language untouched', () => {
  /*
   * It travels as numbers and an untranslated band id precisely so this holds.
   * The feedback card is rebuilt in the new language, spreading the previous
   * object — anything already phrased would come through in the old one.
   */
  const session = new TrainerSession('vegas-strip-6d-s17', 20260917);
  play(session, 30);

  const before = JSON.stringify((session.view as any).feedback.spot);
  session.setLocale('he');
  const after = JSON.stringify((session.view as any).feedback.spot);
  assert.equal(after, before);

  if (before !== 'null') {
    assert.doesNotMatch(before, /[א-ת]/, 'a translated string leaked into the spot');
  }
});

test('every band has a word in every language', () => {
  for (const locale of ['en', 'he'] as const) {
    const table = catalogue(locale);
    for (const band of BANDS) {
      assert.ok(table[`spot.${band}`], `${locale} has no word for ${band}`);
    }
  }
  // And no orphans: the key set and the band set are the same set.
  const keys = Object.keys(catalogue('en'))
    .filter((key) => key.startsWith('spot.'))
    .map((key) => key.slice('spot.'.length));
  assert.deepEqual(keys.sort(), [...BANDS].sort());
});
