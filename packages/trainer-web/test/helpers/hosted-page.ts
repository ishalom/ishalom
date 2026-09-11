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
  doc.documentElement = element();
  doc.body = element();

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
    `${code}\n` +
      '__out.api = api; __out.booted = booted; __out.screen = () => screen;' +
      '__out.go = (h) => { location.hash = h; };' +
      '__out.stopWatching = () => stopWatching && stopWatching();',
  )(out);
  return out as unknown as HostedPage;
}
