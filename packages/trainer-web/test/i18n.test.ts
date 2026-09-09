/**
 * The language layer.
 *
 * Two things can go wrong with a translated app and neither shows up in a
 * typecheck: a locale can be missing a key, and the pages can render a string
 * that was never put in the catalogue in the first place. The first is a blank
 * or English-looking line in the middle of Hebrew; the second is a line that
 * stays English no matter what the player picks. Both are checked here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCALES, catalogue, localeInfo, missingKeys, t, type Locale } from '../src/i18n.ts';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

test('every locale carries every key English does', () => {
  for (const info of LOCALES) {
    assert.deepEqual(
      missingKeys(info.code),
      [],
      `${info.code} is missing keys, which would render as English or as the raw key`,
    );
  }
});

test('no locale leaves a placeholder unfilled', () => {
  // A translator can drop a `{gap}` while rephrasing a sentence, and the number
  // then silently vanishes from the explanation rather than reading wrong.
  const english = catalogue('en');
  for (const info of LOCALES) {
    if (info.code === 'en') continue;
    const table = catalogue(info.code);
    for (const [key, template] of Object.entries(english)) {
      const wanted = new Set(template.match(/\{(\w+)\}/g) ?? []);
      const got = new Set(table[key]!.match(/\{(\w+)\}/g) ?? []);
      assert.deepEqual(
        [...wanted].filter((p) => !got.has(p)),
        [],
        `${info.code} drops a placeholder from ${key}`,
      );
    }
  }
});

test('substitution fills every parameter and leaves the emphasis alone', () => {
  const rendered = t('he', 'combined.numbers', {
    best: '−0.500',
    runnerUp: '−0.504',
    runnerUpVerb: 'x',
  });
  assert.ok(!rendered.includes('{'), `left a placeholder: ${rendered}`);
});

test('a missing key returns the key rather than throwing', () => {
  // A half-translated screen is bad; a blank one, or a 500, is worse.
  assert.equal(t('en', 'no.such.key'), 'no.such.key');
});

test('Hebrew is declared right-to-left', () => {
  assert.equal(localeInfo('he').dir, 'rtl');
  assert.equal(localeInfo('en').dir, 'ltr');
});

test('every key the client asks for exists', () => {
  // The pages name keys as strings, so nothing but this test connects
  // `T('home.footer')` in a script to the catalogue entry it needs.
  const english = catalogue('en');
  const files = readdirSync(PUBLIC).filter((f) => f.endsWith('.js') || f.endsWith('.html'));
  const unknown: string[] = [];

  for (const file of files) {
    const source = readFileSync(join(PUBLIC, file), 'utf8');
    const keys = [
      // The trailing `[,)]` skips the two call sites that concatenate a value
      // onto a prefix; those are covered by the next test instead.
      ...source.matchAll(/\bT\('([\w.]+)'\s*[,)]/g),
      ...source.matchAll(/data-i18n(?:-value)?="([\w.]+)"/g),
      ...source.matchAll(/data-i18n-attr="[\w-]+:([\w.]+)"/g),
      ...source.matchAll(/content="(ui\.[\w.]+)"/g),
      ...source.matchAll(/\bEV\.t\('([\w.]+)'\s*[,)]/g),
    ].map((m) => m[1]!);
    for (const key of keys) if (english[key] === undefined) unknown.push(`${file}: ${key}`);
  }

  assert.deepEqual(unknown, [], 'the pages reference keys the catalogue does not have');
});

test('keys the pages build at runtime resolve for every value', () => {
  /*
   * Two call sites compose a key from a value rather than writing it out:
   * `T('fb.' + severity)` and `T('ui.mode.' + rating.mode)`. The scan above
   * cannot follow those, so the families are listed here instead — which also
   * means adding a severity tier or a difficulty mode fails loudly rather than
   * rendering the raw key on the feedback card.
   */
  const families: Array<[string, readonly string[]]> = [
    ['fb.', ['optimal', 'negligible', 'minor', 'significant', 'blunder']],
    ['ui.mode.', ['basic', 'recall', 'value']],
    ['action.', ['hit', 'stand', 'double', 'split', 'surrender', 'takeInsurance', 'declineInsurance']],
    ['verbTo.', ['hit', 'stand', 'double', 'split', 'surrender']],
    ['howto.', ['1', '2', '3', '4']],
    ['info.accuracy.', ['title', 'body']],
    ['info.evLost.', ['title', 'body']],
    ['info.edge.', ['title', 'body']],
    ['info.units.', ['title', 'body']],
  ];
  for (const info of LOCALES) {
    const table = catalogue(info.code);
    for (const [prefix, values] of families) {
      for (const value of values) {
        assert.ok(
          table[prefix + value] !== undefined,
          `${info.code} has no ${prefix}${value}`,
        );
      }
    }
  }
});

test('the switcher can name every language in its own script', () => {
  for (const info of LOCALES) {
    assert.ok(info.name.trim().length > 0, `${info.code} has no name`);
  }
  // Someone who cannot read the language currently on screen still has to be
  // able to find their own, so the names are never translated.
  assert.equal(localeInfo('he').name, 'עברית');
});

test('the composed prose differs between locales', () => {
  // Guards against a locale that loads but silently falls through to English.
  const keys: string[] = ['ui.deal', 'fb.blunder', 'coach.q.odds'];
  for (const key of keys) {
    const seen = new Set<string>(LOCALES.map((l) => t(l.code as Locale, key)));
    assert.equal(seen.size, LOCALES.length, `${key} reads the same in every language`);
  }
});
