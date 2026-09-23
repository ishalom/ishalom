/*
 * The evening at a shared table, summed up (round 34).
 *
 * How many hands, who was the most accurate, who won the most chips, and the
 * spot that cost the table most — and a button that turns it into a picture
 * to send on WhatsApp, because that picture is how somebody who has never
 * opened the app first hears of it.
 *
 * Display only: everything here is read off the table's own screen object,
 * which is read off the derivation. Nothing is written anywhere but this
 * browser's own storage, which holds the last evening until the home screen
 * has said it once.
 *
 * One file for the two places it is drawn — the table, once nobody is left to
 * play with, and home, after leaving by the home link — on `window.EVEvening`.
 */
(function () {
  const T = (key, params) => (window.EV ? window.EV.t(key, params) : key);
  const KEY = 'ev:lastEvening';

  /** The lines the card and the picture both say, in the player's language. */
  function lines(data) {
    const out = [T('shared.summaryHands', { n: data.hands })];
    if (data.accurate) out.push(T('shared.summaryAccurate', { name: data.accurate.name, pct: data.accurate.pct }));
    if (data.chips) {
      const n = window.EVFigure ? window.EVFigure.units(data.chips.n, true) : String(data.chips.n);
      out.push(T('shared.summaryChips', { name: data.chips.name, n }));
    }
    if (data.priciest) {
      out.push(
        T('shared.priciest', {
          spot: data.priciest.label,
          wrong: data.priciest.wrong,
          times: data.priciest.times,
          cost: Number(data.priciest.cost).toFixed(2),
        }),
      );
    }
    return out;
  }

  /** The picture: the same lines on the felt's green, with where the app lives. */
  function picture(data) {
    const canvas = document.createElement('canvas');
    const width = 1080;
    const text = lines(data);
    const height = 360 + text.length * 96;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const rtl = document.documentElement.getAttribute('dir') === 'rtl';
    ctx.fillStyle = '#0f4d2e';
    ctx.fillRect(0, 0, width, height);
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2c14e';
    ctx.font = '700 64px system-ui, sans-serif';
    ctx.fillText(T('shared.summaryTitle'), width / 2, 130);
    ctx.fillStyle = '#e8eee9';
    ctx.font = '500 44px system-ui, sans-serif';
    text.forEach((line, index) => ctx.fillText(line, width / 2, 240 + index * 96, width - 80));
    ctx.fillStyle = '#9fc2ad';
    ctx.font = '500 34px system-ui, sans-serif';
    ctx.fillText('EV Trainer · ishalom.github.io/ishalom', width / 2, height - 60);
    return canvas;
  }

  /** Hand the picture to the phone's share sheet, or save it where sharing files is not offered. */
  function share(data) {
    const canvas = picture(data);
    if (!canvas || !canvas.toBlob) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = typeof File === 'function' ? new File([blob], 'evening.png', { type: 'image/png' }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        void navigator.share({ files: [file], text: 'EV Trainer — ishalom.github.io/ishalom' }).catch(() => {});
        return;
      }
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'evening.png';
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    }, 'image/png');
  }

  /** The card: the title, the lines, and the one button. */
  function card(data) {
    const box = document.createElement('section');
    box.className = 'shared-summary-card';
    const title = document.createElement('h2');
    title.textContent = T('shared.summaryTitle');
    box.appendChild(title);
    for (const line of lines(data)) {
      const p = document.createElement('p');
      p.textContent = line;
      box.appendChild(p);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action primary shared-share';
    button.id = 'shared-share';
    button.textContent = T('shared.summaryShare');
    button.addEventListener('click', () => share(data));
    box.appendChild(button);
    return box;
  }

  /** Keep the evening for the home screen, which says it once. */
  function keep(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // No storage: the summary is simply not repeated at home.
    }
  }

  /** The kept evening, handed over once and then forgotten. */
  function takeKept() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || 'null');
      localStorage.setItem(KEY, '');
      return data && typeof data.hands === 'number' ? data : null;
    } catch {
      return null;
    }
  }

  window.EVEvening = { card, keep, takeKept, lines };
})();
