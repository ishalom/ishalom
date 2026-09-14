/*
 * The usage page (round 9).
 *
 * Idan will buy a domain only if he first sees quality use among family and
 * friends. This is how he reads that: how many people have played, how much
 * each of them played, and — the real signal — how many came back on another
 * day. Plus one reading of "quality" on top: a regular is someone who came back
 * on several days and played a real amount in all.
 *
 * Reached at `#usage`. Nothing links to it, so a friend will not wander in. It
 * is not private, and says so on the page: the table it reads is open to anyone
 * who has the app's address, by design (see backends.js).
 *
 * It reads what the app already keeps and counts nothing new about anyone: a
 * name the player chose, both games' decisions, and three facts about days.
 */

/** A regular: this many different days, and this many graded decisions in all. */
const USAGE_REGULAR_DAYS = 3;
const USAGE_REGULAR_DECISIONS = 100;
/** "Recently" means a finished hand in this many days, today included. */
const USAGE_RECENT_DAYS = 7;
/** The day the day count began, which the page names so no one reads it as older. */
const USAGE_COUNTING_FROM = '2026-09-14';

/** Whole days from `a` to `b`, both written 2026-09-14. */
function daysBetween(a, b) {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

/**
 * The table's rows, read as people. Pure, so every branch is tested without a
 * network.
 *
 * Someone with no graded decision in either game has not played, whatever row
 * they left behind, and is not counted. A row with no day count belongs to
 * someone who has not played since the count began: they appear with the day
 * they were last seen, count as having played, and count as neither back nor
 * recent — an undercount, which is the safe side for a gate.
 */
function summariseUsage(rows, today) {
  const people = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const blackjack = Math.max(0, Number(row.blackjack) || 0);
      const ultimate = Math.max(0, Number(row.ultimate) || 0);
      const counted = activityOf({ activity: row.activity });
      const days = counted ? counted.days : 0;
      return {
        name: String(row.name ?? ''),
        blackjack,
        ultimate,
        decisions: blackjack + ultimate,
        counted: Boolean(counted),
        days,
        lastPlayed: counted ? counted.lastDay : null,
        lastSeen: row.at ? localDay(new Date(row.at)) : null,
        cameBack: days >= 2,
        regular: days >= USAGE_REGULAR_DAYS && blackjack + ultimate >= USAGE_REGULAR_DECISIONS,
        recent: Boolean(counted) && daysBetween(counted.lastDay, today) < USAGE_RECENT_DAYS,
      };
    })
    .filter((person) => person.decisions > 0)
    .sort(
      (a, b) =>
        Number(b.regular) - Number(a.regular) ||
        b.days - a.days ||
        (b.lastPlayed ?? b.lastSeen ?? '').localeCompare(a.lastPlayed ?? a.lastSeen ?? '') ||
        b.decisions - a.decisions,
    );
  return {
    people,
    played: people.length,
    cameBack: people.filter((p) => p.cameBack).length,
    regulars: people.filter((p) => p.regular).length,
    recent: people.filter((p) => p.recent).length,
  };
}

const usageHtml = () => `
  <div class="shell usage">
    <a class="back" href="#home">${tr('usage.back')}</a>
    <h1 class="usage-title">${tr('usage.title')}</h1>
    <p class="usage-line">${tr('usage.line')}</p>
    <section class="usage-figures" id="usage-figures"></section>
    <section class="usage-people" id="usage-people"></section>
    <p class="usage-note" id="usage-counting"></p>
    <p class="usage-note usage-public" id="usage-public">${tr('usage.public')}</p>
  </div>`;

/** A count, written by the one figure rule like every other figure (round 8). */
const usageCount = (n) => window.EVFigure.units(n);

/** 2026-09-14 as the page's language writes a short date. */
function usageDate(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short' }).format(
    new Date(y, m - 1, d),
  );
}

async function initUsage() {
  const figures = document.getElementById('usage-figures');
  const list = document.getElementById('usage-people');
  const counting = document.getElementById('usage-counting');
  if (!figures || !list) return;
  if (counting) counting.textContent = tr('usage.counting', { day: usageDate(USAGE_COUNTING_FROM) });

  const say = (key, params) => {
    figures.replaceChildren();
    const line = document.createElement('p');
    line.className = 'empty-note';
    line.textContent = tr(key, params);
    list.replaceChildren(line);
  };

  if (!backend || typeof backend.usage !== 'function') return say('usage.noTable');
  say('usage.loading');
  let rows;
  try {
    rows = await backend.usage();
  } catch (error) {
    // A refusal says so, with its status, so a wrong query shows as an error and never as zero people.
    return error && error.status ? say('usage.refused', { status: usageCount(error.status) }) : say('usage.offline');
  }
  if (screen !== 'usage') return;

  const summary = summariseUsage(rows, localDay());
  if (summary.played === 0) return say('usage.nobody');

  const tile = (value, label, note) => {
    const div = document.createElement('div');
    div.className = 'figure';
    const v = document.createElement('div');
    v.className = 'figure-value';
    v.textContent = usageCount(value);
    const l = document.createElement('div');
    l.className = 'figure-label';
    l.textContent = label;
    const n = document.createElement('div');
    n.className = 'figure-note';
    n.textContent = note;
    div.append(v, l, n);
    return div;
  };
  figures.replaceChildren(
    tile(summary.played, tr('usage.played'), tr('usage.playedNote')),
    tile(summary.cameBack, tr('usage.cameBack'), tr('usage.cameBackNote')),
    tile(
      summary.regulars,
      tr('usage.regulars'),
      tr('usage.regularsNote', { days: usageCount(USAGE_REGULAR_DAYS), decisions: usageCount(USAGE_REGULAR_DECISIONS) }),
    ),
    tile(summary.recent, tr('usage.recent', { n: usageCount(USAGE_RECENT_DAYS) }), tr('usage.recentNote')),
  );

  list.replaceChildren(
    ...summary.people.map((person) => {
      const card = document.createElement('div');
      card.className = 'usage-person';

      const head = document.createElement('div');
      head.className = 'usage-name';
      const name = document.createElement('span');
      name.dir = 'auto';
      name.textContent = person.name;
      const tier = document.createElement('span');
      const [tierClass, tierKey] = person.regular
        ? ['regular', 'usage.tierRegular']
        : person.cameBack
          ? ['back', 'usage.tierBack']
          : ['once', 'usage.tierOnce'];
      tier.className = `usage-tier ${tierClass}`;
      tier.textContent = tr(tierKey);
      head.append(name, tier);

      const days = document.createElement('div');
      days.className = 'usage-detail';
      days.textContent = person.counted
        ? tr('usage.lastPlayed', {
            days: person.days === 1 ? tr('usage.oneDay') : tr('usage.days', { days: usageCount(person.days) }),
            last: usageDate(person.lastPlayed),
          })
        : tr('usage.notCounted', { last: person.lastSeen ? usageDate(person.lastSeen) : '—' });

      const decisions = document.createElement('div');
      decisions.className = 'usage-detail';
      decisions.textContent = tr('usage.decisions', {
        bj: usageCount(person.blackjack),
        uth: usageCount(person.ultimate),
      });

      card.append(head, days, decisions);
      return card;
    }),
  );
}
