/*
 * The browser half of the language layer.
 *
 * The catalogue itself is not here — the server injects it at /i18n.js, built
 * from src/i18n.ts, so there is exactly one place a string is written. This
 * file is only the machinery: pick a locale, swap the document over, sweep the
 * DOM for anything tagged with data-i18n.
 *
 * It runs before first paint and sets `lang` and `dir` on <html> immediately,
 * so a Hebrew player never sees the page assemble left-to-right and jump.
 */
(() => {
  const FALLBACK = { code: 'en', name: 'English', dir: 'ltr' };

  const read = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  // Guess from the browser only the first time; after that the stored choice
  // wins, because someone who switched to English on a Hebrew machine meant it.
  const guess = () => {
    const tags = navigator.languages || [navigator.language || 'en'];
    for (const tag of tags) if (String(tag).toLowerCase().startsWith('he')) return 'he';
    return 'en';
  };

  const locale = read('ev:locale') || guess();
  const info = (window.EV_LOCALES || [FALLBACK]).find((l) => l.code === locale) || FALLBACK;

  const root = document.documentElement;
  root.setAttribute('lang', info.code);
  root.setAttribute('dir', info.dir);

  const messages = (window.EV_MESSAGES && window.EV_MESSAGES[locale]) || {};

  /** Same substitution rule as the server's `t`, so keys behave identically. */
  const t = (key, params) => {
    const template = messages[key];
    if (template === undefined) return key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, name) =>
      params[name] === undefined ? '{' + name + '}' : String(params[name]));
  };

  /*
   * Translate the static markup. `data-i18n` replaces the text; the attribute
   * variants exist because a placeholder or an aria-label is just as visible to
   * the person using the app as the text beside it.
   */
  const sweep = (scope) => {
    const where = scope || document;
    for (const el of where.querySelectorAll('[data-i18n]')) {
      el.textContent = t(el.dataset.i18n);
    }
    for (const el of where.querySelectorAll('[data-i18n-attr]')) {
      for (const pair of el.dataset.i18nAttr.split(',')) {
        const [attr, key] = pair.split(':');
        el.setAttribute(attr.trim(), t(key.trim()));
      }
    }
    for (const el of where.querySelectorAll('[data-i18n-value]')) {
      // Only when untouched: overwriting a name the player typed would be rude.
      if (el.value === '' || el.dataset.i18nPristine === 'true') {
        el.value = t(el.dataset.i18nValue);
        el.dataset.i18nPristine = 'true';
      }
    }
    if (where === document) {
      const meta = document.querySelector('meta[name="i18n-title"]');
      document.title = t(meta ? meta.content : 'ui.appName');
    }
  };

  const set = (code) => {
    try {
      localStorage.setItem('ev:locale', code);
    } catch {
      // storage disabled; the choice lasts for this page only
    }
    // A full reload rather than a live swap: the dealer's reasoning is composed
    // server-side, so the page has to ask for it again in the new language
    // anyway, and half-translated prose is worse than a blink.
    location.reload();
  };

  /*
   * Tell the server which language to compose in, before the pages ask it for
   * anything. The dealer's reasoning is built server-side from the engine's
   * numbers, so a page that fetched first would render one hand of English
   * prose under a Hebrew heading.
   */
  const ready = fetch('/api/player', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locale }),
  }).catch(() => {
    // Offline or mid-restart: the pages still render, in the server's language.
  });

  window.EV = { locale, dir: info.dir, t, sweep, setLocale: set, ready };

  document.addEventListener('DOMContentLoaded', () => sweep());
})();
