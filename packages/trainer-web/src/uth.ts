/**
 * Ultimate Texas Hold'em preview (spec §5.2, §6.3).
 *
 * Read-only. The solvers are finished and exact, but there is no UTH state
 * machine yet — no dealing, no street progression, no settlement — so this deals
 * a hand from a shuffled deck and asks the solvers what they make of it at each
 * decision point. Nothing is wagered and nothing is graded.
 *
 * The river and flop are solved live, because both are fast enough: 990 dealer
 * holdings and 1,070,190 outcomes respectively. Pre-flop is a table lookup,
 * because solving it live is 2.1 billion outcomes per hole-card class.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  fullDeck,
  formatCard,
  rankOf,
  suitOf,
  uth,
  type Card,
} from '@evtrainer/ev-engine';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSET = join(HERE, '..', '..', 'ev-engine', 'assets', 'uth-preflop.json');

interface PreflopAsset {
  classes: Record<string, { ev4x: number; ev3x: number; evCheck: number; optimalAction: string; margin: number }>;
}

let preflop: PreflopAsset | null = null;
function preflopTable(): PreflopAsset {
  // Re-read each time: the offline job may still be filling it in, and a preview
  // that quietly shows a stale count is worse than one that costs a file read.
  preflop = JSON.parse(readFileSync(ASSET, 'utf8')) as PreflopAsset;
  return preflop;
}

const RANKS = '23456789TJQKA';
const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'];

function cardView(card: Card) {
  const suit = suitOf(card);
  const rank = RANKS[rankOf(card)]!;
  return {
    rank: rank === 'T' ? '10' : rank,
    suit: SUIT_SYMBOLS[suit]!,
    red: suit === 1 || suit === 2,
    label: formatCard(card),
  };
}

/** The 169-class label for two hole cards: AKs, AKo, AA. */
function holeClassLabel(a: Card, b: Card): string {
  const high = Math.max(rankOf(a), rankOf(b));
  const low = Math.min(rankOf(a), rankOf(b));
  const label = `${RANKS[high]}${RANKS[low]}`;
  if (high === low) return label;
  return label + (suitOf(a) === suitOf(b) ? 's' : 'o');
}

export function uthPreview(): unknown {
  const deck = fullDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }

  const hole = [deck[0]!, deck[1]!];
  const board = [deck[2]!, deck[3]!, deck[4]!, deck[5]!, deck[6]!];
  const paytable = uth.DEFAULT_BLIND_PAYTABLE;

  const table = preflopTable();
  const label = holeClassLabel(hole[0]!, hole[1]!);
  const preflopRow = table.classes[label] ?? null;

  const flop = uth.solveFlop(hole, board.slice(0, 3), paytable);
  const river = uth.solveRiver(hole, board, paytable);
  const trips = uth.analyseTrips(uth.TRIPS_PAYTABLES[0]!);

  return {
    solvedClasses: Object.keys(table.classes).length,
    totalClasses: 169,
    hole: hole.map(cardView),
    board: board.map(cardView),
    holeClass: label,
    preflop: preflopRow,
    flop: {
      evPlay: flop.evPlay,
      evCheck: flop.evCheck,
      optimalAction: flop.optimalAction,
      outcomes: flop.outcomes,
      riverFoldFrequency: flop.riverFoldFrequency,
    },
    river: {
      evPlay: river.evPlay,
      evFold: river.evFold,
      optimalAction: river.optimalAction,
      wins: river.wins,
      ties: river.ties,
      losses: river.losses,
    },
    trips: {
      name: trips.paytable.name,
      housePercent: trips.houseEdgePercent,
      winProbability: trips.winProbability,
      verdict: uth.describeTrips(trips.paytable),
    },
  };
}
