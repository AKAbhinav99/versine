/* The iOS app's home screen: a summary, in the manner of Health's.
 *
 * Nothing here is new information. Each card is a view of something the app
 * already keeps (the scan log, the intake answers) or already says (the rescan
 * advice in each band's next steps), gathered where someone lands when they
 * open the app, with the way into each part of it:
 *
 *   - symptoms the intake flagged, first, for the same reason the result
 *     screen puts them above the verdict;
 *   - when the next scan is due, and the button to take it;
 *   - the latest reading, with its error bar, its band and the recent trend;
 *   - the next steps: the intake, the referral summary, care, background.
 *
 * Drawn fresh on every visit (shell.js), since a scan may have landed since. */

import { $, el, formatDate } from '../lib/dom.js';
import { THRESHOLDS } from '../config.js';
import { showScreen } from '../router.js';
import { listScans } from '../lib/storage.js';
import { highestUrgency } from '../lib/intake.js';
import { intakeState, openIntake } from '../screens/intake.js';
import { openReport } from '../screens/report.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/* How often to rescan, by band, as each band's next steps already advise
   (nextSteps in src/lib/screening.js): monthly once a reading is worth a
   professional look, every two to three months while tracking a mild one,
   every six months during the growth years otherwise. */
const RESCAN = {
  refer: { days: 30, advice: 'Rescan monthly, so a clinician sees a trend rather than one number.' },
  monitor: { days: 60, advice: 'Rescan every 2–3 months, in the same light and from the same height.' },
  clear: { days: 182, advice: 'Rescan every 6 months during the growth years.' },
};

/* The band names the result screen's ruler uses. */
const BAND = { clear: 'Level', monitor: 'Track it', refer: 'Get it looked at' };

export function renderHome() {
  const section = $('#screen-home');
  const body = $('#home-body');
  if (!section || !body) return;

  /* Today's date over the large title, as Health and Fitness head their summaries. */
  let date = section.querySelector('.home__date');
  if (!date) {
    date = el('p', { class: 'home__date', 'aria-hidden': 'true' });
    section.querySelector('.app-title')?.before(date);
  }
  date.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const scans = listScans();
  const latest = scans[0] || null;
  const intake = intakeState();

  body.replaceChildren(...[
    intake.flags.length ? flagsCard(intake.flags) : null,
    scanCard(latest),
    latest ? readingCard(scans) : null,
    el('h3', { class: 'home__section' }, 'Next steps'),
    stepsList(latest, intake),
    el('p', { class: 'home__footnote' },
      'Versine measures how level your shoulders and hips look in a photo. It does not diagnose scoliosis; a physician does, from an X-ray.'),
  ].filter(Boolean));
}

/* ----------------------------------------------------------------- cards --- */

function flagsCard(flags) {
  const urgent = highestUrgency(flags) === 'urgent';
  return el('button', {
    class: 'home-card home-flags', type: 'button', 'data-urgency': urgent ? 'urgent' : 'prompt',
    onClick: () => showScreen('doctors'),
  },
  el('span', { class: 'home-flags__kicker' }, urgent ? 'See a clinician this week' : 'Raise this with a clinician'),
  el('span', { class: 'home-flags__body' },
    `You reported ${flags.map((flag) => flag.label.toLowerCase()).join(', ')}. A photo does not screen for ${flags.length === 1 ? 'that' : 'these'}.`),
  el('span', { class: 'home-flags__action' }, 'Find care nearby'));
}

function scanCard(latest) {
  let kicker = 'Your first scan';
  let headline = 'One forward-bend photo';
  let note = 'Measured five times, with its error bar. The timer means nobody has to hold the phone.';

  if (latest) {
    const cadence = RESCAN[latest.level] || RESCAN.clear;
    const due = latest.timestamp + cadence.days * DAY_MS;
    kicker = `Last scan ${relativeDay(latest.timestamp)}`;
    headline = dueLabel(due);
    note = cadence.advice;
  }

  return el('div', { class: 'home-card home-scan' },
    el('span', { class: 'home-scan__kicker' }, kicker),
    el('span', { class: 'home-scan__headline' }, headline),
    el('span', { class: 'home-scan__note' }, note),
    el('button', { class: 'btn home-scan__start', type: 'button', onClick: () => showScreen('capture') },
      latest ? 'Scan again' : 'Start a scan'));
}

function readingCard(scans) {
  const latest = scans[0];
  const spread = latest.shoulderSpreadDeg ?? 0;
  const recent = scans.slice(0, 8).reverse();

  return el('button', {
    class: 'home-card home-reading', type: 'button', 'data-level': latest.level,
    'aria-label': `Latest shoulder tilt ${latest.shoulderTiltDeg.toFixed(1)} degrees, plus or minus ${spread.toFixed(1)}, ${BAND[latest.level] || ''}. Open the scan log.`,
    onClick: () => showScreen('history'),
  },
  el('span', { class: 'home-reading__head' },
    el('span', { class: 'home-reading__label' }, 'Shoulder tilt'),
    el('span', { class: 'home-reading__date' }, formatDate(latest.timestamp))),
  el('span', { class: 'home-reading__row' },
    el('span', { class: 'home-reading__value' },
      latest.shoulderTiltDeg.toFixed(1), el('span', { class: 'home-reading__unit' }, '°'),
      el('span', { class: 'home-reading__error' }, ` ±${spread.toFixed(1)}°`)),
    el('span', { class: 'home-reading__band' }, BAND[latest.level] || '')),
  recent.length > 1 ? sparkline(recent) : null,
  el('span', { class: 'home-reading__foot' },
    scans.length === 1 ? 'Your first reading. A second one starts the trend.' : `${scans.length} scans since ${formatDate(scans.at(-1).timestamp)}`));
}

/* The last few readings, oldest first, against the two band edges. */
function sparkline(entries) {
  const width = 300;
  const height = 64;
  const pad = 6;
  const top = Math.max(THRESHOLDS.shoulderReferDeg + 1, ...entries.map((entry) => entry.shoulderTiltDeg + 0.5));
  const x = (i) => pad + (i * (width - pad * 2)) / (entries.length - 1);
  const y = (deg) => pad + (height - pad * 2) * (1 - deg / top);

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'home-reading__spark');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const add = (tag, attrs) => {
    const node = document.createElementNS(svgNS, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    svg.append(node);
  };

  [THRESHOLDS.shoulderMonitorDeg, THRESHOLDS.shoulderReferDeg].forEach((deg) => {
    add('line', { class: 'spark-edge', x1: 0, x2: width, y1: y(deg), y2: y(deg) });
  });
  add('polyline', { class: 'spark-line', points: entries.map((entry, i) => `${x(i)},${y(entry.shoulderTiltDeg)}`).join(' ') });
  entries.forEach((entry, i) => {
    const last = i === entries.length - 1;
    add('circle', { class: last ? 'spark-dot' : 'spark-point', cx: x(i), cy: y(entry.shoulderTiltDeg), r: last ? 4.5 : 3 });
  });
  return svg;
}

/* -------------------------------------------------------------- next steps --- */

function stepsList(latest, intake) {
  const rows = [
    row({
      icon: 'person', tint: 'amber',
      title: 'About you',
      detail: intake.flags.length
        ? `${intake.flags.length} symptom${intake.flags.length > 1 ? 's' : ''} flagged`
        : intake.answered ? 'Answered, and printed on every summary' : 'Eight questions a photo cannot answer',
      onClick: () => openIntake('home'),
    }),
    latest ? row({
      icon: 'doc', tint: 'scrub',
      title: 'Referral summary',
      detail: 'One page for a clinician, to print or save',
      onClick: () => openReport(latest, { from: 'home' }),
    }) : null,
    row({
      icon: 'pin', tint: 'marker',
      title: 'Find care nearby',
      detail: 'Orthopedists and physical therapists',
      onClick: () => showScreen('doctors'),
    }),
    row({
      icon: 'book', tint: 'clear',
      title: 'What scoliosis is',
      detail: 'And what a photo cannot show',
      onClick: () => showScreen('resources'),
    }),
  ];
  return el('div', { class: 'home-list' }, ...rows.filter(Boolean));
}

function row({ icon, tint, title, detail, onClick }) {
  return el('button', { class: 'home-row', type: 'button', onClick },
    el('span', { class: 'home-row__icon', 'data-tint': tint, 'aria-hidden': 'true' }, glyph(icon)),
    el('span', { class: 'home-row__text' },
      el('span', { class: 'home-row__title' }, title),
      el('span', { class: 'home-row__detail' }, detail)),
    el('span', { class: 'home-row__chevron', 'aria-hidden': 'true' }));
}

/* Small white glyphs for the row icons, drawn on a 20-unit grid. */
const GLYPHS = {
  person: '<circle cx="10" cy="6.5" r="3.2"/><path d="M3.8 17c.6-3.4 3.1-5.4 6.2-5.4s5.6 2 6.2 5.4"/>',
  doc: '<path d="M5 2.8h6.6L15 6.2v11H5z"/><path d="M11.4 2.8v3.6H15M7.6 10h4.8M7.6 13h4.8"/>',
  pin: '<path d="M10 17.6s5.6-5 5.6-9.4a5.6 5.6 0 1 0-11.2 0c0 4.4 5.6 9.4 5.6 9.4z"/><path d="M10 5.4v5.2M7.4 8h5.2"/>',
  book: '<path d="M2.8 4h5a2.2 2.2 0 0 1 2.2 2.2v10a2 2 0 0 0-2-2H2.8z"/><path d="M17.2 4h-5A2.2 2.2 0 0 0 10 6.2v10a2 2 0 0 1 2-2h5.2z"/>',
};

function glyph(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.innerHTML = GLYPHS[name];
  return svg;
}

/* ------------------------------------------------------------------- time --- */

function relativeDay(timestamp) {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(timestamp)) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return `on ${formatDate(timestamp)}`;
}

function dueLabel(due) {
  const days = Math.round((startOfDay(due) - startOfDay(Date.now())) / DAY_MS);
  if (days <= 0) return 'Your next scan is due';
  if (days === 1) return 'Next scan tomorrow';
  if (days < 21) return `Next scan in ${days} days`;
  if (days < 75) return `Next scan in ${Math.round(days / 7)} weeks`;
  return `Next scan in ${Math.round(days / 30)} months`;
}

const startOfDay = (timestamp) => new Date(timestamp).setHours(0, 0, 0, 0);
