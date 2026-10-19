/* The iOS app's home screen, a summary in the manner of Health's.
 *
 * Nothing here is new information. Each card is a view of something the app
 * already keeps (the scan log, the intake answers) or already says (the band
 * edges, the rescan advice in each band's next steps), gathered where someone
 * lands when they open the app, with the way into each part of it:
 *
 *   - symptoms the intake flagged, first, for the same reason the result
 *     screen puts them above the verdict;
 *   - the latest reading, with its photo, its error bar, and where it sits
 *     against the bands;
 *   - the trend across recent scans, with each reading's error bar as a band
 *     around the line (src/lib/tilt-chart.js, which the Log draws too);
 *   - how far along the wait for the next scan is, and the button to take it;
 *   - the next steps: the intake, the report for a doctor, care, background.
 *
 * The look is data, not decoration: the photo, a band bar like Weather's UV
 * index, a chart like Health's. Drawn fresh on every visit (shell.js), since a
 * scan may have landed since. */

import { $, el, formatDate } from '../lib/dom.js';
import { THRESHOLDS } from '../config.js';
import { showScreen } from '../router.js';
import { listScans } from '../lib/storage.js';
import { highestUrgency } from '../lib/intake.js';
import { intakeState, openIntake } from '../screens/intake.js';
import { openHistoryReport } from '../screens/report.js';
import { tiltChart } from '../lib/tilt-chart.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TREND_POINTS = 12;

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

  /* Today's date over the large title, as Health heads its summary. */
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
    intake.flags.length ? flagsSection(intake.flags) : null,
    ...(latest
      ? [readingCard(latest), scans.length > 1 ? trendCard(scans) : null, nextScanCard(latest)]
      : [firstScanCard()]),
    stepsSection(latest, intake),
  ].filter(Boolean));
}

/* ------------------------------------------------------------------ cards --- */

/** A Health-style card: a title in the card's own colour (`tone`), something
    on the right, a chevron when it goes somewhere. A `solid` card is filled
    with its colour instead, as a widget is: the one that asks for a scan. */
function card({ title, tone = 'scrub', solid = false, meta = null, onClick = null, label = null }, ...content) {
  const head = el('span', { class: 'home-card__head' },
    el('span', { class: 'home-card__title' }, title),
    meta ? el('span', { class: 'home-card__meta' }, meta) : null,
    onClick ? el('span', { class: 'ios-row__chevron', 'aria-hidden': 'true' }) : null);
  return onClick
    ? el('button', { class: 'home-card', 'data-tone': tone, 'data-solid': solid, type: 'button', onClick, 'aria-label': label }, head, ...content)
    : el('div', { class: 'home-card', 'data-tone': tone, 'data-solid': solid }, head, ...content);
}

function readingCard(latest) {
  const spread = latest.shoulderSpreadDeg ?? 0;
  return card({
    title: 'Shoulder tilt',
    tone: latest.level,
    meta: formatDate(latest.timestamp),
    onClick: () => showScreen('history'),
    label: `Shoulder tilt ${latest.shoulderTiltDeg.toFixed(1)} degrees, plus or minus ${spread.toFixed(1)}, ${BAND[latest.level] || ''}, ${formatDate(latest.timestamp)}. Open the scan log.`,
  },
  el('span', { class: 'home-reading', 'data-level': latest.level },
    el('span', { class: 'home-reading__numbers' },
      el('span', { class: 'home-reading__value' },
        latest.shoulderTiltDeg.toFixed(1), el('span', { class: 'home-reading__unit' }, '°')),
      el('span', { class: 'home-reading__error' }, `±${spread.toFixed(1)}° across ${latest.passes ?? 5} framings`),
      el('span', { class: 'home-reading__band' }, BAND[latest.level] || '')),
    latest.thumbnail
      ? el('img', { class: 'home-reading__photo', src: latest.thumbnail, alt: '' })
      : null),
  bandBar(latest.shoulderTiltDeg, latest.level));
}

function trendCard(scans) {
  const entries = scans.slice(0, TREND_POINTS).reverse();
  return card({
    title: 'Trend',
    meta: `${scans.length} scans`,
    onClick: () => showScreen('history'),
    label: `Trend of shoulder tilt across ${entries.length} scans. Open the scan log.`,
  }, tiltChart(entries));
}

function nextScanCard(latest) {
  const cadence = RESCAN[latest.level] || RESCAN.clear;
  const due = latest.timestamp + cadence.days * DAY_MS;
  const progress = Math.min(1, Math.max(0, (Date.now() - latest.timestamp) / (due - latest.timestamp)));
  const isDue = progress >= 1;

  return card({ title: 'Next scan', solid: true },
    el('span', { class: 'home-next__when' }, dueLabel(due)),
    el('span', { class: `home-next__bar${isDue ? ' is-due' : ''}`, role: 'img',
      'aria-label': `${Math.round(progress * 100)} percent of the way to the next scan` },
    el('span', { class: 'home-next__fill', style: `--progress:${progress}` })),
    el('span', { class: 'home-next__dates' },
      el('span', {}, formatDate(latest.timestamp)),
      el('span', {}, formatDate(due))),
    el('span', { class: 'home-next__advice' }, cadence.advice),
    el('button', { class: 'btn btn--block home-next__scan', type: 'button', onClick: () => showScreen('capture') },
      isDue ? 'Scan Now' : 'Scan Again'));
}

function firstScanCard() {
  return card({ title: 'Your first scan', solid: true },
    el('span', { class: 'home-next__when' }, 'One forward-bend photo'),
    el('span', { class: 'home-next__advice' },
      'Shoulder tilt is measured at five framings of the photo, and the reading lands in one of three bands.'),
    bandBar(null),
    el('button', { class: 'btn btn--block home-next__scan', type: 'button', onClick: () => showScreen('capture') },
      'Start a Scan'));
}

function flagsSection(flags) {
  const urgent = highestUrgency(flags) === 'urgent';
  return group('Symptoms you reported', [
    el('div', { class: 'ios-row ios-row--text', 'data-urgency': urgent ? 'urgent' : 'prompt' },
      el('span', { class: 'home__flag-title' }, urgent ? 'See a clinician this week' : 'Raise this with a clinician'),
      el('span', { class: 'home__flag-list' }, flags.map((flag) => flag.label).join(' · '))),
    link('Find care nearby', null, () => showScreen('doctors'), true),
  ], `A photo does not screen for ${flags.length === 1 ? 'this' : 'these'}. Whatever a reading says, ${flags.length === 1 ? 'it is' : 'they are'} worth asking a clinician about.`);
}

function stepsSection(latest, intake) {
  return group('Next steps', [
    link('About you',
      intake.flags.length
        ? `${intake.flags.length} symptom${intake.flags.length > 1 ? 's' : ''} flagged`
        : intake.answered ? 'Answered' : 'Eight questions a photo cannot answer',
      () => openIntake('home')),
    latest ? link('Report for your doctor', 'Every scan, the trend and your answers, as a PDF', () => openHistoryReport({ from: 'home' })) : null,
    link('Find care nearby', 'Orthopedists and physical therapists', () => showScreen('doctors')),
    link('About scoliosis', 'What it is, and what a photo cannot show', () => showScreen('resources')),
  ], 'Versine measures how level your shoulders and hips look in a photo. It does not diagnose scoliosis; a physician does, from an X-ray.');
}

/* -------------------------------------------------------------- band bar --- */

/* The three bands as one bar, as Weather draws the UV index: level to 2°,
   track it to 3.5°, get it looked at beyond, on the result ruler's 0–8° scale.
   The reading is a dot on it; with no reading the bar explains the bands. */
function bandBar(deg, level = null) {
  const max = THRESHOLDS.rulerMaxDeg;
  const pct = (value) => `${(Math.min(value, max) / max) * 100}%`;
  const edges = [0, THRESHOLDS.shoulderMonitorDeg, THRESHOLDS.shoulderReferDeg, max];

  return el('span', { class: 'band-bar', 'aria-hidden': 'true' },
    el('span', { class: 'band-bar__track' },
      el('span', { class: 'band-bar__zone', 'data-zone': 'clear', style: `flex:${edges[1] - edges[0]}` }),
      el('span', { class: 'band-bar__zone', 'data-zone': 'monitor', style: `flex:${edges[2] - edges[1]}` }),
      el('span', { class: 'band-bar__zone', 'data-zone': 'refer', style: `flex:${edges[3] - edges[2]}` }),
      deg === null ? null : el('span', { class: 'band-bar__dot', 'data-level': level, style: `--at:${pct(deg)}` })),
    el('span', { class: 'band-bar__labels' },
      ...edges.map((edge, i) => el('span', { class: 'band-bar__tick', style: `--at:${pct(edge)}` },
        i === edges.length - 1 ? `${edge}°+` : `${edge}°`))),
    deg === null
      ? el('span', { class: 'band-bar__legend' },
        el('span', { 'data-zone': 'clear' }, BAND.clear),
        el('span', { 'data-zone': 'monitor' }, BAND.monitor),
        el('span', { 'data-zone': 'refer' }, BAND.refer))
      : null);
}

/* ------------------------------------------------------------- grouped list --- */

/* A titled group of rows with an optional footer, UITableView's inset grouped style. */
function group(title, rows, footer = null) {
  return el('section', { class: 'ios-group' },
    title ? el('h3', { class: 'ios-group__header' }, title) : null,
    el('div', { class: 'ios-group__rows' }, ...rows.filter(Boolean)),
    footer ? el('p', { class: 'ios-group__footer' }, footer) : null);
}

/** A row that goes somewhere: title, optional subtitle, chevron. */
function link(title, detail, onClick, tinted = false) {
  return el('button', { class: `ios-row${tinted ? ' ios-row--tinted' : ''}`, type: 'button', onClick },
    el('span', { class: 'ios-row__text' },
      el('span', { class: 'ios-row__title' }, title),
      detail ? el('span', { class: 'ios-row__detail' }, detail) : null),
    el('span', { class: 'ios-row__chevron', 'aria-hidden': 'true' }));
}

/* ------------------------------------------------------------------- time --- */

function dueLabel(due) {
  const days = Math.round((startOfDay(due) - startOfDay(Date.now())) / DAY_MS);
  if (days <= 0) return 'Due now';
  if (days === 1) return 'Tomorrow';
  if (days < 21) return `In ${days} days`;
  if (days < 75) return `In ${Math.round(days / 7)} weeks`;
  return `In ${Math.round(days / 30)} months`;
}

const startOfDay = (timestamp) => new Date(timestamp).setHours(0, 0, 0, 0);
