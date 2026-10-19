/* The referral summary: one page to hand a clinician.
 *
 * The honest version of "a report of what is wrong" is not a narrative. This app
 * measures one angle and withholds roughly half its readings; a page that
 * described a condition would be fabricating. What a clinician actually needs
 * from a measurement taken on a phone by a stranger is narrower and duller:
 *
 *   what was measured   one angle, with its error bar
 *   how                 which method, at what framings, on what date
 *   what was not        the list of things a photograph cannot see
 *   what it is worth    the calibration behind the bands, including its size
 *
 * The limitations section is not a disclaimer bolted on the end. It is the part
 * that makes the rest usable, a page claiming less gets read, and a page
 * claiming to have found scoliosis gets dismissed, correctly.
 *
 * There are two of them. The summary of one scan (openReport) is what to take
 * to a first appointment. The scan history (openHistoryReport) is every logged
 * scan on one document, for a clinician who is following a curve over time:
 * the trend, each reading with its error bar, the photographs side by side,
 * and the self-reported history once. Neither adds an interpretation the app
 * does not already make on screen.
 *
 * Printing goes through window.print() and styles/print.css rather than a PDF
 * library: no bundle cost, and "Save as PDF" is already in every print dialog
 * including iOS Safari's. In the iOS app, Share PDF renders the same print
 * layout to a PDF file natively (ios/, WebShell). Nothing is uploaded either way.
 */

import { $, el, append, formatDate } from '../lib/dom.js';
import { THRESHOLDS, RELIABILITY } from '../config.js';
import { showScreen } from '../router.js';
import { listScans } from '../lib/storage.js';
import { loadIntake, redFlagsFrom, riskFactorsFrom, highestUrgency } from '../lib/intake.js';
import { tiltChart } from '../lib/tilt-chart.js';

const TREND_ROWS = 6;
/* The history report shows the most recent photographs, not all sixty. */
const PHOTO_LIMIT = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

/* Bumped when the measurement itself changes, so a printed page can be placed
   against the method that produced it. Not the app version, the method's. */
const METHOD_VERSION = 'shoulder-tilt/consensus-5, calibrated 2026-08';

let returnTo = 'result';

/**
 * @param {object} entry     a saved scan, from storage
 * @param {object} [options]
 * @param {string} [options.image]  data URL of the annotated photo, when one is
 *                                  on screen; falls back to the stored thumbnail
 * @param {string} [options.from]   screen to return to
 */
export function openReport(entry, { image = null, from = 'result' } = {}) {
  returnTo = from;
  showScreen('report');
  render(entry, image);
}

function render(entry, image) {
  const body = $('#report-body');
  body.replaceChildren();

  const { answers } = loadIntake();
  const flags = redFlagsFrom(answers);
  const factors = riskFactorsFrom(answers);
  const history = listScans();

  append(body,
    actions(`Versine screening summary ${isoDate(entry.timestamp)}`),
    header(entry),
    flags.length ? flagsBlock(flags) : null,
    readingBlock(entry),
    image || entry.thumbnail ? photoBlock(entry, image) : null,
    custodyBlock(entry),
    notMeasuredBlock(),
    factors.length ? factorsBlock(factors) : null,
    history.length > 1 ? trendBlock(history, entry) : null,
    clinicianBlock(),
    methodBlock(),
    footer(),
  );
}

/* ---------------------------------------------------------------- controls --- */

/** @param {string} fileName what the PDF is called when the iOS app shares it */
function actions(fileName) {
  const native = window.VersineNative;
  const canShare = Boolean(native?.sharePDF);

  return el('div', { class: 'report__actions no-print' },
    canShare ? el('button', { class: 'btn', onClick: () => native.sharePDF(fileName) }, 'Share PDF') : null,
    el('button', { class: canShare ? 'btn btn--ghost' : 'btn', onClick: () => window.print() },
      canShare ? 'Print' : 'Print or save as PDF'),
    el('button', { class: 'btn btn--ghost report__back', onClick: () => showScreen(returnTo) }, 'Back'),
    el('p', { class: 'small muted', style: 'flex-basis:100%;margin:var(--space-2) 0 0' },
      canShare
        ? 'Everything on this page is generated on your iPhone. Share PDF sends it by Mail or Messages, AirDrops it, or saves it to Files.'
        : 'Everything on this page is generated on your device. Choose "Save as PDF" in the print dialog to keep a copy, or print it and take it with you.'));
}

/* Local date, as 2026-10-19, for file names. */
const isoDate = (timestamp) => {
  const date = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/* ----------------------------------------------------------------- blocks --- */

function header(entry) {
  return el('header', { class: 'report__head' },
    el('div', { class: 'report__title' },
      /* Carries the id the section's aria-labelledby points at, so the screen
         needs no second, hidden heading above this one. */
      el('h1', { id: 'report-title' }, 'Screening summary'),
      el('p', { class: 'report__sub' },
        'Self-administered photographic screening. Not a diagnosis, not a clinical measurement.')),
    el('dl', { class: 'report__meta' },
      metaPair('Scan date', formatDate(entry.timestamp)),
      metaPair('Printed', formatDate(Date.now())),
      metaPair('Tool', 'Versine'),
      metaPair('Method', METHOD_VERSION)));
}

const metaPair = (term, value) => el('div', {},
  el('dt', { class: 'label' }, term),
  el('dd', { class: 'mono' }, value));

function flagsBlock(flags) {
  const urgency = highestUrgency(flags);

  return el('section', { class: 'report__flags', 'data-urgency': urgency },
    el('h2', { class: 'label' }, urgency === 'urgent' ? 'Reported symptoms: urgent' : 'Reported symptoms'),
    el('ul', {}, ...flags.map((flag) => el('li', {}, flag.label))),
    el('p', { class: 'report__flagnote' },
      'Self-reported, not measured. Listed first because a photograph does not screen for any of them.'));
}

function readingBlock(entry) {
  const spread = entry.shoulderSpreadDeg ?? 0;

  return el('section', { class: 'report__section' },
    el('h2', { class: 'label' }, 'Measurement'),
    el('div', { class: 'report__figure' },
      el('div', { class: 'report__number mono' },
        entry.shoulderTiltDeg.toFixed(1), el('span', { class: 'report__unit' }, '°'),
        el('span', { class: 'report__pm' }, ` ± ${spread.toFixed(1)}°`)),
      el('div', { class: 'report__figurelabel' },
        el('b', {}, 'Shoulder tilt from horizontal'),
        el('span', {}, sideText(entry.higherShoulder, 'shoulder')))),

    el('table', { class: 'report__table' },
      el('tbody', {},
        row('Shoulder tilt', `${entry.shoulderTiltDeg.toFixed(1)}° ± ${spread.toFixed(1)}°`, sideText(entry.higherShoulder, 'shoulder')),
        row('Hip tilt', `${entry.hipTiltDeg.toFixed(1)}°`, sideText(entry.higherHip, 'hip')),
        row('Framings in agreement', framingText(entry), `Withheld above ${RELIABILITY.maxShoulderSpreadDeg}° spread`),
        entry.swayDeg === null || entry.swayDeg === undefined
          ? row('Movement between frames', 'Not measured', 'Single frame, uploaded, or only one frame resolved')
          : row('Movement between frames', `${entry.swayDeg.toFixed(1)}°`,
            `Across ${entry.usableFrames || entry.frames} frames about a second apart. Reported, not gated.`),
        row('Landmark confidence', (entry.landmarkConfidence ?? 0).toFixed(2), 'Weakest of the four measured points'),
        row('Band', bandText(entry.level), bandBasis(entry.level)))),

    el('p', { class: 'report__note' },
      `The ± is the actual spread across ${entry.totalFramings ? `${entry.totalFramings} ` : ''}re-croppings of the same photograph, not a rounding or a confidence interval. It is the app's own estimate of how much this number moves when the framing changes. `
      + (entry.swayDeg === null || entry.swayDeg === undefined
        ? 'Movement between frames was not measured for this scan, so the ± is a floor on the true uncertainty rather than the whole of it.'
        : `Movement between frames is listed separately at ${entry.swayDeg.toFixed(1)}°, because it is a different source of uncertainty and the withholding threshold was calibrated only against the framing spread.`)));
}

const row = (label, value, note) => el('tr', {},
  el('th', { scope: 'row' }, label),
  el('td', { class: 'mono' }, value),
  el('td', { class: 'report__rownote' }, note));

const framingText = (entry) =>
  (entry.totalFramings ? `${entry.passes} of ${entry.totalFramings}` : `${entry.passes ?? 'n/a'}`);

const bandText = (level) => ({
  clear: `Under ${THRESHOLDS.shoulderMonitorDeg}°`,
  monitor: `${THRESHOLDS.shoulderMonitorDeg}–${THRESHOLDS.shoulderReferDeg}°`,
  refer: `${THRESHOLDS.shoulderReferDeg}° and above`,
}[level] || 'n/a');

const bandBasis = (level) => ({
  clear: 'App band: no significant asymmetry measured',
  monitor: 'App band: track rather than act',
  refer: 'App band: worth a professional look',
}[level] || '');

function sideText(side, part) {
  if (side === 'left') return `Subject's left ${part} higher`;
  if (side === 'right') return `Subject's right ${part} higher`;
  return 'Level';
}

function photoBlock(entry, image) {
  return el('section', { class: 'report__section report__photo' },
    el('h2', { class: 'label' }, 'Measured photograph'),
    el('img', {
      src: image || entry.thumbnail,
      alt: 'The screening photograph with the measured shoulder and hip lines drawn on it',
    }),
    el('p', { class: 'report__note' },
      image
        ? 'The landmarks and lines shown are the ones the measurement was taken from.'
        : 'Reduced-size copy kept with the scan record. The full-resolution frame was not retained.'));
}

/* A clinician's first question about a measurement taken on a phone is how it was
   taken. Everything that could have moved the number goes here, including the one
   thing the person holding the phone could have done to it. */
function custodyBlock(entry) {
  const rotated = Math.abs(entry.rotationDeg || 0) > 0.05;

  return el('section', { class: 'report__section' },
    el('h2', { class: 'label' }, 'How this was taken'),
    el('table', { class: 'report__table' },
      el('tbody', {},
        row('Date', formatDate(entry.timestamp), 'Recorded on the device at capture'),
        row('Posture', 'Adam\'s forward bend, photographed from behind', 'Self-administered, unsupervised'),
        row('Rotation applied by hand', `${(entry.rotationDeg || 0).toFixed(1)}°`,
          rotated
            ? 'Shoulder tilt moves with the image, degree for degree'
            : 'Image measured as captured'),
        row('Landmark source', 'MediaPipe Pose, on-device', 'No image left the device'))),
    rotated
      ? el('p', { class: 'report__warn' },
        el('b', {}, 'Read the rotation before the angle. '),
        `This photograph was turned ${Math.abs(entry.rotationDeg).toFixed(1)}° before it was measured, which moves the reported tilt by the same amount. It is the correct thing to do when levelling a tilted camera against a door frame or skirting board, and the wrong thing if the shoulders were levelled by eye. The app cannot tell which happened.`)
      : null);
}

function notMeasuredBlock() {
  return el('section', { class: 'report__section report__not' },
    el('h2', { class: 'label' }, 'Not measured'),
    el('ul', {},
      el('li', {}, el('b', {}, 'Angle of trunk rotation. '),
        `No scoliometer equivalent is produced. An earlier version estimated it from the depth this pose model reports per landmark; tested against clinical photographs, those values moved further on a 6% re-crop than the 10–20 mm rib hump they were meant to detect, so the metric was removed rather than caveated. The ${THRESHOLDS.scoliometerReferenceDeg}° referral convention does not apply to anything on this page.`),
      el('li', {}, el('b', {}, 'Cobb angle. '),
        'Requires a standing radiograph. Nothing here estimates one.'),
      el('li', {}, el('b', {}, 'Rib hump, waist crease asymmetry, leg length, skin markings. '),
        'Surface geometry in a single image plane only.'),
      el('li', {}, el('b', {}, 'Anything ruled out. '),
        'A curve can be present with level shoulders. A reading in the lowest band is not a negative screen.')));
}

function factorsBlock(factors) {
  return el('section', { class: 'report__section' },
    el('h2', { class: 'label' }, 'History reported by the subject'),
    el('table', { class: 'report__table' },
      el('tbody', {}, ...factors.map((factor) =>
        row(factor.label, factor.value, factor.note || '')))),
    el('p', { class: 'report__note' }, 'Self-reported and unverified. Not combined with the measurement in any way.'));
}

/* The trend is the part of this that a single clinic visit cannot reproduce,
   nobody else has last quarter's photograph. Rotation is printed beside every row
   because differently-rotated scans are not comparing like with like. */
function trendBlock(history, current) {
  const rows = history.slice(0, TREND_ROWS);
  const mixedRotation = new Set(rows.map((scan) => Math.round(scan.rotationDeg || 0))).size > 1;

  return el('section', { class: 'report__section' },
    el('h2', { class: 'label' }, `Previous readings (${history.length} scan${history.length > 1 ? 's' : ''} logged)`),
    el('table', { class: 'report__table report__table--trend' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Date'),
        el('th', { scope: 'col' }, 'Shoulder tilt'),
        el('th', { scope: 'col' }, 'Framings'),
        el('th', { scope: 'col' }, 'Rotation'))),
      el('tbody', {}, ...rows.map((scan) => el('tr', { 'data-current': scan.id === current.id || null },
        el('td', {}, formatDate(scan.timestamp)),
        el('td', { class: 'mono' }, `${scan.shoulderTiltDeg.toFixed(1)}° ± ${(scan.shoulderSpreadDeg ?? 0).toFixed(1)}°`),
        el('td', { class: 'mono' }, framingText(scan)),
        el('td', { class: 'mono' }, `${(scan.rotationDeg || 0).toFixed(1)}°`))))),
    mixedRotation
      ? el('p', { class: 'report__warn' },
        el('b', {}, 'These rows are not directly comparable. '),
        'They were measured on photographs rotated by different amounts, and rotation shifts the reading one degree for one degree. Compare rows sharing a rotation, or subtract the difference.')
      : el('p', { class: 'report__note' },
        'All rows measured at the same rotation, so the differences between them are differences in the photographs rather than in the handling.'));
}

/* Deliberately blank. The page is more useful as something a clinician writes on
   than as something that only talks at them. */
function clinicianBlock() {
  return el('section', { class: 'report__section report__clinician' },
    el('h2', { class: 'label' }, 'For the examining clinician'),
    el('div', { class: 'report__fields' },
      field('Scoliometer ATR', 'degrees'),
      field('Adam\'s forward bend', 'positive / negative'),
      field('Curve location', ''),
      field('Leg length discrepancy', ''),
      field('Imaging requested', 'yes / no'),
      field('Cobb angle, if imaged', 'degrees'),
      field('Follow-up interval', ''),
      field('Examined by / date', '')));
}

const field = (label, hint) => el('div', { class: 'report__field' },
  el('span', { class: 'label' }, label),
  el('span', { class: 'report__rule' }),
  hint ? el('span', { class: 'report__hint' }, hint) : null);

function methodBlock() {
  return el('section', { class: 'report__section report__method' },
    el('h2', { class: 'label' }, 'Method and how much it is worth'),
    el('p', {},
      'MediaPipe Pose locates body landmarks in a single photograph. Shoulder tilt is the angle between the line joining the two shoulder landmarks and horizontal, computed in pixel space so the image aspect ratio does not skew it. The photograph is measured at five framings; the reported value is the median and the ± is the spread between them. Where that spread exceeds '
      + `${RELIABILITY.maxShoulderSpreadDeg}°, or fewer than ${RELIABILITY.minPasses} framings yield a usable pose, no number is reported at all.`),
    el('p', {},
      `The bands (under ${THRESHOLDS.shoulderMonitorDeg}°, ${THRESHOLDS.shoulderMonitorDeg}–${THRESHOLDS.shoulderReferDeg}°, above ${THRESHOLDS.shoulderReferDeg}°) are calibrated against a set of 17 labelled photographs, of which 9 produced a reportable reading. On that set: sensitivity 0.83, specificity 1.00. `,
      el('b', {}, 'Nine cases is a demonstration, not a validation. '),
      'The confidence interval on that sensitivity spans most of the range. These thresholds are provisional and have not been clinically validated.'),
    el('p', {},
      'Camera height, posture, clothing, and how squarely the subject faced away all move these numbers, and none of them are controlled in a self-administered photograph.'));
}

function footer() {
  return el('footer', { class: 'report__footer' },
    el('p', {},
      el('b', {}, 'This is not a diagnosis. '),
      'It is a geometric measurement from a photograph, taken by the subject without supervision. Scoliosis is diagnosed by a licensed physician from a standing spine radiograph, measured as a Cobb angle. This page is intended to give a clinician a starting point and a record over time, not a finding.'),
    el('p', { class: 'report__footnote mono' },
      `Versine · ${METHOD_VERSION} · generated on-device, nothing uploaded`));
}


/* ======================================================= scan history report === */

/** Every logged scan on one document, for a clinician following a curve over time. */
export function openHistoryReport({ from = 'history' } = {}) {
  returnTo = from;
  showScreen('report');
  renderHistory();
}

function renderHistory() {
  const body = $('#report-body');
  body.replaceChildren();

  const scans = listScans();   // newest first
  if (!scans.length) {
    append(body,
      el('div', { class: 'empty' },
        el('p', {}, 'No scans are logged yet, so there is nothing to report. Readings appear here once a scan gives a number.'),
        el('button', { class: 'btn', onClick: () => showScreen('capture') }, 'Run your first scan')));
    return;
  }

  const { answers } = loadIntake();
  const flags = redFlagsFrom(answers);
  const factors = riskFactorsFrom(answers);

  append(body,
    actions(`Versine scan history ${isoDate(Date.now())}`),
    historyHeader(scans),
    flags.length ? flagsBlock(flags) : null,
    overviewBlock(scans),
    scans.length > 1 ? chartBlock(scans) : null,
    allScansBlock(scans),
    scans.some((scan) => scan.thumbnail) ? photosBlock(scans) : null,
    factors.length ? factorsBlock(factors) : null,
    notMeasuredBlock(),
    clinicianBlock(),
    methodBlock(),
    footer(),
  );
}

function historyHeader(scans) {
  const first = scans.at(-1);
  const latest = scans[0];
  return el('header', { class: 'report__head' },
    el('div', { class: 'report__title' },
      el('h1', { id: 'report-title' }, 'Scan history'),
      el('p', { class: 'report__sub' },
        'Self-administered photographic screening, repeated over time. Not a diagnosis, not a clinical measurement.')),
    el('dl', { class: 'report__meta' },
      metaPair('Scans logged', String(scans.length)),
      metaPair('Period', scans.length > 1 ? `${formatDate(first.timestamp)} – ${formatDate(latest.timestamp)}` : formatDate(latest.timestamp)),
      metaPair('Printed', formatDate(Date.now())),
      metaPair('Method', METHOD_VERSION)));
}

/* The few numbers a clinician reads first. A change is only called a change
   when it is larger than the two readings' own spreads put together; anything
   smaller is what re-framing one photograph already produces. */
function overviewBlock(scans) {
  const latest = scans[0];
  const first = scans.at(-1);
  const highest = scans.reduce((top, scan) => (scan.shoulderTiltDeg > top.shoulderTiltDeg ? scan : top), latest);
  const spread = (scan) => scan.shoulderSpreadDeg ?? 0;
  const counts = { clear: 0, monitor: 0, refer: 0 };
  scans.forEach((scan) => { if (scan.level in counts) counts[scan.level] += 1; });

  const change = latest.shoulderTiltDeg - first.shoulderTiltDeg;
  const sameRotation = Math.round(latest.rotationDeg || 0) === Math.round(first.rotationDeg || 0);
  const beyondSpread = Math.abs(change) > spread(latest) + spread(first);

  return el('section', { class: 'report__section' },
    el('h2', { class: 'label' }, 'At a glance'),
    el('div', { class: 'report__figure' },
      el('div', { class: 'report__number mono' },
        latest.shoulderTiltDeg.toFixed(1), el('span', { class: 'report__unit' }, '°'),
        el('span', { class: 'report__pm' }, ` ± ${spread(latest).toFixed(1)}°`)),
      el('div', { class: 'report__figurelabel' },
        el('b', {}, `Latest shoulder tilt, ${formatDate(latest.timestamp)}`),
        el('span', {}, `${sideText(latest.higherShoulder, 'shoulder')} · ${bandBasis(latest.level)}`))),
    el('table', { class: 'report__table' },
      el('tbody', {},
        scans.length > 1
          ? row('First logged', `${first.shoulderTiltDeg.toFixed(1)}° ± ${spread(first).toFixed(1)}°`, formatDate(first.timestamp))
          : null,
        scans.length > 1
          ? row('Change since first', `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(1)}°`,
            !sameRotation
              ? 'The two photographs were rotated by different amounts, so this is not a like-for-like difference'
              : beyondSpread
                ? 'Larger than the two readings\' spreads combined'
                : 'Within the two readings\' spreads: not a measurable change')
          : null,
        scans.length > 1
          ? row('Highest reading', `${highest.shoulderTiltDeg.toFixed(1)}° ± ${spread(highest).toFixed(1)}°`, formatDate(highest.timestamp))
          : null,
        row('Bands across all scans',
          [counts.clear && `${counts.clear} under ${THRESHOLDS.shoulderMonitorDeg}°`,
            counts.monitor && `${counts.monitor} at ${THRESHOLDS.shoulderMonitorDeg}–${THRESHOLDS.shoulderReferDeg}°`,
            counts.refer && `${counts.refer} at ${THRESHOLDS.shoulderReferDeg}° or more`].filter(Boolean).join(', '),
          'The app\'s own bands, provisional; see Method'),
        scans.length > 2 ? row('Typical interval', intervalText(scans), 'Median time between logged scans') : null)));
}

function intervalText(scans) {
  const gaps = scans.slice(0, -1).map((scan, i) => scan.timestamp - scans[i + 1].timestamp).sort((a, b) => a - b);
  const days = Math.round(gaps[Math.floor(gaps.length / 2)] / DAY_MS);
  if (days < 1) return 'Same day';
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}

function chartBlock(scans) {
  const entries = scans.slice().reverse();
  return el('section', { class: 'report__section' },
    el('h2', { class: 'label' }, 'Shoulder tilt over time'),
    el('div', { class: 'report__chart' }, tiltChart(entries)),
    el('p', { class: 'report__note' },
      `Each point is a scan; the shaded band around the line is that scan's spread across framings. The dashed lines are the app's band edges at ${THRESHOLDS.shoulderMonitorDeg}° and ${THRESHOLDS.shoulderReferDeg}°. Points are evenly spaced, not to a time scale; the dates are in the table below.`));
}

/* Every logged reading, newest first. Rotation is in every row for the same
   reason as on the one-scan summary: it moves the reading degree for degree. */
function allScansBlock(scans) {
  const mixedRotation = new Set(scans.map((scan) => Math.round(scan.rotationDeg || 0))).size > 1;

  return el('section', { class: 'report__section' },
    el('h2', { class: 'label' }, `Every logged scan (${scans.length})`),
    el('div', { class: 'report__scroll' },
      el('table', { class: 'report__table report__table--scans' },
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col' }, 'Date'),
          el('th', { scope: 'col' }, 'Shoulder tilt'),
          el('th', { scope: 'col' }, 'Hip tilt'),
          el('th', { scope: 'col' }, 'Framings'),
          el('th', { scope: 'col' }, 'Movement'),
          el('th', { scope: 'col' }, 'Rotation'))),
        el('tbody', {}, ...scans.map((scan) => el('tr', {},
          el('td', {}, formatDate(scan.timestamp)),
          el('td', { class: 'mono' },
            `${scan.shoulderTiltDeg.toFixed(1)}° ± ${(scan.shoulderSpreadDeg ?? 0).toFixed(1)}°`,
            el('span', { class: 'report__band', 'data-level': scan.level },
              `${bandText(scan.level)}${scan.higherShoulder && scan.higherShoulder !== 'level' ? ` · ${scan.higherShoulder[0].toUpperCase()} higher` : ''}`)),
          el('td', { class: 'mono' }, `${scan.hipTiltDeg.toFixed(1)}°`),
          el('td', { class: 'mono' }, framingText(scan)),
          el('td', { class: 'mono' }, scan.swayDeg === null || scan.swayDeg === undefined ? '–' : `${scan.swayDeg.toFixed(1)}°`),
          el('td', { class: 'mono' }, `${(scan.rotationDeg || 0).toFixed(1)}°`)))))),
    mixedRotation
      ? el('p', { class: 'report__warn' },
        el('b', {}, 'Not every row is directly comparable. '),
        'Some photographs were rotated by hand before measuring, by different amounts, and rotation shifts the reading one degree for one degree. Compare rows that share a rotation, or subtract the difference.')
      : null,
    el('p', { class: 'report__note' },
      `Only readings the app reported are logged. A scan whose framings disagreed by more than ${RELIABILITY.maxShoulderSpreadDeg}°, or that found no usable pose, gave no number and is not listed. "Movement" is how much the reading changed between frames a second apart; a dash means it was not measured (one frame, or an uploaded photo). L and R are the subject's left and right.`));
}

/* The photographs side by side: the quickest way to see whether stance, distance
   and camera height were the same from scan to scan. */
function photosBlock(scans) {
  const shown = scans.filter((scan) => scan.thumbnail).slice(0, PHOTO_LIMIT);
  return el('section', { class: 'report__section' },
    el('h2', { class: 'label' }, scans.length > shown.length ? `Photographs (latest ${shown.length})` : 'Photographs'),
    el('div', { class: 'report__photos' }, ...shown.map((scan) => el('figure', {},
      el('img', { src: scan.thumbnail, alt: `Screening photograph from ${formatDate(scan.timestamp)}` }),
      el('figcaption', {},
        el('span', {}, formatDate(scan.timestamp)),
        el('span', { class: 'mono' }, `${scan.shoulderTiltDeg.toFixed(1)}°`))))),
    el('p', { class: 'report__note' },
      'Reduced-size copies kept with each scan record. Differences in stance, distance or camera height between them are the largest source of difference between readings.'));
}
