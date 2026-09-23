/*
 * Screens, language, and the two panels that only exist in the shared build.
 *
 * The local app is two pages and the browser navigates between them. A single
 * published page cannot do that, so screens are mounted one at a time into the
 * same container — which has the useful side effect that the two page scripts
 * keep working untouched: only one of them is ever looking at the DOM, so their
 * element ids never meet.
 */

/* --- Language ------------------------------------------------------------- */

const dir = (code) => (LOCALES.find((l) => l.code === code) ?? LOCALES[0]).dir;

let locale = (() => {
  const saved = store.get('ev:locale');
  if (saved && LOCALES.some((l) => l.code === saved)) return saved;
  for (const tag of navigator.languages ?? [navigator.language ?? 'en']) {
    if (String(tag).toLowerCase().startsWith('he')) return 'he';
  }
  return 'en';
})();

let messages = catalogue(locale);

function tr(key, params) {
  const template = messages[key];
  if (template === undefined) return key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    params[name] === undefined ? `{${name}}` : String(params[name]),
  );
}

/** The contract the page scripts expect from the local app's i18n client. */
window.EV = {
  get locale() {
    return locale;
  },
  get dir() {
    return dir(locale);
  },
  t: tr,
  sweep,
  setLocale,
  ready: Promise.resolve(),
};
window.EV_LOCALES = LOCALES;

function applyLanguage() {
  const root = document.documentElement;
  root.setAttribute('lang', locale);
  root.setAttribute('dir', dir(locale));
  document.title = tr('ui.appName');
}

function setLocale(code) {
  locale = code;
  messages = catalogue(code);
  store.set('ev:locale', code);
  session.setLocale(code);
  uthSession.setLocale(code);
  applyLanguage();
  // Re-mounting redraws every generated sentence in the new language. The local
  // app reloads instead, because there the prose is composed on the server and
  // has to be fetched again; here it is composed in this scope, so there is
  // nothing to fetch and no reason to blink.
  mount(screen);
}

/** Translate whatever is currently mounted. Same markup contract as the local app. */
function sweep(scope) {
  const where = scope ?? document;
  for (const node of where.querySelectorAll('[data-i18n]')) {
    node.textContent = tr(node.dataset.i18n);
  }
  for (const node of where.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of node.dataset.i18nAttr.split(',')) {
      const [attr, key] = pair.split(':');
      node.setAttribute(attr.trim(), tr(key.trim()));
    }
  }
  for (const node of where.querySelectorAll('[data-i18n-value]')) {
    if (node.value === '' || node.dataset.i18nPristine === 'true') {
      node.value = tr(node.dataset.i18nValue);
      node.dataset.i18nPristine = 'true';
    }
  }
}

/* --- Screens -------------------------------------------------------------- */

/* What is actually mounted. Starts at the door, not at the home screen. */
let screen = 'welcome';
const app = () => document.getElementById('app');

/*
 * The screen lives in the hash.
 *
 * The doors are rewritten to `#home` and `#table` at build time, for a reason
 * that is about sharing rather than routing: the built page is served from
 * `/ishalom/`, and the local app's `/table.html` left the site whenever a click
 * was not an ordinary left click. Keeping the hash in step means a copied link
 * opens the screen it was copied from, and the browser's back button walks the
 * screens instead of leaving the app.
 *
 * `#ultimate` joined them in round 4a, when the door stopped being a preview.
 */
// `#usage` (round 9) is the one screen nothing links to: see usage.js.
const SCREENS = {
  '#home': 'home',
  '#table': 'table',
  '#ultimate': 'ultimate',
  '#usage': 'usage',
  '#analyse': 'analyse',
  '#shared': 'shared',
};
const SCREEN_HTML = {
  home: () => HOME_HTML,
  table: () => TABLE_HTML,
  ultimate: () => ULTIMATE_HTML,
  usage: () => usageHtml(),
  analyse: () => ANALYSE_HTML,
  shared: () => SHARED_HTML,
};

/*
 * The shared table is the one screen whose hash carries something.
 *
 * `#shared=hx3k…` is the invitation, and it is the only growth this app has
 * (§3.11), so it has to survive being pasted into a message, opened on a phone
 * that has never seen the app, and followed twice. Everything after the `=` is
 * the table's name and belongs to the screen, not to the router — which is why
 * this is matched on the part before it.
 */
const screenFromHash = () => {
  const hash = String(location.hash || '');
  const at = hash.indexOf('=');
  return SCREENS[at > 0 ? hash.slice(0, at) : hash] ?? null;
};

function mount(name) {
  screen = name;
  // Set before the markup, and only when it differs: `hashchange` fires after
  // this returns, sees the screen it names is already mounted, and does nothing.
  // The shared table keeps whatever table its hash already names.
  const keepsHash = name === 'shared' && String(location.hash || '').startsWith('#shared=');
  if (!keepsHash && location.hash !== `#${name}`) location.hash = `#${name}`;
  app().innerHTML = SCREEN_HTML[name]();
  sweep(app());
  applyLanguage();
  // The strip lives outside the mounted screen, so a screen change redraws it.
  drawWaitingStrip();

  if (name === 'home') {
    addSocialTabs();
    initHome();
    const saved = store.get('ev:tab');
    if (saved === 'table' || saved === 'feed') {
      app().querySelector(`.tab[data-tab="${saved}"]`)?.click();
    }
  } else if (name === 'ultimate') {
    initUltimate();
  } else if (name === 'usage') {
    void initUsage();
  } else if (name === 'analyse') {
    initAnalyse();
  } else if (name === 'shared') {
    /*
     * Arriving at the shared table is the end of waiting for it, whether he
     * came because his friend sat down or because he pressed the strip.
     */
    stopWaitingForFriend();
    initShared();
  } else {
    initTable();
  }

  // The doors and the back link are ordinary links in the local app. Here they
  // change screens instead of pages.
  for (const link of app().querySelectorAll('a[href]')) {
    const target = link.getAttribute('href');
    if (SCREENS[target]) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        mount(SCREENS[target]);
      });
    }
  }

  mountLanguageBar();
  if (name === 'home') mountSwitchPlayer();
}

/**
 * "Not you?" — the way off a shared computer, and the way to test the door.
 *
 * Only where there is a table to come back to: with no backend the record lives
 * in this browser alone, and forgetting it would be the one destructive button
 * in the app.
 */
function mountSwitchPlayer() {
  if (!backend) return;
  const footer = app().querySelector('.footer');
  if (!footer) return;
  // Approved round 10: the one thing a player needs when the address changes.
  const remember = document.createElement('p');
  remember.className = 'remember';
  remember.textContent = tr('home.remember');
  footer.parentElement.insertBefore(remember, footer);

  const button = document.createElement('button');
  button.className = 'link switch-player';
  button.type = 'button';
  button.textContent = tr('welcome.switch');
  button.title = tr('welcome.switchNote');
  button.addEventListener('click', switchPlayer);
  footer.parentElement.insertBefore(button, footer);
}

/**
 * Where the language is chosen.
 *
 * It used to be a permanent bar at the top of every screen — 33px on the felt,
 * on every hand, for a setting somebody changes once in a lifetime (round 17).
 * A screen that has a panel of its own offers it there, in `#lang-slot`;
 * everywhere else it stays where it was.
 */
function mountLanguageBar() {
  const shell = app().querySelector('.shell');
  if (!shell) return;
  const slot = app().querySelector('#lang-slot');
  const bar = document.createElement('div');
  bar.className = slot ? 'fontbar in-panel' : 'fontbar';
  const label = document.createElement('span');
  label.textContent = tr('ui.language');
  bar.appendChild(label);
  for (const info of LOCALES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.lang = info.code;
    button.textContent = info.name;
    button.setAttribute('aria-pressed', String(info.code === locale));
    button.addEventListener('click', () => setLocale(info.code));
    bar.appendChild(button);
  }
  if (slot) slot.replaceChildren(bar);
  else shell.insertBefore(bar, shell.firstChild);
}

/* --- The two shared panels ------------------------------------------------ */

function addSocialTabs() {
  const tabs = app().querySelector('.tabs');
  const anchor = app().querySelector('#panel-stats');
  if (!tabs || !anchor) return;

  for (const [key, labelKey] of [['table', 'social.table'], ['feed', 'social.feed']]) {
    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.setAttribute('role', 'tab');
    tab.dataset.tab = key;
    tab.setAttribute('aria-selected', 'false');
    tab.textContent = tr(labelKey);
    tabs.appendChild(tab);

    const panel = document.createElement('section');
    panel.className = 'tab-body';
    panel.id = `panel-${key}`;
    panel.setAttribute('role', 'tabpanel');
    panel.hidden = true;
    anchor.parentElement.insertBefore(panel, anchor.nextSibling);

    tab.addEventListener('click', () => {
      for (const other of app().querySelectorAll('.tab')) {
        other.setAttribute('aria-selected', String(other === tab));
      }
      for (const body of app().querySelectorAll('.tab-body')) {
        body.hidden = body !== panel;
      }
      store.set('ev:tab', key);
    });
  }
  renderSocial();
}

function renderSocial() {
  const table = document.getElementById('panel-table');
  const stream = document.getElementById('panel-feed');
  if (table) renderLeaderboard(table);
  if (stream) renderFeed(stream);
}

/** The same `**bold**` convention the explanation layer uses, kept consistent. */
function rich(target, text) {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  target.innerHTML = escaped
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(?<![\w>])([+−-]?\d+(?:[.,]\d+)?%?\+?)(?![\w<])/g, '<span class="num">$1</span>');
}

const emptyNote = (text) => {
  const p = document.createElement('p');
  p.className = 'empty-note';
  p.textContent = text;
  return p;
};

function renderLeaderboard(box) {
  box.replaceChildren();
  if (!backendReady) return void box.appendChild(emptyNote(tr('social.connecting')));
  if (!backend) return void box.appendChild(emptyNote(tr('social.offline')));
  if (!backendReachable) return void box.appendChild(emptyNote(tr('social.offlineNow')));

  // One board, two games (round 10): the switch, then the chosen game's ranking,
  // named — the numbers are never added together or put in one list.
  box.appendChild(boardSwitch());
  const caption = document.createElement('p');
  caption.className = 'board-caption';
  caption.textContent = tr(boardGame === 'uth' ? 'social.byUltimate' : 'social.byBlackjack');
  box.appendChild(caption);
  if (boardGame === 'uth') return void renderUthBoard(box);

  /*
   * The Blackjack side, as it was before round 10: same rows, same order —
   * except who is on it (round 31). Everything a player plays counts, so a
   * player whose decisions were all made at a shared table is on the board by
   * the rating they moved, where `decisions > 0` had hidden him.
   */
  const lifetimeOf = (p) => Number(p.lifetime_decisions ?? p.lifetimeDecisions ?? p.decisions) || 0;
  const rated = leaderboard.filter((p) => p.decisions > 0 || lifetimeOf(p) > 0);
  if (rated.length === 0) return void box.appendChild(emptyNote(tr('social.noPlayers')));

  const list = document.createElement('ol');
  list.className = 'ladder board';
  rated.forEach((player, index) => {
    const row = document.createElement('li');
    row.className = 'board-row' + (player.id === me.id ? ' is-me' : '');

    const place = document.createElement('span');
    place.className = 'board-place';
    place.textContent = index + 1;

    const who = document.createElement('span');
    who.className = 'board-name';
    who.textContent = player.name;

    const score = document.createElement('span');
    score.className = 'ladder-score';
    score.textContent = player.rating > 0 ? window.EVFigure.units(player.rating) : '—';
    if (player.provisional) score.classList.add('provisional');

    const detail = document.createElement('span');
    detail.className = 'board-detail';
    /*
     * One kind of judgement per figure (round 31, Idan: *"שלא יהיה ערבוב בין
     * סוגים של שיפוט"*). The accuracy stored on a row is the private table's,
     * and the line now says so; a player with none there gets his whole count
     * instead, named as that — never "100.0% over 0 hands" beside a rating
     * built somewhere else.
     */
    detail.textContent =
      player.decisions > 0
        ? tr('social.playerLine', {
            accuracy: (player.accuracy * 100).toFixed(1),
            hands: player.hands,
          })
        : tr('social.playerLineAll', { decisions: window.EVFigure.units(lifetimeOf(player)) });

    row.append(place, who, score, detail);
    list.appendChild(row);
  });
  box.appendChild(list);
}

/** Blackjack | Ultimate. The choice is remembered on this device. */
function boardSwitch() {
  const bar = document.createElement('div');
  bar.className = 'board-games';
  bar.setAttribute('role', 'group');
  for (const [key, label] of [['bj', 'ui.blackjack'], ['uth', 'ui.ultimate']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.game = key;
    button.textContent = tr(label);
    button.setAttribute('aria-pressed', String(boardGame === key));
    button.addEventListener('click', () => {
      if (boardGame === key) return;
      boardGame = key;
      store.set('ev:board', key);
      renderSocial();
      if (key === 'uth') void loadUthBoard();
    });
    bar.appendChild(button);
  }
  return bar;
}

/** The Ultimate side: the same row as Blackjack's, ranked by the Ultimate rating. */
function renderUthBoard(box) {
  if (uthBoard.state === 'idle') void loadUthBoard();
  if (uthBoard.state === 'idle' || uthBoard.state === 'loading') {
    return void box.appendChild(emptyNote(tr('social.connecting')));
  }
  if (uthBoard.state === 'pending') return void box.appendChild(emptyNote(tr('social.uthPending')));
  if (uthBoard.state === 'offline') return void box.appendChild(emptyNote(tr('social.offlineNow')));
  if (uthBoard.state === 'none') return void box.appendChild(emptyNote(tr('social.offline')));
  if (uthBoard.rows.length === 0) return void box.appendChild(emptyNote(tr('social.noUthPlayers')));

  const list = document.createElement('ol');
  list.className = 'ladder board';
  uthBoard.rows.forEach((player, index) => {
    const row = document.createElement('li');
    row.className = 'board-row' + (player.id === me.id ? ' is-me' : '');

    const place = document.createElement('span');
    place.className = 'board-place';
    place.textContent = index + 1;

    const who = document.createElement('span');
    who.className = 'board-name';
    who.textContent = player.name;

    const score = document.createElement('span');
    score.className = 'ladder-score';
    score.textContent = window.EVFigure.units(player.rating);
    if (player.provisional) score.classList.add('provisional');

    const detail = document.createElement('span');
    detail.className = 'board-detail';
    detail.textContent = tr('social.uthPlayerLine', { decisions: window.EVFigure.units(player.decisions) });

    row.append(place, who, score, detail);
    list.appendChild(row);
  });
  box.appendChild(list);
}

function renderFeed(box) {
  box.replaceChildren();
  if (!backendReady) return void box.appendChild(emptyNote(tr('social.connecting')));
  if (!backend) return void box.appendChild(emptyNote(tr('social.offline')));
  if (!backendReachable) return void box.appendChild(emptyNote(tr('social.offlineNow')));
  if (feed.length === 0) return void box.appendChild(emptyNote(tr('social.noFeed')));

  for (const item of feed) {
    const card = document.createElement('article');
    card.className = 'feed-item ' + (item.correct ? 'good' : item.severity);

    const head = document.createElement('div');
    head.className = 'feed-head';
    const who = document.createElement('strong');
    who.textContent = item.playerId === me.id ? tr('social.you') : item.name;
    const when = document.createElement('span');
    when.className = 'feed-when';
    when.textContent = ago(item.at);
    head.append(who, when);

    const line = document.createElement('p');
    line.className = 'feed-line';
    line.textContent = item.headline;

    const verdict = document.createElement('p');
    verdict.className = 'feed-verdict';
    rich(
      verdict,
      item.correct
        ? tr('social.held', { action: item.optimal })
        : tr('social.missed', {
            chosen: item.chosen,
            optimal: item.optimal,
            cost: item.evCost.toFixed(3),
          }),
    );

    card.append(head, line, verdict);
    box.appendChild(card);
  }
}

function ago(at) {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 90) return tr('social.justNow');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return tr('social.minutes', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return tr('social.hours', { n: hours });
  return tr('social.days', { n: Math.round(hours / 24) });
}

/* --- First run ------------------------------------------------------------ */

/**
 * The door.
 *
 * A name and a four-digit code, so the same person is the same player on any
 * device. Without a backend there is nothing to match a code against, so the
 * field is hidden and the name alone is kept — which is exactly the old
 * behaviour, and the right one for a page opened from a file.
 */
function askName() {
  screen = 'welcome';
  const canMatch = Boolean(backend);

  const wrap = document.createElement('div');
  /*
   * Opened from a home-screen icon. On iPhone that app keeps its storage apart
   * from Safari's, so a player who has been playing in Safari arrives here as a
   * stranger — exactly the case name and code exist for. One line says so.
   */
  const installed =
    (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
    navigator.standalone === true;
  wrap.className = 'shell welcome';
  wrap.innerHTML = `
    <h1 class="welcome-title">${tr('ui.appName')}</h1>
    <p class="slogan">${tr('brand.slogan')}</p>
    <p class="welcome-line">${tr('welcome.line')}</p>
    <form class="welcome-form" id="welcome-form">
      <label class="welcome-label" for="welcome-name">${tr('welcome.nameLabel')}</label>
      <input class="welcome-input" id="welcome-name" maxlength="24" autocomplete="off"
             spellcheck="false" placeholder="${tr('welcome.placeholder')}" />
      ${
        canMatch
          ? `<label class="welcome-label" for="welcome-code">${tr('welcome.codeLabel')}</label>
      <input class="welcome-input welcome-code" id="welcome-code" inputmode="numeric"
             maxlength="4" autocomplete="off" pattern="[0-9]{4}" placeholder="0000" />
      <p class="welcome-hint">${tr('welcome.codeHint')}</p>
      ${installed ? `<p class="welcome-hint welcome-installed">${tr('welcome.installed')}</p>` : ''}`
          : ''
      }
      <p class="welcome-error" id="welcome-error" hidden></p>
      <button class="action primary" type="submit">${tr('welcome.start')}</button>
    </form>
    <p class="welcome-fine">${tr(canMatch ? 'welcome.fine' : 'welcome.fineLocal')}</p>`;
  app().replaceChildren(wrap);
  applyLanguage();

  const nameField = wrap.querySelector('#welcome-name');
  const codeField = wrap.querySelector('#welcome-code');
  const error = wrap.querySelector('#welcome-error');
  const button = wrap.querySelector('button[type="submit"]');
  nameField.focus();

  const complain = (key) => {
    error.textContent = tr(key);
    error.hidden = false;
  };

  wrap.querySelector('#welcome-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;

    const name = nameField.value.trim().slice(0, 24);
    if (name.length === 0) return;

    if (!canMatch) {
      // No table to check against, so there is nothing a code could prove.
      await enter(name);
      return;
    }

    const code = (codeField.value || '').trim();
    if (!/^\d{4}$/.test(code)) return void complain('welcome.badCode');

    button.disabled = true;
    try {
      const rows = await backend.findByName(nameKey(name));
      const decision = await decideIdentity(name, code, rows, newId);

      if (decision.action === 'refuse') {
        complain(decision.reason === 'wrong-code' ? 'welcome.wrongCode' : 'welcome.badCode');
        return;
      }

      /*
       * `adopt` and `claim` both mean: this browser is now that player. The id
       * is taken over so the next save writes to their row rather than making
       * another one, and their record is pulled down before anything is shown.
       */
      /*
       * A claim takes over a record somebody else could see was unguarded, so
       * the player is told it happened (round 33): the name is now his, under
       * the code he just chose, and its history came with it. Said once, on
       * the home screen he lands on.
       */
      if (decision.action === 'claim') {
        const row = (rows ?? []).find((entry) => entry.id === decision.id) ?? {};
        store.set(
          'ev:claimed',
          JSON.stringify({ name, decisions: Number(row.lifetimeDecisions ?? row.decisions ?? 0) || 0 }),
        );
      }
      me.id = decision.id;
      store.set('ev:playerId', decision.id);
      if (decision.pinHash) {
        me.pinHash = decision.pinHash;
        store.set('ev:pinHash', decision.pinHash);
      }
      await enter(name, decision.action !== 'create');
    } catch {
      // The table is unreachable. Rather than trap someone at the door, let
      // them in locally; the record syncs when it comes back.
      complain('welcome.offline');
      await enter(name);
    } finally {
      button.disabled = false;
    }
  });
}

/** Take the name, pull down whatever belongs to it, and open the app. */
async function enter(name, restore = false) {
  me.name = name;
  store.set('ev:playerName', name);
  session.setPlayerName(name);
  if (restore) await restoreMine();
  saveProgressLocally();
  // Fire-and-forget: joining the table is not worth waiting at the door for,
  // and the write is retried after the first hand anyway.
  void publish();
  // A shared `#table` link opens the table once its recipient has sat down,
  // rather than dropping them on the home screen with the link spent.
  mount(screenFromHash() ?? 'home');
}

/**
 * "Not you?" — forget this browser's player and go back to the door.
 *
 * It forgets, it never deletes. The record stays in the table under its name
 * and code, and the same person can walk back in with them.
 */
function switchPlayer() {
  store.set('ev:playerId', '');
  store.set('ev:playerName', '');
  store.set('ev:pinHash', '');
  store.set(PROGRESS_KEY, '');
  store.set(FEED_KEY, '');
  location.reload();
}

/* --- Boot ----------------------------------------------------------------- */

session.setLocale(locale);
/*
 * The UTH session composes its own prose, so it has to be told the language at
 * boot as well as on a switch. Without this line a Hebrew player opened
 * Ultimate onto English buttons and an English card — found by looking at the
 * built page, not by the session tests, which set the locale themselves.
 */
uthSession.setLocale(locale);
if (me.name) session.setPlayerName(me.name);
applyLanguage();
/*
 * Connecting happens once, at boot, and the door waits for it: whether a code
 * can be checked at all depends on whether there is a table to check against,
 * and asking for one that cannot be verified would be theatre.
 *
 * Kept as a promise so anything driving this page without being a browser — a
 * test, say — can wait for it rather than calling connect again and quietly
 * opening a second subscription.
 */
window.addEventListener('hashchange', () => {
  const next = screenFromHash();
  // Only once there is a player: the door has to come first, however the page
  // was opened.
  if (next && next !== screen && me.name) mount(next);
});

const booted = connect().then(() => {
  if (me.name) mount(screenFromHash() ?? 'home');
  else askName();
});
