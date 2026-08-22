/* App entry: wires the screens together and decides where to land on open. */

import { $ } from './lib/dom.js';
import { INTRO_KEY } from './config.js';
import { showScreen, initTabs, onEnter } from './router.js';
import { initCapture } from './screens/capture.js';
import { initAdjust } from './screens/adjust.js';
import { initDoctors } from './screens/doctors.js';
import { renderHistory } from './screens/history.js';

initCapture();
initAdjust();
initDoctors();
onEnter('history', renderHistory);

initTabs((tab) => showScreen(tab));

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
