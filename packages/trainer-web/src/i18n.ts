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

  // --- Upcards ---
  'upcard.ace': 'an ace',
  'upcard.ten': 'a ten',
  'upcard.number': 'a {rank}',

  // --- Step 1: read the dealer ---
  'dealer.bust': '{up}{worst} — a **bust card**. Breaks {bust}.',
  'dealer.worst': ', their worst',
  'dealer.ace': 'An ace, and **no blackjack** behind it. Still breaks only {bust}.',
  'dealer.strong': '{up} — **strong**. Breaks {bust}, makes 17+ {made}.',

  // --- Step 2: read your hand ---
  'hand.insurance': 'Insurance rides on **my hole card**, not your hand. Barely three cards in thirteen are tens.',
  'hand.aces': 'A,A — the **best pair in the deck**. Held together the second ace is dead weight.',
  'hand.eights': '8,8 — **sixteen**, the worst total there is. Splitting is an **escape**, not an attack.',
  'hand.splitDas': '{pair} — a small pair. Each half wants to draw then **double**, so this one rides on the double-after-split rule.',
  'hand.splitOffensive': '{pair} — fine as one hand. Splitting is an **attack**.',
  'hand.splitDefensive': '{pair} — as one hand it wins only when the dealer breaks. Apart, each card **starts again** somewhere better.',
  'hand.pairNever': '{pair} — a pair worth **keeping**. Apart it is two weaker hands.',
  'hand.stiff': '{total} — a **stiff**. Standing never wins it; drawing breaks it {bust}. No good answer, only a **cheaper** one.',
  'hand.doubling': '{total} — **cannot break** on one card, and every ten makes it a real hand.',
  'hand.softDraw': 'Soft {total} — the ace protects you. **Nothing you draw can break it**.',
  'hand.softMade': 'Soft {total} — already good, and **free to improve**. The question is whether it is worth it.',
  'hand.pat': "{total} — **pat**. It wins what it wins; the rest is the dealer's business.",
  'hand.small': '{total} — too small to stand, too small to double. **Not finished.**',

  // --- How decisive the call is ---
  'gap.only': 'the only play',
  'gap.notClose': '**not close**',
  'gap.right': '**right**, but closer than it looks',
  'gap.narrow': 'a **narrow** call',
  'gap.coinflip': 'a **coin-flip**; either is defensible',

  // --- Step 3: the supporting figure ---
  'stat.softDraw': 'The draw is free — and against {up}, what you have is not enough.',
  'stat.standWins': 'Standing wins {win}, loses {lose}. Little beats it.',
  'stat.standBadPat': 'Standing still loses {lose} — **bad, just less bad** than the rest.',
  'stat.standBreaks': 'Standing only wins when I break, and I break {bust}.',
  'stat.hitVsSurrender': 'Drawing breaks it {bust} on the very next card.',
  'stat.double': 'Same card as hitting, **twice the stake**, no second draw — and one card is usually enough here.',
  'stat.splitGains': 'Two hands are worth {gap} more than one.',
  'stat.splitCosts': 'Splitting costs {gap} — one good total becomes two worse ones.',
  'stat.surrender': 'Half back is a guaranteed {half}; played out, this is worth less.',

  // --- Step 3 assembled ---
  'combined': '**{verdict}** — {shape}. {numbers}. {stat}',
  'combined.numbers': '{best} against {runnerUp} to {runnerUpVerb}',
  'combined.numbersOnly': '{best}',
  'headline': '{hand} vs {up} → {verdict}',
  'headline.insurance': 'Insurance → {verdict}',
  'insurance.step1': 'Dealer shows an ace, so insurance is on offer. It is a bet on the hole card and nothing else.',

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
  'ui.rating': 'rating',
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
  'ui.askDealer': 'Ask the dealer',

  // --- Ultimate ---
  'ui.ultimateTitle': 'Ultimate Texas Hold’em',
  'ui.solverPreview': 'Solver preview',
  'ui.notPlayableYet': 'Not playable yet — the tables are still being computed.',

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
  'coach.insurance.odds': 'Barely three cards in thirteen are tens, so the bet loses money every time it is made. Your own cards have nothing to do with it.',
  'coach.prompt.pair': 'A pair. You can break that up if you want it.',
  'coach.prompt.few': '{label}. Not much to choose from — what’ll it be?',
  'coach.prompt.open': '{label} against my card. Your call.',
  'label.pair': 'A pair',
  'label.soft': 'Soft {total}',
  'label.hard': '{total}',
  'label.insurance': 'Insurance',
  'label.vs': '{hand} vs {up}',

  // --- Table chrome ---
  'ui.blackjackTitle': 'EV Trainer — Blackjack',
  'ui.changeRuleSet': 'Change rule set',
  'ui.sessionStats': 'Session statistics',
  'ui.decisionAccuracy': 'decision accuracy',
  'ui.evLostPer100': 'EV lost / 100 hands',
  'ui.yourEdge': 'your effective edge',
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
  'home.ratingOf': '{mode} rating',
  'home.unrated': 'unrated',
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
  'uth.fold': 'Fold',
  'uth.threeXNever': 'The 3× raise loses to both alternatives here — as it does everywhere.',
  'uth.stillComputing': 'This class is still being computed by the offline job. The flop and river below are exact.',
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

  // --- Upcards ---
  'upcard.ace': 'אס',
  'upcard.ten': 'עשר',
  'upcard.number': '{rank}',

  // --- Step 1: read the dealer ---
  'dealer.bust': 'לדילר {up}{worst} — **קלף חלש**. הוא נשרף ב-{bust} מהמקרים.',
  'dealer.worst': ', הגרוע שלו',
  'dealer.ace': 'אס, וכבר ידוע שאין **בלאק ג׳ק**. עדיין נשרף רק ב-{bust}.',
  'dealer.strong': 'לדילר {up} — **חזק**. נשרף ב-{bust} בלבד, ומגיע ל-17 ומעלה ב-{made}.',

  // --- Step 2: read your hand ---
  'hand.insurance': 'הביטוח תלוי **בקלף הסמוי שלי**, לא ביד שלך. בקושי שלושה קלפים מתוך שלושה־עשר הם עשיריות.',
  'hand.aces': 'A,A — **הזוג הכי טוב בחפיסה**. ביד אחת האס השני מיותר.',
  'hand.eights': '8,8 — **שש־עשרה**, הסכום הגרוע ביותר. הפיצול הוא **בריחה**, לא התקפה.',
  'hand.splitDas': '{pair} — זוג קטן. כל חצי רוצה לקחת קלף ואז **להכפיל**, אז הכול תלוי בכלל ההכפלה אחרי פיצול.',
  'hand.splitOffensive': '{pair} — סביר כיד אחת. הפיצול כאן הוא **התקפה**.',
  'hand.splitDefensive': '{pair} — כיד אחת היא מנצחת רק כשהדילר נשרף. בפיצול כל קלף **מתחיל מחדש** ממקום טוב יותר.',
  'hand.pairNever': '{pair} — זוג ש**שווה לשמור**. בפיצול זה הופך לשתי ידיים חלשות יותר.',
  'hand.stiff': '{total} — **יד תקועה**. עצירה לא מנצחת אותה, ולקיחת קלף שורפת אותה ב-{bust}. אין תשובה טובה, רק **זולה יותר**.',
  'hand.doubling': '{total} — **לא יכולה להישרף** בקלף אחד, וכל עשירייה הופכת אותה ליד אמיתית.',
  'hand.softDraw': 'יד רכה {total} — האס מגן עליך. **שום קלף לא יכול לשרוף אותה**.',
  'hand.softMade': 'יד רכה {total} — כבר טובה, ואפשר **לשפר בחינם**. השאלה היא אם זה שווה.',
  'hand.pat': '{total} — **יד סגורה**. היא מנצחת את מה שהיא מנצחת; השאר עניין של הדילר.',
  'hand.small': '{total} — קטן מדי לעצור, קטן מדי להכפיל. **עוד לא נגמר.**',

  // --- How decisive the call is ---
  'gap.only': 'המהלך היחיד',
  'gap.notClose': '**לא צמוד בכלל**',
  'gap.right': '**נכון**, אבל צמוד יותר משנדמה',
  'gap.narrow': 'הכרעה **צמודה**',
  'gap.coinflip': '**הטלת מטבע**; שתי האפשרויות סבירות',

  // --- Step 3: the supporting figure ---
  'stat.softDraw': 'הקלף הנוסף לא עולה כלום — ומול {up}, מה שיש לך לא מספיק.',
  'stat.standWins': 'עצירה מנצחת ב-{win} ומפסידה ב-{lose}. מעט מאוד מנצח אותה.',
  'stat.standBadPat': 'עצירה עדיין מפסידה ב-{lose} — **גרוע, פשוט פחות גרוע** מהשאר.',
  'stat.standBreaks': 'עצירה מנצחת רק כשאני נשרף, ואני נשרף ב-{bust}.',
  'stat.hitVsSurrender': 'לקיחת קלף שורפת את היד ב-{bust} כבר בקלף הבא.',
  'stat.double': 'אותו קלף כמו בלקיחה, **בכפול כסף**, בלי קלף שני — וכאן קלף אחד בדרך כלל מספיק.',
  'stat.splitGains': 'שתי ידיים שוות כאן {gap} יותר מיד אחת.',
  'stat.splitCosts': 'פיצול עולה {gap} — סכום אחד טוב הופך לשניים גרועים.',
  'stat.surrender': 'חצי בחזרה זה {half} מובטח; במשחק עד הסוף זה שווה פחות.',

  // --- Step 3 assembled ---
  'combined': '**{verdict}** — {shape}. {numbers}. {stat}',
  'combined.numbers': '{best} מול {runnerUp} ל{runnerUpVerb}',
  'combined.numbersOnly': '{best}',
  'headline': '{hand} מול {up} ← {verdict}',
  'headline.insurance': 'ביטוח ← {verdict}',
  'insurance.step1': 'לדילר יש אס, אז הביטוח פתוח. זה הימור על הקלף הסמוי בלבד.',

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
  'ui.tab.standing': 'דירוג',
  'ui.tab.hands': 'ידיים',
  'ui.tab.stats': 'סטטיסטיקה',
  'ui.rating': 'דירוג',
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
  'ui.askDealer': 'שאל את הדילר',

  // --- Ultimate ---
  'ui.ultimateTitle': 'אולטימייט טקסס הולדם',
  'ui.solverPreview': 'תצוגה מקדימה של הפותר',
  'ui.notPlayableYet': 'עדיין לא ניתן לשחק — הטבלאות עדיין בחישוב.',

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
  'coach.insurance.odds': 'בקושי שלושה קלפים מתוך שלושה-עשר הם עשיריות, ולכן ההימור מפסיד כסף בכל פעם שעושים אותו. לקלפים שלך אין לזה שום קשר.',
  'coach.prompt.pair': 'זוג. אפשר לפצל אותו אם בא לך.',
  'coach.prompt.few': '{label}. אין הרבה ממה לבחור — מה עושים?',
  'coach.prompt.open': '{label} מול הקלף שלי. ההחלטה שלך.',
  'label.pair': 'זוג',
  'label.soft': 'רך {total}',
  'label.hard': '{total}',
  'label.insurance': 'ביטוח',
  'label.vs': '{hand} מול {up}',

  // --- Table chrome ---
  'ui.blackjackTitle': 'מאמן EV — בלאק ג׳ק',
  'ui.changeRuleSet': 'שינוי מערכת החוקים',
  'ui.sessionStats': 'סטטיסטיקת המושב',
  'ui.decisionAccuracy': 'דיוק ההחלטות',
  'ui.evLostPer100': 'EV שאבד ל-100 ידיים',
  'ui.yourEdge': 'היתרון שלך בפועל',
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
  'home.ratingOf': 'דירוג {mode}',
  'home.unrated': 'ללא דירוג',
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
  'uth.preflopStreet': 'פרה-פלופ · העלאה 4× או צ׳ק',
  'uth.flopStreet': 'פלופ · העלאה 2× או צ׳ק',
  'uth.riverStreet': 'ריבר · העלאה 1× או פרישה',
  'uth.tripsPanel': 'הימור צד טריפס',
  'uth.preflopPanel': 'טבלת פרה-פלופ',
  'uth.dealAnother': 'חלק עוד אחת',
  'uth.solving': 'מחשב…',
  'uth.raise4': 'העלאה 4×',
  'uth.raise3': 'העלאה 3×',
  'uth.raise2': 'העלאה 2×',
  'uth.raise1': 'העלאה 1×',
  'uth.check': 'צ׳ק',
  'uth.fold': 'פרישה',
  'uth.threeXNever': 'ההעלאה של 3× מפסידה לשתי האפשרויות האחרות כאן — כמו בכל מקום אחר.',
  'uth.stillComputing': 'המחלקה הזו עדיין בחישוב על ידי העבודה הלא-מקוונת. הפלופ והריבר למטה מדויקים.',
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
