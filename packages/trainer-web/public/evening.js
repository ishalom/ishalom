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
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const font = '500 44px system-ui, sans-serif';
    /* A long line wraps onto the next rather than being squeezed to fit. */
    ctx.font = font;
    const wrapped = [];
    for (const line of lines(data)) {
      let current = '';
      for (const word of line.split(' ')) {
        const next = current ? `${current} ${word}` : word;
        if (current && ctx.measureText(next).width > width - 120) {
          wrapped.push(current);
          current = word;
        } else current = next;
      }
      if (current) wrapped.push(current);
    }
    const height = 330 + wrapped.length * 72;
    canvas.width = width;
    canvas.height = height;
    const rtl = document.documentElement.getAttribute('dir') === 'rtl';
    ctx.fillStyle = '#0f4d2e';
    ctx.fillRect(0, 0, width, height);
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2c14e';
    ctx.font = '700 64px system-ui, sans-serif';
    ctx.fillText(T('shared.summaryTitle'), width / 2, 130);
    ctx.fillStyle = '#e8eee9';
    ctx.font = font;
    wrapped.forEach((line, index) => ctx.fillText(line, width / 2, 230 + index * 72));
    ctx.fillStyle = '#9fc2ad';
    ctx.font = '500 34px system-ui, sans-serif';
    ctx.fillText('EV Trainer · ishalom.github.io/ishalom', width / 2, height - 50);
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

  /**
   * The kept evening, handed over once and then forgotten.
   *
   * Leaving by the home link mounts home twice in quick succession — once for
   * the click and once for the address changing — and the first mount used to
   * take the evening and the second find nothing and hide it (found on the live
   * walk, round 34). So what was taken is still handed to a mount in the next
   * few seconds, and to nothing after that.
   */
  let taken = null;
  function takeKept() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (data && typeof data.hands === 'number') {
        localStorage.setItem(KEY, '');
        taken = { data, at: Date.now() };
        return data;
      }
    } catch {
      // No storage: nothing was kept.
    }
    return taken && Date.now() - taken.at < 5000 ? taken.data : null;
  }

  window.EVEvening = { card, keep, takeKept, lines, picture };
})();
