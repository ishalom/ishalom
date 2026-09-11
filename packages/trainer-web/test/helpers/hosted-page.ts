/**
 * Load the built page and run it, the way a browser would.
 *
 * `docs/index.html` is the file GitHub Pages serves, so testing it rather than
 * the modules is the only way to catch what the bundler does to them. The DOM
 * here is the smallest thing the page will accept: enough to mount a screen,
 * follow a link, and read back which screen it ended on.
 *
 * The window carries a hash, and assigning to it notifies the page's
 * `hashchange` listener the way a browser does — which is what lets a test open
 * the page on a shared link instead of merely asserting that the routing code
 * exists.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');

export interface HostedPage {
  booted: Promise<unknown>;
  /** Which screen is mounted: 'welcome', 'home' or 'table'. */
  screen: () => string;
  /** Follow a link, or arrive on one. */
  go: (hash: string) => void;
  api: (path: string, body?: unknown) => Promise<any>;
  stopWatching: () => void;
  /** The page's own sessions, for stacking a deck or reading a record. */
  session: () => any;
  uthSession: () => any;
  parseCards: (text: string) => number[];
  lifetimeOf: (progress: unknown) => number;
  /** What this browser has in local storage. */
  storage: () => Map<string, string>;
  document: any;
  press: (code: string, key: string) => void;
}

function element(): any {
  const queries = new Map<string, any>();
  const node: any = {
    style: { setProperty() {} },
    dataset: {},
    children: [] as any[],
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    lang: '',
    listeners: {} as Record<string, Function[]>,
    classList: { add() {}, remove() {}, contains: () => false },
    setAttribute() {},
    getAttribute: () => null,
    appendChild(c: any) {
      node.children.push(c);
      return c;
    },
    append(...c: any[]) {
      node.children.push(...c);
    },
    replaceChildren(...c: any[]) {
      node.children = c;
    },
    insertBefore(c: any) {
      node.children.unshift(c);
      return c;
    },
    addEventListener(type: string, fn: Function) {
      (node.listeners[type] ??= []).push(fn);
    },
    // `pinStrip()` measures the rules bar to place the pinned strip under it.
    getBoundingClientRect: () => ({
      height: 52, width: 320, top: 0, left: 0, right: 320, bottom: 52,
    }),
    focus() {},
    remove() {},
    showModal() {},
    close() {},
    querySelector(selector: string) {
      if (!queries.has(selector)) queries.set(selector, element());
      return queries.get(selector);
    },
    querySelectorAll: () => [],
    get parentElement() {
      return element();
    },
  };
  return node;
}

/**
 * @param startHash the address the page is opened at, as a shared link would be
 * @param stored    what this browser already remembers
 */
export function loadHosted(
  startHash = '',
  stored: Array<[string, string]> = [['ev:playerName', 'Dana']],
  /** A shared table to talk to, as the hosted build is configured with one. */
  config?: { url: string; key: string },
): HostedPage {
  const html = readFileSync(join(ROOT, 'docs', 'index.html'), 'utf8');
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .join('\n')
    // The page ships with whatever table it was built against; this runs with
    // none, which is the configuration that must still play.
    .replace(/^[ \t]*const BACKEND_CONFIG = .*$/m, '');

  const doc = element();
  const byId = new Map<string, any>();
  doc.getElementById = (id: string) => {
    if (!byId.has(id)) byId.set(id, element());
    return byId.get(id);
  };
  doc.createElement = () => element();
  doc.createTextNode = (text: string) => ({ textContent: text, nodeType: 3 });
  doc.documentElement = element();
  doc.body = element();
  /*
   * No dialog is open. The stub hands back a node for any selector, which made
   * `document.querySelector('dialog[open]')` truthy — and both key handlers
   * return early while a dialog is open, so no key ever reached a table.
   */
  const anyNode = doc.querySelector;
  doc.querySelector = (selector: string) => (selector.includes('[open]') ? null : anyNode(selector));

  const disk = new Map<string, string>(stored);
  const g = globalThis as any;
  g.document = doc;
  g.localStorage = {
    getItem: (k: string) => disk.get(k) ?? null,
    setItem: (k: string, v: string) => disk.set(k, String(v)),
  };

  const windowListeners: Record<string, Function[]> = {};
  g.addEventListener = (type: string, fn: Function) => {
    (windowListeners[type] ??= []).push(fn);
  };
  g.window = globalThis;
  let hash = startHash;
  g.location = {
    reload() {},
    get hash() {
      return hash;
    },
    set hash(value: string) {
      if (hash === value) return;
      hash = value;
      for (const fn of windowListeners.hashchange ?? []) fn({});
    },
  };
  g.alert = () => {};

  const out: Record<string, any> = {};
  new Function(
    '__out',
    '__config',
    // With no config this declares it undefined, which the page reads as "no
    // shared table" — the same as the declaration having been left out.
    `const BACKEND_CONFIG = __config;\n${code}\n` +
      '__out.api = api; __out.booted = booted; __out.screen = () => screen;' +
      '__out.go = (h) => { location.hash = h; };' +
      '__out.session = () => session; __out.uthSession = () => uthSession;' +
      '__out.parseCards = parseCards; __out.lifetimeOf = lifetimeOf;' +
      '__out.stopWatching = () => stopWatching && stopWatching();',
  )(out, config);
  const page = out as unknown as HostedPage;
  page.storage = () => disk;
  page.document = doc;
  /** Press a key the way a browser reports it: the physical key and the character. */
  page.press = (code: string, key: string) => {
    const event = {
      code,
      key,
      repeat: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault() {},
    };
    for (const fn of doc.listeners.keydown ?? []) fn(event);
  };
  return page;
}
