/*
 * Which explanations get opened (round 15, asked for in round 14).
 *
 * Idan wants to know what people press and what nobody ever touches. The answer
 * is a handful of numbers, not a trail: **counters, not logs.**
 *
 * WHAT IS KEPT, EXACTLY: for each control, how many times this player has
 * opened it. Nothing else. No sequence — the numbers cannot say what followed
 * what. No timestamps — they cannot say when, or how long, or how often in one
 * sitting. They answer "what is useful and what is dead weight" and they cannot
 * be made to answer anything about somebody's evening.
 *
 * WHERE IT LIVES: inside the player's own saved record, beside the day count
 * from round 9. No new service, no new cost, no migration.
 *
 * WHO CAN READ IT: the shared table is open to anyone who has the app's
 * address, by design — so these counts are public too, exactly as the day count
 * is. The usage page says so on the page.
 *
 * Lives on `window.EVCount`.
 */
(function () {
  const KEY = 'ev:counts';

  /**
   * Every control counted, and nothing else. A control that is not on this list
   * is not counted at all — `bump` ignores it — so adding a counter is a
   * deliberate act rather than something a stray call can do.
   */
  const IDS = [
    'help', // the figures explanation opened
    'helpShut', // and closed, which is what tells us whether open-by-default is right
    'primer', // how the game works, from the felt
    'howto', // how the trainer works
    'chart', // the strategy chart
    'rules', // the rule panel
    'level', // how much the app explains, changed
    'arrow', // the "there is more below" arrow, tapped
    'statInfo', // what one of the strip's figures means
    'next', // stepped through the reasoning
    'skip', // skipped to the answer
    'hand', // opened a hand in the log
  ];

  let counts = read();

  function read() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      return clean(raw);
    } catch {
      return {};
    }
  }

  /** Only known ids, only whole counts: anything else is not data, it is noise. */
  function clean(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const id of IDS) {
      const n = Number(raw[id]);
      if (Number.isFinite(n) && n > 0) out[id] = Math.floor(n);
    }
    return out;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(counts));
    } catch {
      // Storage off: the counts last as long as the page does. Nothing that
      // matters to the player depends on them.
    }
  }

  /** One press of one control. Unknown ids are ignored on purpose. */
  function bump(id) {
    if (IDS.indexOf(id) < 0) return;
    counts[id] = (counts[id] || 0) + 1;
    save();
  }

  /** What this device has counted, as a plain object to ride in the record. */
  const all = () => ({ ...counts });

  /**
   * Two devices' counts, as one.
   *
   * The larger of each pair, never the sum: the same device's record is written
   * back and read again all the time, and adding would inflate every count by
   * however often it synced. The max can only undercount — the safe direction
   * for numbers a decision about what to build rests on.
   */
  function merge(a, b) {
    const out = clean(a);
    const other = clean(b);
    for (const id of IDS) {
      if (other[id] === undefined) continue;
      out[id] = Math.max(out[id] || 0, other[id]);
    }
    return out;
  }

  /** Take a record's counts, if this device has fewer of any of them. */
  function restore(saved) {
    counts = merge(counts, saved);
    save();
    return all();
  }

  window.EVCount = { KEY, IDS, bump, all, merge, restore, clean };
})();
