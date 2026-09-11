/**
 * The hand log, read as a player reads it.
 *
 * Idan opened a hand with three decisions — 5,5 doubled, then 15, then 18 — and
 * found one header at the top and nine unlabelled paragraphs under it, three of
 * which were the identical dealer read. His question was "how come one time one
 * thing was right and then another?", which is the only conclusion available
 * from what was on the screen: a single headline, "5,5 מול 8 ← הכפלה", sitting
 * above the reasoning for two other decisions it had nothing to do with.
 *
 * So this tests the structure rather than the prose: one header per decision,
 * every step under its own title, the dealer read once per hand, and a row
 * summary that describes the hand instead of one decision inside it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCards } from '@evtrainer/ev-engine';
import type { BlackjackTable } from '@evtrainer/game-engine';

import { catalogue, t, type Locale } from '../src/i18n.ts';
import { TrainerSession } from '../src/session.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Just enough DOM to build the log and read it back. */
interface Node {
  className: string;
  hidden: boolean;
  children: Node[];
  own: string;
  textContent: string;
}

function makeDocument() {
  const node = (own = ''): Node => {
    const n: Node = {
      className: '',
      hidden: false,
      children: [],
      own,
      get textContent(): string {
        return n.own + n.children.map((c) => c.textContent).join('');
      },
      set textContent(value: string) {
        n.own = value;
        n.children.length = 0;
      },
    } as unknown as Node;
    Object.assign(n, {
      appendChild(child: Node) {
        n.children.push(child);
        return child;
      },
      append(...kids: Node[]) {
        n.children.push(...kids);
      },
    });
    return n;
  };
  return {
    createElement: () => node(),
    createTextNode: (text: string) => node(text),
  };
}

/** Lift the log builders out of the page script, so this tests what ships. */
function loadLog(locale: Locale) {
  const source = readFileSync(join(HERE, '..', 'public', 'home.js'), 'utf8');
  const slice = (name: string) => {
    const from = source.indexOf(`function ${name}`);
    assert.ok(from > 0, `${name} is gone from home.js`);
    const end = source.indexOf('\n}\n', from);
    assert.ok(end > from, `could not find the end of ${name}`);
    return source.slice(from, end + 3);
  };
  const titles = source.indexOf('const STEP_TITLES');
  assert.ok(titles > 0, 'STEP_TITLES is gone from home.js');

  return new Function(
    'T',
    '__document',
    `const document = __document;\n` +
      `${source.slice(titles, source.indexOf('\n', titles) + 1)}\n` +
      `${slice('noDecisionReason')}\n${slice('handSummary')}\n${slice('decisionBlocks')}\n` +
      'return { handSummary, decisionBlocks };',
  )(
    (key: string, params?: Record<string, string | number>) => t(locale, key, params ?? {}),
    makeDocument(),
  ) as {
    handSummary: (hand: unknown) => string;
    decisionBlocks: (hand: unknown) => Node;
  };
}

/** A hand of 5,5 against an 8: double, then hit the 15, then stand on the 18. */
function threeDecisionHand(locale: Locale): { hand: unknown; session: TrainerSession } {
  const session = new TrainerSession('vegas-strip-6d-s17', 3);
  session.setLocale(locale);
  const table = (session as unknown as { table: BlackjackTable }).table;
  // 5,5 against an 8 with no double allowed after the split, so the player can
  // keep drawing and the hand carries three graded decisions.
  table.shoe.stack(parseCards('5s 8d 5h 9c 6h 3d'));
  session.deal();
  session.act('hit'); // 10 -> 16
  session.act('hit'); // 16 -> 19
  session.act('stand');
  const history = (session.view as { history: unknown[] }).history;
  return { hand: history[0], session };
}

const headers = (block: Node) =>
  block.children.map((decision) => decision.children[0]!.textContent);

const titlesIn = (block: Node) =>
  block.children.flatMap((decision) =>
    decision.children.slice(1).map((step) => step.children[0]!.own),
  );

test('every decision in a hand gets its own header', () => {
  for (const locale of ['en', 'he'] as Locale[]) {
    const { hand } = threeDecisionHand(locale);
    const decisions = (hand as { decisions: unknown[] }).decisions;
    assert.ok(decisions.length >= 3, `the fixture only produced ${decisions.length} decisions`);

    const block = loadLog(locale).decisionBlocks(hand);
    assert.equal(
      headers(block).length,
      decisions.length,
      `${locale}: ${headers(block).length} headers for ${decisions.length} decisions`,
    );
    for (const [i, header] of headers(block).entries()) {
      const decision = decisions[i] as { headline: string; chosen: string; correct: boolean };
      assert.ok(
        header.includes(decision.headline),
        `${locale}: header ${i + 1} does not name its own decision: ${header}`,
      );
      // A header only names what was played when that differed from the best
      // play; "played it right" already says what was played.
      if (!decision.correct) {
        assert.ok(header.includes(decision.chosen.toLowerCase()), `${locale}: ${header}`);
      }
    }
  }
});

test('every step is under its title, and the titles are the reveal’s own', () => {
  for (const locale of ['en', 'he'] as Locale[]) {
    const { hand } = threeDecisionHand(locale);
    const block = loadLog(locale).decisionBlocks(hand);
    const expected = [
      t(locale, 'ui.readDealer'),
      t(locale, 'ui.readHand'),
      t(locale, 'ui.combine'),
    ];
    const seen = titlesIn(block);
    assert.ok(seen.length > 0, 'the steps lost their titles');
    for (const title of seen) {
      assert.ok(expected.includes(title), `${locale}: "${title}" is not a step title`);
    }
    // Every block still ends with the verdict step.
    for (const decision of block.children) {
      const last = decision.children[decision.children.length - 1]!;
      assert.equal(last.children[0]!.own, expected[2], `${locale}: a block lost its last step`);
    }
  }
});

test('the dealer read is shown once per hand, not once per decision', () => {
  for (const locale of ['en', 'he'] as Locale[]) {
    const { hand } = threeDecisionHand(locale);
    const decisions = (hand as { decisions: Array<{ steps: string[] }> }).decisions;
    const read = decisions[0]!.steps[0]!;
    // The fixture has to actually repeat it, or the test proves nothing.
    assert.ok(
      decisions.filter((d) => d.steps[0] === read).length >= 3,
      'the fixture does not repeat the dealer read',
    );

    const block = loadLog(locale).decisionBlocks(hand);
    const body = block.textContent;
    const occurrences = body.split(read).length - 1;
    assert.equal(occurrences, 1, `${locale}: the dealer read appears ${occurrences} times`);
  }
});

test('the row summarises the hand, not the worst decision in it', () => {
  for (const locale of ['en', 'he'] as Locale[]) {
    const { hand } = threeDecisionHand(locale);
    const log = loadLog(locale);
    const summary = log.handSummary(hand);
    const decisions = (hand as { decisions: Array<{ headline: string }> }).decisions;

    for (const decision of decisions) {
      assert.ok(
        !summary.includes(decision.headline),
        `${locale}: the row still quotes one decision's headline: ${summary}`,
      );
    }
    assert.ok(summary.includes(String(decisions.length)), `${locale}: ${summary}`);
  }
});

test('a hand with one decision is still summarised by that decision', () => {
  const session = new TrainerSession('vegas-strip-6d-s17', 5);
  const table = (session as unknown as { table: BlackjackTable }).table;
  table.shoe.stack(parseCards('Ks 9d Qh 8c'));
  session.deal();
  session.act('stand');
  const hand = (session.view as { history: unknown[] }).history[0] as {
    decisions: Array<{ headline: string }>;
  };
  assert.equal(hand.decisions.length, 1);
  assert.ok(loadLog('en').handSummary(hand).includes(hand.decisions[0]!.headline));
});

test('nothing in the Hebrew log is written in English', () => {
  const { hand } = threeDecisionHand('he');
  const log = loadLog('he');
  const text = `${log.handSummary(hand)} ${log.decisionBlocks(hand).textContent}`;
  // Card ranks and the engine's own figures are the only Latin left: T, J, Q,
  // K, A and EV. Any other run of letters is untranslated copy.
  const words = text.match(/[A-Za-z]{2,}/g) ?? [];
  assert.deepEqual(
    words.filter((w) => w !== 'EV'),
    [],
    `English words in the Hebrew log: ${words.join(', ')}`,
  );
});

test('the two hand-summary keys exist in both languages', () => {
  for (const locale of ['en', 'he'] as Locale[]) {
    for (const key of ['log.allRight', 'log.someOff']) {
      assert.ok(catalogue(locale)[key], `${locale} has no ${key}`);
    }
  }
});
