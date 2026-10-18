/* The analysis pass: load the pose model, detect landmarks, run the geometry,
 * classify against the screening thresholds, log the scan. */

import { $, $$ } from '../lib/dom.js';
import { showScreen } from '../router.js';
import { loadPoseLandmarker } from '../lib/pose.js';
import { measureWithConsensus, combineBurst } from '../lib/consensus.js';
import { classifyReading } from '../lib/screening.js';
import { saveScan, makeThumbnail } from '../lib/storage.js';
import { renderResult, renderFailure } from './result.js';

/* Each stage holds long enough to be readable, the log is there so a slow first
   load looks like progress rather than a hang. */
const MIN_STEP_MS = 380;

/**
 * @param {HTMLCanvasElement[]|HTMLCanvasElement} burst frames of one scan
 */
export async function runAnalysis(burst, adjustments = null) {
  const frames = Array.isArray(burst) ? burst : [burst];
  showScreen('analyze');
  $('#analyze-preview').src = frames[0].toDataURL('image/jpeg', 0.55);
  resetLog();

  let step = 'model';
  try {
    await runStep('model', () => loadPoseLandmarker());
    step = 'measure';

    /* Each frame is measured at several framings because one framing is not
       reliable on its own, and several frames are measured because one frame
       cannot show whether the person was still, see lib/consensus.js. */
    const reading = await runStep('detect', async () => {
      const measured = [];
      for (const [index, frame] of frames.entries()) {
        measured.push(await measureWithConsensus(frame, (framing) => {
          setDetail(frames.length > 1
            ? `frame ${index + 1} of ${frames.length} · ${framing}`
            : `framing: ${framing}`);
        }));
      }
      return combineBurst(measured);
    });
    setDetail(detailFor(reading));

    await runStep('agree', () => reading);
    const verdict = await runStep('compare', () => classifyReading(reading));

    const entry = reading.usable
      ? saveScan({ reading, verdict, adjustments, thumbnail: makeThumbnail(frames[0]) })
      : null;

    showScreen('result');
    renderResult({ reading, verdict, entry, adjustments });
  } catch (error) {
    reportFailure(error, frames[0], step);
  }
}

function detailFor(reading) {
  const framings = reading.usable
    ? `${reading.passes} of ${reading.totalFramings} framings agreed`
    : `${reading.passes} of ${reading.totalFramings} framings usable`;
  return reading.frames > 1
    ? `${reading.usableFrames} of ${reading.frames} frames · ${framings}`
    : framings;
}

/* Only a failure in the model step is a download problem. Anything later used
   to be reported the same way, which hid a bug in saving the scan behind
   "the pose model failed to load". */
function reportFailure(error, photoCanvas, step) {
  console.error('[Versine] analysis failed', error);
  renderFailure(step === 'model'
    ? {
      photo: photoCanvas,
      headline: 'The pose model failed to load',
      /* The iOS app ships the model (src/config.js), so there it is no download. */
      body: location.protocol === 'versine:'
        ? 'The landmark model ships inside the app, and it would not start. Close Versine and open it again; if it keeps happening, reinstalling the app restores it.'
        : 'Versine downloads its landmark model the first time you scan, so this step needs a network connection. Check you are online and try the scan again.',
    }
    : {
      photo: photoCanvas,
      headline: 'This photo could not be measured',
      body: 'The model loaded, but measuring the photo stopped partway. Try the scan again; if it keeps happening, reloading the page usually clears it.',
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
