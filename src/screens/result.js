/* The result screen: photo with the measurement overlay, the numbers with their
 * error bars, and a plain-language reading of what they mean.
 *
 * Nothing here is a black box, and nothing here is reported without its
 * uncertainty — the benchmark that shaped this app (bench/README.md) showed a
 * single-framing measurement is not reliable enough to present as a fact. */

import { $, el, formatDate, prefersReducedMotion } from '../lib/dom.js';
import { THRESHOLDS, RELIABILITY } from '../config.js';
import { showScreen } from '../router.js';
import { nextSteps, shortSide } from '../lib/screening.js';
import { prepareCanvas, drawOverlay } from './overlay.js';

const REVEAL_MS = 1200;

export function renderResult({ reading, verdict, entry, adjustments = null }) {
  const body = $('#result-body');
  body.replaceChildren();

  const pass = reading.primary;

  body.append(
    verdictBlock(verdict),
    pass ? plate(pass, entry, reading) : null,
    reading.usable ? tiltReadout(reading) : null,
    reading.usable ? metricGrid(reading) : null,
    reliabilityPanel(reading),
    ...(adjustments?.rotationDeg ? [rotationNote(adjustments.rotationDeg)] : []),
    methodPanel(),
    ...(reading.warnings?.length ? [qualityNote(reading.warnings)] : []),
    nextStepsBlock(verdict.level),
    actions(),
    disclaimer(),
  );

  if (pass) {
    animateOverlay(body.querySelector('#result-canvas'), pass.canvas, pass.pose.landmarks, pass.measurements);
  }
}

/** Shown when the model or the network failed outright. */
export function renderFailure({ headline, body: message, photo }) {
  const body = $('#result-body');
  body.replaceChildren(
    el('div', { class: 'verdict', 'data-level': 'unclear' },
      el('div', { class: 'label verdict__kicker' }, 'No reading'),
      el('h2', { class: 'verdict__headline' }, headline),
      el('p', { class: 'verdict__body' }, message)),
    photo ? el('div', { class: 'plate' }, photoOnlyCanvas(photo)) : null,
    actions(),
    disclaimer(),
  );
  showScreen('result');
}

/* ------------------------------------------------------------------ parts --- */

function verdictBlock(verdict) {
  return el('div', { class: 'verdict', 'data-level': verdict.level },
    el('div', { class: 'label verdict__kicker' }, verdict.kicker),
    el('h2', { class: 'verdict__headline' }, verdict.headline),
    el('p', { class: 'verdict__body' }, verdict.body));
}

function plate(pass, entry, reading) {
  const canvas = el('canvas', { id: 'result-canvas', role: 'img',
    'aria-label': 'Your photo with the detected shoulder and hip landmarks and the measured tilt lines drawn on it' });
  prepareCanvas(canvas, pass.canvas);

  return el('div', {},
    el('div', { class: 'plate' }, canvas),
    el('div', { class: 'plate__caption' },
      el('span', { class: 'label' }, `Framing shown: ${pass.framing}`),
      el('span', { class: 'label' },
        entry ? `Logged ${formatDate(entry.timestamp)}` : `Confidence ${(reading.landmarkConfidence ?? 0).toFixed(2)}`)));
}

function photoOnlyCanvas(photo) {
  const canvas = prepareCanvas(el('canvas', {}), photo);
  canvas.getContext('2d').drawImage(photo, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function tiltReadout(reading) {
  return el('div', { class: 'readout readout--primary' },
    el('div', { class: 'label' }, 'Shoulder tilt from level'),
    el('div', { class: 'readout__head' },
      el('div', { class: 'readout__value' },
        reading.shoulderTiltDeg.toFixed(1), el('sup', {}, '°'),
        el('span', { class: 'readout__error' }, ` ±${reading.shoulderSpreadDeg.toFixed(1)}°`)),
      el('div', { class: 'readout__side' },
        reading.higherShoulder === 'level' ? 'Level' : `${reading.higherShoulder === 'left' ? 'Left' : 'Right'} shoulder higher`)),
    thresholdRuler(reading.shoulderTiltDeg),
    el('p', { class: 'readout__note' },
      'The angle between the line joining your shoulder points and horizontal. The ± is the real spread across five framings of the same photo, not a rounding.'));
}

/** Where this reading falls against the app's own bands. */
function thresholdRuler(value) {
  const max = THRESHOLDS.rulerMaxDeg;
  const pct = (deg) => `${Math.min(100, (deg / max) * 100)}%`;
  const track = el('div', { class: 'ruler__track' },
    el('div', { class: 'ruler__band', 'data-band': 'clear', style: `left:0;width:${pct(THRESHOLDS.shoulderMonitorDeg)}` }),
    el('div', { class: 'ruler__band', 'data-band': 'monitor', style: `left:${pct(THRESHOLDS.shoulderMonitorDeg)};width:calc(${pct(THRESHOLDS.shoulderReferDeg)} - ${pct(THRESHOLDS.shoulderMonitorDeg)})` }),
    el('div', { class: 'ruler__band', 'data-band': 'refer', style: `left:${pct(THRESHOLDS.shoulderReferDeg)};right:0` }),
    ...[0, 2, 3.5, 6, 8].map((tick) => el('div', {
      class: `ruler__tick${[0, 2, 3.5].includes(tick) ? ' ruler__tick--major' : ''}`,
      style: `left:${pct(tick)}`,
    }, el('span', {}, `${tick}°`))),
    el('div', { class: 'ruler__needle', style: `left:${pct(Math.max(value, 0))}` }));

  return el('div', { class: 'ruler' }, track,
    el('div', { class: 'ruler__legend' },
      legend('clear', 'Under 2° — level'),
      legend('monitor', '2–3.5° — track it'),
      legend('refer', '3.5°+ — get it looked at')));
}

const legend = (band, text) => el('span', {},
  el('i', { style: `background:${{ clear: 'rgba(44,122,91,0.45)', monitor: 'rgba(184,117,20,0.5)', refer: 'rgba(214,64,42,0.45)' }[band]}` }), text);

function metricGrid(reading) {
  return el('div', { class: 'metric-grid' },
    tile('Hip tilt', `${reading.hipTiltDeg.toFixed(1)}°`, shortSide(reading.higherHip)),
    tile('Framings agreed', `${reading.passes}/${reading.totalFramings}`, 'usable detections'),
    tile('Side agreement', `${Math.round(reading.sideAgreement * 100)}%`, 'framings naming the same side'),
    tile('Landmark confidence', reading.landmarkConfidence.toFixed(2), 'weakest of the four points'));
}

const tile = (label, value, note) => el('div', { class: 'readout' },
  el('div', { class: 'label' }, label),
  el('div', { class: 'readout__value' }, value),
  el('div', { class: 'readout__side', style: 'text-align:left;margin-top:6px' }, note));

function reliabilityPanel(reading) {
  const good = reading.usable;
  return el('div', { class: good ? 'notice' : 'quality-note' },
    el('b', {}, good ? 'How steady this reading is. ' : 'Why no number is shown. '),
    good
      ? `The same photo was measured ${reading.totalFramings} times at slightly different crops. ${reading.passes} produced a usable pose and they agreed within ${reading.shoulderSpreadDeg.toFixed(1)}°. Anything wider than ${RELIABILITY.maxShoulderSpreadDeg}° is withheld rather than reported.`
      : `Only ${reading.passes} of ${reading.totalFramings} framings produced a usable pose${reading.shoulderSpreadDeg !== undefined ? `, and they disagreed by ${reading.shoulderSpreadDeg.toFixed(1)}°` : ''}. A number from that would be guesswork, so none is shown.`);
}

/* A hand-applied rotation shifts the reading one-for-one, so it is never left
   implicit — the number below was measured on a photo that was turned. */
function rotationNote(rotationDeg) {
  return el('div', { class: 'quality-note' },
    el('b', {}, `This photo was rotated ${rotationDeg.toFixed(1)}° before measuring. `),
    `Shoulder tilt moves with the photo, degree for degree, so this reading is ${Math.abs(rotationDeg).toFixed(1)}° away from what the untouched photo would have given. That is the right thing to do if you were correcting a tilted camera, and the wrong thing if you were levelling your shoulders by eye. It is recorded with the scan so the trend stays comparable.`);
}

function methodPanel() {
  return el('details', { class: 'panel panel--registered', style: 'margin-bottom:var(--space-4)' },
    el('summary', { class: 'label', style: 'cursor:pointer' }, 'How this is measured — and what it cannot measure'),
    el('ul', { class: 'small muted', style: 'margin:var(--space-3) 0 0;padding-left:1.1rem' },
      el('li', {}, 'MediaPipe Pose locates 33 body landmarks. Four of them — both shoulders and both hips — carry the measurement.'),
      el('li', {}, 'Shoulder and hip tilt: the angle between the line joining that pair and horizontal, measured in pixel space so image proportions do not skew it.'),
      el('li', {}, 'Each photo is measured at five framings. The reading is the median, the ± is the spread, and a wide spread means no number is reported.'),
      el('li', {}, el('b', {}, 'Not measured: trunk rotation. '),
        'The rib hump a clinician feels for is a depth difference of a centimetre or two. Testing against clinical photographs showed the depth this model estimates moves further than that when the same photo is simply re-cropped, so SpineCheck does not report a rotation angle. A scoliometer, laid on the back in the forward bend, is what measures that — and 7° on one is the usual referral level.'),
      el('li', {}, 'The bands here are calibrated on a small set of labelled clinical photographs. They are provisional, not clinically validated.')));
}

function qualityNote(warnings) {
  return el('div', { class: 'quality-note' },
    el('b', {}, 'Things that may have affected this reading'),
    el('ul', {}, ...warnings.map((warning) => el('li', {}, warning))));
}

function nextStepsBlock(level) {
  return el('div', {},
    el('div', { class: 'step-label' },
      el('span', { class: 'step-label__num' }, '04'), 'What to do next',
      el('span', { class: 'step-label__rule' })),
    el('ul', { class: 'next-steps' }, ...nextSteps(level).map((step) => el('li', {}, step))));
}

function actions() {
  return el('div', { class: 'stack-sm', style: 'margin-bottom:var(--space-5)' },
    el('button', { class: 'btn btn--block', onClick: () => showScreen('doctors') }, 'Find clinicians near me'),
    el('button', { class: 'btn btn--ghost btn--block', onClick: () => showScreen('capture') }, 'Scan again'),
    el('button', { class: 'btn btn--quiet btn--block', onClick: () => showScreen('history') }, 'View scan log'));
}

function disclaimer() {
  return el('div', { class: 'disclaimer' },
    el('strong', {}, 'This is not a diagnosis. '),
    'SpineCheck measures how level your shoulders and hips look in a photograph. That is one of several signs a clinician checks, and on its own it neither finds nor rules out scoliosis. Scoliosis is diagnosed by a physician from a standing spine X-ray, measured as a Cobb angle. Camera height, posture, and clothing all move these numbers.');
}

/* -------------------------------------------------------------- animation --- */

/* One purposeful animation: the landmarks and measurement lines draw themselves
   onto the photo, so it is obvious the points came from this specific image. */
function animateOverlay(canvas, photo, landmarks, measurements) {
  if (!canvas) return;
  if (prefersReducedMotion()) {
    drawOverlay(canvas, photo, landmarks, measurements, 1);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - start) / REVEAL_MS);
    drawOverlay(canvas, photo, landmarks, measurements, easeOut(progress));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const easeOut = (t) => 1 - Math.pow(1 - t, 2);
