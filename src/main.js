/* App entry: wires the screens together and decides where to land on open. */

import { $, el } from './lib/dom.js';
import { INTRO_KEY, LEGACY_KEYS } from './config.js';
import { showScreen, initTabs, onEnter } from './router.js';
import { initCapture } from './screens/capture.js';
import { initAdjust } from './screens/adjust.js';
import { initMotion } from './lib/motion.js';
import { initDotfield } from './lib/dotfield.js';

/* Carry anything stored under the pre-rename namespace across first. Must run
   before any screen reads storage. */
migrateLegacyStorage();

initCapture();
initAdjust();
initMotion();
initDotfield();

/* Only the capture flow is loaded up front. The other screens are whole
   subtrees — the clinician finder alone pulls eight modules and Leaflet — and
   none of them is needed to show a viewfinder. Each arrives the first time its
   tab is opened, and the router shows the empty screen immediately so the tap
   still feels instant. */
/* The failure branch matters more than the success one, and it has two halves.
 *
 * Clearing our own cached promise is the obvious half: one tap made offline
 * should not leave that tab dead for the session. The other half is not obvious
 * and cost a round of testing to find — the browser's module map remembers a
 * module whose fetch failed, so importing the same specifier again returns the
 * cached failure without going near the network. Measured directly: with the
 * server back up and the file returning 200, a plain re-import still rejected
 * while the identical file behind a fresh query string resolved.
 *
 * So each retry needs a URL the module map has not seen. This recovers the case
 * that actually happens — the whole subtree failing because the network was
 * down. It cannot recover a partial failure deeper in the graph, since those
 * modules keep their canonical specifiers; a reload is the only cure for that,
 * and the message says so once a retry has already failed. */
const lazyModule = (path) => {
  let pending = null;
  let attempts = 0;

  return () => (pending ||= import(attempts++ === 0 ? path : `${path}?retry=${attempts}`)
    .catch((error) => {
      pending = null;
      throw error;
    }));
};

const loadDoctors = lazyModule('./screens/doctors.js');
/* A module namespace object is sealed, so the "already wired" flag lives here.
   It can only be set after a load that succeeded, which is exactly when the
   listeners were actually attached. */
let doctorsWired = false;
const doctors = () => loadDoctors().then((module) => {
  if (!doctorsWired) { module.initDoctors(); doctorsWired = true; }
  return module;
});
const history = lazyModule('./screens/history.js');

/* The tab has already switched by the time this runs, so a silent failure would
   leave someone staring at an empty screen. */
const lazyScreen = (screen, load, show, container) => {
  let failures = 0;
  onEnter(screen, () => {
    load()
      .then((module) => { failures = 0; show(module); })
      .catch(() => loadFailed(container, ++failures, () => showScreen(screen)));
  });
};

lazyScreen('doctors', doctors, (module) => module.showDoctors(), '#places-notice');
lazyScreen('history', history, (module) => module.renderHistory(), '#history-body');

function loadFailed(container, failures, retry) {
  const host = $(container);
  if (!host) return;

  const stubborn = failures > 1;
  host.replaceChildren(
    el('div', { class: 'empty' },
      el('p', {}, 'This section could not load — it is fetched the first time you open it, and the request did not get through. Your scans are safe on this device.'),
      stubborn
        ? el('p', { class: 'small muted' }, 'It failed again. Reloading the page clears what the browser cached about the failure, which a retry on its own cannot always do.')
        : null,
      stubborn
        ? el('button', { class: 'btn', onClick: () => location.reload() }, 'Reload the page')
        : el('button', { class: 'btn', onClick: retry }, 'Try again')));
}

/* Belt-and-suspenders alongside router.js hiding the tab bar during the intro
   screen: that removes the buttons from layout so nothing can click or tab to
   them, but a `.click()` dispatched straight at a hidden button still fires its
   listener. Refusing here means even a synthetic event, or a future call site
   that shows the tab bar early, cannot land on a gated screen before the
   disclaimer has actually been accepted. */
initTabs((tab) => {
  if (!localStorage.getItem(INTRO_KEY)) { showScreen('intro'); return; }
  showScreen(tab);
});

/* The analysis cluster is not on the critical path, but it is needed the moment
   someone accepts a photo — so it is fetched once the browser is otherwise idle
   rather than at load or at the tap. */
/* Failing here costs nothing: accepting a photo imports it again, and that path
   reports its own failure. Swallowed so it does not surface as an unhandled
   rejection every time someone opens the app offline. */
const warm = () => { import('./screens/analyze.js').catch(() => {}); };
if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 4000 });
else setTimeout(warm, 1500);

function migrateLegacyStorage() {
  for (const [oldKey, newKey] of Object.entries(LEGACY_KEYS)) {
    try {
      const value = localStorage.getItem(oldKey);
      if (value !== null && localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, value);
      }
      if (value !== null) localStorage.removeItem(oldKey);
    } catch { /* storage unavailable; the app still works, it just will not persist */ }
  }
}

$('#intro-accept').addEventListener('click', () => {
  localStorage.setItem(INTRO_KEY, String(Date.now()));
  showScreen('capture');
});

/* The disclaimer gate shows once; after that the app opens on the capture screen. */
showScreen(localStorage.getItem(INTRO_KEY) ? 'capture' : 'intro');

/* ?demo renders the result screen from a hand-written fixture, for showing the
   app on a machine with no camera. Never runs during a real scan. */
if (new URLSearchParams(location.search).has('demo')) {
  import('./dev/demo.js').then((module) => module.runDemoScan());
}
