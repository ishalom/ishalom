/*
 * The hand analyser's screen (round 16).
 *
 * A player names cards and gets the same answer the table gives: the same bars,
 * the same figures, the same worked lines, at whatever level he is on. The
 * screen's whole job is to make naming a hand cost three taps on a phone — no
 * keyboard, no scrolling, no suit picker, because blackjack has no use for one.
 *
 * It asks `/api/analyse`, which is a pure function with no session behind it.
 * Nothing this screen can do reaches a rating, an accuracy, a streak or the day
 * count, and that is structural rather than remembered.
 */

const T = (key, params) => (window.EV ? window.EV.t(key, params) : key);
const el = (id) => document.getElementById(id);

/** What a player can tap. A ten stands for the jack, the queen and the king. */
const AN_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const AN_MAX_CARDS = 4;

const anState = {
  /** The player's cards, by rank, in the order they were tapped. */
  player: [],
  /** The dealer's one card. */
  dealer: null,
  /** Whether the next tap adds a card beyond the first two. */
  adding: false,
  presetId: null,
  presets: [],
  result: null,
};

async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'request failed');
  return data;
}

/** Which slot the next tap fills. */
function anWanting() {
  if (anState.player.length < 2) return 'player';
  if (!anState.dealer) return 'dealer';
  return anState.adding && anState.player.length < AN_MAX_CARDS ? 'player' : null;
}

function anRenderSlots() {
  const box = el('an-slots');
  box.replaceChildren();
  const wanting = anWanting();

  const group = (labelKey, ranks, active) => {
    const wrap = document.createElement('div');
    wrap.className = 'an-group' + (active ? ' active' : '');
    const label = document.createElement('div');
    label.className = 'an-label';
    label.textContent = T(labelKey);
    const cards = document.createElement('div');
    cards.className = 'an-cards';
    ranks.forEach((rank, index) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'an-card-slot';
      card.dataset.rank = rank;
      card.textContent = rank;
      // Tapping a card that is already down takes it back, which is the whole
      // undo this screen needs.
      card.addEventListener('click', () => {
        if (labelKey === 'an.dealers') anState.dealer = null;
        else anState.player.splice(index, 1);
        anState.adding = false;
        anRun();
      });
      cards.appendChild(card);
    });
    if (active) {
      const slot = document.createElement('span');
      slot.className = 'an-card-slot empty';
      slot.textContent = '?';
      cards.appendChild(slot);
    }
    wrap.append(label, cards);
    return wrap;
  };

  box.appendChild(group('an.yours', anState.player, wanting === 'player'));
  box.appendChild(group('an.dealers', anState.dealer ? [anState.dealer] : [], wanting === 'dealer'));

  el('an-hint').textContent = T(
    wanting === 'player' && anState.player.length < 2
      ? 'an.tapYours'
      : wanting === 'dealer'
        ? 'an.tapDealer'
        : 'an.tapMore',
  );
  el('an-add').disabled = !anState.dealer || anState.player.length >= AN_MAX_CARDS || anState.adding;
}

function anRenderPad() {
  const pad = el('an-pad');
  if (pad.children.length > 0) return;
  for (const rank of AN_RANKS) {
    const key = document.createElement('button');
    key.type = 'button';
    key.className = 'an-key';
    key.dataset.rank = rank;
    // The ten key says what it covers: in blackjack a picture card is a ten.
    key.textContent = rank === '10' ? T('an.tenKey') : rank;
    key.addEventListener('click', () => anTap(rank));
    pad.appendChild(key);
  }
}

function anTap(rank) {
  const wanting = anWanting();
  if (wanting === 'player') anState.player.push(rank);
  else if (wanting === 'dealer') anState.dealer = rank;
  else return;
  anState.adding = false;
  anRun();
}

/** Ask, and draw whatever comes back — an answer, or a sentence saying why not. */
async function anRun() {
  anRenderSlots();
  const ready = anState.player.length >= 2 && anState.dealer;
  el('an-says').hidden = true;
  el('an-result').hidden = true;
  if (!ready) return;

  let result;
  try {
    result = await api('/api/analyse', {
      player: anState.player,
      dealer: anState.dealer,
      presetId: anState.presetId ?? undefined,
      locale: window.EV ? window.EV.locale : 'en',
    });
  } catch (error) {
    el('an-says').hidden = false;
    el('an-says').textContent = String(error.message ?? error);
    return;
  }
  anState.result = result;

  if (!result.ok) {
    // A hand that cannot exist, or one with nothing left to decide, gets a
    // sentence and no figures. A figure for an impossible hand would be a lie
    // told confidently.
    el('an-says').hidden = false;
    el('an-says').textContent = result.says;
    // And nothing of the last answer is left standing behind the sentence.
    el('an-card').replaceChildren();
    el('an-steps').replaceChildren();
    return;
  }

  el('an-result').hidden = false;
  el('an-headline').textContent = result.headline;
  el('an-best').textContent = T('an.best', { action: result.best.label });
  el('an-rules-line').textContent = result.ruleSet.name;

  // The same block the table draws, from the same data — including the worked
  // line under every action, and the explanation panel at this player's level.
  const card = el('an-card');
  card.replaceChildren();
  card.appendChild(
    window.EVReturns.block(
      { ranked: result.ranked, returns: result.returns, chosen: null, breakdown: result.breakdown },
      { game: 'bj', helpId: 'an-returns-help' },
    ),
  );

  /*
   * §3.3, which a player has never been able to see until now: the same cards
   * under another rule set, sometimes with the answer reversed. Shown here at
   * every level, because choosing the rules is part of what this screen is for.
   */
  const sensitivity = el('an-sensitivity');
  sensitivity.hidden = result.sensitivity.length === 0;
  if (result.sensitivity.length > 0) {
    sensitivity.textContent = T('fb.ruleSensitive', {
      list: result.sensitivity
        .map((s) => `${T('action.' + s.action).toLowerCase()} ${T('sens.' + s.id)}`)
        .join('; '),
    });
  }

  // The reasoning, in the share this level reads — the same three steps, and
  // the same one for a beginner.
  const steps = el('an-steps');
  steps.replaceChildren();
  const shown = window.EVLevel ? window.EVLevel.steps() : 3;
  result.steps.slice(3 - shown).forEach((text) => {
    const step = document.createElement('p');
    step.className = 'an-step';
    window.EVReturns.rich(step, text);
    steps.appendChild(step);
  });
}

async function anOpenRules() {
  if (anState.presets.length === 0) anState.presets = await api('/api/presets');
  const list = el('an-preset-list');
  list.replaceChildren();
  for (const preset of anState.presets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset' + (preset.id === (anState.presetId ?? anState.presets[0].id) ? ' current' : '');
    const name = document.createElement('strong');
    name.textContent = preset.name;
    const note = document.createElement('small');
    note.textContent = preset.badge ?? preset.note ?? '';
    button.append(name, note);
    button.addEventListener('click', () => {
      anState.presetId = preset.id;
      el('an-rule-picker').close();
      anRun();
    });
    list.appendChild(button);
  }
  el('an-rule-picker').showModal();
}

el('an-add').addEventListener('click', () => {
  anState.adding = true;
  anRenderSlots();
});
el('an-clear').addEventListener('click', () => {
  anState.player = [];
  anState.dealer = null;
  anState.adding = false;
  anRun();
});
el('an-rules').addEventListener('click', () => {
  window.EVCount.bump('rules');
  void anOpenRules();
});

Promise.resolve(window.EV && window.EV.ready).then(() => {
  anRenderPad();
  anRun();
});
