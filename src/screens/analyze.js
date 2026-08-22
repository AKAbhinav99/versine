/* The analysis pass: load the pose model, detect landmarks, run the geometry,
 * classify against the screening thresholds, log the scan. */

import { $, $$ } from '../lib/dom.js';
import { showScreen } from '../router.js';
import { loadPoseLandmarker } from '../lib/pose.js';
import { measureWithConsensus } from '../lib/consensus.js';
import { classifyReading } from '../lib/screening.js';
import { saveScan, makeThumbnail } from '../lib/storage.js';
import { renderResult, renderFailure } from './result.js';

/* Each stage holds long enough to be readable — the log is there so a slow first
   load looks like progress rather than a hang. */
const MIN_STEP_MS = 380;

export async function runAnalysis(photoCanvas, adjustments = null) {
  showScreen('analyze');
  $('#analyze-preview').src = photoCanvas.toDataURL('image/jpeg', 0.55);
  resetLog();

  try {
    await runStep('model', () => loadPoseLandmarker());

    /* Measured at several framings, because one framing is not reliable on its
       own — see lib/consensus.js. */
    const reading = await runStep('detect', () => measureWithConsensus(photoCanvas, (framing) => {
      setDetail(`framing: ${framing}`);
    }));
    setDetail(reading.usable
      ? `${reading.passes} of ${reading.totalFramings} framings agreed`
      : `${reading.passes} of ${reading.totalFramings} framings usable`);

    await runStep('agree', () => reading);
    const verdict = await runStep('compare', () => classifyReading(reading));

    const entry = reading.usable
      ? saveScan({ reading, verdict, adjustments, thumbnail: makeThumbnail(photoCanvas) })
      : null;

    showScreen('result');
    renderResult({ reading, verdict, entry, adjustments });
  } catch (error) {
    reportFailure(error, photoCanvas);
  }
}

function reportFailure(error, photoCanvas) {
  console.error('[SpineCheck] analysis failed', error);
  renderFailure({
    photo: photoCanvas,
    headline: 'The pose model failed to load',
    body: 'SpineCheck downloads its landmark model the first time you scan, so this step needs a network connection. Check you are online and try the scan again.',
  });
}

/* ---------------------------------------------------------------- the log --- */

function resetLog() {
  $$('#analyze-log li').forEach((item) => { item.dataset.state = 'pending'; });
  setDetail('');
}

const setState = (step, state) => {
  const item = $(`#analyze-log li[data-step="${step}"]`);
  if (item) item.dataset.state = state;
};

/* Live sub-status, so a multi-framing pass doesn't look like a stall. */
const setDetail = (text) => { $('#analyze-detail').textContent = text; };

async function runStep(step, work) {
  setState(step, 'active');
  const startedAt = performance.now();
  const value = await work();
  const remaining = MIN_STEP_MS - (performance.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  setState(step, 'done');
  return value;
}
