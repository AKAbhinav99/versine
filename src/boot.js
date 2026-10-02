/* Runs synchronously in <head>, before first paint, and does one thing.
 *
 * The intro hero animates in with GSAP, which loads deferred. Without this the
 * hero would paint in its final state, then snap to hidden when GSAP takes it
 * over, then animate in: a visible flash. This hides it until scenes.js has
 * set the starting state, and gives up after a moment so a blocked CDN or a
 * failed script can only delay the hero, never hide it.
 *
 * External rather than inline because the CSP allows no inline script. */
(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var root = document.documentElement;
  root.classList.add('anim-pending');
  window.setTimeout(function () { root.classList.remove('anim-pending'); }, 1600);
}());
