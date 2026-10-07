/* Light or dark, and the masthead button that switches between them.
 *
 * boot.js has already set data-theme on <html> before first paint. This keeps
 * it in step afterwards: a click flips it and remembers the choice, and until
 * the reader has made one the page follows the system setting live. Anything
 * drawn outside CSS (the dot field, the 3D figure, the map) listens for the
 * `themechange` event on window and repaints. */

const STORAGE = 'versine.theme';
const META = { light: '#F2F5F6', dark: '#0B161D' };

const root = document.documentElement;

/** @returns {'light'|'dark'} */
export function currentTheme() {
  return root.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Calls `fn(theme)` on every change. Returns the unsubscribe. */
export function onThemeChange(fn) {
  const handler = (event) => fn(event.detail.theme);
  window.addEventListener('themechange', handler);
  return () => window.removeEventListener('themechange', handler);
}

function stored() {
  try {
    const value = localStorage.getItem(STORAGE);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function apply(theme, button) {
  if (theme === currentTheme() && root.dataset.theme) return;
  /* Colours swap in one frame rather than each element running its own
     transition at its own speed, which reads as a smear. */
  root.classList.add('theme-switching');
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META[theme]);
  sync(button);
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
}

function sync(button) {
  if (!button) return;
  const dark = currentTheme() === 'dark';
  button.setAttribute('aria-pressed', String(dark));
  button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  button.title = dark ? 'Light mode' : 'Dark mode';
}

export function initTheme() {
  const button = document.querySelector('[data-theme-toggle]');
  sync(button);

  button?.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(STORAGE, next); } catch { /* storage blocked: still switch */ }
    apply(next, button);
  });

  const system = window.matchMedia('(prefers-color-scheme: dark)');
  system.addEventListener?.('change', (event) => {
    if (!stored()) apply(event.matches ? 'dark' : 'light', button);
  });
}
