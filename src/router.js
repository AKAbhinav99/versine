/* Screen switching. Screens are sections in index.html; only one is active. */

import { $, $$ } from './lib/dom.js';

const enterHooks = new Map();
const leaveHooks = new Map();
let active = null;

/* Which bottom tab lights up for each screen — the scan flow keeps "Scan" lit. */
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

  active = name;
  window.scrollTo({ top: 0 });
  if (enterHooks.has(name)) enterHooks.get(name)(payload);
}

export function initTabs(onTab) {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => onTab(tab.dataset.tab));
  });
}
