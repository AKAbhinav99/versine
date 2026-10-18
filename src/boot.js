/* Runs synchronously in <head>, before first paint.
 *
 * It picks the colour theme first, so a dark page never flashes light: the
 * reader's own choice if they have made one (src/lib/theme.js stores it),
 * otherwise the system's.
 *
 * Then the hero: it animates in with GSAP, which loads deferred. Without this
 * the hero would paint in its final state, then snap to hidden when GSAP takes
 * it over, then animate in: a visible flash. This hides it until scenes.js has
 * set the starting state, and gives up after a moment so a blocked CDN or a
 * failed script can only delay the hero, never hide it.
 *
 * External rather than inline because the CSP allows no inline script. */
(function () {
  var root = document.documentElement;

  /* App mode: inside the iOS app (ios/), whose shell injects window.VersineNative
     before any page script runs, or with ?app in a browser, to work on that
     layout without Xcode (kept for the tab's session). It swaps the website's
     chrome and scroll scenes for an iOS layout, see src/app/shell.js. */
  var app = Boolean(window.VersineNative);
  try {
    if (/[?&]app(=|&|$)/.test(window.location.search)) window.sessionStorage.setItem('versine.appPreview', '1');
    app = app || window.sessionStorage.getItem('versine.appPreview') === '1';
  } catch (e) { /* storage blocked */ }
  if (app) {
    root.setAttribute('data-shell', 'app');
    /* An app's screens do not pinch-zoom or zoom into a focused field. */
    var viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
  }

  var theme = null;
  try { theme = window.localStorage.getItem('versine.theme'); } catch (e) { /* storage blocked */ }
  /* An app follows the system appearance; it has no theme toggle of its own. */
  if (app || (theme !== 'light' && theme !== 'dark')) {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  root.setAttribute('data-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0B161D' : '#F2F5F6');

  /* Every screen opens at its top; a reload restoring a scroll position from
     the middle of the intro would start the scroll scenes mid-way. */
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  /* No hero animation in the app, so nothing to hide until it starts. */
  if (app) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.classList.add('anim-pending');
  window.setTimeout(function () { root.classList.remove('anim-pending'); }, 1600);
}());
