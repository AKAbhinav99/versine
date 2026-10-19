/* The iOS app's home screen.
 *
 * Nothing here is new information. Each part is a view of something the app
 * already keeps (the scan log, the intake answers) or already says (the band
 * edges, the rescan advice in each band's next steps), gathered where someone
 * lands when they open the app, with the way into each part of it:
 *
 *   - symptoms the intake flagged, first, for the same reason the result
 *     screen puts them above the verdict;
 *   - the latest reading, on the level (level.js), beside its photo, with its
 *     spread, which shoulder is higher, and its band, then the button to scan;
 *   - the trend across recent scans (src/lib/tilt-chart.js, as the Log draws);
 *   - how far along the wait for the next scan is;
 *   - the next steps: the intake, the report for a doctor, care, background.
 *
 * The reading is the one thing drawn large, straight on the page; everything
 * after it is a plain grouped list. Drawn fresh on every visit (shell.js),
 * since a scan may have landed since. */

import { $, el, formatDate } from '../lib/dom.js';
import { showScreen } from '../router.js';
import { listScans } from '../lib/storage.js';
import { highestUrgency } from '../lib/intake.js';
import { intakeState, openIntake } from '../screens/intake.js';
import { openHistoryReport } from '../screens/report.js';
import { tiltChart } from '../lib/tilt-chart.js';
import { levelGauge } from './level.js';

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
    latest ? readingHero(latest) : emptyHero(),
    latest && scans.length > 1 ? trendSection(scans) : null,
    latest ? nextScanSection(latest) : null,
    stepsSection(latest, intake),
  ].filter(Boolean));
}

/* ------------------------------------------------------------- the reading --- */

function readingHero(latest) {
  const spread = latest.shoulderSpreadDeg ?? 0;
  const side = latest.higherShoulder === 'left' ? 'Left shoulder higher'
    : latest.higherShoulder === 'right' ? 'Right shoulder higher' : 'Shoulders level';

  return el('section', { class: 'home-hero', 'data-level': latest.level, 'aria-label': 'Latest reading' },
    levelGauge(latest),
    el('div', { class: 'home-hero__reading' },
      el('div', { class: 'home-hero__figures' },
        el('p', { class: 'home-hero__value' },
          latest.shoulderTiltDeg.toFixed(1), el('span', { class: 'home-hero__deg' }, '°'),
          el('span', { class: 'home-hero__spread' }, `±${spread.toFixed(1)}°`)),
        el('p', { class: 'home-hero__side' }, side),
        el('p', { class: 'home-hero__band' }, BAND[latest.level] || '')),
      latest.thumbnail
        ? el('button', { class: 'home-hero__photo', type: 'button', 'aria-label': 'Open the scan log', onClick: () => showScreen('history') },
          el('img', { src: latest.thumbnail, alt: '' }))
        : null),
    el('p', { class: 'home-hero__meta' },
      `Measured ${formatDate(latest.timestamp)}, at ${latest.passes ?? 5} framings of one photo.`),
    el('button', { class: 'btn btn--block', type: 'button', onClick: () => showScreen('capture') }, 'Scan again'));
}

function emptyHero() {
  return el('section', { class: 'home-hero home-hero--empty', 'aria-label': 'No reading yet' },
    levelGauge(null, { settle: false }),
    el('h2', { class: 'home-hero__title' }, 'No reading yet'),
    el('p', { class: 'home-hero__lede' },
      'Take one forward-bend photo. Versine measures how far your shoulders sit off level, five times over, and the bubble moves to the higher side.'),
    el('button', { class: 'btn btn--block', type: 'button', onClick: () => showScreen('capture') }, 'Start a scan'));
}

/* ---------------------------------------------------------------- sections --- */

function trendSection(scans) {
  const entries = scans.slice(0, TREND_POINTS).reverse();
  return el('section', { class: 'home-section' },
    sectionHead('Trend', `${scans.length} scans`, () => showScreen('history')),
    el('button', {
      class: 'home-panel', type: 'button', onClick: () => showScreen('history'),
      'aria-label': `Trend of shoulder tilt across ${entries.length} scans. Open the scan log.`,
    }, tiltChart(entries)));
}

function nextScanSection(latest) {
  const cadence = RESCAN[latest.level] || RESCAN.clear;
  const due = latest.timestamp + cadence.days * DAY_MS;
  const progress = Math.min(1, Math.max(0, (Date.now() - latest.timestamp) / (due - latest.timestamp)));
  const isDue = progress >= 1;

  return el('section', { class: 'home-section' },
    sectionHead('Next scan'),
    el('div', { class: 'home-panel home-next' },
      el('p', { class: `home-next__when${isDue ? ' is-due' : ''}` }, dueLabel(due)),
      el('span', { class: `home-next__bar${isDue ? ' is-due' : ''}`, role: 'img',
        'aria-label': `${Math.round(progress * 100)} percent of the way to the next scan` },
      el('span', { class: 'home-next__fill', style: `--progress:${progress}` })),
      el('span', { class: 'home-next__dates' },
        el('span', {}, formatDate(latest.timestamp)),
        el('span', {}, formatDate(due)))),
    el('p', { class: 'ios-group__footer' }, cadence.advice));
}

/** A section's heading, with an optional link on the right, as Health heads its lists. */
function sectionHead(title, linkText = null, onClick = null) {
  return el('div', { class: 'home-section__head' },
    el('h3', { class: 'home-section__title' }, title),
    linkText ? el('button', { class: 'home-section__link', type: 'button', onClick }, linkText) : null);
}

function flagsSection(flags) {
  const urgent = highestUrgency(flags) === 'urgent';
  return group('Symptoms you reported', [
    el('div', { class: 'ios-row ios-row--text', 'data-urgency': urgent ? 'urgent' : 'prompt' },
      el('span', { class: 'home__flag-title' }, urgent ? 'See a clinician this week' : 'Raise this with a clinician'),
      el('ul', { class: 'home__flag-list' }, ...flags.map((flag) => el('li', {}, flag.label)))),
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

/* ------------------------------------------------------------- grouped list --- */

/* A titled group of rows with an optional footer, UITableView's inset grouped style. */
function group(title, rows, footer = null) {
  return el('section', { class: 'ios-group home-section' },
    title ? sectionHead(title) : null,
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
