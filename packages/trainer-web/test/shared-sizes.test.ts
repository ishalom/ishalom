/**
 * Every size of table, 2 to 6 seats, in both games (round 34, item 8).
 *
 * Tables are now opened without saying how many will play, and seats fill as
 * people arrive — so the checks the two-seat tests make are made again at every
 * size, with players arriving and leaving mid-table:
 *
 *   - the same seed and the same decisions give the same cards and the same
 *     board, and every seat's checksum agrees;
 *   - each seat is graded exactly as the solo engine grades the same cards.
 *
 * Nobody has yet seen six seats on a real phone; these are the tests' six.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bjRankOfCard } from '@evtrainer/ev-engine';
import { makeRng, UthTable, type UthAction } from '@evtrainer/game-engine';

import { analyse } from '../src/analyse.ts';
import {
  deriveTable,
  isLive,
  playTable,
  seatCardsHash,
  seatsAgree,
  type SeatMove,
  type TableEvent,
  type TableRecord,
} from '../src/shared-table.ts';
import { playUthTable, UTH_PRESET_ID } from '../src/shared-uth.ts';

const SIZES = [2, 3, 4, 5, 6];

/**
 * A table of `size` seats that fills as people arrive: seats 0 and 1 from the
 * first hand, each later seat one hand after the one before it. Seat 1 leaves
 * at hand 3 and comes back at hand 5; the last seat, when there are three or
 * more, leaves at hand 6 for good.
 */
function arriving(seed: number, size: number, presetId: string): TableRecord {
  return {
    id: `s${size}-${seed}`,
    seed,
    presetId,
    restrictions: { noSurrender: false, likeRanksOnly: false },
    seats: Array.from({ length: size }, (_, seat) => {
      const events: TableEvent[] = [{ kind: 'join', seat, hand: Math.max(0, seat - 1) }];
      if (seat === 1) events.push({ kind: 'drop', seat, hand: 3, why: 'left' }, { kind: 'return', seat, hand: 5 });
      if (size >= 3 && seat === size - 1) events.push({ kind: 'drop', seat, hand: 6, why: 'left' });
      return { seat, playerId: `p${seat}`, name: `P${seat}`, bet: 1 + (seat % 3), moves: [] as SeatMove[], events };
    }),
  };
}

const copyOf = (record: TableRecord) => JSON.parse(JSON.stringify(record)) as TableRecord;

/** What two derivations must agree on: every card, the board, every net, every grade. */
const shapeOf = (table: ReturnType<typeof deriveTable>) =>
  table.hands.map((hand) => ({
    hand: hand.hand,
    dealer: hand.dealer,
    board: hand.uth ? hand.uth.board : null,
    seats: hand.seats.map((seat) => [seat.seat, seat.cards, seat.net]),
    decisions: hand.decisions.map((d) => [d.seat, d.round, d.action, d.evCost]),
  }));

/** Every seat writes its checksum, and the table agrees with all of them. */
function assertAgrees(record: TableRecord, table: ReturnType<typeof deriveTable>, where: string) {
  const stamped = { ...record, seats: record.seats.map((seat) => ({ ...seat, cardsHash: seatCardsHash(table, seat.seat) })) };
  assert.ok(seatsAgree(stamped, table), `${where}: the seats' checksums disagree`);
}

/** The arrivals and departures happened: who was dealt into which hand follows the events. */
function assertLiveByEvents(record: TableRecord, table: ReturnType<typeof deriveTable>, where: string) {
  for (const hand of table.hands) {
    const dealt = hand.seats.map((seat) => seat.seat).sort();
    const live = record.seats.filter((seat) => isLive(record, seat.seat, hand.hand)).map((seat) => seat.seat).sort();
    assert.deepEqual(dealt, live, `${where}: hand ${hand.hand} dealt ${dealt} but ${live} were at the table`);
  }
}

// --- Blackjack -----------------------------------------------------------------------------------

test('Blackjack at 2 to 6 seats, filling and emptying: the same cards every time, and every seat agrees', () => {
  for (const size of SIZES) {
    for (let seed = 1; seed <= 4; seed++) {
      const record = arriving(seed * 13 + size, size, 'vegas-strip-6d-s17');
      const rng = makeRng(seed * 7 + size);
      const played = playTable(record, 9, ({ legal }) => legal[rng.nextInt(legal.length)] as SeatMove['action']);
      const where = `Blackjack, ${size} seats, seed ${seed}`;
      assert.deepEqual(shapeOf(deriveTable(copyOf(record))), shapeOf(played), `${where}: derived differently`);
      assertAgrees(record, played, where);
      assertLiveByEvents(record, played, where);
    }
  }
});

test('Blackjack at 2 to 6 seats: each seat is graded exactly as the same cards are graded alone', () => {
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
  const rankOf = (card: number) => RANKS[bjRankOfCard(card)]!;
  /*
   * The analyser solves each question from scratch, which is most of this
   * test's time: the same hand against the same upcard is asked once, and each
   * size stops at 25 decisions compared.
   */
  const asked = new Map<string, { ok: boolean; ranked?: Array<{ action: string; ev: number }> }>();
  for (const size of SIZES) {
    let compared = 0;
    for (let seed = 1; seed <= 3 && compared < 25; seed++) {
      const record = arriving(seed * 31 + size, size, 'vegas-strip-6d-s17');
      const rng = makeRng(seed + size);
      const table = playTable(record, 8, ({ legal }) => legal[rng.nextInt(legal.length)] as SeatMove['action']);
      for (const hand of table.hands) {
        for (const decision of hand.decisions) {
          // Insurance is asked elsewhere; split hands are a different hand from the same two cards fresh.
          if (decision.round < 0 || decision.fromSplit || decision.handCount > 1 || decision.cards.length > 4) continue;
          if (compared >= 25) break;
          const player = decision.cards.map(rankOf);
          const key = `${player.join(',')}|${rankOf(decision.upcard)}`;
          const answer =
            asked.get(key) ??
            (analyse({ player, dealer: rankOf(decision.upcard), presetId: 'vegas-strip-6d-s17', locale: 'en' }) as {
              ok: boolean;
              ranked?: Array<{ action: string; ev: number }>;
            });
          asked.set(key, answer);
          if (!answer.ok || !answer.ranked) continue;
          for (const row of answer.ranked) {
            const mine = decision.evByAction[row.action];
            if (mine === undefined) continue;
            assert.ok(Math.abs(mine - row.ev) < 1e-9, `${size} seats: ${row.action} graded ${mine} here, ${row.ev} alone`);
          }
          assert.equal(decision.optimalAction, answer.ranked[0]!.action, `${size} seats: a different best play`);
          compared++;
        }
      }
    }
    assert.ok(compared >= 20, `${size} seats: only ${compared} decisions compared`);
  }
});

// --- Ultimate ------------------------------------------------------------------------------------

/** Mostly the pre-flop raise, which is a lookup, so six seats stay quick; every street still comes up. */
function playUth(record: TableRecord, hands: number, seed: number) {
  const rng = makeRng(seed);
  return playUthTable(record, hands, ({ legal }) => {
    if (legal.includes('raise4x') && rng.nextInt(10) < 6) return 'raise4x';
    return legal[rng.nextInt(legal.length)] as SeatMove['action'];
  });
}

test('Ultimate at 2 to 6 seats, filling and emptying: the same cards and board every time, and every seat agrees', () => {
  for (const size of SIZES) {
    for (let seed = 1; seed <= 3; seed++) {
      const record = arriving(seed * 17 + size, size, UTH_PRESET_ID);
      const played = playUth(record, 9, seed * 5 + size);
      const where = `Ultimate, ${size} seats, seed ${seed}`;
      assert.deepEqual(shapeOf(deriveTable(copyOf(record))), shapeOf(played), `${where}: derived differently`);
      assertAgrees(record, played, where);
      assertLiveByEvents(record, played, where);
      for (const hand of played.hands) {
        const all = [...hand.dealer, ...hand.uth!.board, ...hand.seats.flatMap((seat) => seat.cards)];
        assert.equal(new Set(all).size, all.length, `${where}: hand ${hand.hand} dealt a card twice`);
      }
    }
  }
});

test('Ultimate at 2 to 6 seats: each seat is graded and settled exactly as the solo engine does it', () => {
  for (const size of SIZES) {
    let compared = 0;
    const record = arriving(size * 101, size, UTH_PRESET_ID);
    const table = playUth(record, 8, size * 3);
    for (const hand of table.hands) {
      for (const seatHand of hand.seats) {
        const mine = hand.decisions.filter((d) => d.seat === seatHand.seat);
        if (mine.length === 0) continue;
        // The solo engine, stacked with this seat's nine cards and played the same way.
        const solo = new UthTable({ seed: 1 });
        solo.stackNextHand([...seatHand.cards, ...hand.dealer, ...hand.uth!.board]);
        solo.startHand();
        for (const decision of mine) {
          const graded = solo.act(decision.action as UthAction);
          assert.deepEqual(decision.evByAction, graded.evByAction, `${size} seats, hand ${hand.hand}: different figures`);
          assert.equal(decision.optimalAction, graded.optimalAction);
          assert.equal(decision.evCost, graded.evCost);
          compared++;
        }
        const bet = record.seats.find((seat) => seat.seat === seatHand.seat)!.bet;
        assert.equal(seatHand.net, solo.view.netUnits! * bet, `${size} seats, hand ${hand.hand}: settled differently`);
      }
    }
    assert.ok(compared >= 12, `${size} seats: only ${compared} decisions compared`);
  }
});
