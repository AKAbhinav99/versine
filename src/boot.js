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
  var theme = null;
  try { theme = window.localStorage.getItem('versine.theme'); } catch (e) { /* storage blocked */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  root.setAttribute('data-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0B161D' : '#F2F5F6');

  /* Every screen opens at its top; a reload restoring a scroll position from
     the middle of the intro would start the scroll scenes mid-way. */
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.classList.add('anim-pending');
  window.setTimeout(function () { root.classList.remove('anim-pending'); }, 1600);
}());
