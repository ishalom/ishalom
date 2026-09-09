/*
 * The home screen (§10, screen 1).
 *
 * Name, standing, the two games. Everything shown is real: the stats come from
 * the session, the rating from the Elo layer, and the difficulty ladder from the
 * chart itself — no placeholder numbers, because a home screen that lies about
 * your progress is worse than one that admits it has none yet.
 */

const el = (id) => document.getElementById(id);

async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? 'request failed');
  return response.json();
}

function render(profile) {
  const { player, rating, stats, ruleSet, ladder } = profile;

  el('name').value = player.name;
  el('initial').textContent = player.initial;
  el('since').textContent =
    stats.hands === 0
      ? 'no hands yet'
      : `${stats.hands.toLocaleString()} hand${stats.hands === 1 ? '' : 's'} · ` +
        `${stats.decisions.toLocaleString()} decisions`;

  // A provisional rating is shown faded rather than hidden: the number is real,
  // it just has an ±80 error bar until about 30 rated decisions.
  el('rating').textContent = Math.round(rating.rating / 10) * 10;
  el('rating').className = 'rating-value' + (rating.provisional ? ' provisional' : '');
  el('rating-label').textContent =
    `Blackjack rating · ${rating.mode}` + (rating.provisional ? ' · provisional' : '');
  el('peak').textContent = Math.round(rating.peak / 10) * 10;

  const delta = Math.round(rating.sessionDelta);
  const deltaEl = el('session-delta');
  deltaEl.textContent = rating.ratedDecisions === 0 ? 'unrated' : `${delta >= 0 ? '+' : ''}${delta} this session`;
  deltaEl.className = delta > 0 ? 'up' : delta < 0 ? 'down' : '';

  el('accuracy').textContent =
    stats.decisions === 0 ? '—' : `${(stats.accuracy * 100).toFixed(1)}%`;
  el('evlost').textContent = stats.hands === 0 ? '—' : stats.evLostPer100.toFixed(2);
  el('edge').textContent =
    stats.hands === 0 ? `${ruleSet.edgePercent.toFixed(2)}%` : `${stats.effectiveHouseEdgePercent.toFixed(2)}%`;
  el('units').textContent = stats.hands === 0 ? '—' : stats.netUnits;

  el('bj-rules').textContent = ruleSet.name;
  el('bj-rating').textContent = rating.ratedDecisions === 0 ? '—' : Math.round(rating.rating / 10) * 10;
  el('bj-hands').textContent = stats.hands.toLocaleString();
  el('house-edge').textContent = `${ruleSet.edgePercent.toFixed(2)}%`;
  el('ladder-mode').textContent = rating.mode;

  for (const button of document.querySelectorAll('.mode')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === rating.mode));
  }

  // The ladder is what makes the rating legible: real cells, at their real
  // computed difficulty, in the mode currently selected.
  const box = el('ladder');
  box.replaceChildren();
  if (ladder.length === 0) return;
  const lo = ladder[0].difficulty;
  const hi = ladder[ladder.length - 1].difficulty;
  for (const row of ladder) {
    const width = hi === lo ? 50 : ((row.difficulty - lo) / (hi - lo)) * 100;
    const div = document.createElement('div');
    div.className = 'ladder-row';
    div.innerHTML =
      `<div><div>${row.label} <span class="muted">· ${row.optimal}</span></div>` +
      `<div class="ladder-bar" style="width:${Math.max(6, width)}%"></div>` +
      `<div class="ladder-meta">margin ${row.margin.toFixed(4)} · one in ${row.oneIn} hands</div></div>` +
      `<div class="ladder-score">${row.difficulty}</div>`;
    box.appendChild(div);
  }
}

for (const button of document.querySelectorAll('.mode')) {
  button.addEventListener('click', async (event) => {
    event.preventDefault(); // the buttons sit inside the game link
    render(await api('/api/player', { mode: button.dataset.mode }));
  });
}

el('name').addEventListener('change', async (event) => {
  render(await api('/api/player', { name: event.target.value }));
});

api('/api/uth/preview')
  .then((uth) => {
    el('uth-classes').textContent = `pre-flop table ${uth.solvedClasses}/169`;
  })
  .catch(() => {});

api('/api/profile').then(render);
