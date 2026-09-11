/**
 * Motion and sound, and the lines neither may cross.
 *
 * These are the parts of the app whose failure mode is not a wrong number but a
 * wrong instinct: a page that celebrates money teaches the player to chase it,
 * which is the habit §3.1 exists to break and the risk §16 names. So the rules
 * are asserted rather than left to whoever edits the file next.
 *
 * The stylesheet and the client script are read as text. That is crude, and it
 * is exactly right for these properties — they are statements about what the
 * shipped source may contain.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');

const css = readFileSync(join(PUBLIC, 'styles.css'), 'utf8');
const app = readFileSync(join(PUBLIC, 'app.js'), 'utf8');

/** The body of every `@media (prefers-reduced-motion: no-preference)` block. */
function reducedMotionBlocks(source: string): string[] {
  const blocks: string[] = [];
  const opener = /@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    const from = i;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    blocks.push(source.slice(from, i - 1));
  }
  return blocks;
}

test('stillness is the default: nothing animates outside the reduced-motion guard', () => {
  /*
   * Built this way round on purpose. If animations lived at the top level and
   * were switched off inside `prefers-reduced-motion: reduce`, then every new
   * one added later would be missed by default and would have to be remembered.
   * This way, forgetting produces a still page rather than an unguarded one.
   */
  const guarded = reducedMotionBlocks(css);
  assert.ok(guarded.length > 0, 'there is no reduced-motion block at all');

  let outside = css;
  for (const block of guarded) outside = outside.replace(block, '');

  const offenders = [...outside.matchAll(/^\s*(animation|transition)\s*:[^;]+;/gm)].map((m) =>
    m[0].trim(),
  );
  assert.deepEqual(offenders, [], 'these move even when the player asked for less motion');
});

test('every animation has keyframes, and every keyframes is used', () => {
  const declared = new Set(
    [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]!),
  );
  const used = new Set(
    [...css.matchAll(/animation:\s*([\w-]+)/g)].map((m) => m[1]!),
  );
  for (const name of used) assert.ok(declared.has(name), `no @keyframes for ${name}`);
  for (const name of declared) assert.ok(used.has(name), `${name} is never used`);
  assert.ok(declared.size > 0);
});

test('nothing is slow enough to wait for', () => {
  // "Dealing fast rather than cinematic, because this is a drilling tool and
  // not a casino simulator" — the stylesheet's own header, made enforceable.
  const durations = [...css.matchAll(/(\d+(?:\.\d+)?)m?s/g)].map((m) => {
    const raw = m[0];
    return raw.endsWith('ms') ? Number(m[1]) : Number(m[1]) * 1000;
  });
  for (const ms of durations) assert.ok(ms <= 400, `${ms}ms is too long to sit through`);
});

test('a card animates when it is dealt and not when the page redraws', () => {
  /*
   * The regression the whole diff exists to prevent. `render()` runs after every
   * response and after every step of the reveal, and rebuilds the seats each
   * time — so without a record of what was already there, stepping through the
   * reasoning would re-deal the hand under the player three times.
   */
  const from = app.indexOf('function newCards');
  const end = app.indexOf('\n}\n', from);
  assert.ok(from > 0 && end > from, 'newCards is gone from app.js');
  const newCards = new Function(`${app.slice(from, end + 3)}\nreturn newCards;`)() as (
    keys: string[],
    previous: string[],
  ) => Map<number, number>;

  const hand = ['0:A♠', '1:8♦'];
  assert.equal(newCards(hand, []).size, 2, 'a fresh deal should animate both cards');
  assert.equal(newCards(hand, hand).size, 0, 'a redraw animated cards that were already there');

  // A hit animates only the new card, and immediately rather than queued behind
  // the two that were already down.
  const afterHit = [...hand, '2:5♣'];
  const fresh = newCards(afterHit, hand);
  assert.deepEqual([...fresh.entries()], [[2, 0]]);

  // A split leaves the first card in place and brings one new one.
  assert.deepEqual([...newCards(['0:8♦', '1:K♥'], ['0:8♦']).entries()], [[1, 0]]);
});

test('sound ships as code, never as a file', () => {
  // The artifact and the hosted page inline everything and must stay
  // self-contained and policy-clean: no fetch, no data: URI, no media.
  for (const forbidden of ['new Audio(', '.mp3', '.wav', '.ogg', 'data:audio', 'XMLHttpRequest']) {
    assert.ok(!app.includes(forbidden), `the sound code reaches for ${forbidden}`);
  }
});

test('right and wrong sound the same except for pitch', () => {
  /*
   * The §16 rule, in one assertion. A rising chime for a correct play and a
   * buzzer for a wrong one is casino conditioning attached to a learning
   * signal, which is worse than attaching it to money because it is harder to
   * notice. One tone, one envelope, one loudness; only the frequency moves.
   */
  const from = app.indexOf('function playVerdict');
  const end = app.indexOf('\n}\n', from);
  assert.ok(from > 0, 'playVerdict is gone from app.js');
  const body = app.slice(from, end);

  // Exactly one place where right and wrong differ, and it is the pitch.
  const branches = [...body.matchAll(/correct\s*\?/g)];
  assert.equal(branches.length, 1, 'right and wrong differ in more than one way');
  assert.match(body, /frequency\.value = correct \?/, 'the difference is not the pitch');

  // One oscillator, one gain envelope, fixed numbers.
  assert.equal([...body.matchAll(/createOscillator/g)].length, 1);
  assert.ok(!/Math\.random/.test(body), 'the verdict tone is randomised');
});

test('money is silent', () => {
  /*
   * The hardest line in the app. Nothing may sound when a hand wins, loses,
   * pushes or busts — those are outcomes, and an outcome that makes a noise is
   * the slot machine this trainer is arguing against.
   */
  for (const fn of ['function renderHands', 'function renderRail', 'function tableTalk']) {
    const from = app.indexOf(fn);
    assert.ok(from > 0, `${fn} is gone from app.js`);
    const body = app.slice(from, app.indexOf('\n}\n', from));
    assert.ok(!/play(Card|Verdict)\s*\(/.test(body), `${fn} makes a sound about the outcome`);
  }
});

test('nothing is built until sound is asked for', () => {
  // A player who never turns it on should never get an audio context at all.
  const from = app.indexOf('function audio()');
  const end = app.indexOf('\n}\n', from);
  assert.ok(from > 0, 'audio() is gone from app.js');
  const body = app.slice(from, end);
  const guard = body.indexOf('if (!soundEnabled()) return null;');
  assert.ok(guard >= 0, 'the preference is not checked');
  assert.ok(
    guard < body.indexOf('new Ctx('),
    'a context is constructed before the preference is consulted',
  );
  // One context per page, not one per screen change — the artifact build calls
  // this file's initialiser again on every navigation.
  assert.match(app, /window\.__evAudio/, 'the context is not held across re-initialisation');
});
