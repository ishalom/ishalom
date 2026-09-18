/**
 * "I pressed an insurance button and the hand skipped to the next one" (round 7).
 *
 * Reproduced on the built page with real taps, and it was two bugs:
 *
 *   1. A hand that ends on the insurance answer — the dealer's blackjack, or the
 *      player's own — ended with the reasoning walkthrough still open. The dock
 *      already offered Deal, the dealer's card was still face down, and the
 *      walkthrough's Next sat below the fold on a phone. Nothing on screen said
 *      why the hand was over, and the one button in reach dealt the next.
 *   2. A quick second tap landed on whatever had just replaced the button under
 *      the finger: Stand where Decline was, Hit where Take was, Deal where Take
 *      was when the hand had ended. The same was true on the Ultimate table.
 *
 * These drive the page's own buttons, the way a click reaches them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { catalogue } from '../src/i18n.ts';
import { loadHosted, type HostedPage } from './helpers/hosted-page.ts';

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/*
 * The dock's hold, on a clock this test controls (round 12).
 *
 * The hold is 450 ms of wall clock in a browser, and waiting it out here made
 * the test a measure of how busy the machine was: it failed once in a full run
 * with a browser probe alongside it, and passed alone seconds later. So the page
 * is handed a clock that only moves when `pastTheHold()` says so — the hold is
 * then exactly the hold, on any machine.
 */
let fakeNow = 0;

function holdOnOurClock(page: HostedPage): void {
  fakeNow = 0;
  const dock = (globalThis as { EVDock?: { useClock: (fn: () => number) => void } }).EVDock;
  assert.ok(dock?.useClock, 'the page has no dock to hold the buttons');
  dock.useClock(() => fakeNow);
  void page;
}

/** Move past the hold without waiting for anything. */
const pastTheHold = () => {
  fakeNow += 520;
};

function buttons(page: HostedPage, bar: string): any[] {
  const box = page.document.getElementById(bar);
  return box.children.flatMap((row: any) => row.children ?? []).filter((node: any) => node.dataset?.action);
}

function actionsIn(page: HostedPage, bar: string): string[] {
  return buttons(page, bar).map((node) => node.dataset.action);
}

async function press(page: HostedPage, bar: string, action: string): Promise<void> {
  const node = buttons(page, bar).find((b) => b.dataset.action === action);
  assert.ok(node, `no ${action} button; the bar holds ${actionsIn(page, bar).join(',')}`);
  for (const handler of node.listeners.click ?? []) handler({ preventDefault() {} });
  for (let i = 0; i < 10; i++) await settle();
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await settle(5);
  assert.ok(check(), what);
}

async function openTable(stack: string): Promise<HostedPage> {
  const page = loadHosted('#table', [['ev:playerName', 'Dana'], ['ev:showAll', '0']]);
  await page.booted;
  holdOnOurClock(page);
  await until(() => actionsIn(page, 'actions').includes('deal'), 'the table never offered Deal');
  pastTheHold();
  page.session().table.shoe.stack(page.parseCards(stack));
  await press(page, 'actions', 'deal');
  await until(() => page.session().view.phase === 'insurance', 'insurance was not offered');
  pastTheHold();
  return page;
}

test('a hand that ends on the insurance answer shows why before it offers the next hand', async () => {
  // You 9-7 against an ace with a king under it: whichever you answer, the hand is over.
  const page = await openTable('9s As 7d Kc');
  await press(page, 'actions', 'declineInsurance');
  assert.equal(page.session().view.phase, 'settled');

  const offered = actionsIn(page, 'actions');
  assert.ok(!offered.includes('deal'), `Deal was offered before the hand showed how it ended: ${offered.join(',')}`);
  assert.ok(!offered.some((a) => a.startsWith('chip-') || a === 'bet-open'), 'the chips were offered before the hand showed how it ended');
  assert.deepEqual(offered, ['reveal-next'], 'the walkthrough cannot be reached from the dock');

  // Stepping through reaches the end of the hand, and the dealer names her blackjack.
  // The dock has just changed, so a press only counts after the hold.
  pastTheHold();
  await press(page, 'actions', 'reveal-next');
  await press(page, 'actions', 'reveal-next');
  await until(() => actionsIn(page, 'actions').includes('deal'), 'Deal never came back');
  const said = page.document.getElementById('table-talk').textContent;
  assert.equal(said, catalogue('en')['dealer.dealerNatural'], 'the screen does not say the dealer had blackjack');
  page.stopWatching();
});

test('a second tap straight after the insurance answer does not play the button that replaced it', async () => {
  // No blackjack behind the ace: the hand goes on, with Hit and Stand where the insurance buttons were.
  const page = await openTable('9s As 7d 9c 5h 8d 4c');
  await press(page, 'actions', 'declineInsurance');
  assert.equal(page.session().view.phase, 'player');

  await press(page, 'actions', 'stand');
  assert.equal(page.session().view.phase, 'player', 'a Stand arriving with the Decline tap ended the hand');

  // A deliberate press a moment later still plays.
  pastTheHold();
  await press(page, 'actions', 'stand');
  assert.equal(page.session().view.phase, 'settled', 'a deliberate Stand was ignored');
  page.stopWatching();
});

test('a second tap straight after the last decision does not deal the next Ultimate hand', async () => {
  const page = loadHosted('#ultimate', [['ev:playerName', 'Dana']]);
  await page.booted;
  holdOnOurClock(page);
  await until(() => actionsIn(page, 'uth-actions').includes('deal'), 'Ultimate never offered Deal');
  pastTheHold();
  page.uthSession().table.stackNextHand(page.parseCards('7s 2d As Ad Qs Jh 3d 8c 5s'));
  await press(page, 'uth-actions', 'deal');
  await until(() => actionsIn(page, 'uth-actions').includes('check'), 'no pre-flop decision');
  pastTheHold();
  await press(page, 'uth-actions', 'check');
  await until(() => actionsIn(page, 'uth-actions').includes('raise2x'), 'no flop decision');
  pastTheHold();
  await press(page, 'uth-actions', 'check');
  await until(() => actionsIn(page, 'uth-actions').includes('raise1x'), 'no river decision');
  pastTheHold();
  await press(page, 'uth-actions', 'raise1x');
  assert.equal(page.uthSession().view.phase, 'settled');
  const hands = page.uthSession().stats.hands;

  await press(page, 'uth-actions', 'deal');
  assert.equal(page.uthSession().view.phase, 'settled', 'the second tap dealt a new hand');
  assert.equal(page.uthSession().stats.hands, hands);

  pastTheHold();
  await press(page, 'uth-actions', 'deal');
  assert.equal(page.uthSession().view.phase, 'preflop', 'a deliberate Next hand was ignored');
  page.stopWatching();
});
