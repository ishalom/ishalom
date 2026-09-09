/*
 * The Ultimate Texas Hold'em preview.
 *
 * Read-only: a hand is dealt and the solvers are asked what they make of it at
 * each decision point. The river and flop are solved live — 990 dealer holdings
 * and 1,070,190 outcomes — while pre-flop is a table lookup, because solving
 * that one live is 2.1 billion outcomes per hole-card class.
 */

const el = (id) => document.getElementById(id);

function cardNode(card) {
  const node = document.createElement('div');
  node.className = 'card' + (card.red ? ' red' : '');
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', card.label);
  node.innerHTML =
    `<span class="card-rank">${card.rank}</span><span class="card-suit">${card.suit}</span>`;
  return node;
}

/** Bars scaled together, so their lengths are comparable within a street. */
function bars(container, rows) {
  const span = Math.max(...rows.map((r) => Math.abs(r.ev)), 0.01);
  container.replaceChildren();
  for (const row of rows) {
    const div = document.createElement('div');
    div.className = 'bar-row';
    div.innerHTML =
      `<span>${row.label}</span>` +
      `<span class="bar-track"><i class="bar-fill${row.ev < 0 ? ' neg' : ''}" ` +
      `style="width:${(Math.abs(row.ev) / span) * 100}%"></i></span>` +
      `<span class="bar-value">${row.ev >= 0 ? '+' : ''}${row.ev.toFixed(3)}</span>`;
    container.appendChild(div);
  }
}

function pill(id, text, fold) {
  const node = el(id);
  node.textContent = text;
  node.className = 'verdict-pill' + (fold ? ' fold' : '');
}

async function deal() {
  const button = el('redeal');
  button.disabled = true;
  button.textContent = 'Solving…';

  const data = await (await fetch('/api/uth/preview')).json();

  el('hole').replaceChildren(...data.hole.map(cardNode));
  el('flop').replaceChildren(...data.board.slice(0, 3).map(cardNode));
  el('river').replaceChildren(...data.board.slice(3).map(cardNode));
  el('hole-class').textContent = data.holeClass;

  if (data.preflop) {
    const raise = data.preflop.optimalAction === 'raise4x';
    pill('pf-verdict', raise ? 'Raise 4×' : 'Check', !raise);
    bars(el('pf-bars'), [
      { label: 'Raise 4×', ev: data.preflop.ev4x },
      { label: 'Raise 3×', ev: data.preflop.ev3x },
      { label: 'Check', ev: data.preflop.evCheck },
    ]);
    // §5.2.3: any hand strong enough to raise is strong enough to raise the max.
    el('pf-note').textContent =
      data.preflop.ev3x < Math.max(data.preflop.ev4x, data.preflop.evCheck)
        ? 'The 3× raise loses to both alternatives here — as it does everywhere.'
        : '';
  } else {
    pill('pf-verdict', `${data.holeClass} not solved yet`, true);
    el('pf-bars').replaceChildren();
    el('pf-note').textContent =
      'This class is still being computed by the offline job. The flop and river below are exact.';
  }

  const flopRaise = data.flop.optimalAction === 'play';
  pill('fl-verdict', flopRaise ? 'Raise 2×' : 'Check', !flopRaise);
  bars(el('fl-bars'), [
    { label: 'Raise 2×', ev: data.flop.evPlay },
    { label: 'Check', ev: data.flop.evCheck },
  ]);
  el('fl-count').textContent = `${data.flop.outcomes.toLocaleString()} outcomes, exact`;

  const riverRaise = data.river.optimalAction === 'play';
  pill('rv-verdict', riverRaise ? 'Raise 1×' : 'Fold', !riverRaise);
  bars(el('rv-bars'), [
    { label: 'Raise 1×', ev: data.river.evPlay },
    { label: 'Fold', ev: data.river.evFold },
  ]);
  el('rv-count').textContent = `beats ${data.river.wins} of 990 dealer hands`;

  el('trips').textContent = data.trips.verdict;
  el('trips-hit').textContent = `hits ${(data.trips.winProbability * 100).toFixed(1)}% of hands`;
  el('table-count').textContent = `${data.solvedClasses} of ${data.totalClasses} solved`;
  el('table-bar').style.width = `${(data.solvedClasses / data.totalClasses) * 100}%`;

  button.disabled = false;
  button.textContent = 'Deal another';
}

el('redeal').addEventListener('click', deal);
deal();
