/**
 * Draw the home-screen icon, once, into `public/icons/`.
 *
 * The icon is original: two playing cards on the table's felt green, the front
 * one marked "EV". No casino's name, mark, colours or lettering — nothing a
 * player could mistake for a real establishment's.
 *
 * It is drawn as SVG and rasterised by headless Chrome, because a browser is the
 * one thing on this machine that renders SVG exactly, and the project takes no
 * image dependency. The PNGs are committed, so the site build copies them and
 * never needs Chrome; run this again only to change the design.
 *
 *   node scripts/make-icons.ts
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'public', 'icons');
const CHROME = process.env.CHROME ?? 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';

/**
 * @param size    the square's side in pixels
 * @param padded  maskable icons keep their mark inside the centre 80%, because
 *                Android crops them to a circle or a squircle
 */
function svg(size: number, padded: boolean): string {
  const s = size;
  const inset = padded ? 0.2 : 0.08; // how far in from the edge the cards sit
  const cardW = s * (padded ? 0.38 : 0.46);
  const cardH = cardW * 1.4;
  const cx = s / 2;
  const cy = s / 2;
  const r = cardW * 0.12;
  const corner = padded ? 0 : s * 0.22; // maskable icons are full-bleed
  void inset;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <radialGradient id="felt" cx="50%" cy="30%" r="75%">
      <stop offset="0" stop-color="#1f6b44"/>
      <stop offset="0.6" stop-color="#14532d"/>
      <stop offset="1" stop-color="#0a2e1b"/>
    </radialGradient>
  </defs>
  <rect width="${s}" height="${s}" rx="${corner}" fill="url(#felt)"/>
  <g transform="rotate(-12 ${cx} ${cy})">
    <rect x="${cx - cardW * 0.78}" y="${cy - cardH / 2}" width="${cardW}" height="${cardH}" rx="${r}"
          fill="#dfe6ec" stroke="#0a2e1b" stroke-width="${s * 0.006}"/>
  </g>
  <g transform="rotate(8 ${cx} ${cy})">
    <rect x="${cx - cardW * 0.28}" y="${cy - cardH / 2}" width="${cardW}" height="${cardH}" rx="${r}"
          fill="#ffffff" stroke="#0a2e1b" stroke-width="${s * 0.006}"/>
    <text x="${cx + cardW * 0.22}" y="${cy + cardH * 0.13}" text-anchor="middle"
          font-family="Arial, Helvetica, sans-serif" font-weight="900"
          font-size="${cardW * 0.46}" fill="#14532d" letter-spacing="${-cardW * 0.01}">EV</text>
    <rect x="${cx - cardW * 0.08}" y="${cy + cardH * 0.24}" width="${cardW * 0.6}" height="${s * 0.012}"
          rx="${s * 0.006}" fill="#c9a227"/>
  </g>
</svg>`;
}

const ICONS: Array<{ file: string; size: number; padded: boolean }> = [
  { file: 'icon-192.png', size: 192, padded: false },
  { file: 'icon-512.png', size: 512, padded: false },
  { file: 'maskable-512.png', size: 512, padded: true },
  // iOS draws its own rounded corners and ignores transparency, so a full square.
  { file: 'apple-touch-icon.png', size: 180, padded: true },
];

mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'icons-'));
for (const icon of ICONS) {
  const page = join(work, `${icon.file}.html`);
  writeFileSync(
    page,
    `<!doctype html><html><head><style>html,body{margin:0;background:transparent}</style></head>` +
      `<body>${svg(icon.size, icon.padded)}</body></html>`,
  );
  execFileSync(
    CHROME,
    [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--default-background-color=00000000',
      `--window-size=${icon.size},${icon.size}`,
      `--screenshot=${join(OUT, icon.file)}`,
      `file:///${page.replace(/\\/g, '/')}`,
    ],
    { stdio: 'ignore' },
  );
  process.stdout.write(`${join(OUT, icon.file)}\n`);
}
writeFileSync(join(OUT, 'icon.svg'), svg(512, false));
