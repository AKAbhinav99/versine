/* Screen switching. Screens are sections in index.html; only one is active. */

import { $, $$ } from './lib/dom.js';
import { INTRO_KEY } from './config.js';

const enterHooks = new Map();
const leaveHooks = new Map();
let active = null;

/* Which bottom tab lights up for each screen, the scan flow keeps "Scan" lit. */
const TAB_OF = {
  intro: 'capture', capture: 'capture', adjust: 'capture', analyze: 'capture', result: 'capture',
  intake: 'capture', report: 'capture',
  doctors: 'doctors', resources: 'resources', history: 'history',
};

export const onEnter = (screen, fn) => enterHooks.set(screen, fn);
export const onLeave = (screen, fn) => leaveHooks.set(screen, fn);
export const currentScreen = () => active;

export function showScreen(name, payload) {
  if (active && leaveHooks.has(active)) leaveHooks.get(active)();

  $$('.screen').forEach((section) => {
    section.toggleAttribute('data-active', section.id === `screen-${name}`);
  });
  $$('.tab').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === TAB_OF[name]));
  });

  /* The disclaimer gate has nothing to gate if the tab bar sits underneath it
     offering a way around it. `.hidden` (not the `hidden` attribute) because
     .tabbar already carries `display: grid` in base.css, and only a rule with
     `!important` reliably beats that (the same reason print.css force-hides it
     with `!important` rather than relying on the cascade). Hidden this way the
     buttons have no layout box, so they take no click, tap, or Tab focus. */
  /* Once the disclaimer has been accepted, the intro is just a page to revisit
     (from the logo), and the tabs are the way back out of it. */
  let accepted = false;
  try { accepted = Boolean(localStorage.getItem(INTRO_KEY)); } catch { /* storage blocked */ }
  const tabbar = $('.tabbar');
  if (tabbar) tabbar.classList.toggle('hidden', name === 'intro' && !accepted);

  const previous = active;
  active = name;
  window.scrollTo({ top: 0 });
  if (enterHooks.has(name)) enterHooks.get(name)(payload);

  /* For anything that needs to know the screen changed without owning that
     screen's enter hook (onEnter keeps one hook per screen): the scroll scenes
     build and tear themselves down per screen from this. */
  document.dispatchEvent(new CustomEvent('screenchange', { detail: { name, previous } }));
}

export function initTabs(onTab) {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => onTab(tab.dataset.tab));
  });
}
