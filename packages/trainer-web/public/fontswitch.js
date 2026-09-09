/*
 * Font switcher — temporary.
 *
 * Typography is hard to choose from a description, so the candidates ship
 * together and get compared on real hands. Once one is picked it becomes the
 * only :root block in styles.css and this file goes away.
 *
 * Loaded on every page and applied before first paint, so switching on the
 * table and then walking to Home does not flip the face back.
 */
(() => {
  const FONTS = [
    ['warm', 'Warm'],
    ['elegant', 'Elegant'],
    ['deco', 'Deco'],
    ['system', 'System'],
  ];

  const stored = (() => {
    try {
      return localStorage.getItem('ev:font');
    } catch {
      return null;
    }
  })();

  const apply = (name) => {
    document.documentElement.setAttribute('data-font', name);
    try {
      localStorage.setItem('ev:font', name);
    } catch {
      // storage disabled; the choice just does not follow you between pages
    }
    for (const button of document.querySelectorAll('.fontbar button')) {
      button.setAttribute('aria-pressed', String(button.dataset.font === name));
    }
  };

  // Before paint, so there is no flash of the default face.
  document.documentElement.setAttribute('data-font', stored ?? 'warm');

  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.className = 'fontbar';
    const label = document.createElement('span');
    label.textContent = 'Font';
    bar.appendChild(label);

    for (const [value, text] of FONTS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.font = value;
      button.textContent = text;
      button.addEventListener('click', () => apply(value));
      bar.appendChild(button);
    }

    const shell = document.querySelector('.shell');
    if (shell) shell.insertBefore(bar, shell.firstChild);
    apply(stored ?? 'warm');
  });
})();
