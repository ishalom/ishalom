/**
 * Languages.
 *
 * The hard part is not the chrome — it is that the dealer's reasoning is
 * *generated*, not written. `explain.ts` assembles each sentence from the
 * engine's numbers, so translating it means translating the templates, not a
 * list of finished strings.
 *
 * So messages are keys with parameters, and each locale owns its own phrasing.
 * A locale is free to put the numbers in a different order, or to need a word
 * the other does not, because it holds the whole sentence rather than a
 * fragment of one.
 *
 * Hebrew is right-to-left, which is a layout question as much as a language
 * one — see `dir` below and the logical properties in styles.css.
 */

export type Locale = 'en' | 'he';

export interface LocaleInfo {
  code: Locale;
  /** The language's own name for itself, which is what a picker should show. */
  name: string;
  dir: 'ltr' | 'rtl';
}

export const LOCALES: readonly LocaleInfo[] = [
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'he', name: 'עברית', dir: 'rtl' },
];

export function localeInfo(code: Locale): LocaleInfo {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0]!;
}

export type Params = Record<string, string | number>;

/**
 * Render a message.
 *
 * `{name}` is substituted; `**word**` survives for the client to render as
 * emphasis. A missing key returns the key itself rather than throwing — a
 * half-translated screen is bad, a blank one is worse.
 */
export function t(locale: Locale, key: string, params: Params = {}): string {
  const table = MESSAGES[locale] ?? MESSAGES.en;
  const template = table[key] ?? MESSAGES.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    params[name] === undefined ? `{${name}}` : String(params[name]),
  );
}

type Catalogue = Record<string, string>;

/**
 * Hebrew note: gambling vocabulary in Israel is a mix of Hebrew and
 * transliterated English. The terms used here are the ones players actually
 * say — נשרף for a bust, תיקו for a push, דילר for the dealer — rather than
 * stricter coinages nobody uses at a table.
 */
const EN: Catalogue = {
  // --- Actions ---
  'action.hit': 'Hit',
  'action.stand': 'Stand',
  'action.double': 'Double',
  'action.split': 'Split',
  'action.surrender': 'Surrender',
  'action.hitting': 'hitting',
  'action.standing': 'standing',
  'action.doubling': 'doubling',
  'action.splitting': 'splitting',
  'action.surrendering': 'surrendering',
  'action.takeInsurance': 'Take insurance',
  'action.declineInsurance': 'Decline insurance',
  'verbTo.hit': 'hit',
  'verbTo.stand': 'stand',
  'verbTo.double': 'double',
  'verbTo.split': 'split',
  'verbTo.surrender': 'surrender',
  'verbTo.takeInsurance': 'take insurance',
  'verbTo.declineInsurance': 'decline it',

  // --- Upcards ---
  'upcard.ace': 'an ace',
  'upcard.ten': 'a ten',
  'upcard.number': 'a {rank}',
  'upcard.numberAn': 'an {rank}',

  // --- Step 1: read the dealer ---
  'dealer.bust': '{up}{worst} — a **bust card**. Breaks {bust} of the time.',
  'dealer.worst': ', their worst',
  'dealer.ace': 'An ace, and **no blackjack** behind it. The dealer still breaks only {bust} of the time.',
  'dealer.strong': '{up} — **strong**. Breaks {bust} of the time, and makes 17+ the other {made}.',

  // --- Step 2: read your hand ---
  'hand.insurance':
    'Insurance rides on **the dealer’s hole card**, not your hand. Four of the thirteen ranks are worth ten, so the hole card is a ten in about {tens} of cases — and at 2:1 the bet needs {breakEven} just to break even.',
  'hand.aces': 'A,A — the **best pair in the deck**. Held together the second ace is dead weight.',
  'hand.eights': '8,8 — **sixteen**, the worst total there is. Splitting is an **escape**, not an attack.',
  'hand.splitDas': '{pair} — a small pair. Each half wants to draw then **double**, so this one rides on the double-after-split rule.',
  'hand.splitOffensive': '{pair} — fine as one hand. Splitting is an **attack**.',
  'hand.splitDefensive': '{pair} — as one hand it wins only when the dealer breaks. Apart, each card **starts again** somewhere better.',
  'hand.pairNever': '{pair} — a pair worth **keeping**. Apart it is two weaker hands.',
  'hand.stiff': '{total} — a **stiff**. Standing never wins it; drawing breaks it {bust} of the time. No good answer, only a **cheaper** one.',
  'hand.doubling': '{total} — **cannot break** on one card, and every ten makes it a real hand.',
  'hand.softDraw': 'Soft {total} — the ace protects you. **Nothing you draw can break it**.',
  'hand.softMade': 'Soft {total} — already good, and **free to improve**. The question is whether it is worth it.',
  'hand.pat': "{total} — **pat**. It wins what it wins; the rest is the dealer's business.",
  'hand.small': '{total} — too small to stand, too small to double. **Not finished.**',

  // --- How decisive the call is ---
  'gap.only': 'the only play',
  'gap.notClose': '**well clear** of the next best',
  'gap.right': '**closer to the next best** than it looks',
  'gap.narrow': 'a **narrow** win over the next best',
  'gap.coinflip': 'a **coin-flip** with the next best; either is defensible',

  // --- Step 3: the supporting figure ---
  'stat.softDraw': 'The draw is free — and against {up}, what you have is not enough.',
  'stat.standWins': 'Standing wins {win} of the time and loses {lose}. Little beats it.',
  'stat.standBadPat': 'Standing still loses {lose} of the time — **bad, just less bad** than the rest.',
  'stat.standBreaks': 'Standing only wins when the dealer breaks, and the dealer breaks {bust} of the time.',
  'stat.hitVsSurrender': 'Drawing breaks it {bust} of the time on the very next card.',
  'stat.insurance':
    'That gap looks small only because it is measured against your main bet, and insurance stakes half of one. Of the money you actually put up, it gives away **{pct}** — every single time.',
  'stat.double': 'Same card as hitting, **twice the stake**, no second draw — and one card is usually enough here.',
  'stat.doubleTooThin':
    'Doubling buys **one card and no more**. Here that card leaves you under seventeen {stiff} of the time — stuck standing on a hand you would still want to draw to, for twice the money.',
  'stat.splitGains': 'Two hands are worth {gap} more than one.',
  'stat.splitCosts': 'Splitting costs {gap} — one good total becomes two worse ones.',
  'stat.surrender': 'Half back is a guaranteed {half}; played out, this is worth less.',

  // --- Step 3 assembled ---
  'combined': '**{verdict}** — {shape}. {numbers}. {stat}',
  'combined.numbers': 'returns {best} against {runnerUp} to {runnerUpVerb}',
  'combined.numbersOnly': 'returns {best}',
  'headline': '{hand} vs {up} → {verdict}',
  'headline.insurance': 'Insurance → {verdict}',
  'insurance.step1': 'Dealer shows an ace, so insurance is on offer. It is a bet on the hole card and nothing else.',
  'insurance.counterNote':
    'For the record: the cards already dealt left this shoe ten-rich enough that a card counter would have insured here. You are graded on basic strategy, which never insures, so this changed nothing — it is not a skill the trainer teaches yet.',

  // --- Home ---
  'ui.appName': 'EV Trainer',
  'ui.yourName': 'Your name',
  'ui.defaultName': 'Player',
  'ui.greeting': 'Good to see you.',
  'ui.blackjack': 'Blackjack',
  'ui.ultimate': 'Ultimate',
  'ui.playAHand': 'Play a hand',
  'ui.lookAround': 'Look around',
  'ui.preview': 'preview',
  'ui.yourPlay': 'Your play',
  'ui.tab.standing': 'Standing',
  'ui.tab.hands': 'Hands',
  'ui.tab.stats': 'Stats',
  'ui.rating': 'Blackjack rating',
  'ui.drilledOn': 'What you are drilled on',
  'ui.mode.basic': 'Basic',
  'ui.mode.basicNote': 'the costly hands',
  'ui.mode.recall': 'Recall',
  'ui.mode.recallNote': 'thin and rare',
  'ui.mode.value': 'Value',
  'ui.mode.valueNote': 'your own leaks',
  'ui.language': 'Language',
  'ui.font': 'Font',
  'ui.home': 'Home',

  // --- Table ---
  'ui.dealer': 'Dealer',
  'ui.you': 'You',
  'ui.deal': 'Deal',
  'ui.nextHand': 'Next hand',
  'ui.accuracy': 'Accuracy',
  'ui.hands': 'Hands',
  'ui.streak': 'Streak',
  'ui.cost': 'Cost',
  'ui.insurance': 'Insurance',
  'ui.takeInsurance': 'Take',
  'ui.declineInsurance': 'No thanks',
  'ui.showAll': 'Show all',
  'ui.next': 'Next',
  'ui.step': 'Step {n} of {total}',
  'ui.readDealer': 'Read the dealer',
  'ui.readHand': 'Read your hand',
  'ui.combine': 'Put them together',
  'ui.youPlayed': 'You played {action}',
  'ui.bestWas': 'Best was {action}',
  'ui.noHandsYet': 'No hands yet.',
  'ui.playedNothing': 'Play a hand and it shows up here.',
  'ui.win': 'Win',
  'ui.loss': 'Loss',
  'ui.push': 'Push',
  'ui.blackjackResult': 'Blackjack',
  'ui.bust': 'Bust',
  'ui.rules': 'Rules',
  'ui.change': 'change',
  'ui.askDealer': 'Ask the dealer',

  // --- Ultimate ---
  'ui.ultimateTitle': 'Ultimate Texas Hold’em',
  'ui.solverPreview': 'Solver preview',

  // --- The dealer at the table (§7: asked, not lectured) ---
  'coach.q.odds': 'My odds?',
  'coach.a.odds': 'I break {bust}% of the time showing this, and finish with 17 or better the other {made}%.',
  'coach.a.oddsYouBreak': 'You break {bust}% of the time if you take a card.',
  'coach.a.oddsNoBreak': 'You cannot break at all on the next card — that ace protects you.',
  'coach.q.close': 'Is this close?',
  'coach.a.closeVery': 'Very. The two best plays here are within a hundredth of a unit — this one is nearly a coin-flip.',
  'coach.a.closeSome': 'Closer than it looks. About {spread} of a unit between the top two.',
  'coach.a.closeNot': 'There is {spread} of a unit between the best play and the next one. Not really.',
  'coach.insurance.prompt': 'Ace up. Insurance is open — but it is a bet on my hole card, not on your hand.',
  'coach.insurance.odds':
    'Four of the thirteen ranks are worth ten, so the hole card is a ten in about {tens} of cases. At 2:1 the bet needs {breakEven} to break even, so it loses money every time it is made. Your own cards have nothing to do with it.',
  'coach.prompt.pair': 'A pair. You can break that up if you want it.',
  'coach.prompt.few': '{label}. Not much to choose from — what’ll it be?',
  'coach.prompt.open': '{label} against my card. Your call.',
  'label.pair': 'A pair',
  'label.soft': 'Soft {total}',
  'label.hard': '{total}',
  'log.vs': 'vs',
  'log.right': '{headline} · played it right',
  'log.played': '{headline} · you played {chosen}',
  'log.allRight': '{n} decisions · played them all right',
  'log.someOff': '{n} decisions · {bad} not the best play',
  'log.playerNatural': 'blackjack — nothing to decide',
  'log.dealerNatural': 'dealer blackjack — the hand ended on the deal',
  'log.bothNaturals': 'blackjack both sides — a push on the deal',
  'log.noDecisions': 'nothing to decide',
  'label.insurance': 'Insurance',
  'label.vs': '{hand} vs {up}',

  // --- Table chrome ---
  'ui.blackjackTitle': 'EV Trainer — Blackjack',
  'ui.changeRuleSet': 'Change rule set',
  'ui.sessionStats': 'Session statistics',
  'ui.decisionAccuracy': 'decision accuracy',
  'ui.evLostPer100': 'EV lost / 100 hands',
  'ui.yourEdge': 'house edge you face',
  'ui.units': 'units',
  'ui.dealerName': 'Vera · dealer',
  'ui.takeSeat': 'Take a seat. Deal when you’re ready.',
  'ui.yourHand': 'Your hand',
  'ui.actions': 'Actions',
  'ui.pressDeal': 'Press Deal to start.',
  'ui.ruleSet': 'Rule set',
  'ui.ruleSetNote': 'Changing the rules starts a new session. The correct play changes with them, which is the point.',
  'ui.close': 'Close',
  'ui.basicStrategy': 'Basic strategy for these rules',
  'ui.chartNote': 'Derived from the EV computation, not copied from a chart.',
  'ui.legend': 'H hit · S stand · D double · P split · R surrender',
  'ui.strategyChart': 'Strategy chart',

  // --- Feedback card ---
  'fb.didNotDraw': 'Did not draw — you busted first. A dealer must keep drawing to 17.',
  'fb.optimal': 'Correct',
  'fb.negligible': 'Negligible',
  'fb.minor': 'Minor error',
  'fb.significant': 'Significant error',
  'fb.blunder': 'Blunder',
  'fb.correct': 'Correct — {action}',
  'fb.wrong': '{severity} — cost {cost} units',
  'fb.youChose': 'You chose {chosen}. Best is {best}.',
  'fb.closeCall': 'The top two are within a hundredth of a unit.',
  'fb.skipAlways': 'Skip to the answer, always',
  'fb.skipAlwaysHint': 'Remembered for every hand from now on. Change it back below the card.',
  'fb.walkMe': 'Walk me through it next time',
  'fb.skipNext': 'Skip to the answer next time',
  'fb.ruleSensitive': 'Rule-sensitive: {list}.',
  'fb.accuracyTip': 'Share of decisions played correctly, once coin-flips are set aside.',
  'fb.accuracyAll': 'Counting everything: {pct}%.',
  'fb.noCloseCalls': 'No close calls yet.',

  // --- What comes back to you: the decision block and its `?` (round 13) ---
  'ret.title': 'What comes back, per unit staked',
  'ret.helpAria': 'What do these figures mean?',
  'ret.helpClose': 'Close the explanation',
  'ret.same2': '{a} and {b} are worth the same here — they differ past the third decimal.',
  'ret.sameMany': '{list} are worth the same here — they differ past the third decimal.',
  'ret.helpWhat': 'Each figure is what **one unit already at risk comes back**, on average, if this spot were played over and over. **1.000 is break-even**: the stake comes back and nothing more.',
  'ret.helpFold': 'Folding is the one you can check without trusting anything: the Ante and the Blind are gone and **nothing comes back**, so it reads 0.000.',
  'ret.helpRiver': 'On the river nothing is estimated: your hand beats **{win}** of the dealer’s possible hands and ties {tie} of them, and the Ante, the Blind and the Play bet together come to {value}.',
  'ret.helpRaise': 'Raising has no single sum: the Play bet joins what is already at risk, and the engine plays your hand against every holding the dealer can have.',
  'ret.helpUthStake': 'Every figure here is per unit of the Ante and the Blind, the two bets already on the table. A raise adds the Play bet on top of them, and it is already inside the figure.',
  // --- One action, worked out, with this hand's own numbers (round 15) ---
  'work.stand': 'Choosing **{action}** wins when the dealer breaks, which is **{win}** of the time, and a win returns two units:',
  'work.stand.sum': '2 × {win} = {value}',
  'work.standPush': 'Choosing **{action}** wins **{win}** of the time and ties **{push}**. A win returns two units, a tie returns one:',
  'work.standPush.sum': '2 × {win} + {push} = {value}',
  'work.hit': 'Choosing **{action}** breaks the hand **{bust}** of the time, and then nothing comes back. The other **{survive}** you are holding a new hand, which comes back **{surviveValue}** on average — assuming the rest of it is played as well as it can be:',
  'work.hit.sum': '{survive} × {surviveValue} = {value}',
  'work.hitAlwaysBreaks': 'Choosing **{action}** breaks the hand every time from here, so nothing comes back:',
  'work.hitAlwaysBreaks.sum': '{value}',
  'work.double': 'Choosing **{action}** puts a second unit beside the first and takes exactly one card, standing on whatever it is. That hand comes back **{oneCard}** per unit — on two units now, less the one just put up:',
  'work.double.sum': '2 × {oneCard} − 1 = {value}',
  'work.split': 'Choosing **{action}** puts a second bet out and plays two hands. Each comes back **{perHand}** per unit, played on as well as it can be — on two units, less the one just put up:',
  'work.split.sum': '2 × {perHand} − 1 = {value}',
  'work.surrender': 'Choosing **{action}** gives up the hand and takes half the bet back, always. It is the one figure here that needs no arithmetic at all:',
  'work.surrender.sum': '{value}',
  'work.insurance': 'Insurance pays 2:1, so every unit on it comes back three when the hole card is a ten — which it is **{ten}** of the time:',
  'work.insurance.sum': '3 × {ten} = {value}',
  'work.decline': 'Declining puts nothing on the side bet, so there is nothing there to lose and nothing to come back:',
  'work.decline.sum': '{value}',
  // --- Ultimate's own worked lines (round 19) ---
  'work.uthRiverPlay': 'Every card is out, so nothing here is estimated. Against the **{outcomes}** hands the dealer can be holding you beat **{wins}**, tie {ties} and lose to {losses}. A win here pays **{winPay}** on average — the Play bet, the Ante when the dealer qualifies, and the Blind — and a loss costs **{losePay}**. The average of all that is added to the 1.000 the stake itself comes back as:',
  'work.uthRiverPlay.sum': '1 + ({wins} × {winPay} − {losses} × {losePay}) ÷ {outcomes} ÷ 2 = {value}',
  'work.uthFlopPlay': 'Choosing **{action}** plays this hand through every turn and river and against every hand the dealer can hold — **{outcomes}** endings in all. You finish ahead in **{wins}** of them, level in {ties} and behind in {losses}. Ahead pays **{winPay}** on average, behind costs **{losePay}**, and their average joins the 1.000 the stake comes back as:',
  'work.uthFlopPlay.sum': '1 + ({wins} × {winPay} − {losses} × {losePay}) ÷ {outcomes} ÷ 2 = {value}',
  'work.uthFlopCheck': 'Checking keeps the river decision, and the river is then played properly. Of the **{boards}** ways the turn and river can come, **{playBoards}** are worth betting — **{playValue}** on average — and on the other **{foldBoards}** the right move there is to fold for −2. Their average joins the 1.000 the stake comes back as:',
  'work.uthFlopCheck.sum': '1 + ({playBoards} × {playValue} + {foldBoards} × −2) ÷ {boards} ÷ 2 = {value}',
  'work.uthFold': 'Folding gives up the Ante and the Blind and takes back nothing, always. It is the one figure here that needs no arithmetic at all:',
  'work.uthFold.sum': '{value}',
  // --- The same decision in chips, which is what Ultimate hides (round 19) ---
  'ret.money.title': 'The same choices in chips',
  'ret.money.puts': 'puts out',
  'ret.money.risk': 'at risk',
  'ret.money.back': 'comes back',
  'ret.money.note': 'The Ante and the Blind are already on the table, so **at risk** counts them and **comes back** is what the choice is worth on average. Folding leaves two chips at risk and brings back nothing.',
  // --- The gestures: evidence, never a compliment (round 20) ---
  'gest.improved': '**Five right in a row on {spot}.** The {wrongs} times you got this one wrong, you {played}.',
  'gest.improvedPlain': '**Five right in a row on {spot}**, after getting it wrong {wrongs} times.',
  'gest.record': '**{streak} correct in a row — your best yet.** The one before it was {previous}.',
  'gest.rightAndLost': '**You played that hand perfectly and lost.** That is exactly what is supposed to happen sometimes, and it is why this app measures decisions instead of results.',
  'records.title': 'Your records',
  'records.streak': '{n} in a row',
  'records.mastered': '{n} of {total} spots mastered',
  'records.decisions': '{n} decisions in all',
  'records.none': 'Nothing here yet — play a few hands.',
  'sitting.line': 'This sitting: **{decisions} decisions**, {mistakes} of them wrong.',
  'sitting.clean': 'This sitting: **{decisions} decisions**, and not one of them wrong.',
  'sitting.allOne': 'Every one of them was the same spot — **{spot}**.',
  'sitting.leak': 'The one that cost the most was **{spot}**, {n} times.',
  'chart.mode.chart': 'The chart',
  'chart.mode.mastery': 'What you have mastered',
  'mastery.legend': '**Played** · **Mastered**: five played, four of them right, and the last two right.',
  'mastery.count': '**{n} of {total}** mastered',
  'ret.scale': 'Before the flop nothing is solved at the table. This figure was worked out once, over **{outcomes}** endings for your two cards: every board that can come, every hand the dealer can hold behind it, all three bets settled, averaged.',
  'ret.helpLines': 'The dashed line is **1.000**. The unbroken one is where the best action reaches, so the gap between a bar and that line is what the move gives up. The scale ends at 2.0 on every hand, which is why a short best bar means a hand that was never going far.',

  // --- Said once, before the first hand ever played (round 13) ---
  'intro.title': 'Before your first hand',
  'intro.body': 'This is not a blackjack game. Every decision you make is measured against the mathematically best play, and that is what you are scored on. **You will lose hands playing perfectly — that is the point.**',
  'intro.ok': 'Deal me in',

  // --- The hand analyser (round 16) ---
  'an.title': 'Analyse a hand',
  'an.tenKey': '10 J Q K',
  'ui.analyseTitle': 'EV Trainer — Analyse a hand',
  'an.open': 'Analyse a hand',
  'an.sub': 'Any cards, without playing',
  'an.yours': 'Your cards',
  'an.dealers': 'Dealer shows',
  'an.tapYours': 'Tap two cards.',
  'an.tapDealer': 'Now the dealer’s card.',
  'an.tapMore': 'Add a card, or change the rules.',
  'an.addCard': 'Add a card',
  'an.clear': 'Start again',
  'an.rules': 'Rules',
  'an.best': 'Best play: {action}',
  'an.notCounted': 'Nothing here counts towards your Blackjack or Ultimate ratings, your accuracy, or anything else. It is a question, not a hand.',
  'an.needCards': 'Pick two cards for yourself and one for the dealer.',
  'an.tooManyCards': 'A hand here holds at most {max} cards.',
  'an.badRank': 'Those are not cards this game deals.',
  'an.badRules': 'That is not a rule set this app knows.',
  'an.impossible': 'This game deals {decks}. That is {held} {rank}s, and this hand asks for {count}.',
  'an.oneDeck': 'a single deck',
  'an.decks': '{n} decks',
  'an.impossibleShort': 'There are not enough cards left in the shoe for that hand.',
  'an.bust': 'That hand is already {total} — over 21, so there is nothing left to decide.',
  'an.blackjack': 'That is a blackjack. It pays itself; there is no decision to make.',
  'an.twentyOne': 'Twenty-one. The hand stands itself, so there is nothing to decide.',
  'an.rank.A': 'ace',
  'an.rank.2': 'two',
  'an.rank.3': 'three',
  'an.rank.4': 'four',
  'an.rank.5': 'five',
  'an.rank.6': 'six',
  'an.rank.7': 'seven',
  'an.rank.8': 'eight',
  'an.rank.9': 'nine',
  'an.rank.10': 'ten-card',

  // --- The slogan, and what the app is for (round 14) ---
  'brand.slogan': 'Simply winning more hands.',

  // --- The game itself, for a player who asked to be taught it (round 15) ---
  'prime.title': 'How the game works',
  'prime.open': 'How the game works',
  'prime.start': 'Start playing',
  'prime.headOrder': 'The order of play',
  'prime.order': 'You put a bet up, and then you are dealt **two cards face up**. The dealer takes two as well: **one face up**, which you can see, and one face down, which you cannot. Then it is your turn — you choose, one card at a time, until you stand or go over 21. Only when you are done does the dealer turn his hidden card and play his own hand.',
  'prime.cards': 'A hand is worth what its cards add up to. Numbers count themselves, **a picture card counts ten**, and **an ace counts eleven** until that would take you over 21 — and then it counts one. So A-6 is seventeen, or seven if another card would break it.',
  'prime.dealerRule': 'The dealer has no choices to make: he **draws to 16 and stands on 17** or more. That is why the card he is showing tells you so much.',
  'prime.headActions': 'What each choice does',
  'prime.hit': '**Hit** — take one more card. You can keep taking them; go over 21 and the hand is lost at once, whatever the dealer does afterwards.',
  'prime.stand': '**Stand** — take no more cards, and let the dealer play his hand out.',
  'prime.double': '**Double** — put a second bet out beside the first and take exactly one more card. You stand on whatever it turns out to be.',
  'prime.split': '**Split** — offered only when your two cards are the same rank. Put up a second bet and play them as two separate hands.',
  'prime.surrender': '**Surrender** — give the hand up before playing it and take half your bet back. Some tables do not offer it.',
  'prime.insurance': '**Insurance** — offered only when the dealer shows an ace. It is a side bet, half your stake, that his hidden card is worth ten. It pays 2:1 and it has nothing to do with your own hand.',
  'prime.headWin': 'When you win',
  'prime.win': 'You win when your total is **closer to 21 than the dealer’s** without going over, and when the dealer goes over and you have not. Equal totals are a **push**: your bet simply comes back. An ace with a ten-card in your first two cards is a **blackjack**, and it pays {pays} — unless the dealer has one too, and then it is a push.',
  'prime.headPoint': 'What this is',
  'prime.point': 'Every hand is a small decision: your two cards against the dealer’s one, and one choice that is better than the others. This app measures the **choice**, not the result — so a correct play that loses is still correct, and that is the whole idea.',

  // --- How much the app explains (round 14) ---
  'level.question': 'How much should the app explain?',
  'level.note': 'This changes only how much is explained — never your score. The grade, the figures and both your Blackjack and Ultimate ratings are the same at every setting, and you can change it whenever you like.',
  'level.new.title': 'Explain everything',
  'level.new.body': 'How the game itself works, and what the figures mean, in plain words.',
  'level.intermediate.title': 'Explain the decision',
  'level.intermediate.body': 'A little of the basics, and the full reasoning behind the best play.',
  'level.advanced.title': 'Show me the numbers',
  'level.advanced.body': 'The reasoning, and the whole breakdown: every dealer outcome, the exact figures, how rare the spot is, and what another rule set would answer.',
  'ui.plain.accuracy': 'decisions played right',
  'ui.plain.evLost': 'cost of mistakes / 100 hands',
  'ui.plain.units': 'chips, up or down',
  'ui.moreBelow': 'There is more below',

  // --- The breakdown, at Advanced (round 14) ---
  'bd.title': 'The whole breakdown',
  'bd.dealer': 'The dealer, from this card: {list}.',
  'bd.breaks': 'breaks',
  'bd.natural': 'blackjack',
  'bd.exact': 'Exactly: {list}.',
  'bd.rarity': 'About one hand in {oneIn} is this spot, and it is a {band} one: difficulty {difficulty}.',
  'bd.rules': 'Under another rule set: {list}.',
  'bd.rulesNone': 'This answer holds under every rule set the app offers.',

  'ui.why': 'Why?',
  'ui.thinkPrompt': 'Take a moment. What is my card telling you?',
  'ui.dealWhenReady': 'Deal when you are ready.',
  'ui.edgeNote': 'Perfect play still loses {pct}% of every unit bet.',
  'ui.chart.hard': 'Hard',
  'ui.chart.soft': 'Soft',
  'ui.chart.pairs': 'Pairs',

  // --- Home, generated ---
  'home.greet.none': 'Nothing played yet. Pick a table.',
  'home.greet.early': '{hands} hands in. Early days.',
  'home.greet.clean': '{hands} hands, and playing them well.',
  'home.greet.close': '{hands} hands. Close to clean.',
  'home.greet.work': '{hands} hands. There is work in here.',
  'home.ratingOf': 'Blackjack rating · {mode}',
  'home.unrated': 'Blackjack · not rated yet',
  'home.rating.none': 'Play a few hands and this settles on a number. It rises when you beat a hard spot and falls when you lose an easy one.',
  'home.rating.settling': 'Still settling — about {left} more decisions before it means much.',
  'home.rating.peak': 'Peak {peak}. It moves with every decision, both ways.',
  'home.noHands': 'No hands yet this session. Every one you play shows up here, with what it cost.',
  'home.noStats': 'Nothing to measure yet. Play a hand or two.',
  'home.excluded': '{n} coin-flips left out — spots where the best two plays are within a hundredth of a unit. Counting those too, it is {pct}%.',
  'home.excludedOne': '1 coin-flip left out — a spot where the best two plays are within a hundredth of a unit. Counting it too, it is {pct}%.',
  'home.noExcluded': 'Every decision so far had a clear best play.',
  'home.fig.accuracy': 'of your decisions were the best play',
  'home.fig.evLost': 'units given away per hundred hands',
  'home.fig.evLostNote': 'What your mistakes cost, separate from how the cards happened to fall.',
  'home.fig.edge': 'the edge you are really playing against',
  'home.fig.edgeNote': 'The house takes {pct}% from perfect play under these rules. The rest of that is yours to close.',
  'home.fig.units': 'units, this session',
  'home.fig.unitsNote': 'How the cards fell. Kept last on purpose.',
  'home.handsPlayed': '{hands} hands played',
  'home.footer': 'Under these rules perfect play still loses {pct}% of every unit bet. This teaches you to lose less, not to win.',

  // --- Ultimate preview ---
  'uth.blindPays': 'Blind pays straight or better',
  'uth.yourHand': 'Your hand',
  'uth.preflopStreet': 'Pre-flop · raise 4× or check',
  'uth.flopStreet': 'Flop · raise 2× or check',
  'uth.riverStreet': 'River · raise 1× or fold',
  'uth.tripsPanel': 'Trips side bet',
  'uth.preflopPanel': 'Pre-flop table',
  'uth.dealAnother': 'Deal another',
  'uth.solving': 'Solving…',
  'uth.raise4': 'Raise 4×',
  'uth.raise3': 'Raise 3×',
  'uth.raise2': 'Raise 2×',
  'uth.raise1': 'Raise 1×',
  'uth.check': 'Check',
  'info.uthEvLost.title':
    'EV lost per 100 hands',
  'info.uthEvLost.body':
    '**Lower is better. 0 is perfect** — it cannot go below 0, because nothing beats perfect play. This is what your mistakes cost over a hundred hands, in units of your **Ante**; a perfect player scores zero no matter how the cards ran. It is the only number here that is entirely yours.',
  'info.uthEdge.title':
    'House edge you face',
  'info.uthEdge.body':
    '**Lower is better.** The floor is the game’s own edge against perfect play, {rulesEdge} of the Ante, solved exactly from every starting hand. Counting cards cannot lower it: the deck is reshuffled for every hand. This figure is exactly that floor plus your EV lost per 100 hands, so everything above {rulesEdge} is your own mistakes.',
  'hand.chips':
    '{n} chips',
  'bet.yourBet':
    'bet',
  'bet.limits':
    'Table limits {range}',
  'bet.chip':
    'Add a {value} chip',
  'bet.spot':
    'Your bet: {bet} chips. Tap to take the last chip back.',
  'sens.s17':
    'if the dealer stood on soft 17',
  'sens.h17':
    'if the dealer hit soft 17',
  'sens.noSurrender':
    'without late surrender',
  'sens.lateSurrender':
    'with late surrender available',
  'sens.noDas':
    'without double after split',
  'sens.noHoleCard':
    'in a no-hole-card game',
  'bet.change':
    'Bet {bet} · change',
  'bet.clear':
    'Clear',
  'bet.repeat':
    'Repeat {bet}',
  'bet.double':
    'Double to {bet}',
  'bet.place':
    'Tap a chip to place a bet.',
  'rebuy.line':
    'Out of chips. Take {n} more — free, as often as you like.',
  'rebuy.button':
    'Take {n} chips',
  'track.title':
    'Last hands',
  'track.empty':
    'Your hands line up here as you play, one dot for each decision.',
  'track.row':
    '{n} decisions, result {net} chips. Opens the hand in your log.',
  'track.rowOne':
    'One decision, result {net} chips. Opens the hand in your log.',
  'track.rowNone':
    'No decision: the hand ended on the deal. Result {net} chips. Opens the hand in your log.',
  'uth.logTitle':
    'Hands',
  'uth.logEmpty':
    'Every hand you play is kept here, with each decision graded.',
  'uth.howto.1':
    'Deal to post **Ante 1** and **Blind 1**. Then decide: raise **4×** or check before the flop, **2×** or check on the flop, **1×** or fold on the river. One raise ends your decisions.',
  'uth.howto.2':
    'You are graded on the **decision**, not the result: the card shows what every choice was worth and what yours cost. The cards come after it, and quieter.',
  'uth.howto.trips':
    '**Trips** is optional, in its own circle beside the Ante. It pays on your own seven cards — even after a fold — and costs **{edge}** of every bet placed on it. It is never graded.',
  'uth.class.pair':
    'a pair of {p}',
  'uth.class.suited':
    '{hilo}, same suit',
  'uth.class.offsuit':
    '{hilo}, different suits',
  'uth.note.suitFlips':
    'Because your cards are suited, **{best}** returns {ev}. With the same cards in different suits the best play is **{offBest}**, returning {offEv} — the suit changes the decision.',
  'uth.note.suitSame':
    'Being suited adds {gap} here — **{best}** returns {ev} suited and {offEv} in different suits — but the decision is the same.',
  'uth.note.connector':
    'The surprise worth knowing: in Ultimate even suited connectors like these are a check before the flop, not a raise. You are up against the dealer’s hand, where high cards count for more; the flush and straight chances are what make the hand worth keeping, and worth betting later if they arrive.',
  'uth.note.onlyWith':
    'The dealer beats you only with {list}.',
  'uth.note.closest':
    'The closest hands that beat you: {list}.',
  'uth.note.nothingBeats':
    'Nothing the dealer could hold beats you.',
  'uth.list.or':
    ' or ',
  'uth.show.you':
    'You: {hand} ({five})',
  'uth.show.dealer':
    'Dealer: {hand} ({five})',
  'uth.note.suitOffSame':
    'Your cards are in different suits: **{best}** returns {ev}. The same ranks in one suit would return {suitedEv}, with the same best play.',
  'uth.note.suitOffFlips':
    'Your cards are in different suits, so the best play is **{best}**, returning {ev}. The same ranks in one suit would make it **{suitedBest}**, returning {suitedEv} — the suit would change the decision.',
  'uth.show.youWin':
    'You win: {you} against {dealer}',
  'uth.show.dealerWins':
    'The dealer wins: {dealer} against {you}',
  'uth.show.youWinKicker':
    'You win on the kicker: {hand} each',
  'uth.show.dealerWinsKicker':
    'The dealer wins on the kicker: {hand} each',
  'uth.show.tie':
    'A tie: {hand} each',
  'uth.show.legend':
    'Gold ring: your five cards. Blue ring: the dealer’s. A board card in both hands carries both, blue on the dealer’s side and gold on yours.',
  'uthHand.0':
    '{r1} high',
  'uthHand.1':
    'a pair of {p1}',
  'uthHand.2':
    'two pair, {p1} and {p2}',
  'uthHand.3':
    'three {p1}',
  'uthHand.4':
    'a straight to the {r1}',
  'uthHand.5':
    'a flush to the {r1}',
  'uthHand.6':
    'a full house, three {p1} and two {p2}',
  'uthHand.7':
    'four {p1}',
  'uthHand.8':
    'a straight flush to the {r1}',
  'uthHand.royal':
    'a royal flush',
  'uthHand.kicker':
    '{hand} with a better kicker',
  'rankName.0':
    'two',
  'rankPlural.0':
    'twos',
  'rankName.1':
    'three',
  'rankPlural.1':
    'threes',
  'rankName.2':
    'four',
  'rankPlural.2':
    'fours',
  'rankName.3':
    'five',
  'rankPlural.3':
    'fives',
  'rankName.4':
    'six',
  'rankPlural.4':
    'sixes',
  'rankName.5':
    'seven',
  'rankPlural.5':
    'sevens',
  'rankName.6':
    'eight',
  'rankPlural.6':
    'eights',
  'rankName.7':
    'nine',
  'rankPlural.7':
    'nines',
  'rankName.8':
    'ten',
  'rankPlural.8':
    'tens',
  'rankName.9':
    'jack',
  'rankPlural.9':
    'jacks',
  'rankName.10':
    'queen',
  'rankPlural.10':
    'queens',
  'rankName.11':
    'king',
  'rankPlural.11':
    'kings',
  'rankName.12':
    'ace',
  'rankPlural.12':
    'aces',
  'uth.board':
    'Board',
  'uth.ante':
    'Ante',
  'uth.blind':
    'Blind',
  'uth.play':
    'Play',
  'uth.atRisk':
    'in play',
  'uth.pressDeal':
    'Deal to post Ante {bet} and Blind {bet}.',
  'uth.nextHand':
    'Next hand',
  'uth.keys':
    'Keys: 4 · 3 · C before the flop, 2 · C on the flop, 1 · F on the river, N for the next hand.',
  'uth.rulesLine':
    'Blind pays a straight or better · dealer qualifies with a pair',
  // --- The rule panel this table gained in round 19 ---
  'uth.blind.standard':
    'Blind pays: straight 1 · flush 3:2 · full house 3 · four of a kind 10 · straight flush 50 · royal flush 500',
  'uth.blind.fixed':
    'The Blind pay table is fixed, and this is the one honest reason: every figure the trainer shows was solved against it, and the pre-flop table alone took **two billion endings for each starting hand**. A second one would mean solving the game again, not flipping a switch.',
  'uth.rules.trips': 'Trips pay table',
  'uth.rules.tripsNote':
    'Trips settles on your own seven cards and no solve reads it, so changing it moves nothing that is graded, rated or ranked. What it does reset is the Trips row of your stats — a cost measured against two pay tables at once measures nothing.',
  'uth.rules.pays': 'three of a kind · straight · flush · full house · four of a kind · straight flush · royal',
  'uth.rules.costs': 'costs {edge} of what goes on it',
  'uth.rules.limits': 'Table limits: {min} to {max} a hand',
  'uth.trips.trips-a': 'Pay table I',
  'uth.trips.trips-b': 'Pay table II',
  'uth.trips.trips-c': 'Pay table III',
  'uth.readingFlop':
    'Reading the flop…',
  'uth.h.preflop':
    '{class} · before the flop',
  'uth.h.flop':
    '{class} · on the flop',
  'uth.h.river':
    '{class} · on the river',
  'uth.s.threeX':
    '3× is the best play on **none of the 169 starting hands** — any hand worth raising is worth raising the maximum. Here it gives up **{cost}** against {best}.',
  'uth.s.preRaise':
    'This hand is strong enough to raise the maximum: 4× is worth **{gap}** more than checking.',
  'uth.s.preCheck':
    'This hand is worth more checked. Checked, it goes on to raise the flop in {flopRaise} of cases and to fold the river in {riverFold} of cases.',
  'uth.s.flopRaise':
    '2× beats checking by **{gap}**. Checked, this hand ends up folding the river in {riverFold} of cases.',
  'uth.s.flopCheck':
    'Checking beats 2× by **{gap}**. You keep a 1× decision on the river, and fold it in {riverFold} of cases.',
  'uth.s.riverRaise':
    'Your hand beats **{win}** of the dealer’s possible hands, ties {tie} and loses to {lose} — worth more than folding for {fold} units.',
  'uth.s.riverFold':
    'Your hand beats only **{win}** of the dealer’s possible hands, ties {tie} and loses to {lose}, so 1× loses more than folding for {fold} units.',
  'uth.line.dealerQualified':
    'Dealer qualifies with a pair or better — Ante {ante}',
  'uth.line.dealerNotQualified':
    'Dealer does not qualify — the Ante pushes',
  'uth.line.tie':
    'A tie — every bet pushes',
  'uth.line.playWin':
    'Play {bet} wins {play}',
  'uth.line.playLose':
    'Play {bet} loses {play}',
  'uth.line.playPush':
    'Play {bet} pushes',
  'uth.line.blindPaid':
    'Blind pays {blind} on a straight or better',
  'uth.line.blindPush':
    'Blind pushes — the win was below a straight',
  'uth.line.blindLose':
    'Blind loses {blind}',
  'uth.line.blindTie':
    'Blind pushes',
  'uth.line.folded':
    'You folded — the dealer keeps their cards down',
  'uth.line.foldPlay':
    'No Play bet was made',
  'uth.line.forfeit':
    'Ante and Blind are forfeit: {lost}',
  'uth.line.net':
    'Hand {net} chips',
  'uth.fold': 'Fold',
  'uth.threeXNever': 'The 3× raise loses to both alternatives here — as it does everywhere.',
  'uth.stillComputing': 'This class is still being computed by the offline job. The flop and river below are exact.',

  // --- House restrictions (real rules, not display filters) ---
  'rules.house': 'House restrictions',
  'rules.noSurrender': 'No surrender',
  'rules.noSurrenderNote': 'Most tables do not offer it. Turning it off changes the right play on 15 and 16.',
  'rules.likeRanksOnly': 'Split like ranks only',
  'rules.likeRanksOnlyNote': 'A jack beside a queen becomes a hard twenty. It takes away a move that was never correct anyway, so no other answer changes.',
  'rules.restartsSession': 'Either one restarts the session — they are part of the rule set the chart is solved from.',

  // --- What the four figures mean (§9.2) ---
  'info.accuracy.title': 'Decision accuracy',
  'info.accuracy.body':
    '**Higher is better.** The target is 99% or more, sustained over 500 hands. This is the share of your decisions that were the best play available. Coin-flips — spots where the top two plays are within a hundredth of a unit — are left out, because getting those "wrong" is not a mistake worth counting. It is scored on the decision, never on whether the hand won.',
  'info.evLost.title': 'EV lost per 100 hands',
  'info.evLost.body':
    '**Lower is better. 0 is perfect** — it cannot go below 0, because nothing beats perfect play. This is what your mistakes cost, in units of your bet, over a hundred hands; a perfect player scores zero no matter how badly the cards ran. It is the number to watch: the only one that is entirely yours.',
  'info.edge.title': 'House edge you face',
  'info.edge.body':
    '**Lower is better.** The floor is the rules’ own edge, {rulesEdge}, and you cannot go below it without counting cards. This figure is exactly that floor plus your EV lost per 100 hands, so everything above {rulesEdge} is your own mistakes — and that is the part you can close.',
  'info.units.title': 'Units',
  'info.units.body':
    '**This does not measure how you played.** It can be positive or negative, and over a session this short it is almost entirely luck. A perfect player loses many sessions; it is not a sign of a mistake. Kept last, and kept quiet, because reading it as a score is the habit this trainer exists to break.',
  'info.more': 'What does this mean?',

  // --- Instructions ---
  'howto.title': 'How this works',
  'howto.open': 'How to play',
  'howto.1': 'Press **Deal**, then choose the play you think is best. Keyboard: **H** hit, **S** stand, **D** double, **P** split, **R** surrender, and **Y** / **N** for insurance.',
  'howto.2': 'The dealer reads the spot back to you in three steps — her card, your hand, then the two together. **Space** moves through them, or skip straight to the answer.',
  'howto.3': 'You are graded on the **decision**, not the result. A correct play that loses is still correct, and that is the whole idea.',
  'howto.4': 'Ask **Why?** at any point before you act; she will answer from the same numbers she grades you with.',

  // --- The value of doubling ---
  'stat.doubleMissed': 'The same card either way, on **half the money** — what you gave up is **the raise**, not the hand.',

  'fb.accuracyCount': '**{right} of {total}** decisions right so far.',
  'fb.accuracyExcluded': '{n} close calls set aside — spots where the best two plays differ by under 0.01 units, which is inside the noise.',
  'fb.accuracyExcludedOne': '1 close call set aside — a spot where the best two plays differ by under 0.01 units, which is inside the noise.',

  // --- The shared build: other people ---
  'social.table': 'Table',
  'social.feed': 'Feed',
  'social.connecting': 'Looking for the others…',
  'social.offlineNow':
    'Offline — the shared table cannot be reached right now. The games play as usual; your record is kept on this device and joins the table when the connection is back.',
  'social.offline': 'Playing on your own here — the shared table needs a connection this page could not get. Everything else works.',
  'social.noPlayers': 'Nobody has played a rated hand yet. Be first.',
  'social.noFeed': 'Nothing on the feed yet. Hands land here when someone drops a big one or holds a hard spot.',
  'social.playerLine': '{accuracy}% over {hands} hands',
  'social.you': 'You',
  'social.held': 'Held it — **{action}** was right.',
  'social.missed': 'Played {chosen}; **{optimal}** was right. Cost {cost}.',
  'social.justNow': 'just now',
  'social.minutes': '{n} min ago',
  'social.hours': '{n} h ago',
  'social.days': '{n} d ago',

  'welcome.line': 'Real hands, dealt properly. You decide, then you find out what the maths says — and why.',
  'welcome.nameLabel': 'What should we call you?',
  'welcome.placeholder': 'Your name',
  'welcome.start': 'Sit down',
  'welcome.fine': 'No account, no password. The name is so the others can see you at the table.',

  'fb.thinking': 'thinking it through',

  // --- The rail ---
  'ui.stack': 'stack',
  'ui.wager': 'in play',
  'ui.dealt': 'dealt',
  'ui.drawn': 'drawn',
  'ui.cardDealt': '{card}, dealt',
  'ui.cardDrawn': '{card}, drawn on hit {n}',

  'hand.doubled': 'doubled',
  // What became of a hand, in one word, for the seat's header (round 17).
  'hand.won': 'won',
  'hand.lost': 'lost',
  'hand.push': 'push',
  'hand.nth': 'Hand {n}',
  'hand.surrendered': 'surrendered',
  'hand.units': '{n} units',

  // --- Table talk (§3.4) ---
  //
  // What a dealer says out loud when a hand resolves: what she made, and who
  // took it. Never whether the play was right — the feedback card is doing
  // that, and hearing it twice made her sound like a scoreboard rather than
  // someone dealing cards.
  'dealer.youBust': 'Too many.',
  'dealer.iBust': 'Dealer breaks. The hand is yours.',
  'dealer.blackjack': 'Blackjack. Pays {pays}.',
  'dealer.pays32': 'three to two',
  'dealer.pays65': 'six to five',
  'dealer.dealerNatural':
    'Ace and a ten — dealer blackjack, so the hand is over before you play it. Nothing was skipped; there was nothing left to decide.',
  'dealer.bothNaturals': 'Blackjack for the dealer too. Push — your bet stays up.',
  'dealer.push': 'Push — your bet stays up.',
  'dealer.surrendered': 'Half back. On to the next.',
  'dealer.youWin': '{player} against the dealer’s {dealer}. The hand is yours.',
  'dealer.iWin': 'Dealer {dealer}. That one goes to the house.',
  'dealer.youWinPlain': 'Those are good. The hand pays.',
  'dealer.iWinPlain': 'The house takes this one.',

  // --- Playing well (§3.4) ---
  //
  // Every string here is about the decision. None of it mentions the money,
  // and none of it gets louder as a run gets longer — see §16.
  'fb.streak': '{n} correct in a row',
  'fb.streakBest': 'Best run this session: {n}.',
  'fb.streakCounts': 'A run of correct decisions. Close calls neither extend it nor break it, and it starts again with the session.',
  'fb.milestone': '**{n} in a row** — {hard} of them the chart calls hard.',
  'fb.milestoneOne': '**{n} in a row** — one of them the chart calls hard.',
  'fb.milestoneNone': '**{n} in a row**.',

  'ui.ratingPoints': '{delta} Blackjack rating',
  'home.sessionSwing': '{delta} this session',
  'ui.ratingUnrated': 'not rated',
  'fb.ratingWhy': 'Your Blackjack rating moves on the decision and how hard it was — never on whether the hand won.',
  // The Ultimate rating (round 10): its own number, always named with its game.
  'ui.uthRatingPoints': '{delta} Ultimate rating',
  'fb.uthRatingWhy': 'Your Ultimate rating moves on the decision and how hard it was — never on whether the hand won.',
  'fb.uthUnratedWhy': 'Too obvious to rate: getting it right says nothing about how well you play.',
  'home.uthRating': 'Ultimate rating',
  'home.uthUnrated': 'Ultimate · not rated yet',
  'home.uthRating.none': 'Play a few hands of Ultimate and this settles on a number of its own. It is never added to your Blackjack rating.',
  'home.uthRating.settling': 'Still settling — about {left} more rated decisions before it means much.',
  'home.uthRating.peak': 'Peak {peak}. Only the harder decisions move it.',
  'home.remember': 'Write down your name and code — you will need them once.',
  'home.ladderHead': 'what this mode counts as hard',
  'home.ladderOneIn': 'one in {n} hands',
  // Trips (round 11): a cost stated honestly, in its own place, never graded.
  'uth.trips': 'Trips',
  'uth.line.tripsPaid': 'Trips pays {multiple} to 1 on {hand}: {won}',
  'uth.line.tripsLose': 'Trips loses {lost} — below three of a kind',
  'uth.line.tripsCost': 'Trips costs {edge} of what you put on it, over time, however it lands tonight.',
  'bet.spotTrips': 'Trips: {bet} chips. Tap to take the last chip back.',
  'bet.chooseAnte': 'Ante: {bet} chips. Tap to put chips here.',
  'bet.chooseTrips': 'Trips: {bet} chips. Tap to put chips here.',
  'home.tripsHead': 'Trips, in Ultimate',
  'home.fig.tripsPut': 'chips put on Trips',
  'home.fig.tripsPutNote': 'Over {hands} hands.',
  'home.fig.tripsPutNoteOne': 'On one hand.',
  // Rule sets and cards, worded in the language on screen (round 11, the Hebrew sweep).
  'preset.vegas-strip-6d-s17': 'Vegas Strip 6-deck S17',
  'preset.downtown-h17': 'Downtown H17',
  'preset.single-deck-6-5': 'Single Deck 6:5',
  'preset.single-deck-6-5.note': 'The 6:5 blackjack payout alone adds roughly 1.4% to the house edge — a rule choice that costs more than every strategy error a typical player makes combined.',
  'preset.european-nhc': 'European No-Hole-Card',
  'preset.european-nhc.note': 'The dealer takes no hole card. A dealer natural collects your doubled and split wagers too, which changes the correct play against an Ace or ten.',
  'badge.noDas': 'no DAS',
  'badge.surrender.none': 'no surrender',
  'badge.surrender.late': 'late surrender',
  'badge.surrender.early': 'early surrender',
  'badge.likeRanks': 'like ranks only',
  'badge.noHoleCard': 'no hole card',
  'card.label': '{rank} of {suit}',
  'card.rank.2': '2',
  'card.rank.3': '3',
  'card.rank.4': '4',
  'card.rank.5': '5',
  'card.rank.6': '6',
  'card.rank.7': '7',
  'card.rank.8': '8',
  'card.rank.9': '9',
  'card.rank.10': 'ten',
  'card.rank.J': 'jack',
  'card.rank.Q': 'queen',
  'card.rank.K': 'king',
  'card.rank.A': 'ace',
  'card.suit.clubs': 'clubs',
  'card.suit.diamonds': 'diamonds',
  'card.suit.hearts': 'hearts',
  'card.suit.spades': 'spades',
  'card.faceDown': 'face-down card',
  'key.space': 'SPACE',
  'home.fig.tripsCost': 'what Trips costs over time',
  'home.fig.tripsCostNote': '{edge} of what was put on it: the price of the bet, whatever it did tonight.',
  'home.fig.tripsResult': 'what Trips actually did, in chips',
  'home.fig.tripsResultNote': 'How the cards fell on it. It says nothing about how well you played.',
  'social.byBlackjack': 'Ranked by Blackjack rating',
  'social.byUltimate': 'Ranked by Ultimate rating',
  'social.noUthPlayers': 'Nobody has an Ultimate rating yet. A few hands of Ultimate and you are first.',
  'social.uthPending': 'Ultimate ratings appear here once the shared table has been updated for them.',
  'social.uthPlayerLine': '{decisions} Ultimate decisions',
  'fb.unratedWhy': 'No real decision here, so there is nothing to rate.',

  'spot.routine': 'routine',
  'spot.ordinary': 'ordinary',
  'spot.tricky': 'tricky',
  'spot.brutal': 'brutal',
  'fb.spotBand': '{band} spot',
  'fb.spotRarity': 'About one hand in {oneIn}.',
  'fb.spotHeld': 'About one hand in {oneIn} — and you had it.',
  'fb.spotAboveYou': 'Rated above you.',

  'sound.enable': 'Sound',
  'sound.note': 'Short tones as cards land and when the verdict arrives, and one click whenever chips move — the same click whether a hand wins or loses.',

  // --- The door ---
  'welcome.codeLabel': 'Pick a 4-digit code',
  'welcome.installed':
    'Opened from your home screen? It keeps its own storage, so type the same name and code you use in the browser and your record comes back.',
  'welcome.codeHint': 'So you are the same player on your phone as on here. Four digits, and remember them.',
  'welcome.badCode': 'Four digits, please.',
  'welcome.wrongCode': 'That name is taken and the code does not match it. Try the code you used before, or a different name.',
  'welcome.offline': 'The table is not answering, so you are playing on your own for now. Your record is kept here and will join up later.',
  'welcome.fineLocal': 'No account, no password. This copy keeps your record in this browser only.',
  'welcome.switch': 'Not you? Switch player',
  'welcome.switchNote': 'Forgets this browser and returns to the door. Nothing is deleted — your record stays under its name and code.',
  // --- The usage page (round 9) ---
  'usage.title': 'Who is playing',
  'usage.line': 'From the shared table: everyone who has played, how much, and who came back on another day.',
  'usage.back': '← Home',
  'usage.played': 'people have played',
  'usage.playedNote': 'At least one graded decision, in either game.',
  'usage.cameBack': 'came back on another day',
  'usage.cameBackNote': 'Finished a hand on two or more different days.',
  'usage.regulars': 'regulars',
  'usage.regularsNote': 'Played on {days} or more different days, with {decisions} or more graded decisions in all.',
  'usage.recent': 'played in the last {n} days',
  'usage.recentNote': 'By the last day they finished a hand.',
  'usage.oneDay': '1 day played',
  'usage.days': '{days} days played',
  'usage.lastPlayed': '{days} · last played {last}',
  'usage.notCounted': 'Has not played since the day count began · last seen {last}',
  'usage.decisions': 'Blackjack: {bj} decisions · Ultimate: {uth} decisions',
  'usage.tierRegular': 'regular',
  'usage.tierBack': 'came back',
  'usage.tierOnce': 'one day',
  'usage.nobody': 'Nobody has played yet.',
  'usage.loading': 'Reading the table…',
  'usage.noTable': 'This copy has no shared table, so there is nobody to count.',
  'usage.offline': 'The shared table is not answering, so nothing can be counted right now.',
  'usage.refused': 'The shared table refused the question ({status}), so nothing is shown rather than a wrong count.',
  'usage.counting':
    'Days are counted from {day}. Someone who played before then and has not played since shows the day they were last seen; when they play again, the earlier visit counts as a day.',
  // --- What people open (round 15): counts, not logs ---
  'usage.opened': 'What people open',
  'usage.openedNote': 'How many times each of these has been opened, by everyone, ever. Counts only — no order, no times of day, and nothing that says who did what when.',
  'usage.open.help': 'The explanation of the figures',
  'usage.open.helpShut': '…and closed again',
  'usage.open.primer': 'How the game works',
  'usage.open.howto': 'How this works',
  'usage.open.chart': 'The strategy chart',
  'usage.open.statInfo': 'What a figure on the strip means',
  'usage.open.next': 'Stepped through the reasoning',
  'usage.open.skip': 'Skipped to the answer',
  'usage.open.arrow': 'Followed the arrow to the reasoning',
  'usage.open.hand': 'Opened a hand in the log',
  'usage.open.rules': 'The rule panel',
  'usage.open.level': 'Changed how much is explained',
  'usage.public':
    'Not private. Nothing links to this page, but the table it reads is open to anyone who has the app’s address, so anyone who looked could read these same numbers.',
};

const HE: Catalogue = {
  // --- Actions ---
  'action.hit': 'קלף',
  'action.stand': 'עצירה',
  'action.double': 'הכפלה',
  'action.split': 'פיצול',
  'action.surrender': 'ויתור',
  'action.hitting': 'לקיחת קלף',
  'action.standing': 'עצירה',
  'action.doubling': 'הכפלה',
  'action.splitting': 'פיצול',
  'action.surrendering': 'ויתור',
  'action.takeInsurance': 'לקנות ביטוח',
  'action.declineInsurance': 'לוותר על הביטוח',
  'verbTo.hit': 'לקיחת קלף',
  'verbTo.stand': 'עצירה',
  'verbTo.double': 'הכפלה',
  'verbTo.split': 'פיצול',
  'verbTo.surrender': 'ויתור',
  'verbTo.takeInsurance': 'קניית ביטוח',
  'verbTo.declineInsurance': 'ויתור על הביטוח',

  // --- Upcards ---
  'upcard.ace': 'אס',
  'upcard.ten': 'עשר',
  'upcard.number': '{rank}',
  'upcard.numberAn': '{rank}',

  // --- Step 1: read the dealer ---
  'dealer.bust': 'לדילר {up}{worst} — **קלף חלש**. הוא נשרף ב-{bust} מהמקרים.',
  'dealer.worst': ', הגרוע שלו',
  'dealer.ace': 'אס, וכבר ידוע שאין **בלאק ג׳ק**. הדילר עדיין נשרף רק ב-{bust} מהמקרים.',
  'dealer.strong': 'לדילר {up} — **חזק**. הוא נשרף רק ב-{bust} מהמקרים, ומגיע ל-17 ומעלה ב-{made} הנותרים.',

  // --- Step 2: read your hand ---
  'hand.insurance':
    'הביטוח תלוי **בקלף הסמוי של הדילר**, לא ביד שלך. ארבעה מתוך שלושה־עשר סוגי הקלפים שווים עשר, ולכן הקלף הסמוי הוא עשירייה בכ־{tens} מהמקרים — ובתשלום 2:1 ההימור צריך {breakEven} רק כדי לצאת בשווה.',
  'hand.aces': 'A,A — **הזוג הכי טוב בחפיסה**. ביד אחת האס השני מיותר.',
  'hand.eights': '8,8 — **שש־עשרה**, הסכום הגרוע ביותר. הפיצול הוא **בריחה**, לא התקפה.',
  'hand.splitDas': '{pair} — זוג קטן. כל חצי רוצה לקחת קלף ואז **להכפיל**, אז הכול תלוי בכלל ההכפלה אחרי פיצול.',
  'hand.splitOffensive': '{pair} — סביר כיד אחת. הפיצול כאן הוא **התקפה**.',
  'hand.splitDefensive': '{pair} — כיד אחת היא מנצחת רק כשהדילר נשרף. בפיצול כל קלף **מתחיל מחדש** ממקום טוב יותר.',
  'hand.pairNever': '{pair} — זוג ש**שווה לשמור**. בפיצול זה הופך לשתי ידיים חלשות יותר.',
  'hand.stiff': '{total} — **יד תקועה**. עצירה לא מנצחת אותה, ולקיחת קלף שורפת אותה ב-{bust} מהמקרים. אין תשובה טובה, רק **זולה יותר**.',
  'hand.doubling': '{total} — **לא יכולה להישרף** בקלף אחד, וכל עשירייה הופכת אותה ליד אמיתית.',
  'hand.softDraw': 'יד רכה {total} — האס מגן עליך. **שום קלף לא יכול לשרוף אותה**.',
  'hand.softMade': 'יד רכה {total} — כבר טובה, ואפשר **לשפר בחינם**. השאלה היא אם זה שווה.',
  'hand.pat': '{total} — **יד סגורה**. היא מנצחת את מה שהיא מנצחת; השאר עניין של הדילר.',
  'hand.small': '{total} — קטן מדי לעצור, קטן מדי להכפיל. **עוד לא נגמר.**',

  // --- How decisive the call is ---
  'gap.only': 'המהלך היחיד',
  'gap.notClose': '**בפער ברור** מהאפשרות הבאה',
  'gap.narrow': 'ניצחון **צמוד** על האפשרות הבאה',
  'gap.right': '**צמוד לאפשרות הבאה** יותר משנדמה',
  'gap.coinflip': '**הטלת מטבע** מול האפשרות הבאה; שתיהן סבירות',

  // --- Step 3: the supporting figure ---
  'stat.softDraw': 'הקלף הנוסף לא עולה כלום — ומול {up}, מה שיש לך לא מספיק.',
  'stat.standWins': 'עצירה מנצחת ב-{win} מהמקרים ומפסידה ב-{lose}. מעט מאוד מנצח אותה.',
  'stat.standBadPat': 'עצירה עדיין מפסידה ב-{lose} מהמקרים — **גרוע, פשוט פחות גרוע** מהשאר.',
  'stat.standBreaks': 'עצירה מנצחת רק כשהדילר נשרף, והדילר נשרף ב-{bust} מהמקרים.',
  'stat.hitVsSurrender': 'לקיחת קלף שורפת את היד ב-{bust} מהמקרים כבר בקלף הבא.',
  'stat.insurance':
    'הפער נראה קטן רק כי הוא נמדד מול ההימור הראשי, והביטוח מסכן רק חצי ממנו. מהכסף שאתה באמת מניח, הוא מוותר על **{pct}** — בכל פעם מחדש.',
  'stat.double': 'אותו קלף כמו בלקיחה, **בכפול כסף**, בלי קלף שני — וכאן קלף אחד בדרך כלל מספיק.',
  'stat.doubleTooThin':
    'הכפלה קונה **קלף אחד וזהו**. כאן הקלף הזה משאיר אותך מתחת ל-17 ב-{stiff} מהמקרים — תקוע עם יד שהיית רוצה להמשיך לקחת אליה, על כפול כסף.',
  'stat.splitGains': 'שתי ידיים שוות כאן {gap} יותר מיד אחת.',
  'stat.splitCosts': 'פיצול עולה {gap} — סכום אחד טוב הופך לשניים גרועים.',
  'stat.surrender': 'חצי בחזרה זה {half} מובטח; במשחק עד הסוף זה שווה פחות.',

  // --- Step 3 assembled ---
  'combined': '**{verdict}** — {shape}. {numbers}. {stat}',
  'combined.numbers': 'מחזיר {best} מול {runnerUp} ל{runnerUpVerb}',
  'combined.numbersOnly': 'מחזיר {best}',
  'headline': '{hand} מול {up} ← {verdict}',
  'headline.insurance': 'ביטוח ← {verdict}',
  'insurance.step1': 'לדילר יש אס, אז הביטוח פתוח. זה הימור על הקלף הסמוי בלבד.',
  'insurance.counterNote':
    'לפרוטוקול: הקלפים שכבר יצאו השאירו את החפיסה עשירה בעשיריות מספיק כדי שמי שסופר קלפים היה קונה כאן ביטוח. הציון שלך ניתן לפי אסטרטגיה בסיסית, שלעולם לא קונה ביטוח, ולכן זה לא שינה כלום — זו עדיין לא מיומנות שהמאמן מלמד.',

  // --- Home ---
  'ui.appName': 'מאמן EV',
  'ui.yourName': 'השם שלך',
  'ui.defaultName': 'שחקן',
  'ui.greeting': 'טוב לראות אותך.',
  'ui.blackjack': 'בלאק ג׳ק',
  'ui.ultimate': 'אולטימייט',
  'ui.playAHand': 'לשחק יד',
  'ui.lookAround': 'להסתכל מסביב',
  'ui.preview': 'תצוגה מקדימה',
  'ui.yourPlay': 'המשחק שלך',
  'ui.tab.standing': 'מעמד',
  'ui.tab.hands': 'ידיים',
  'ui.tab.stats': 'סטטיסטיקה',
  'ui.rating': 'דירוג בלאק ג׳ק',
  'ui.drilledOn': 'על מה מתאמנים',
  'ui.mode.basic': 'בסיסי',
  'ui.mode.basicNote': 'הידיים היקרות',
  'ui.mode.recall': 'שינון',
  'ui.mode.recallNote': 'דקות ונדירות',
  'ui.mode.value': 'ערך',
  'ui.mode.valueNote': 'החולשות שלך',
  'ui.language': 'שפה',
  'ui.font': 'גופן',
  'ui.home': 'דף הבית',

  // --- Table ---
  'ui.dealer': 'דילר',
  'ui.you': 'אתה',
  'ui.deal': 'חלק',
  'ui.nextHand': 'יד הבאה',
  'ui.accuracy': 'דיוק',
  'ui.hands': 'ידיים',
  'ui.streak': 'רצף',
  'ui.cost': 'עלות',
  'ui.insurance': 'ביטוח',
  'ui.takeInsurance': 'קונה',
  'ui.declineInsurance': 'לא תודה',
  'ui.showAll': 'הצג הכל',
  'ui.next': 'הבא',
  'ui.step': 'שלב {n} מתוך {total}',
  'ui.readDealer': 'קריאת הדילר',
  'ui.readHand': 'קריאת היד שלך',
  'ui.combine': 'מחברים את השניים',
  'ui.youPlayed': 'שיחקת {action}',
  'ui.bestWas': 'הכי טוב היה {action}',
  'ui.noHandsYet': 'עוד אין ידיים.',
  'ui.playedNothing': 'שחק יד והיא תופיע כאן.',
  'ui.win': 'ניצחון',
  'ui.loss': 'הפסד',
  'ui.push': 'תיקו',
  'ui.blackjackResult': 'בלאק ג׳ק',
  'ui.bust': 'נשרף',
  'ui.rules': 'חוקים',
  'ui.change': 'שינוי',
  'ui.askDealer': 'שאל את הדילר',

  // --- Ultimate ---
  'ui.ultimateTitle': 'אולטימייט טקסס הולדם',
  'ui.solverPreview': 'תצוגה מקדימה של הפותר',

  // --- The dealer at the table (§7: asked, not lectured) ---
  'coach.q.odds': 'מה הסיכויים שלי?',
  'coach.a.odds': 'עם הקלף הזה אני נשרף ב-{bust}% מהמקרים, ומסיים עם 17 ומעלה ב-{made}% הנותרים.',
  'coach.a.oddsYouBreak': 'אתה נשרף ב-{bust}% מהמקרים אם תיקח קלף.',
  'coach.a.oddsNoBreak': 'אי אפשר להישרף בקלף הבא — האס מגן עליך.',
  'coach.q.close': 'זה צמוד?',
  'coach.a.closeVery': 'מאוד. שתי האפשרויות הטובות כאן במרחק של פחות ממאית יחידה — זו כמעט הטלת מטבע.',
  'coach.a.closeSome': 'צמוד יותר משזה נראה. בערך {spread} יחידה בין שתי הראשונות.',
  'coach.a.closeNot': 'יש {spread} יחידה בין המהלך הטוב ביותר לבא אחריו. לא ממש.',
  'coach.insurance.prompt': 'אס גלוי. הביטוח פתוח — אבל זה הימור על הקלף הסמוי שלי, לא על היד שלך.',
  'coach.insurance.odds':
    'ארבעה מתוך שלושה־עשר סוגי הקלפים שווים עשר, ולכן הקלף הסמוי הוא עשירייה בכ־{tens} מהמקרים. בתשלום 2:1 ההימור צריך {breakEven} כדי לצאת בשווה, ולכן הוא מפסיד כסף בכל פעם שעושים אותו. לקלפים שלך אין לזה שום קשר.',
  'coach.prompt.pair': 'זוג. אפשר לפצל אותו אם בא לך.',
  'coach.prompt.few': '{label}. אין הרבה ממה לבחור — מה עושים?',
  'coach.prompt.open': '{label} מול הקלף שלי. ההחלטה שלך.',
  'label.pair': 'זוג',
  'label.soft': 'רך {total}',
  'label.hard': '{total}',
  'log.vs': 'מול',
  'log.right': '{headline} · שיחקת נכון',
  'log.played': '{headline} · שיחקת {chosen}',
  'log.allRight': '{n} החלטות · שיחקת את כולן נכון',
  'log.someOff': '{n} החלטות · {bad} לא לפי המהלך הטוב ביותר',
  'log.playerNatural': 'בלאק ג׳ק — לא היה מה להחליט',
  'log.dealerNatural': 'בלאק ג׳ק לדילר — היד נגמרה כבר בחלוקה',
  'log.bothNaturals': 'בלאק ג׳ק לשני הצדדים — תיקו בחלוקה',
  'log.noDecisions': 'לא היה מה להחליט',
  'label.insurance': 'ביטוח',
  'label.vs': '{hand} מול {up}',

  // --- Table chrome ---
  'ui.blackjackTitle': 'מאמן EV — בלאק ג׳ק',
  'ui.changeRuleSet': 'שינוי מערכת החוקים',
  'ui.sessionStats': 'סטטיסטיקת המושב',
  'ui.decisionAccuracy': 'דיוק ההחלטות',
  'ui.evLostPer100': 'EV שאבד ל-100 ידיים',
  'ui.yourEdge': 'יתרון הקזינו מולך',
  'ui.units': 'יחידות',
  'ui.dealerName': 'ורה · דילרית',
  'ui.takeSeat': 'שב בנוחות. חלק כשאתה מוכן.',
  'ui.yourHand': 'היד שלך',
  'ui.actions': 'פעולות',
  'ui.pressDeal': 'לחץ על חלק כדי להתחיל.',
  'ui.ruleSet': 'מערכת חוקים',
  'ui.ruleSetNote': 'שינוי החוקים פותח מושב חדש. המהלך הנכון משתנה יחד איתם, וזו בדיוק הנקודה.',
  'ui.close': 'סגור',
  'ui.basicStrategy': 'אסטרטגיה בסיסית לחוקים האלה',
  'ui.chartNote': 'נגזר מחישוב ה-EV, לא הועתק מטבלה.',
  'ui.legend': 'H קלף · S עצירה · D הכפלה · P פיצול · R ויתור',
  'ui.strategyChart': 'טבלת אסטרטגיה',

  // --- Feedback card ---
  'fb.didNotDraw': 'לא משך קלף — נשרפת קודם. דילר חייב להמשיך למשוך עד 17.',
  'fb.optimal': 'נכון',
  'fb.negligible': 'זניח',
  'fb.minor': 'טעות קטנה',
  'fb.significant': 'טעות משמעותית',
  'fb.blunder': 'טעות גסה',
  'fb.correct': 'נכון — {action}',
  'fb.wrong': '{severity} — עלות {cost} יחידות',
  'fb.youChose': 'בחרת {chosen}. הכי טוב היה {best}.',
  'fb.closeCall': 'שתי האפשרויות המובילות במרחק של פחות ממאית יחידה.',
  'fb.skipAlways': 'לדלג ישר לתשובה, תמיד',
  'fb.skipAlwaysHint': 'נשמר לכל יד מעכשיו. אפשר לשנות בחזרה מתחת לכרטיס.',
  'fb.walkMe': 'להסביר לי שלב-שלב בפעם הבאה',
  'fb.skipNext': 'לדלג ישר לתשובה בפעם הבאה',
  'fb.ruleSensitive': 'תלוי בחוקים: {list}.',
  'fb.accuracyTip': 'שיעור ההחלטות שנוצקו נכון, אחרי שמנטרלים את הטלות המטבע.',
  'fb.accuracyAll': 'בספירה של הכול: {pct}%.',
  'fb.noCloseCalls': 'עוד לא היו מקרים צמודים.',

  // --- What comes back to you: the decision block and its `?` (round 13) ---
  'ret.title': 'כמה חוזר לך על כל יחידה בסיכון',
  'ret.helpAria': 'מה המספרים האלה אומרים?',
  'ret.helpClose': 'לסגור את ההסבר',
  'ret.same2': '{a} ו{b} שוות בדיוק כאן — ההפרש ביניהן נמצא מעבר לספרה השלישית.',
  'ret.sameMany': '{list} שוות בדיוק כאן — ההפרש ביניהן נמצא מעבר לספרה השלישית.',
  'ret.helpWhat': 'כל מספר הוא **כמה חוזר אליך על כל יחידה שכבר בסיכון**, בממוצע, אילו שיחקת את המצב הזה שוב ושוב. **1.000 זאת נקודת האיזון**: הכסף חוזר אליך ולא יותר מזה.',
  'ret.helpFold': 'פרישה היא המספר שאפשר לבדוק בלי להאמין לאף אחד: האנטה והבליינד אבודים ו**לא חוזר כלום** — ולכן היא 0.000.',
  'ret.helpRiver': 'בריבר שום דבר אינו הערכה: היד שלך מנצחת **{win}** מהידיים האפשריות של הדילר ויוצאת תיקו מול {tie} מהן, והאנטה, הבליינד וה-Play יחד יוצאים {value}.',
  'ret.helpRaise': 'להעלאה אין חשבון אחד: הימור ה-Play מצטרף למה שכבר בסיכון, והמנוע משחק את היד שלך מול כל יד שהדילר יכול להחזיק.',
  'ret.helpUthStake': 'כל מספר כאן הוא על כל יחידה של האנטה והבליינד, שני ההימורים שכבר על השולחן. העלאה מוסיפה עליהם את הימור ה-Play, והוא כבר בתוך המספר.',
  // --- One action, worked out, with this hand's own numbers (round 15) ---
  'work.stand': 'בחירה ב**{action}** תנצח כאשר הדילר נשרף, וזה קורה ב-**{win}** מהמקרים, וניצחון מחזיר שתי יחידות:',
  'work.stand.sum': '2 × {win} = {value}',
  'work.standPush': 'בחירה ב**{action}** תנצח ב-**{win}** מהמקרים ותצא תיקו ב-**{push}**. ניצחון מחזיר שתי יחידות, ותיקו מחזיר אחת:',
  'work.standPush.sum': '2 × {win} + {push} = {value}',
  'work.hit': 'בחירה ב**{action}** תשרוף את היד ב-**{bust}** מהמקרים, ואז לא חוזר כלום. ב-**{survive}** הנותרים תחזיק יד חדשה, שמחזירה בממוצע **{surviveValue}** — בהנחה שממשיכים לשחק אותה בצורה הטובה ביותר:',
  'work.hit.sum': '{survive} × {surviveValue} = {value}',
  'work.hitAlwaysBreaks': 'בחירה ב**{action}** תשרוף את היד בכל מקרה מכאן, ולכן לא חוזר כלום:',
  'work.hitAlwaysBreaks.sum': '{value}',
  'work.double': 'בחירה ב**{action}** מוסיפה יחידה שנייה לצד הראשונה ולוקחת קלף אחד בדיוק, ואז עוצרים. היד הזאת מחזירה **{oneCard}** ליחידה — אבל על שתי יחידות, פחות זו שהרגע הוספת:',
  'work.double.sum': '2 × {oneCard} − 1 = {value}',
  'work.split': 'בחירה ב**{action}** מוציאה הימור שני ומשחקת שתי ידיים. כל אחת מחזירה **{perHand}** ליחידה, בהנחה שממשיכים לשחק אותן היטב — על שתי יחידות, פחות זו שהרגע הוספת:',
  'work.split.sum': '2 × {perHand} − 1 = {value}',
  'work.surrender': 'בחירה ב**{action}** מוותרת על היד ומחזירה חצי מההימור, תמיד. זה המספר היחיד כאן שלא צריך שום חשבון:',
  'work.surrender.sum': '{value}',
  'work.insurance': 'ביטוח משלם 2:1, ולכן כל יחידה עליו חוזרת פי שלוש כשהקלף הסמוי הוא עשר — וזה קורה ב-**{ten}** מהמקרים:',
  'work.insurance.sum': '3 × {ten} = {value}',
  'work.decline': 'ויתור על הביטוח לא שם כלום בצד, ולכן אין שם מה להפסיד ואין מה שיחזור:',
  'work.decline.sum': '{value}',
  // --- Ultimate's own worked lines (round 19) ---
  'work.uthRiverPlay': 'כל הקלפים כבר על השולחן, ולכן אין כאן שום הערכה. מול **{outcomes}** הידיים שהדילר יכול להחזיק אתה מנצח **{wins}**, יוצא תיקו מול {ties} ומפסיד ל-{losses}. ניצחון כאן מחזיר בממוצע **{winPay}** — הימור ה-Play, האנטה כשהדילר עומד בתנאי, והבליינד — והפסד עולה **{losePay}**. הממוצע של כל זה מתווסף ל-1.000 שהוא ההימור עצמו חוזר:',
  'work.uthRiverPlay.sum': '1 + ({wins} × {winPay} − {losses} × {losePay}) ÷ {outcomes} ÷ 2 = {value}',
  'work.uthFlopPlay': 'בחירה ב**{action}** משחקת את היד הזאת מול כל טרן וריבר אפשריים ומול כל יד שהדילר יכול להחזיק — **{outcomes}** סיומים. אתה מסיים מלפנים ב-**{wins}** מהם, בתיקו ב-{ties} ומאחור ב-{losses}. סיום מלפנים מחזיר בממוצע **{winPay}**, סיום מאחור עולה **{losePay}**, והממוצע שלהם מצטרף ל-1.000 שההימור עצמו חוזר:',
  'work.uthFlopPlay.sum': '1 + ({wins} × {winPay} − {losses} × {losePay}) ÷ {outcomes} ÷ 2 = {value}',
  'work.uthFlopCheck': 'צ׳ק שומר את ההחלטה של הריבר, ושם משחקים נכון. מתוך **{boards}** הדרכים שבהן הטרן והריבר יכולים לצאת, ב-**{playBoards}** שווה להמר — **{playValue}** בממוצע — ובשאר **{foldBoards}** המהלך הנכון שם הוא לפרוש ב-2−. הממוצע שלהם מצטרף ל-1.000 שההימור עצמו חוזר:',
  'work.uthFlopCheck.sum': '1 + ({playBoards} × {playValue} + {foldBoards} × −2) ÷ {boards} ÷ 2 = {value}',
  'work.uthFold': 'פרישה מוותרת על האנטה ועל הבליינד ולא מחזירה כלום, תמיד. זה המספר היחיד כאן שלא צריך שום חשבון:',
  'work.uthFold.sum': '{value}',
  // --- The same decision in chips, which is what Ultimate hides (round 19) ---
  'ret.money.title': 'אותן בחירות, בציפים',
  'ret.money.puts': 'מוציא עכשיו',
  'ret.money.risk': 'בסיכון',
  'ret.money.back': 'חוזר בממוצע',
  'ret.money.note': 'האנטה והבליינד כבר על השולחן, ולכן **בסיכון** סופר גם אותם ו**חוזר בממוצע** הוא מה שהבחירה שווה. פרישה משאירה שני ציפים בסיכון ולא מחזירה כלום.',
  // --- The gestures: evidence, never a compliment (round 20) ---
  'gest.improved': '**חמש נכונות ברצף על {spot}.** {wrongs} הפעמים שטעית כאן — {played}.',
  'gest.improvedPlain': '**חמש נכונות ברצף על {spot}**, אחרי {wrongs} טעויות במצב הזה.',
  'gest.record': '**{streak} נכונות ברצף — השיא החדש שלך.** הקודם היה {previous}.',
  'gest.rightAndLost': '**שיחקת את היד הזאת מושלם והפסדת.** זה בדיוק מה שאמור לקרות לפעמים, ובגלל זה האפליקציה מודדת החלטות ולא תוצאות.',
  'records.title': 'השיאים שלך',
  'records.streak': '{n} ברצף',
  'records.mastered': '{n} מצבים מתוך {total}',
  'records.decisions': '{n} החלטות בסך הכול',
  'records.none': 'עוד אין כאן כלום — שחק כמה ידיים.',
  'sitting.line': 'בישיבה הזאת: **{decisions} החלטות**, {mistakes} מהן שגויות.',
  'sitting.clean': 'בישיבה הזאת: **{decisions} החלטות**, ואף אחת מהן לא שגויה.',
  'sitting.allOne': 'כולן היו באותו מצב — **{spot}**.',
  'sitting.leak': 'המצב שעלה הכי הרבה הוא **{spot}**, {n} פעמים.',
  'chart.mode.chart': 'הטבלה',
  'chart.mode.mastery': 'מה שכבר שלטת בו',
  'mastery.legend': '**שיחקת** · **שולט**: חמש פעמים, ארבע מהן נכונות, והשתיים האחרונות נכונות.',
  'mastery.count': '**{n} מתוך {total}** בשליטה',
  'ret.scale': 'לפני הפלופ שום דבר לא נפתר ליד השולחן. המספר הזה חושב פעם אחת, על פני **{outcomes}** סיומים לשני הקלפים שלך: כל בורד שיכול לצאת, כל יד שהדילר יכול להחזיק מאחוריו, שלושת ההימורים מסודרים, והכול ממוצע.',
  'ret.helpLines': 'הקו המקווקו הוא **1.000**. הקו המלא הוא המקום שאליו מגיעה הפעולה הטובה ביותר, ולכן המרווח בין עמודה לקו הזה הוא מה שהמהלך מוותר עליו. הסקאלה נגמרת ב-2.0 בכל יד — ולכן עמודה טובה שנשארת קצרה מספרת על יד שלא היה בה הרבה מלכתחילה.',

  // --- Said once, before the first hand ever played (round 13) ---
  'intro.title': 'לפני היד הראשונה שלך',
  'intro.body': 'זה לא משחק בלאק ג׳ק. כל החלטה שלך נמדדת מול המהלך הנכון מתמטית, ועל זה אתה מקבל ציון. **תפסיד ידיים גם כששיחקת מושלם — וזאת בדיוק הנקודה.**',
  'intro.ok': 'קדימה, נתחיל',

  // --- The hand analyser (round 16) ---
  'an.title': 'ניתוח יד',
  'an.tenKey': '10 J Q K',
  'ui.analyseTitle': 'EV Trainer — ניתוח יד',
  'an.open': 'לנתח יד',
  'an.sub': 'כל קלפים, בלי לשחק',
  'an.yours': 'הקלפים שלך',
  'an.dealers': 'לדילר יש',
  'an.tapYours': 'בחר שני קלפים.',
  'an.tapDealer': 'עכשיו הקלף של הדילר.',
  'an.tapMore': 'אפשר להוסיף קלף או לשנות חוקים.',
  'an.addCard': 'עוד קלף',
  'an.clear': 'להתחיל מחדש',
  'an.rules': 'חוקים',
  'an.best': 'המהלך הנכון: {action}',
  'an.notCounted': 'שום דבר כאן לא נספר לדירוג שלך בבלאק ג׳ק או באולטימייט, לדיוק שלך או לשום דבר אחר. זאת שאלה, לא יד.',
  'an.needCards': 'בחר שני קלפים לעצמך ואחד לדילר.',
  'an.tooManyCards': 'יד כאן מחזיקה עד {max} קלפים.',
  'an.badRank': 'אלה לא קלפים שהמשחק הזה מחלק.',
  'an.badRules': 'זאת לא מערכת חוקים שהאפליקציה מכירה.',
  'an.impossible': 'המשחק הזה מחלק {decks}. זה {held} קלפי {rank}, והיד הזאת מבקשת {count}.',
  'an.oneDeck': 'חפיסה אחת',
  'an.decks': '{n} חפיסות',
  'an.impossibleShort': 'לא נשארו מספיק קלפים בחפיסה ליד כזאת.',
  'an.bust': 'היד הזאת כבר {total} — מעל 21, ולכן אין מה להחליט.',
  'an.blackjack': 'זה בלאק ג׳ק. הוא משלם מעצמו; אין כאן החלטה.',
  'an.twentyOne': 'עשרים ואחת. היד עוצרת מעצמה, ולכן אין מה להחליט.',
  'an.rank.A': 'אס',
  'an.rank.2': '2',
  'an.rank.3': '3',
  'an.rank.4': '4',
  'an.rank.5': '5',
  'an.rank.6': '6',
  'an.rank.7': '7',
  'an.rank.8': '8',
  'an.rank.9': '9',
  'an.rank.10': 'עשר',

  // --- The slogan, and what the app is for (round 14) ---
  'brand.slogan': 'פשוט לנצח ביותר ידיים.',

  // --- The game itself, for a player who asked to be taught it (round 15) ---
  'prime.title': 'איך המשחק עובד',
  'prime.open': 'איך המשחק עובד',
  'prime.start': 'להתחיל לשחק',
  'prime.headOrder': 'סדר המשחק',
  'prime.order': 'אתה שם הימור, ואז מקבל **שני קלפים גלויים**. גם הדילר לוקח שניים: **אחד גלוי**, שאתה רואה, ואחד הפוך שאתה לא רואה. אחר כך זה התור שלך — אתה בוחר, קלף אחרי קלף, עד שאתה עוצר או עובר את 21. רק כשסיימת הדילר הופך את הקלף הסמוי ומשחק את היד שלו.',
  'prime.cards': 'שווי היד הוא סכום הקלפים שבה. מספרים שווים את עצמם, **קלף תמונה שווה עשר**, ו**אס שווה אחת-עשרה** — עד שזה יעביר אותך את 21, ואז הוא שווה אחת. כך שא׳-6 היא שבע-עשרה, או שבע אם קלף נוסף היה שורף אותה.',
  'prime.dealerRule': 'לדילר אין החלטות: הוא **מושך עד 16 ועוצר ב-17** ומעלה. בגלל זה הקלף שהוא מראה אומר כל כך הרבה.',
  'prime.headActions': 'מה כל בחירה עושה',
  'prime.hit': '**קלף** — לקחת עוד קלף אחד. אפשר להמשיך לקחת; אם עוברים את 21 היד מפסידה מיד, לא משנה מה הדילר יעשה אחר כך.',
  'prime.stand': '**עצירה** — לא לקחת עוד קלפים, ולתת לדילר לשחק את היד שלו.',
  'prime.double': '**הכפלה** — לשים הימור שני לצד הראשון ולקחת בדיוק קלף אחד נוסף. אחריו עוצרים, מה שלא יהיה.',
  'prime.split': '**פיצול** — מוצע רק כששני הקלפים שלך באותו ערך. שמים הימור שני ומשחקים אותם כשתי ידיים נפרדות.',
  'prime.surrender': '**ויתור** — לוותר על היד לפני שמשחקים אותה ולקבל חצי מההימור בחזרה. יש שולחנות שלא מציעים את זה.',
  'prime.insurance': '**ביטוח** — מוצע רק כשלדילר יש אס גלוי. זה הימור צדדי, חצי מהסכום שלך, על כך שהקלף הסמוי שלו שווה עשר. הוא משלם 2:1 ואין לו שום קשר ליד שלך.',
  'prime.headWin': 'מתי מנצחים',
  'prime.win': 'אתה מנצח כשהסכום שלך **קרוב ל-21 יותר משל הדילר** בלי לעבור, וגם כשהדילר עובר ואתה לא. סכום זהה הוא **תיקו**: ההימור פשוט חוזר אליך. אס עם קלף בשווי עשר בשני הקלפים הראשונים הוא **בלאק ג׳ק**, והוא משלם {pays} — אלא אם גם לדילר יש, ואז זה תיקו.',
  'prime.headPoint': 'מה זה בעצם',
  'prime.point': 'כל יד היא החלטה קטנה: שני הקלפים שלך מול הקלף של הדילר, ובחירה אחת שהיא טובה מהאחרות. האפליקציה מודדת את **הבחירה**, לא את התוצאה — ולכן מהלך נכון שהפסיד הוא עדיין נכון, וזה כל הרעיון.',

  // --- How much the app explains (round 14) ---
  'level.question': 'כמה שהאפליקציה תסביר?',
  'level.note': 'זה משנה רק כמה מוסבר לך — אף פעם לא את הציון. הציון, המספרים והדירוג שלך בבלאק ג׳ק ובאולטימייט זהים בכל הבחירות, ואפשר לשנות מתי שרוצים.',
  'level.new.title': 'תסביר לי הכול',
  'level.new.body': 'איך המשחק עצמו עובד, ומה המספרים אומרים, במילים פשוטות.',
  'level.intermediate.title': 'תסביר לי את ההחלטה',
  'level.intermediate.body': 'קצת מהבסיס, וכל ההסבר איך מגיעים להחלטה הנכונה.',
  'level.advanced.title': 'תראה לי את המספרים',
  'level.advanced.body': 'ההסבר, וגם הפירוט המלא: כל התוצאות של הדילר, המספרים המדויקים, כמה המצב נדיר, ומה היה קורה בחוקים אחרים.',
  'ui.plain.accuracy': 'החלטות נכונות',
  'ui.plain.evLost': 'עלות הטעויות ל-100 ידיים',
  'ui.plain.units': 'צ׳יפים, פלוס או מינוס',
  'ui.moreBelow': 'יש עוד מתחת',

  // --- The breakdown, at Advanced (round 14) ---
  'bd.title': 'הפירוט המלא',
  'bd.dealer': 'הדילר, מהקלף הזה: {list}.',
  'bd.breaks': 'נשרף',
  'bd.natural': 'בלאק ג׳ק',
  'bd.exact': 'במדויק: {list}.',
  'bd.rarity': 'בערך יד אחת מכל {oneIn} היא המצב הזה, והוא {band}: רמת קושי {difficulty}.',
  'bd.rules': 'בחוקים אחרים: {list}.',
  'bd.rulesNone': 'התשובה הזאת נכונה בכל מערכות החוקים שהאפליקציה מציעה.',

  'ui.why': 'למה?',
  'ui.thinkPrompt': 'קח רגע. מה הקלף שלי מספר לך?',
  'ui.dealWhenReady': 'חלק כשאתה מוכן.',
  'ui.edgeNote': 'גם משחק מושלם מפסיד {pct}% מכל יחידה שמהמרים.',
  'ui.chart.hard': 'קשה',
  'ui.chart.soft': 'רך',
  'ui.chart.pairs': 'זוגות',

  // --- Home, generated ---
  'home.greet.none': 'עוד לא שיחקת. בחר שולחן.',
  'home.greet.early': '{hands} ידיים. עוד בהתחלה.',
  'home.greet.clean': '{hands} ידיים, ואתה משחק אותן טוב.',
  'home.greet.close': '{hands} ידיים. קרוב לנקי.',
  'home.greet.work': '{hands} ידיים. יש כאן עוד עבודה.',
  'home.ratingOf': 'דירוג בלאק ג׳ק · {mode}',
  'home.unrated': 'בלאק ג׳ק · עוד ללא דירוג',
  'home.rating.none': 'שחק כמה ידיים והמספר הזה יתייצב. הוא עולה כשאתה מנצח מצב קשה ויורד כשאתה מפסיד קל.',
  'home.rating.settling': 'עדיין מתייצב — עוד כ-{left} החלטות עד שזה יתחיל להגיד משהו.',
  'home.rating.peak': 'שיא {peak}. הוא זז עם כל החלטה, לשני הכיוונים.',
  'home.noHands': 'עוד אין ידיים במושב הזה. כל יד שתשחק תופיע כאן, יחד עם מה שהיא עלתה.',
  'home.noStats': 'עוד אין מה למדוד. שחק יד או שתיים.',
  'home.excluded': '{n} הטלות מטבע הוצאו מהחישוב — מצבים שבהם שתי האפשרויות הטובות במרחק של פחות ממאית יחידה. בספירה שלהן, זה {pct}%.',
  'home.excludedOne': 'הטלת מטבע אחת הוצאה מהחישוב — מצב שבו שתי האפשרויות הטובות במרחק של פחות ממאית יחידה. בספירה שלה, זה {pct}%.',
  'home.noExcluded': 'לכל החלטה עד כה היה מהלך אחד ברור.',
  'home.fig.accuracy': 'מההחלטות שלך היו המהלך הטוב ביותר',
  'home.fig.evLost': 'יחידות שנמסרו למאה ידיים',
  'home.fig.evLostNote': 'מה שהטעויות שלך עלו, בנפרד מהאופן שבו הקלפים במקרה נפלו.',
  'home.fig.edge': 'היתרון שאתה באמת משחק מולו',
  'home.fig.edgeNote': 'הקזינו לוקח {pct}% ממשחק מושלם תחת החוקים האלה. את השאר אתה יכול לסגור.',
  'home.fig.units': 'יחידות, במושב הזה',
  'home.fig.unitsNote': 'איך שהקלפים נפלו. נשמר לסוף בכוונה.',
  'home.handsPlayed': '{hands} ידיים שוחקו',
  'home.footer': 'תחת החוקים האלה גם משחק מושלם מפסיד {pct}% מכל יחידה שמהמרים. זה מלמד אותך להפסיד פחות, לא לנצח.',

  // --- Ultimate preview ---
  'uth.blindPays': 'הבליינד משלם על רצף ומעלה',
  'uth.yourHand': 'היד שלך',
  'uth.preflopStreet': 'פרה-פלופ · העלאה ⁦4×⁩ או צ׳ק',
  'uth.flopStreet': 'פלופ · העלאה ⁦2×⁩ או צ׳ק',
  'uth.riverStreet': 'ריבר · העלאה ⁦1×⁩ או פרישה',
  'uth.tripsPanel': 'הימור צד טריפס',
  'uth.preflopPanel': 'טבלת פרה-פלופ',
  'uth.dealAnother': 'חלק עוד אחת',
  'uth.solving': 'מחשב…',
  'uth.raise4': 'העלאה ⁦4×⁩',
  'uth.raise3': 'העלאה ⁦3×⁩',
  'uth.raise2': 'העלאה ⁦2×⁩',
  'uth.raise1': 'העלאה ⁦1×⁩',
  'uth.check': 'צ׳ק',
  'info.uthEvLost.title':
    'EV שאבד ל-100 ידיים',
  'info.uthEvLost.body':
    '**כמה שיותר נמוך. 0 זה מושלם** — אי אפשר לרדת מתחת ל-0, כי אין משחק טוב יותר מהמשחק המושלם. זה מה שהטעויות שלך עולות לאורך מאה ידיים, ביחידות של **האנטה**; שחקן מושלם מקבל כאן אפס בלי קשר לאיך שהקלפים נפלו. זה המספר היחיד כאן ששלך לגמרי.',
  'info.uthEdge.title':
    'יתרון הקזינו מולך',
  'info.uthEdge.body':
    '**כמה שיותר נמוך.** הרצפה היא היתרון של המשחק עצמו מול משחק מושלם, {rulesEdge} מהאנטה, מחושב במדויק מכל הידיים הפותחות. ספירת קלפים לא יכולה להוריד אותו: החפיסה נטרפת לפני כל יד. המספר הזה הוא בדיוק הרצפה הזו ועוד ה-EV שאבד לך ל-100 ידיים, ולכן כל מה שמעל {rulesEdge} הוא הטעויות שלך.',
  'hand.chips':
    '{n} צ׳יפים',
  'bet.yourBet':
    'הימור',
  'bet.limits':
    'מגבלות השולחן {range}',
  'bet.chip':
    'הוסף צ׳יפ של {value}',
  'bet.spot':
    'ההימור שלך: {bet} צ׳יפים. הקשה מחזירה את הצ׳יפ האחרון.',
  'sens.s17':
    'אם הדילר היה עוצר על 17 רך',
  'sens.h17':
    'אם הדילר היה מושך על 17 רך',
  'sens.noSurrender':
    'בלי ויתור מאוחר',
  'sens.lateSurrender':
    'כשיש ויתור מאוחר',
  'sens.noDas':
    'בלי הכפלה אחרי פיצול',
  'sens.noHoleCard':
    'במשחק בלי קלף סגור',
  'bet.change':
    'הימור {bet} · שינוי',
  'bet.clear':
    'נקה',
  'bet.repeat':
    'חזור על {bet}',
  'bet.double':
    'הכפל ל-{bet}',
  'bet.place':
    'הקש על צ׳יפ כדי להניח הימור.',
  'rebuy.line':
    'נגמרו הצ׳יפים. קח עוד {n} — בחינם, כמה פעמים שתרצה.',
  'rebuy.button':
    'קח {n} צ׳יפים',
  'track.title':
    'ידיים אחרונות',
  'track.empty':
    'הידיים שלך יסתדרו כאן תוך כדי משחק, נקודה לכל החלטה.',
  'track.row':
    '{n} החלטות, תוצאה {net} צ׳יפים. פותח את היד ברשימת הידיים.',
  'track.rowOne':
    'החלטה אחת, תוצאה {net} צ׳יפים. פותח את היד ברשימת הידיים.',
  'track.rowNone':
    'בלי החלטה: היד נגמרה בחלוקה. תוצאה {net} צ׳יפים. פותח את היד ברשימת הידיים.',
  'uth.logTitle':
    'ידיים',
  'uth.logEmpty':
    'כל יד שתשחק נשמרת כאן, עם ציון לכל החלטה.',
  'uth.howto.1':
    'חלק כדי להניח **אנטה 1** ו**בליינד 1**. אחר כך מחליטים: העלאה **⁦4×⁩** או צ׳ק לפני הפלופ, **⁦2×⁩** או צ׳ק בפלופ, **⁦1×⁩** או פרישה בריבר. העלאה אחת מסיימת את ההחלטות שלך.',
  'uth.howto.2':
    'הציון הוא על **ההחלטה**, לא על התוצאה: הכרטיס מראה כמה שווה כל אפשרות וכמה עלתה הבחירה שלך. הקלפים מגיעים אחריו, ובשקט.',
  'uth.howto.trips':
    '**טריפס** הוא הימור רשות, בעיגול משלו ליד האנטה. הוא משלם לפי שבעת הקלפים שלך — גם אחרי קיפול — ועולה **{edge}** מכל הימור שמונח עליו. הוא אף פעם לא מקבל ציון.',
  'uth.class.pair':
    'זוג {p}',
  'uth.class.suited':
    '{hilo} באותה צורה',
  'uth.class.offsuit':
    '{hilo} בצורות שונות',
  'uth.note.suitFlips':
    'בגלל שהקלפים שלך באותה צורה, **{best}** מחזיר {ev}. עם אותם קלפים בצורות שונות הבחירה הטובה היא **{offBest}**, שמחזיר {offEv} — הצורה משנה את ההחלטה.',
  'uth.note.suitSame':
    'הצורה המשותפת מוסיפה כאן {gap} — **{best}** מחזיר {ev} באותה צורה ו-{offEv} בצורות שונות — אבל ההחלטה זהה.',
  'uth.note.connector':
    'ההפתעה שכדאי לדעת: באולטימייט גם קלפים עוקבים באותה צורה כמו אלה הם צ׳ק לפני הפלופ, לא העלאה. אתה מול היד של הדילר, ושם קלפים גבוהים שווים יותר; הסיכוי לפלאש או לרצף הוא מה שהופך את היד לשווה שמירה, ולשווה הימור בהמשך אם הוא מגיע.',
  'uth.note.onlyWith':
    'הדילר מנצח אותך רק עם {list}.',
  'uth.note.closest':
    'הידיים הקרובות ביותר שמנצחות אותך: {list}.',
  'uth.note.nothingBeats':
    'אין לדילר יד שמנצחת אותך.',
  'uth.list.or':
    ' או ',
  'uth.show.you':
    'אתה: {hand} ({five})',
  'uth.show.dealer':
    'הדילר: {hand} ({five})',
  'uth.note.suitOffSame':
    'הקלפים שלך בצורות שונות: **{best}** מחזיר {ev}. אותם ערכים באותה צורה היו מחזירים {suitedEv}, עם אותה בחירה טובה.',
  'uth.note.suitOffFlips':
    'הקלפים שלך בצורות שונות, ולכן הבחירה הטובה היא **{best}**, שמחזיר {ev}. אותם ערכים באותה צורה היו הופכים אותה ל-**{suitedBest}**, שמחזיר {suitedEv} — הצורה הייתה משנה את ההחלטה.',
  'uth.show.youWin':
    'אתה מנצח: {you} מול {dealer}',
  'uth.show.dealerWins':
    'הדילר מנצח: {dealer} מול {you}',
  'uth.show.youWinKicker':
    'אתה מנצח בקלף הצד: {hand} לשניכם',
  'uth.show.dealerWinsKicker':
    'הדילר מנצח בקלף הצד: {hand} לשניכם',
  'uth.show.tie':
    'תיקו: {hand} לשניכם',
  'uth.show.legend':
    'טבעת זהב: חמשת הקלפים שלך. טבעת כחולה: של הדילר. קלף לוח ששייך לשתי הידיים נושא את שתיהן, כחול בצד של הדילר וזהב בצד שלך.',
  'uthHand.0':
    'קלף גבוה {r1}',
  'uthHand.1':
    'זוג {p1}',
  'uthHand.2':
    'שני זוגות, {p1} ו-{p2}',
  'uthHand.3':
    'שלישייה של {p1}',
  'uthHand.4':
    'רצף עד {r1}',
  'uthHand.5':
    'פלאש עד {r1}',
  'uthHand.6':
    'פול האוס, שלושה {p1} ושניים {p2}',
  'uthHand.7':
    'רביעייה של {p1}',
  'uthHand.8':
    'סטרייט פלאש עד {r1}',
  'uthHand.royal':
    'רויאל פלאש',
  'uthHand.kicker':
    '{hand} עם קלף צד גבוה יותר',
  'rankName.0':
    '⁦2⁩',
  'rankPlural.0':
    '⁦2⁩',
  'rankName.1':
    '⁦3⁩',
  'rankPlural.1':
    '⁦3⁩',
  'rankName.2':
    '⁦4⁩',
  'rankPlural.2':
    '⁦4⁩',
  'rankName.3':
    '⁦5⁩',
  'rankPlural.3':
    '⁦5⁩',
  'rankName.4':
    '⁦6⁩',
  'rankPlural.4':
    '⁦6⁩',
  'rankName.5':
    '⁦7⁩',
  'rankPlural.5':
    '⁦7⁩',
  'rankName.6':
    '⁦8⁩',
  'rankPlural.6':
    '⁦8⁩',
  'rankName.7':
    '⁦9⁩',
  'rankPlural.7':
    '⁦9⁩',
  'rankName.8':
    '⁦10⁩',
  'rankPlural.8':
    '⁦10⁩',
  'rankName.9':
    '⁦J⁩',
  'rankPlural.9':
    '⁦J⁩',
  'rankName.10':
    '⁦Q⁩',
  'rankPlural.10':
    '⁦Q⁩',
  'rankName.11':
    '⁦K⁩',
  'rankPlural.11':
    '⁦K⁩',
  'rankName.12':
    '⁦A⁩',
  'rankPlural.12':
    '⁦A⁩',
  'uth.board':
    'הלוח',
  'uth.ante':
    'אנטה',
  'uth.blind':
    'בליינד',
  'uth.play':
    'פליי',
  'uth.atRisk':
    'במשחק',
  'uth.pressDeal':
    'חלק כדי להניח אנטה {bet} ובליינד {bet}.',
  'uth.nextHand':
    'היד הבאה',
  'uth.keys':
    'מקשים: 4 · 3 · C לפני הפלופ, 2 · C בפלופ, 1 · F בריבר, N ליד הבאה.',
  'uth.rulesLine':
    'הבליינד משלם על רצף ומעלה · הדילר מתאים עם זוג',
  // --- The rule panel this table gained in round 19 ---
  'uth.blind.standard':
    'הבליינד משלם: רצף 1 · פלאש 3:2 · פול האוס 3 · רביעייה 10 · רצף פלאש 50 · רויאל פלאש 500',
  'uth.blind.fixed':
    'טבלת התשלום של הבליינד קבועה, ויש לכך סיבה אחת אמיתית: כל מספר שהמאמן מציג נפתר מולה, והטבלה שלפני הפלופ לבדה דרשה **שני מיליארד סיומים לכל יד פתיחה**. טבלה שנייה פירושה לפתור את המשחק מחדש, לא להזיז מתג.',
  'uth.rules.trips': 'טבלת התשלום של Trips',
  'uth.rules.tripsNote':
    'Trips נסגר על שבעת הקלפים שלך בלבד ואף פתרון לא קורא אותו, ולכן שינוי כאן לא מזיז שום דבר שנבדק, מדורג או מנוקד. מה שכן מתאפס היא שורת ה-Trips בסטטיסטיקה — עלות שנמדדת מול שתי טבלאות בבת אחת לא מודדת כלום.',
  'uth.rules.pays': 'שלישייה · רצף · פלאש · פול האוס · רביעייה · רצף פלאש · רויאל',
  'uth.rules.costs': 'עולה {edge} מכל מה שמונח עליו',
  'uth.rules.limits': 'מגבלות השולחן: {min} עד {max} ליד',
  'uth.trips.trips-a': 'טבלה I',
  'uth.trips.trips-b': 'טבלה II',
  'uth.trips.trips-c': 'טבלה III',
  'uth.readingFlop':
    'קורא את הפלופ…',
  'uth.h.preflop':
    '{class} · לפני הפלופ',
  'uth.h.flop':
    '{class} · בפלופ',
  'uth.h.river':
    '{class} · בריבר',
  'uth.s.threeX':
    '⁦3×⁩ הוא המהלך הטוב ביותר **באף אחת מ-169 הידיים הפותחות** — כל יד ששווה להעלות, שווה להעלות את המקסימום. כאן הוא מוותר על **{cost}** מול {best}.',
  'uth.s.preRaise':
    'היד הזו חזקה מספיק להעלאה המקסימלית: ⁦4×⁩ שווה **{gap}** יותר מצ׳ק.',
  'uth.s.preCheck':
    'היד הזו שווה יותר בצ׳ק. אחרי צ׳ק, היא ממשיכה להעלאה בפלופ ב-{flopRaise} מהמקרים ולפרישה בריבר ב-{riverFold} מהמקרים.',
  'uth.s.flopRaise':
    '⁦2×⁩ עדיף על צ׳ק ב-**{gap}**. אחרי צ׳ק, היד הזו מגיעה לפרישה בריבר ב-{riverFold} מהמקרים.',
  'uth.s.flopCheck':
    'צ׳ק עדיף על ⁦2×⁩ ב-**{gap}**. נשארת לך החלטת ⁦1×⁩ בריבר, ופורשים בה ב-{riverFold} מהמקרים.',
  'uth.s.riverRaise':
    'היד שלך מנצחת **{win}** מהידיים האפשריות של הדילר, משתווה ל-{tie} ומפסידה ל-{lose} — שווה יותר מפרישה ב-{fold} יחידות.',
  'uth.s.riverFold':
    'היד שלך מנצחת רק **{win}** מהידיים האפשריות של הדילר, משתווה ל-{tie} ומפסידה ל-{lose}, ולכן ⁦1×⁩ מפסיד יותר מפרישה ב-{fold} יחידות.',
  'uth.line.dealerQualified':
    'הדילר מתאים עם זוג ומעלה — אנטה {ante}',
  'uth.line.dealerNotQualified':
    'הדילר לא מתאים — האנטה בתיקו',
  'uth.line.tie':
    'תיקו — כל ההימורים חוזרים',
  'uth.line.playWin':
    'פליי {bet} מנצח {play}',
  'uth.line.playLose':
    'פליי {bet} מפסיד {play}',
  'uth.line.playPush':
    'פליי {bet} בתיקו',
  'uth.line.blindPaid':
    'הבליינד משלם {blind} על רצף ומעלה',
  'uth.line.blindPush':
    'הבליינד בתיקו — הניצחון היה מתחת לרצף',
  'uth.line.blindLose':
    'הבליינד מפסיד {blind}',
  'uth.line.blindTie':
    'הבליינד בתיקו',
  'uth.line.folded':
    'פרשת — הקלפים של הדילר נשארים סגורים',
  'uth.line.foldPlay':
    'לא הונח הימור פליי',
  'uth.line.forfeit':
    'האנטה והבליינד אבודים: {lost}',
  'uth.line.net':
    'היד {net} צ׳יפים',
  'uth.fold': 'פרישה',
  'uth.threeXNever': 'ההעלאה של ⁦3×⁩ מפסידה לשתי האפשרויות האחרות כאן — כמו בכל מקום אחר.',
  'uth.stillComputing': 'המחלקה הזו עדיין בחישוב על ידי העבודה הלא-מקוונת. הפלופ והריבר למטה מדויקים.',

  // --- House restrictions (real rules, not display filters) ---
  'rules.house': 'הגבלות של הקזינו',
  'rules.noSurrender': 'בלי ויתור',
  'rules.noSurrenderNote': 'ברוב השולחנות אין ויתור. ביטול האפשרות משנה את המהלך הנכון ב-15 וב-16.',
  'rules.likeRanksOnly': 'פיצול רק לקלפים זהים',
  'rules.likeRanksOnlyNote': 'נסיך לצד מלכה הופך ליד קשה של עשרים. זה מוריד מהלך שממילא אף פעם לא היה נכון, ולכן שום תשובה אחרת לא משתנה.',
  'rules.restartsSession': 'כל אחת מהן מתחילה מושב חדש — הן חלק ממערכת החוקים שממנה נפתרת הטבלה.',

  // --- What the four figures mean (§9.2) ---
  'info.accuracy.title': 'דיוק ההחלטות',
  'info.accuracy.body':
    '**כמה שיותר גבוה.** היעד הוא 99% ומעלה לאורך 500 ידיים. זה שיעור ההחלטות שלך שהיו המהלך הטוב ביותר שהיה זמין. הטלות מטבע — מצבים שבהם שתי האפשרויות המובילות במרחק של פחות ממאית יחידה — לא נספרות, כי “לטעות” בהן זו לא באמת טעות. הציון ניתן על ההחלטה, לעולם לא על השאלה אם היד ניצחה.',
  'info.evLost.title': 'EV שאבד ל-100 ידיים',
  'info.evLost.body':
    '**כמה שיותר נמוך. 0 זה מושלם** — אי אפשר לרדת מתחת ל-0, כי אין משחק טוב יותר מהמשחק המושלם. זה מה שהטעויות שלך עולות, ביחידות של ההימור, לאורך מאה ידיים — שחקן מושלם מקבל כאן אפס בלי קשר לאיך שהקלפים נפלו. זה המספר שכדאי לעקוב אחריו: הוא היחיד ששלך לגמרי.',
  'info.edge.title': 'יתרון הקזינו מולך',
  'info.edge.body':
    '**כמה שיותר נמוך.** הרצפה היא יתרון החוקים עצמם, {rulesEdge}, ומתחתיה אי אפשר לרדת בלי ספירת קלפים. המספר הזה הוא בדיוק הרצפה הזו ועוד ה-EV שאבד לך ל-100 ידיים — כל מה שמעל {rulesEdge} הוא הטעויות שלך, וזה החלק שאתה יכול לסגור.',
  'info.units.title': 'יחידות',
  'info.units.body':
    '**זה לא מודד איך ששיחקת.** זה יכול להיות חיובי או שלילי, ולאורך מושב קצר כזה זה כמעט הכול מזל. גם שחקן מושלם מפסיד בסשנים רבים — זה לא סימן לטעות. נשמר לסוף, ובשקט, כי ההרגל לקרוא את זה כציון הוא בדיוק מה שהמאמן הזה קיים כדי לשבור.',
  'info.more': 'מה זה אומר?',

  // --- Instructions ---
  'howto.title': 'איך זה עובד',
  'howto.open': 'איך משחקים',
  'howto.1': 'לחץ **חלק**, ואז בחר את המהלך שנראה לך הכי טוב. מקלדת: **H** קלף, **S** עצירה, **D** הכפלה, **P** פיצול, **R** ויתור, ו־**Y** / **N** לביטוח.',
  'howto.2': 'הדילרית קוראת לך את המצב בשלושה שלבים — הקלף שלה, היד שלך, ואז השניים יחד. **רווח** מתקדם ביניהם, או אפשר לדלג ישר לתשובה.',
  'howto.3': 'הציון הוא על **ההחלטה**, לא על התוצאה. מהלך נכון שהפסיד הוא עדיין נכון, וזה כל הרעיון.',
  'howto.4': 'שאל **למה?** בכל רגע לפני שאתה פועל; היא תענה מאותם מספרים שלפיהם היא מדרגת אותך.',

  // --- The value of doubling ---
  'stat.doubleMissed': 'אותו קלף בדיוק, על **חצי מהכסף** — מה שוויתרת עליו הוא **ההעלאה**, לא היד.',

  'fb.accuracyCount': '**{right} מתוך {total}** החלטות נכונות עד כה.',
  'fb.accuracyExcluded': '{n} מקרים צמודים הוצאו — מצבים שבהם שתי האפשרויות הטובות נבדלות בפחות מ-0.01 יחידות, וזה בתוך הרעש.',
  'fb.accuracyExcludedOne': 'מקרה צמוד אחד הוצא — מצב שבו שתי האפשרויות הטובות נבדלות בפחות מ-0.01 יחידות, וזה בתוך הרעש.',

  // --- The shared build: other people ---
  'social.table': 'השולחן',
  'social.feed': 'פיד',
  'social.connecting': 'מחפש את האחרים…',
  'social.offlineNow':
    'אין חיבור — אי אפשר להגיע לשולחן המשותף כרגע. המשחקים עובדים כרגיל; הרשומה שלך נשמרת במכשיר הזה ומצטרפת לשולחן כשהחיבור חוזר.',
  'social.offline': 'כאן אתה משחק לבד — השולחן המשותף דורש חיבור שהדף הזה לא הצליח לקבל. כל השאר עובד.',
  'social.noPlayers': 'אף אחד עוד לא שיחק יד מדורגת. תהיה הראשון.',
  'social.noFeed': 'עוד אין כלום בפיד. ידיים מגיעות לכאן כשמישהו עושה טעות גדולה או מחזיק מצב קשה.',
  'social.playerLine': '{accuracy}% על פני {hands} ידיים',
  'social.you': 'אתה',
  'social.held': 'החזיק — **{action}** היה נכון.',
  'social.missed': 'שיחק {chosen}; **{optimal}** היה נכון. עלות {cost}.',
  'social.justNow': 'ממש עכשיו',
  'social.minutes': 'לפני {n} דק׳',
  'social.hours': 'לפני {n} שע׳',
  'social.days': 'לפני {n} ימים',

  'welcome.line': 'ידיים אמיתיות, מחולקות כמו שצריך. אתה מחליט, ואז מגלה מה המתמטיקה אומרת — ולמה.',
  'welcome.nameLabel': 'איך לקרוא לך?',
  'welcome.placeholder': 'השם שלך',
  'welcome.start': 'שב לשולחן',
  'welcome.fine': 'בלי חשבון ובלי סיסמה. השם הוא כדי שהאחרים יראו אותך בשולחן.',

  'fb.thinking': 'חושבים על זה',

  // --- The rail ---
  'ui.stack': 'קופה',
  'ui.wager': 'על השולחן',
  'ui.dealt': 'חולק',
  'ui.drawn': 'נמשך',
  'ui.cardDealt': '{card}, מהחלוקה',
  'ui.cardDrawn': '{card}, נמשך בלקיחה {n}',

  'hand.doubled': 'הוכפל',
  // What became of a hand, in one word, for the seat's header (round 17).
  'hand.won': 'ניצחת',
  'hand.lost': 'הפסדת',
  'hand.push': 'תיקו',
  'hand.nth': 'יד {n}',
  'hand.surrendered': 'ויתור',
  'hand.units': '{n} יחידות',

  // --- Table talk (§3.4) ---
  'dealer.youBust': 'נשרפת.',
  'dealer.iBust': 'הדילר נשרף. היד שלך.',
  'dealer.blackjack': 'בלאק ג׳ק. משלם {pays}.',
  'dealer.pays32': '3 ל-2',
  'dealer.pays65': '6 ל-5',
  'dealer.dealerNatural':
    'אס ועשר — בלאק ג׳ק לדילר, ולכן היד נגמרת לפני שמשחקים אותה. שום דבר לא דולג — פשוט לא נשאר מה להחליט.',
  'dealer.bothNaturals': 'גם לדילר בלאק ג׳ק. תיקו — ההימור נשאר.',
  'dealer.push': 'תיקו — ההימור נשאר.',
  'dealer.surrendered': 'חצי בחזרה. עוברים לבאה.',
  'dealer.youWin': '{player} מול {dealer} של הדילר. היד שלך.',
  'dealer.iWin': 'לדילר {dealer}. היד הזאת לקזינו.',
  'dealer.youWinPlain': 'אלה טובות. היד משלמת.',
  'dealer.iWinPlain': 'היד הזאת הולכת לקזינו.',

  // --- Playing well (§3.4) ---
  'fb.streak': '{n} החלטות נכונות ברצף',
  'fb.streakBest': 'הרצף הטוב במושב הזה: {n}.',
  'fb.streakCounts': 'רצף של החלטות נכונות. מקרים צמודים לא מאריכים אותו ולא שוברים אותו, והוא מתחיל מחדש בכל מושב.',
  'fb.milestone': '**{n} ברצף** — {hard} מהן נחשבות קשות בטבלה.',
  'fb.milestoneOne': '**{n} ברצף** — אחת מהן נחשבת קשה בטבלה.',
  'fb.milestoneNone': '**{n} ברצף**.',

  'ui.ratingPoints': 'דירוג בלאק ג׳ק {delta}',
  'home.sessionSwing': '{delta} במושב הזה',
  'ui.ratingUnrated': 'לא מדורג',
  'fb.ratingWhy': 'דירוג הבלאק ג׳ק שלך זז לפי ההחלטה ולפי כמה שהיא הייתה קשה — לעולם לא לפי זה שהיד ניצחה.',
  'ui.uthRatingPoints': 'דירוג אולטימייט {delta}',
  'fb.uthRatingWhy': 'דירוג האולטימייט שלך זז לפי ההחלטה ולפי כמה שהיא הייתה קשה — לעולם לא לפי זה שהיד ניצחה.',
  'fb.uthUnratedWhy': 'ברורה מדי כדי לדרג: לשחק אותה נכון לא אומר כלום על כמה טוב אתה משחק.',
  'home.uthRating': 'דירוג אולטימייט',
  'home.uthUnrated': 'אולטימייט · עוד ללא דירוג',
  'home.uthRating.none': 'שחק כמה ידיים של אולטימייט והמספר הזה יתייצב — מספר משלו. הוא לעולם לא מתחבר לדירוג הבלאק ג׳ק שלך.',
  'home.uthRating.settling': 'עדיין מתייצב — עוד כ-{left} החלטות מדורגות עד שזה יתחיל להגיד משהו.',
  'home.uthRating.peak': 'שיא {peak}. רק ההחלטות הקשות יותר מזיזות אותו.',
  'home.remember': 'רשום לעצמך את השם והקוד — תצטרך אותם פעם אחת.',
  'home.ladderHead': 'מה נחשב קשה במצב הזה',
  'home.ladderOneIn': 'יד אחת מכל {n}',
  'uth.trips': 'טריפס',
  'uth.line.tripsPaid': 'טריפס משלם {multiple} ל־1 על {hand}: {won}',
  'uth.line.tripsLose': 'טריפס מפסיד {lost} — פחות משלישייה',
  'uth.line.tripsCost': 'טריפס עולה {edge} ממה שמונח עליו, לאורך זמן, לא משנה איך ייפול הערב.',
  'bet.spotTrips': 'טריפס: {bet} צ׳יפים. הקשה מחזירה את הצ׳יפ האחרון.',
  'bet.chooseAnte': 'אנטה: {bet} צ׳יפים. הקשה כדי להניח כאן צ׳יפים.',
  'bet.chooseTrips': 'טריפס: {bet} צ׳יפים. הקשה כדי להניח כאן צ׳יפים.',
  'home.tripsHead': 'טריפס, באולטימייט',
  'home.fig.tripsPut': 'צ׳יפים שהונחו על טריפס',
  'home.fig.tripsPutNote': 'לאורך {hands} ידיים.',
  'home.fig.tripsPutNoteOne': 'ביד אחת.',
  'preset.vegas-strip-6d-s17': 'וגאס סטריפ · 6 חפיסות · S17',
  'preset.downtown-h17': 'דאונטאון · H17',
  'preset.single-deck-6-5': 'חפיסה אחת · ⁦6:5⁩',
  'preset.single-deck-6-5.note': 'תשלום של ⁦6:5⁩ על בלאק ג׳ק לבדו מוסיף בערך ⁦1.4%⁩ ליתרון הבית — בחירת חוק שעולה יותר מכל טעויות האסטרטגיה של שחקן טיפוסי ביחד.',
  'preset.european-nhc': 'אירופאי, בלי קלף סגור',
  'preset.european-nhc.note': 'הדילר לא לוקח קלף סגור. בלאק ג׳ק של הדילר לוקח גם את ההכפלות והפיצולים שלך, וזה משנה את המהלך הנכון מול אס או עשר.',
  'badge.noDas': 'בלי DAS',
  'badge.surrender.none': 'בלי ויתור',
  'badge.surrender.late': 'ויתור מאוחר',
  'badge.surrender.early': 'ויתור מוקדם',
  'badge.likeRanks': 'פיצול רק בערכים זהים',
  'badge.noHoleCard': 'בלי קלף סגור',
  'card.label': '{rank} {suit}',
  'card.rank.2': '2',
  'card.rank.3': '3',
  'card.rank.4': '4',
  'card.rank.5': '5',
  'card.rank.6': '6',
  'card.rank.7': '7',
  'card.rank.8': '8',
  'card.rank.9': '9',
  'card.rank.10': '10',
  'card.rank.J': 'נסיך',
  'card.rank.Q': 'מלכה',
  'card.rank.K': 'מלך',
  'card.rank.A': 'אס',
  'card.suit.clubs': 'תלתן',
  'card.suit.diamonds': 'יהלום',
  'card.suit.hearts': 'לב',
  'card.suit.spades': 'עלה',
  'card.faceDown': 'קלף הפוך',
  'key.space': 'רווח',
  'home.fig.tripsCost': 'כמה טריפס עולה לאורך זמן',
  'home.fig.tripsCostNote': '{edge} ממה שהונח עליו: המחיר של ההימור, לא משנה מה עשה הערב.',
  'home.fig.tripsResult': 'מה טריפס עשה בפועל, בצ׳יפים',
  'home.fig.tripsResultNote': 'איך שהקלפים נפלו עליו. זה לא אומר כלום על כמה טוב שיחקת.',
  'social.byBlackjack': 'לפי דירוג בלאק ג׳ק',
  'social.byUltimate': 'לפי דירוג אולטימייט',
  'social.noUthPlayers': 'עוד לאף אחד אין דירוג אולטימייט. כמה ידיים של אולטימייט ואתה הראשון.',
  'social.uthPending': 'דירוגי אולטימייט יופיעו כאן אחרי שהטבלה המשותפת תעודכן בשבילם.',
  'social.uthPlayerLine': '{decisions} החלטות אולטימייט',
  'fb.unratedWhy': 'אין כאן החלטה אמיתית, ולכן אין מה לדרג.',

  'spot.routine': 'שגרתי',
  'spot.ordinary': 'רגיל',
  'spot.tricky': 'מסובך',
  'spot.brutal': 'אכזרי',
  'fb.spotBand': 'מצב {band}',
  'fb.spotRarity': 'בערך יד אחת מכל {oneIn}.',
  'fb.spotHeld': 'בערך יד אחת מכל {oneIn} — והחזקת אותה.',
  'fb.spotAboveYou': 'מדורג מעליך.',

  'sound.enable': 'צליל',
  'sound.note': 'צלילים קצרים כשקלף נוחת וכשההחלטה מקבלת ציון, ונקישה אחת כשצ׳יפים זזים — אותה נקישה בדיוק כשיד מנצחת או מפסידה.',

  // --- The door ---
  'welcome.codeLabel': 'בחר קוד בן 4 ספרות',
  'welcome.installed':
    'פתחת מהמסך הראשי? לאפליקציה יש אחסון משלה, אז הקלד את אותו שם ואותו קוד שאתה משתמש בהם בדפדפן והרשומה שלך תחזור.',
  'welcome.codeHint': 'כדי שתהיה אותו שחקן בטלפון ובמחשב. ארבע ספרות, ושווה לזכור אותן.',
  'welcome.badCode': 'ארבע ספרות, בבקשה.',
  'welcome.wrongCode': 'השם הזה כבר תפוס והקוד לא מתאים לו. נסה את הקוד שהשתמשת בו קודם, או שם אחר.',
  'welcome.offline': 'השולחן לא עונה, אז בינתיים אתה משחק לבד. הרשומה נשמרת כאן ותתחבר מאוחר יותר.',
  'welcome.fineLocal': 'בלי חשבון ובלי סיסמה. העותק הזה שומר את הרשומה שלך בדפדפן הזה בלבד.',
  'welcome.switch': 'לא אתה? החלף שחקן',
  'welcome.switchNote': 'שוכח את הדפדפן הזה וחוזר לדלת. שום דבר לא נמחק — הרשומה שלך נשארת תחת השם והקוד שלה.',
  // --- The usage page (round 9) ---
  'usage.title': 'מי משחק',
  'usage.line': 'מהטבלה המשותפת: כל מי ששיחק, כמה, ומי חזר ביום אחר.',
  'usage.back': '→ לבית',
  'usage.played': 'אנשים שיחקו',
  'usage.playedNote': 'לפחות החלטה אחת שקיבלה ציון, באחד המשחקים.',
  'usage.cameBack': 'חזרו ביום אחר',
  'usage.cameBackNote': 'סיימו יד בשני ימים שונים או יותר.',
  'usage.regulars': 'קבועים',
  'usage.regularsNote': 'שיחקו ב־{days} ימים שונים או יותר, עם {decisions} החלטות או יותר שקיבלו ציון.',
  'usage.recent': 'שיחקו ב־{n} הימים האחרונים',
  'usage.recentNote': 'לפי היום האחרון שבו סיימו יד.',
  'usage.oneDay': 'שיחק ביום אחד',
  'usage.days': 'שיחק ב־{days} ימים',
  'usage.lastPlayed': '{days} · לאחרונה ב־{last}',
  'usage.notCounted': 'לא שיחק מאז שהתחילה ספירת הימים · נראה לאחרונה ב־{last}',
  'usage.decisions': 'בלאק ג׳ק: {bj} החלטות · אולטימייט: {uth} החלטות',
  'usage.tierRegular': 'קבוע',
  'usage.tierBack': 'חזר',
  'usage.tierOnce': 'יום אחד',
  'usage.nobody': 'עוד אף אחד לא שיחק.',
  'usage.loading': 'קורא את הטבלה…',
  'usage.noTable': 'לעותק הזה אין טבלה משותפת, אז אין את מי לספור.',
  'usage.offline': 'הטבלה המשותפת לא עונה, אז אי אפשר לספור כרגע.',
  'usage.refused': 'הטבלה המשותפת סירבה לשאלה ({status}), אז לא מוצג כלום במקום ספירה שגויה.',
  'usage.counting':
    'הימים נספרים מ־{day}. מי ששיחק לפני כן ולא שיחק מאז מופיע עם היום שבו נראה לאחרונה; כשישחק שוב, הביקור הקודם ייספר כיום.',
  // --- What people open (round 15): counts, not logs ---
  'usage.opened': 'מה אנשים פותחים',
  'usage.openedNote': 'כמה פעמים כל אחד מאלה נפתח, על ידי כולם, אי פעם. רק ספירות — בלי סדר, בלי שעות, ובלי שום דבר שאומר מי עשה מה ומתי.',
  'usage.open.help': 'ההסבר על המספרים',
  'usage.open.helpShut': '…ונסגר בחזרה',
  'usage.open.primer': 'איך המשחק עובד',
  'usage.open.howto': 'איך זה עובד',
  'usage.open.chart': 'טבלת האסטרטגיה',
  'usage.open.statInfo': 'מה אומר מספר בסרגל',
  'usage.open.next': 'התקדמות שלב-שלב בהסבר',
  'usage.open.skip': 'דילוג ישר לתשובה',
  'usage.open.arrow': 'מעבר בעקבות החץ אל ההסבר',
  'usage.open.hand': 'פתיחת יד ביומן',
  'usage.open.rules': 'חלונית החוקים',
  'usage.open.level': 'שינוי כמה מוסבר',
  'usage.public':
    'לא פרטי. שום דבר לא מקשר לדף הזה, אבל הטבלה שהוא קורא פתוחה לכל מי שיש לו את כתובת האפליקציה, כך שכל מי שיחפש יוכל לקרוא את אותם מספרים.',
};

const MESSAGES: Record<Locale, Catalogue> = { en: EN, he: HE };

/**
 * The catalogue as data, for the browser.
 *
 * The pages are classic scripts (no build step, so no bundler to pull a module
 * through), and the server hands them this table as `/i18n.js`. One catalogue,
 * two consumers — the alternative was a second copy in `public/` that would
 * drift the first time a string changed.
 */
export function catalogue(locale: Locale): Catalogue {
  return { ...EN, ...(MESSAGES[locale] ?? {}) };
}

/** Keys present in English but missing from another locale — used by a test. */
export function missingKeys(locale: Locale): string[] {
  const table = MESSAGES[locale] ?? {};
  return Object.keys(EN).filter((key) => table[key] === undefined);
}
