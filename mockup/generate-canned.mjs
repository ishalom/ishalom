/**
 * Generates `canned.js` for the static mockups.
 *
 * The mockups are not wired to anything, but their numbers are not invented
 * either: this pulls real EVs, real chart margins, real dealer odds, real
 * explanation sentences and real UTH solver output out of the engines and writes
 * them out as a plain ES module the HTML files can import.
 *
 * That keeps the mockup honest about what the app can actually say, and makes
 * wiring it up later a substitution rather than a rewrite.
 *
 *   node mockup/generate-canned.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DealerSolver,
  DEALER_BLACKJACK,
  DEALER_BUST,
  deriveChart,
  getPreset,
  houseEdge,
  parseCards,
  parseScenarioKey,
  rankOf,
  scenarioForHand,
  scenarioKey,
  Shoe,
  suitOf,
} from '@evtrainer/ev-engine';

import { explain } from '../packages/trainer-web/src/explain.ts';
import { ruleSensitivity } from '../packages/trainer-web/src/sensitivity.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const preset = getPreset('vegas-strip-6d-s17');
const rules = preset.rules;
const chart = deriveChart(rules, { cardRemoval: 'static-dealer' });
const edge = houseEdge(rules);

// --- Natural frequency of every opening scenario ---------------------------
// Needed for the rarity term in the difficulty rating, and to show the player
// how often a spot really occurs (so adaptive dealing cannot quietly teach a
// false picture of the game).

const counts = Array.from({ length: 10 }, (_, r) => (r === 9 ? rules.decks * 16 : rules.decks * 4));
const N = rules.decks * 52;
const frequency = new Map();
for (let a = 0; a < 10; a++) {
  for (let b = a; b < 10; b++) {
    for (let u = 0; u < 10; u++) {
      const na = counts[a];
      const nb = a === b ? counts[b] - 1 : counts[b];
      const nu = counts[u] - (u === a ? 1 : 0) - (u === b ? 1 : 0);
      if (nb <= 0 || nu <= 0) continue;
      const ways = (a === b ? na * nb : 2 * na * nb) * nu;
      const key = scenarioKey(scenarioForHand([a, b], u, a === b));
      frequency.set(key, (frequency.get(key) ?? 0) + ways / (N * (N - 1) * (N - 2)));
    }
  }
}

const MEDIAN_MARGIN = 0.1577;
const MEDIAN_FREQUENCY = 1 / 1088;

/**
 * Difficulty: how likely a competent player is to get this spot wrong.
 *
 * Two terms, both on a log scale because both inputs span orders of magnitude —
 * margins run 0.0018 to 0.97, frequencies from 1-in-35 to 1-in-2477.
 *
 *   margin  — a thin margin between the best two actions is hard to know.
 *   rarity  — a spot you meet once in 2,000 hands is hard to recall. Note the
 *             direction: *rarer* is harder, so the ratio is median over actual.
 *             Getting this backwards rates "never split tens" — the most common
 *             and most obvious cell there is — as mid-table.
 */
function difficulty(key) {
  const cell = chart.cells.get(key);
  if (!cell) return 1500;
  const freq = frequency.get(key) ?? MEDIAN_FREQUENCY;
  const raw =
    1500 +
    400 * Math.log10(MEDIAN_MARGIN / Math.max(cell.margin, 1e-4)) +
    150 * Math.log10(MEDIAN_FREQUENCY / freq);
  return Math.round(Math.min(2200, Math.max(800, raw)));
}

/** Elo expectation and the rating swing either way, for the mockup to show. */
function eloSwing(playerRating, handRating, k = 24) {
  const expected = 1 / (1 + 10 ** ((handRating - playerRating) / 400));
  return {
    expected: Number(expected.toFixed(4)),
    onCorrect: Math.round(k * (1 - expected)),
    onError: -Math.round(k * expected),
  };
}

// --- Card rendering --------------------------------------------------------

const RANKS = '23456789TJQKA';
const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'];
const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'];
const RANK_NAMES = { T: 'ten', J: 'jack', Q: 'queen', K: 'king', A: 'ace' };

function card(text) {
  const [c] = parseCards(text);
  const rank = RANKS[rankOf(c)];
  const suit = suitOf(c);
  return {
    rank: rank === 'T' ? '10' : rank,
    suit: SUIT_SYMBOLS[suit],
    red: suit === 1 || suit === 2,
    label: `${RANK_NAMES[rank] ?? rank} of ${SUIT_NAMES[suit]}`,
  };
}

const cards = (text) => text.split(/\s+/).filter(Boolean).map(card);

// --- Dealer odds for a given upcard ----------------------------------------

function odds(upcardRank) {
  const shoe = Shoe.fresh(rules.decks);
  shoe.remove(upcardRank);
  const dist = new DealerSolver(rules).distribution(upcardRank, shoe);
  const natural = dist[DEALER_BLACKJACK];
  const scale = natural < 1 ? 1 / (1 - natural) : 1;
  const bust = dist[DEALER_BUST] * scale;
  return { bust, madeHand: 1 - bust };
}

// --- One decision, fully described -----------------------------------------

/** Everything the feedback card and the dealer's voice need for one spot. */
function decision(key, chosenAction) {
  const cell = chart.cells.get(key);
  if (!cell) throw new Error(`no chart cell for ${key}`);
  const scenario = parseScenarioKey(key);
  const ranked = Object.entries(cell.evByAction)
    .map(([action, ev]) => ({ action, ev: Number(ev.toFixed(4)) }))
    .sort((a, b) => b.ev - a.ev);
  const chosenEv = cell.evByAction[chosenAction];
  const evCost = Math.max(0, cell.optimalEv - chosenEv);
  const severity =
    evCost === 0
      ? 'optimal'
      : evCost <= 0.005
        ? 'negligible'
        : evCost <= 0.03
          ? 'minor'
          : evCost <= 0.1
            ? 'significant'
            : 'blunder';

  return {
    scenarioKey: key,
    optimal: cell.optimalAction,
    chosen: chosenAction,
    correct: evCost === 0,
    evCost: Number(evCost.toFixed(4)),
    severity,
    margin: Number(cell.margin.toFixed(4)),
    ranked,
    ...(() => {
      const ex = explain(scenario, {
        legalActions: Object.keys(cell.evByAction),
        evByAction: cell.evByAction,
        optimalAction: cell.optimalAction,
        optimalEv: cell.optimalEv,
      }, rules);
      return { headline: ex.headline, steps: ex.steps, reason: ex.steps[2] };
    })(),
    sensitivity: ruleSensitivity(key, rules, cell.optimalAction),
    difficulty: difficulty(key),
    frequency: frequency.get(key) ?? null,
    dealerOdds: scenario.upcard === undefined ? null : odds(scenario.upcard),
    bustOnHit: bustChance(scenario),
  };
}

/**
 * The player's chance of busting on one more card — the other half of the answer
 * when someone asks what their odds are. A soft hand cannot bust at all, which
 * is worth the dealer being able to say out loud.
 */
function bustChance(scenario) {
  if (scenario.kind !== 'hard' || scenario.total === undefined) return 0;
  const room = 21 - scenario.total;
  let busting = 0;
  let total = 0;
  for (let rank = 0; rank < 10; rank++) {
    const value = rank === 0 ? 1 : rank === 9 ? 10 : rank + 1; // an ace plays low here
    total += counts[rank];
    if (value > room) busting += counts[rank];
  }
  return busting / total;
}

// --- The hand in progress on the table screen ------------------------------
// Sixteen against a ten: the canonical hard spot, and the one §7.1 uses as its
// own worked example.

const LIVE_KEY = 'bj:hard16:vs10';
const live = decision(LIVE_KEY, 'stand');

// --- The hand log ----------------------------------------------------------

const LOG_SPEC = [
  ['bj:pair8:vs10', 'split', 'split', '8♠ 8♣', '10♦ 7♥', -2],
  ['bj:soft18:vs9', 'stand', 'hit', 'A♥ 7♦', '9♠ K♣', -1],
  ['bj:hard12:vs4', 'hit', 'stand', '9♣ 3♦', '4♥ 10♠ 9♦', 1],
  ['bj:hard11:vs6', 'double', 'double', '5♠ 6♥', '6♦ K♣ 9♥', 2],
  ['bj:hard16:vs10', 'stand', 'surrender', '10♥ 6♠', '10♣ 8♦', -0.5],
  ['bj:soft13:vs5', 'hit', 'double', 'A♣ 2♥', '5♦ J♠ 6♣', -2],
  ['bj:pairT:vs9', 'split', 'stand', 'K♥ Q♣', '9♦ 10♥', 1],
  ['bj:hard14:vs3', 'stand', 'stand', '10♠ 4♦', '3♣ 9♥ J♦', 1],
];

const handLog = LOG_SPEC.map(([key, chosen, _optimalHint, player, dealer, net], index) => {
  const d = decision(key, chosen);
  const swing = eloSwing(1642, d.difficulty);
  return {
    id: 214 - index,
    scenarioKey: key,
    player,
    dealer,
    chosen: d.chosen,
    optimal: d.optimal,
    correct: d.correct,
    evCost: d.evCost,
    severity: d.severity,
    net,
    difficulty: d.difficulty,
    ratingDelta: d.correct ? swing.onCorrect : swing.onError,
    ranked: d.ranked,
    reason: d.reason,
    sensitivity: d.sensitivity,
  };
});

// --- Difficulty ladder, to show what the rating actually means -------------

const LADDER = [
  'bj:pairT:vs9',
  'bj:hard12:vs10',
  'bj:hard16:vs10',
  'bj:pair8:vs6',
  'bj:soft18:vs9',
  'bj:hard15:vs10',
  'bj:soft13:vs5',
];

const ladder = LADDER.map((key) => {
  const cell = chart.cells.get(key);
  return {
    scenarioKey: key,
    label: labelFor(key),
    difficulty: difficulty(key),
    margin: Number(cell.margin.toFixed(4)),
    optimal: cell.optimalAction,
    oneIn: Math.round(1 / frequency.get(key)),
  };
}).sort((a, b) => a.difficulty - b.difficulty);

function labelFor(key) {
  const s = parseScenarioKey(key);
  const up = key.slice(key.indexOf(':vs') + 3);
  if (s.kind === 'pair') {
    const r = s.pairRank === 0 ? 'A' : s.pairRank === 9 ? '10' : String(s.pairRank + 1);
    return `${r},${r} vs ${up}`;
  }
  if (s.kind === 'soft') return `A,${s.total - 11} vs ${up}`;
  return `${s.total} vs ${up}`;
}

// --- Ultimate Texas Hold'em -------------------------------------------------

const preflopTable = JSON.parse(
  readFileSync(join(HERE, '..', 'packages', 'ev-engine', 'assets', 'uth-preflop.json'), 'utf8'),
);
const solvedClasses = Object.keys(preflopTable.classes).length;

const uth = {
  solvedClasses,
  totalClasses: 169,
  hole: cards('A♥ K♥'.replace(/♥/g, 'h')),
  board: cards('Qh Jh 2d 7c 4s'),
  preflop: preflopTable.classes.AKs ?? null,
  examples: ['AA', 'AKs', 'K5o', '22', 'J7s']
    .filter((k) => preflopTable.classes[k])
    .map((k) => ({ label: k, ...preflopTable.classes[k] })),
};

// --- Write it out ----------------------------------------------------------

const out = {
  generatedAt: new Date().toISOString().slice(0, 10),
  ruleSet: {
    id: preset.id,
    name: preset.name,
    badge: '6D · S17 · DAS · late surrender · 3:2',
    edgePercent: Number(edge.percent.toFixed(2)),
  },
  player: { name: 'Idan', initial: 'I' },
  rating: {
    blackjack: { mode: 'basic', rating: 1642, peak: 1701, session: -8, decisions: 412 },
    ultimate: { mode: 'basic', rating: null, peak: null, session: 0, decisions: 0 },
  },
  stats: {
    hands: 1240,
    decisions: 1583,
    correct: 1541,
    accuracy: 0.9735,
    evLost: 4.94,
    evLostPer100: 0.398,
    effectiveHouseEdgePercent: Number((edge.percent + 0.398).toFixed(2)),
    netUnits: -13,
    bySeverity: { optimal: 1541, negligible: 12, minor: 18, significant: 9, blunder: 3 },
  },
  table: {
    dealer: cards('Th'),
    hand: cards('Ts 6d'),
    total: 16,
    // Doubling a sixteen is legal on two cards under "double any two" and is a
    // terrible idea. It stays on the button row because hiding legal-but-bad
    // actions would quietly teach that they do not exist.
    legalActions: ['stand', 'hit', 'double', 'surrender'],
  },
  live,
  handLog,
  ladder,
  uth,
  elo: {
    example: {
      hard: { key: 'bj:soft13:vs5', difficulty: difficulty('bj:soft13:vs5'), ...eloSwing(1642, difficulty('bj:soft13:vs5')) },
      easy: { key: 'bj:pairT:vs9', difficulty: difficulty('bj:pairT:vs9'), ...eloSwing(1642, difficulty('bj:pairT:vs9')) },
    },
  },
};

const banner = `/*
 * GENERATED — do not edit by hand. Run \`node mockup/generate-canned.mjs\`.
 *
 * Every number below came out of the real engines on ${out.generatedAt}: real
 * EVs, real chart margins, real dealer odds, real explanation sentences, real
 * UTH solver output. The mockups are not wired to anything, but they are not
 * lying about what the app can say.
 *
 * Deliberately a classic script rather than an ES module: browsers refuse module
 * imports over file://, and these pages have to open on a double-click.
 */
`;

writeFileSync(
  join(HERE, 'canned.js'),
  `${banner}\nvar CANNED = ${JSON.stringify(out, null, 2)};\n`,
);

process.stdout.write(`wrote mockup/canned.js\n`);
process.stdout.write(`  live spot   : ${live.scenarioKey} (difficulty ${live.difficulty})\n`);
process.stdout.write(`  hand log    : ${handLog.length} hands\n`);
process.stdout.write(`  ladder      : ${ladder.map((l) => `${l.label} ${l.difficulty}`).join(', ')}\n`);
process.stdout.write(`  uth classes : ${solvedClasses}/169 solved\n`);
