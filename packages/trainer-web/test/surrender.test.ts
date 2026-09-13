/**
 * Surrender, checked everywhere (round 7).
 *
 * Idan suspected the surrender option was inconsistent on 15 and 16 against a
 * ten or an ace. This holds the whole app to one answer, for every rule preset,
 * every restriction combination the app ships, and every one of the 310 chart
 * cells — surrender cells included, and not only 15 and 16:
 *
 *   - what the table offers on the first decision of a dealt hand;
 *   - what the feedback card grades as best;
 *   - what the reference chart shows (the chart the page's dialog draws);
 *   - the chart the table itself grades against;
 *   - what the rule-sensitivity note says, recomputed independently.
 *
 * The engine's own computation is the reference (§14.2). The published-chart
 * cross-check for Vegas Strip is the last test.
 *
 * Set EV_SURRENDER_REPORT to a file path to write the preset × restriction ×
 * cell table the round report quotes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

import { makeRules, parseCards, RULE_PRESETS, type BlackjackRules } from '@evtrainer/ev-engine';

import { applyRestrictions, TrainerSession, type Restrictions } from '../src/session.ts';
import { chartFor } from '../src/sensitivity.ts';
import { catalogue } from '../src/i18n.ts';

const UPCARDS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'A'];
const UP_LABEL: Record<string, string> = { T: '10' };
const HARD: Record<number, [string, string]> = {
  5: ['3', '2'], 6: ['4', '2'], 7: ['5', '2'], 8: ['6', '2'], 9: ['7', '2'], 10: ['7', '3'], 11: ['7', '4'],
  12: ['T', '2'], 13: ['T', '3'], 14: ['T', '4'], 15: ['T', '5'], 16: ['T', '6'], 17: ['T', '7'],
};
const SOFT = [13, 14, 15, 16, 17, 18, 19, 20];
const PAIRS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T'];

interface Cell {
  key: string;
  player: [string, string];
  up: string;
}

function cells(): Cell[] {
  const out: Cell[] = [];
  for (const up of UPCARDS) {
    const vs = `vs${UP_LABEL[up] ?? up}`;
    for (const [total, cards] of Object.entries(HARD)) out.push({ key: `bj:hard${total}:${vs}`, player: cards, up });
    for (const total of SOFT) out.push({ key: `bj:soft${total}:${vs}`, player: ['A', String(total - 11)], up });
    for (const rank of PAIRS) out.push({ key: `bj:pair${rank}:${vs}`, player: [rank, rank], up });
  }
  return out;
}

const RESTRICTIONS: Array<{ label: string; value: Restrictions }> = [
  { label: 'none', value: { noSurrender: false, likeRanksOnly: false } },
  { label: 'no surrender', value: { noSurrender: true, likeRanksOnly: false } },
  { label: 'like ranks only', value: { noSurrender: false, likeRanksOnly: true } },
  { label: 'both', value: { noSurrender: true, likeRanksOnly: true } },
];

/** The sensitivity variants, restated here rather than imported, so the note is checked independently. */
const VARIANTS: Array<[string, (rules: BlackjackRules) => BlackjackRules]> = [
  ['if the dealer stood on soft 17', (r) => makeRules({ ...r, soft17: 'S17' })],
  ['if the dealer hit soft 17', (r) => makeRules({ ...r, soft17: 'H17' })],
  ['without late surrender', (r) => makeRules({ ...r, surrender: 'none' })],
  ['with late surrender available', (r) => makeRules({ ...r, surrender: 'late' })],
  ['without double after split', (r) => makeRules({ ...r, das: false })],
  ['in a no-hole-card game', (r) => makeRules({ ...r, peek: false })],
];

interface Row {
  preset: string;
  restriction: string;
  cell: string;
  offered: boolean;
  card: string;
  chart: string;
  grading: string;
  note: string;
  agree: boolean;
  why: string[];
}

const LETTER: Record<string, string> = { hit: 'H', stand: 'S', double: 'D', split: 'P', surrender: 'R' };

function check(): Row[] {
  const rows: Row[] = [];
  for (const preset of RULE_PRESETS) {
    for (const restriction of RESTRICTIONS) {
      const rules = applyRestrictions(preset.rules, restriction.value);
      const reference = chartFor(rules);
      const lateTwin = chartFor(makeRules({ ...rules, surrender: 'late' }));
      /*
       * One session per rule set, as a player sits at one table and deals hand
       * after hand. A new session per cell would make its table derive its own
       * chart 310 times over.
       */
      const session = new TrainerSession(preset.id, 7, restriction.value);
      const shoe = (session as any).table.shoe;
      for (const cell of cells()) {
        if ((session.view as any).chips.needsRebuy) session.rebuy();
        // Player, upcard, player, hole — a hole card that cannot make a dealer natural.
        const hole = cell.up === 'A' || cell.up === 'T' ? '2' : '3';
        const cards = parseCards(`${cell.player[0]}s ${cell.up}h ${cell.player[1]}d ${hole}c`);
        // A reshuffle at the cut card would drop stacked cards, and a single deck
        // cannot stack a card already dealt: shuffle first when either would happen.
        if (shoe.needsShuffle) shoe.shuffle();
        try {
          shoe.stack(cards);
        } catch {
          shoe.shuffle();
          shoe.stack(cards);
        }
        session.deal();
        if ((session.view as any).phase === 'insurance') session.insurance(false);
        const view = session.view as any;
        const why: string[] = [];
        if (view.phase !== 'player') {
          // A pair of tens split by rank: under "like ranks only" T-T is still a pair of identical ranks here.
          why.push(`no decision was dealt (${view.phase})`);
        }
        const legal: string[] = view.legalActions ?? [];
        const offered = legal.includes('surrender');
        const feedback = view.phase === 'player' ? (session.act('stand') as any) : null;
        const chartAction = (session.chart as any).cells[cell.key] as string;
        const gradingAction = (session as any).table.chart.cells.get(cell.key)?.optimalAction as string;
        const cardAction = feedback?.optimal as string;

        if (feedback && feedback.scenarioKey !== cell.key) why.push(`dealt ${feedback.scenarioKey}, not ${cell.key}`);
        if (offered !== (rules.surrender !== 'none')) why.push(`surrender offered: ${offered}, rules say ${rules.surrender}`);
        if (chartAction !== gradingAction) why.push(`reference chart ${chartAction} but the table grades against ${gradingAction}`);
        if (cardAction !== chartAction) why.push(`card grades ${cardAction} but the chart shows ${chartAction}`);
        if (chartAction === 'surrender' && !offered) why.push('the chart says surrender but the table does not offer it');

        const expectedNotes: string[] = [];
        const seen = new Set<string>([JSON.stringify(rules)]);
        for (const [label, apply] of VARIANTS) {
          const other = apply(rules);
          const id = JSON.stringify(other);
          if (seen.has(id)) continue;
          seen.add(id);
          const otherAction = chartFor(other).cells.get(cell.key)?.optimalAction;
          if (otherAction && otherAction !== chartAction && LETTER[otherAction]) expectedNotes.push(`${label}: ${otherAction}`);
        }
        const shownNotes = (feedback?.sensitivity ?? []).map((n: any) => `${n.label}: ${n.action}`);
        if (JSON.stringify(shownNotes) !== JSON.stringify(expectedNotes)) {
          why.push(`note ${JSON.stringify(shownNotes)} but the charts give ${JSON.stringify(expectedNotes)}`);
        }

        const surrenderCell =
          reference.cells.get(cell.key)?.optimalAction === 'surrender' ||
          lateTwin.cells.get(cell.key)?.optimalAction === 'surrender';
        if (surrenderCell || why.length > 0) {
          rows.push({
            preset: preset.id,
            restriction: restriction.label,
            cell: cell.key,
            offered,
            card: LETTER[cardAction] ?? String(cardAction),
            chart: LETTER[chartAction] ?? String(chartAction),
            grading: LETTER[gradingAction] ?? String(gradingAction),
            note: shownNotes.filter((n: string) => n.includes('surrender')).join('; ') || '—',
            agree: why.length === 0,
            why,
          });
        }
      }
    }
  }
  return rows;
}

const rows = check();

test('every preset, every restriction, every cell: the table, the card, the chart and the note agree', () => {
  const disagreements = rows.filter((row) => !row.agree);
  assert.deepEqual(
    disagreements.map((row) => `${row.preset} / ${row.restriction} / ${row.cell}: ${row.why.join('; ')}`),
    [],
  );

  const report = process.env.EV_SURRENDER_REPORT;
  if (report) {
    const lines = [
      '| preset | restriction | cell | table offers R | card best | chart | table grades | surrender note | agree |',
      '|---|---|---|---|---|---|---|---|---|',
      ...rows.map((r) =>
        `| ${r.preset} | ${r.restriction} | ${r.cell.replace('bj:', '')} | ${r.offered ? 'yes' : 'no'} | ${r.card} | ${r.chart} | ${r.grading} | ${r.note} | ${r.agree ? 'yes' : 'NO: ' + r.why.join('; ')} |`,
      ),
    ];
    writeFileSync(report, lines.join('\n') + '\n');
  }
});

test('the rule note is worded in the language on screen: every id has both languages, and Hebrew has no English', () => {
  // The Hebrew card read "תלוי בחוקים: hit without late surrender" until round 7.
  const shown = new Set(rows.flatMap((row) => (row.note === '—' ? [] : [row.note])));
  assert.ok(shown.size > 0, 'no surrender note was produced to word');
  for (const id of ['s17', 'h17', 'noSurrender', 'lateSurrender', 'noDas', 'noHoleCard']) {
    assert.ok(catalogue('en')[`sens.${id}`], `English has no sens.${id}`);
    const hebrew = catalogue('he')[`sens.${id}`];
    assert.ok(hebrew, `Hebrew has no sens.${id}`);
    assert.doesNotMatch(hebrew!, /[a-z]/i, `sens.${id} is English on the Hebrew card`);
  }
  for (const action of ['hit', 'stand', 'double', 'split', 'surrender']) {
    assert.doesNotMatch(catalogue('he')[`action.${action}`]!, /[a-z]/i, `action.${action} is English on the Hebrew card`);
  }
});

test('Vegas Strip 6D S17 matches the published chart on 15 and 16 against 9, 10 and an ace', () => {
  const chart = chartFor(RULE_PRESETS.find((p) => p.id === 'vegas-strip-6d-s17')!.rules);
  const at = (key: string) => chart.cells.get(key)!.optimalAction;
  // Published basic strategy for 6 decks, S17, DAS, late surrender.
  assert.equal(at('bj:hard16:vs9'), 'surrender');
  assert.equal(at('bj:hard16:vs10'), 'surrender');
  assert.equal(at('bj:hard16:vsA'), 'surrender');
  assert.equal(at('bj:hard15:vs9'), 'hit');
  assert.equal(at('bj:hard15:vs10'), 'surrender');
  assert.equal(at('bj:hard15:vsA'), 'hit');
  // And under H17 the ace joins 15 (the published H17 change).
  const h17 = chartFor(makeRules({ ...RULE_PRESETS[0]!.rules, soft17: 'H17' }));
  assert.equal(h17.cells.get('bj:hard15:vsA')!.optimalAction, 'surrender');
  // No surrender restriction: none of them.
  const none = chartFor(makeRules({ ...RULE_PRESETS[0]!.rules, surrender: 'none' }));
  for (const key of ['bj:hard16:vs9', 'bj:hard16:vs10', 'bj:hard16:vsA', 'bj:hard15:vs10']) {
    assert.notEqual(none.cells.get(key)!.optimalAction, 'surrender', key);
  }
});
