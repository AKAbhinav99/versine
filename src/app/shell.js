/* App mode: how the web app behaves inside the iOS app.
 *
 * The iOS app (ios/) is this web app in a native shell, which supplies the tab
 * bar, alerts, the print sheet, location and haptics through
 * window.VersineNative. The website's own chrome is made for a browser window:
 * a masthead with the logo, a floating tab bar, a dot field behind everything,
 * scroll reveals, and an intro told through scroll scenes. Inside an app all of
 * that reads as a web page, so in app mode none of it runs (main.js), and this
 * module adds what an iOS screen has instead:
 *
 *   - a navigation bar: a back button on the steps of a scan, and a title that
 *     appears as the screen's large title scrolls up under it;
 *   - push and pop transitions between the steps of a scan, and none between
 *     tabs, as in any iOS app;
 *   - the capture tips in a sheet, so the camera screen is all camera;
 *   - the route reported to the native shell on every screen change, so its
 *     tab bar shows the right tab, hides on the disclaimer gate and the steps
 *     of a scan, and the status bar goes light over the camera.
 *
 * boot.js decides app mode before first paint (html[data-shell="app"]): when
 * the native shell has injected window.VersineNative, or with ?app in a
 * browser, so this layout can be worked on without Xcode. The look is
 * styles/app.css. None of this changes what is measured or stored. */

import { $, $$, el } from '../lib/dom.js';
import { showScreen, onEnter, TAB_OF } from '../router.js';
import { INTRO_KEY } from '../config.js';

export const inApp = document.documentElement.dataset.shell === 'app';

const native = window.VersineNative || null;

/* Each screen's navigation bar. `large` puts the title at the top of the screen
   as an iOS large title; without it the bar shows the title from the start.
   Screens with `root` are where a tab starts. */
const SCREENS = {
  intro: { root: true, bar: false, tabBar: false },
  home: { root: true, title: 'Home', large: true },
  capture: { root: true, bar: false, camera: true },
  adjust: { title: 'Line It Up', tabBar: false },
  analyze: { bar: false, tabBar: false },
  result: { title: 'Result', large: true },
  intake: { title: 'About You', large: true },
  report: { title: 'Summary', large: true },
  doctors: { root: true, title: 'Find Care', large: true },
  resources: { root: true, title: 'Learn', large: true },
  history: { root: true, title: 'Scan Log', large: true },
};

/* Steps a back button skips over: the measuring screen has finished, and a
   photo already measured is not lined up again. */
const PASS_THROUGH = new Set(['adjust', 'analyze']);

let stack = [];
let route = null;
let bar = null;
let barTitle = null;
let backButton = null;

export function initShell() {
  buildBar();
  addHome();
  addLargeTitles();
  moveCaptureTips();
  wireHaptics();
  wireEdgeSwipe();

  document.addEventListener('screenchange', ({ detail }) => onScreen(detail.name));
  window.addEventListener('scroll', syncBar, { passive: true });

  /* Called by the native tab bar. Goes through the web app's own tab buttons
     (hidden in app mode), so the disclaimer gate guards both alike. Home has
     no web tab, so it checks the gate itself. */
  window.VersineApp = {
    selectTab: (name) => {
      const tab = $(`.tab[data-tab="${name}"]`);
      if (tab) tab.click();
      else showScreen(localStorage.getItem(INTRO_KEY) ? name : 'intro');
    },
  };
}

/* ------------------------------------------------------------ navigation --- */

function onScreen(name) {
  const screen = SCREENS[name] || {};
  const before = stack.length;

  if (screen.root) {
    stack = [name];
  } else if (stack.includes(name)) {
    stack = stack.slice(0, stack.indexOf(name) + 1);
  } else {
    stack.push(name);
  }
  const direction = screen.root ? 'none' : stack.length > before ? 'push' : 'pop';

  document.documentElement.dataset.screen = name;
  enter($(`#screen-${name}`), direction);
  updateBar(name, screen);

  route = {
    screen: name,
    /* The tab a flow started from: the questionnaire opened from Home or the
       Log belongs to that tab, not to Scan, where it lives on the website. */
    tab: TAB_OF[stack[0]] || TAB_OF[name],
    tabBar: screen.tabBar !== false,
    camera: Boolean(screen.camera),
  };
  native?.route(route);
}

function backTarget() {
  const trail = stack.slice(0, -1).filter((name) => !PASS_THROUGH.has(name));
  return trail.at(-1) || 'capture';
}

async function goBack() {
  const leaving = stack.at(-1);
  const target = backTarget();
  /* The intake saves each answer as it is given, the Done button only redraws
     the result underneath it so a newly reported red flag shows. Back has to do
     the same. */
  if (leaving === 'intake' && target === 'result') {
    const { rerenderResult } = await import('../screens/result.js');
    rerenderResult();
  }
  showScreen(target);
}

function enter(section, direction) {
  if (!section) return;
  delete section.dataset.enter;
  if (direction === 'none') return;
  /* A reflow between removing and setting restarts the animation when the same
     direction plays twice in a row. */
  void section.offsetWidth;
  section.dataset.enter = direction;
  section.addEventListener('animationend', () => { delete section.dataset.enter; }, { once: true });
}

/* Wherever there is a back button, a swipe in from the left edge goes back
   too, as on any pushed iOS screen: the screen follows the finger, and past a
   third of the width, or with a flick, it lets go. */
const EDGE_PX = 24;

function wireEdgeSwipe() {
  let drag = null;

  document.addEventListener('touchstart', (event) => {
    const touch = event.touches[0];
    if (event.touches.length !== 1 || touch.clientX > EDGE_PX) return;
    if (!backButton || backButton.hidden || bar.hidden) return;
    drag = { x: touch.clientX, y: touch.clientY, t: event.timeStamp, moving: false, section: $('.screen[data-active]') };
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!drag) return;
    const touch = event.touches[0];
    const dx = touch.clientX - drag.x;
    const dy = touch.clientY - drag.y;
    if (!drag.moving) {
      /* Decide once: a mostly vertical movement is a scroll, not a swipe. */
      if (Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
      if (dx < 8) return;
      drag.moving = true;
      delete drag.section.dataset.enter;
      drag.section.style.transition = 'none';
    }
    event.preventDefault();
    drag.section.style.transform = `translateX(${Math.max(0, dx)}px)`;
  }, { passive: false });

  const release = (event) => {
    if (!drag?.moving) { drag = null; return; }
    const { section } = drag;
    const dx = event.changedTouches[0].clientX - drag.x;
    const flick = dx / Math.max(1, event.timeStamp - drag.t) > 0.5;
    const goes = event.type === 'touchend' && (dx > window.innerWidth / 3 || flick);
    drag = null;

    section.style.transition = 'transform 240ms cubic-bezier(0.32, 0.72, 0, 1)';
    section.style.transform = goes ? 'translateX(100%)' : '';
    section.addEventListener('transitionend', () => {
      section.style.transition = '';
      section.style.transform = '';
      if (goes) goBack();
    }, { once: true });
  };
  document.addEventListener('touchend', release);
  document.addEventListener('touchcancel', release);
}

/* ------------------------------------------------------------------ home --- */

/* The app's first tab, a summary in the manner of Health: when to scan next,
   the latest reading, and where to go from it. The website opens on the
   viewfinder instead, so this screen exists only here, and is drawn by
   src/app/home.js each time it is shown, since a scan may have landed since. */
function addHome() {
  const capture = $('#screen-capture');
  if (!capture) return;
  capture.before(el('section', { class: 'screen screen--pad home', id: 'screen-home', 'aria-labelledby': 'home-title' },
    el('h2', { class: 'visually-hidden', id: 'home-title' }, 'Home'),
    el('div', { id: 'home-body' })));
  onEnter('home', () => import('./home.js').then((module) => module.renderHome()));
}

/* -------------------------------------------------------- navigation bar --- */

/* Built into the existing masthead, whose logo and theme toggle app.css hides:
   iOS supplies the appearance, and the home screen icon is the logo. */
function buildBar() {
  bar = $('.masthead');
  if (!bar) return;
  backButton = el('button', { class: 'appbar__back', type: 'button', 'aria-label': 'Back', onClick: goBack },
    chevron());
  barTitle = el('span', { class: 'appbar__title', 'aria-hidden': 'true' });
  bar.append(backButton, barTitle);
}

function chevron() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M15 4.5 7.5 12l7.5 7.5" />';
  return svg;
}

function updateBar(name, screen) {
  if (!bar) return;
  bar.hidden = screen.bar === false;
  barTitle.textContent = screen.title || '';
  backButton.hidden = Boolean(screen.root);
  bar.classList.toggle('has-large-title', Boolean(screen.large));
  syncBar();
}

/* Two states, as in UIKit: the edge effect behind the bar once anything has
   scrolled under it, and the small title once the large one has gone. */
function syncBar() {
  if (!bar || bar.hidden) return;
  const height = bar.getBoundingClientRect().height;
  bar.classList.toggle('is-scrolled', window.scrollY > 2);
  const large = $('.screen[data-active] .app-title');
  const gone = !large || large.getBoundingClientRect().bottom < height;
  bar.classList.toggle('shows-title', !bar.classList.contains('has-large-title') || gone);
}

/* The large title opens the screen. The screen's own heading stays, as the
   accessible name and as a subtitle, so the title itself is not announced twice. */
function addLargeTitles() {
  for (const [name, screen] of Object.entries(SCREENS)) {
    const section = $(`#screen-${name}`);
    if (!section || !screen.large) continue;
    section.prepend(el('p', { class: 'app-title', 'aria-hidden': 'true' }, screen.title));
  }
}

/* ---------------------------------------------------------- capture tips --- */

/* The four tips under the viewfinder become a sheet behind an info button,
   so the camera screen fits without scrolling. */
function moveCaptureTips() {
  const tips = $('.capture__steps');
  const hint = $('#capture-hint');
  if (!tips || !hint) return;

  const close = () => sheet.close();
  const sheet = el('dialog', { class: 'sheet', 'aria-labelledby': 'tips-title' },
    el('div', { class: 'sheet__grabber', 'aria-hidden': 'true' }),
    el('header', { class: 'sheet__head' },
      el('h2', { id: 'tips-title', class: 'sheet__title' }, 'Taking the photo'),
      el('button', { class: 'sheet__done', type: 'button', onClick: close }, 'Done')),
    tips);
  /* A tap on the dimmed backdrop lands on the dialog element itself. */
  sheet.addEventListener('click', (event) => { if (event.target === sheet) close(); });
  /* The native tab bar draws above the page, so it steps aside while the sheet
     is up, as it would for a sheet presented by UIKit. */
  sheet.addEventListener('close', () => native?.route(route));
  document.body.append(sheet);

  const info = el('button', {
    class: 'capture__info', type: 'button', 'aria-label': 'How to take the photo',
    onClick: () => {
      native?.route({ ...route, tabBar: false });
      sheet.showModal();
    },
  }, 'i');
  const top = el('div', { class: 'capture__top' });
  hint.replaceWith(top);
  top.append(hint, info);
}

/* --------------------------------------------------------------- haptics --- */

function wireHaptics() {
  if (!native) return;
  $('#capture-shutter')?.addEventListener('click', () => native.haptic('medium'));
  $$('.pose-switch button, .chip').forEach((button) => {
    button.addEventListener('click', () => native.haptic('selection'));
  });
  document.addEventListener('screenchange', ({ detail }) => {
    if (detail.name === 'result') native.haptic('light');
  });
}
