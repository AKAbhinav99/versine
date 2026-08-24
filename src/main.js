/* App entry: wires the screens together and decides where to land on open. */

import { $ } from './lib/dom.js';
import { INTRO_KEY, LEGACY_KEYS } from './config.js';
import { showScreen, initTabs, onEnter } from './router.js';
import { initCapture } from './screens/capture.js';
import { initAdjust } from './screens/adjust.js';

/* Carry anything stored under the pre-rename namespace across first. Must run
   before any screen reads storage. */
migrateLegacyStorage();

initCapture();
initAdjust();

/* Only the capture flow is loaded up front. The other screens are whole
   subtrees — the clinician finder alone pulls eight modules and Leaflet — and
   none of them is needed to show a viewfinder. Each arrives the first time its
   tab is opened, and the router shows the empty screen immediately so the tap
   still feels instant. */
const once = (load) => { let pending = null; return () => (pending ||= load()); };

const doctors = once(() => import('./screens/doctors.js').then((module) => {
  module.initDoctors();
  return module;
}));
const history = once(() => import('./screens/history.js'));

onEnter('doctors', () => { doctors().then((module) => module.showDoctors()); });
onEnter('history', () => { history().then((module) => module.renderHistory()); });

initTabs((tab) => showScreen(tab));

/* The analysis cluster is not on the critical path, but it is needed the moment
   someone accepts a photo — so it is fetched once the browser is otherwise idle
   rather than at load or at the tap. */
const warm = () => { import('./screens/analyze.js'); };
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
