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

function mount(name) {
  screen = name;
  app().innerHTML = name === 'table' ? TABLE_HTML : HOME_HTML;
  sweep(app());
  applyLanguage();

  if (name === 'home') {
    addSocialTabs();
    initHome();
    const saved = store.get('ev:tab');
    if (saved === 'table' || saved === 'feed') {
      app().querySelector(`.tab[data-tab="${saved}"]`)?.click();
    }
  } else {
    initTable();
  }

  // The doors and the back link are ordinary links in the local app. Here they
  // change screens instead of pages.
  for (const link of app().querySelectorAll('a[href]')) {
    const target = link.getAttribute('href');
    if (target === '/table.html' || target === '/home.html') {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        mount(target === '/table.html' ? 'table' : 'home');
      });
    } else if (target === '/ultimate.html') {
      // Ultimate is solved but not yet playable; the door says so rather than
      // opening onto nothing.
      link.classList.add('door-locked');
      link.addEventListener('click', (event) => event.preventDefault());
      const sub = link.querySelector('.door-sub');
      if (sub) sub.textContent = tr('uth.notPlayableYet');
    }
  }

  mountLanguageBar();
}

function mountLanguageBar() {
  const shell = app().querySelector('.shell');
  if (!shell) return;
  const bar = document.createElement('div');
  bar.className = 'fontbar';
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
  shell.insertBefore(bar, shell.firstChild);
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

  const rated = leaderboard.filter((p) => p.decisions > 0);
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
    score.textContent = player.rating > 0 ? player.rating : '—';
    if (player.provisional) score.classList.add('provisional');

    const detail = document.createElement('span');
    detail.className = 'board-detail';
    detail.textContent = tr('social.playerLine', {
      accuracy: (player.accuracy * 100).toFixed(1),
      hands: player.hands,
    });

    row.append(place, who, score, detail);
    list.appendChild(row);
  });
  box.appendChild(list);
}

function renderFeed(box) {
  box.replaceChildren();
  if (!backendReady) return void box.appendChild(emptyNote(tr('social.connecting')));
  if (!backend) return void box.appendChild(emptyNote(tr('social.offline')));
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

function askName() {
  screen = 'welcome';
  const wrap = document.createElement('div');
  wrap.className = 'shell welcome';
  wrap.innerHTML = `
    <h1 class="welcome-title">${tr('ui.appName')}</h1>
    <p class="welcome-line">${tr('welcome.line')}</p>
    <form class="welcome-form" id="welcome-form">
      <label class="welcome-label" for="welcome-name">${tr('welcome.nameLabel')}</label>
      <input class="welcome-input" id="welcome-name" maxlength="24" autocomplete="off"
             spellcheck="false" placeholder="${tr('welcome.placeholder')}" />
      <button class="action primary" type="submit">${tr('welcome.start')}</button>
    </form>
    <p class="welcome-fine">${tr('welcome.fine')}</p>`;
  app().replaceChildren(wrap);
  applyLanguage();

  const input = wrap.querySelector('#welcome-name');
  input.focus();
  wrap.querySelector('#welcome-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.trim().slice(0, 24);
    if (name.length === 0) return;
    me.name = name;
    store.set('ev:playerName', name);
    session.setPlayerName(name);
    saveProgressLocally();
    // Fire-and-forget: joining the table is not worth making anyone wait at the
    // door for, and the write is retried after the first hand anyway.
    void publish();
    mount('home');
  });
}

/* --- Boot ----------------------------------------------------------------- */

session.setLocale(locale);
if (me.name) session.setPlayerName(me.name);
applyLanguage();
if (me.name) mount('home');
else askName();

/* Connecting happens once, at boot. Kept as a promise so anything driving this
   page without being a browser — a test, say — can wait for it rather than
   calling connect again and quietly opening a second subscription. */
const booted = connect();
