/* Scan log: a trend line of estimated trunk rotation over time, then the entries.
 * The trend is the point — one reading is noise, a direction is information. */

import { el, $, append, formatDate } from '../lib/dom.js';
import { THRESHOLDS } from '../config.js';
import { listScans, clearScans, deleteScan } from '../lib/storage.js';
import { intakeState, openIntake } from './intake.js';
import { showScreen } from '../router.js';

const TREND_POINTS = 12;

export function renderHistory() {
  const body = $('#history-body');
  const scans = listScans();
  body.replaceChildren();

  if (!scans.length) {
    append(body,
      el('div', { class: 'empty' },
        el('p', {}, 'No scans logged yet.'),
        el('button', { class: 'btn', onClick: () => showScreen('capture') }, 'Run your first scan')),
      intakeRow());
    return;
  }

  const chronological = [...scans].reverse().slice(-TREND_POINTS);
  append(body,
    trendChart(chronological),
    intakeRow(),
    ...scans.map(entryRow),
    el('div', { style: 'margin-top:var(--space-5)' },
      el('button', {
        class: 'btn btn--ghost btn--block',
        onClick: () => {
          if (confirm('Delete every logged scan from this device? This cannot be undone.')) {
            clearScans();
            renderHistory();
          }
        },
      }, 'Clear all scans')),
  );
}

/* The intake belongs on the log rather than only in the scan flow: it is
   answered once and then mostly re-read, and it changes far less often than the
   thing it sits beside. */
function intakeRow() {
  const { answered, flags } = intakeState();

  return el('div', { class: 'intake-prompt', style: 'margin-top:var(--space-4)' },
    el('div', { class: 'intake-prompt__text' },
      el('b', {}, 'Growth, family history, and symptoms'),
      el('span', {}, answered
        ? `Answered${flags.length ? ` · ${flags.length} symptom${flags.length > 1 ? 's' : ''} flagged` : ''}. Carried onto every referral summary you print.`
        : 'Eight questions a clinician will ask that a photograph cannot answer.')),
    el('button', {
      class: answered ? 'btn btn--ghost' : 'btn',
      onClick: () => openIntake('history'),
    }, answered ? 'Review' : 'Answer'));
}

function trendChart(entries) {
  const width = 320;
  const height = 130;
  const padLeft = 28;
  const padBottom = 20;
  const maxDeg = Math.max(THRESHOLDS.rulerMaxDeg * 0.7, ...entries.map((e) => e.shoulderTiltDeg + 1));

  const x = (i) => padLeft + (entries.length === 1 ? (width - padLeft) / 2
    : (i * (width - padLeft - 6)) / (entries.length - 1));
  const y = (deg) => (height - padBottom) * (1 - deg / maxDeg);

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label',
    `Trend of shoulder tilt across ${entries.length} scans, most recent ${entries.at(-1).shoulderTiltDeg} degrees`);

  const add = (tag, attrs, text) => {
    const node = document.createElementNS(svgNS, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    if (text !== undefined) node.textContent = text;
    svg.append(node);
    return node;
  };

  /* Threshold bands, so a rising line is read against the cutoffs, not in a vacuum */
  add('rect', { class: 'trend-band-refer', x: padLeft, y: y(maxDeg), width: width - padLeft, height: Math.max(0, y(THRESHOLDS.shoulderReferDeg) - y(maxDeg)) });
  add('rect', { class: 'trend-band-monitor', x: padLeft, y: y(THRESHOLDS.shoulderReferDeg), width: width - padLeft, height: Math.max(0, y(THRESHOLDS.shoulderMonitorDeg) - y(THRESHOLDS.shoulderReferDeg)) });
  add('line', { class: 'trend-axis', x1: padLeft, y1: y(0), x2: width, y2: y(0) });
  add('line', { class: 'trend-axis', x1: padLeft, y1: 0, x2: padLeft, y2: y(0) });

  [0, THRESHOLDS.shoulderMonitorDeg, THRESHOLDS.shoulderReferDeg].forEach((deg) => {
    add('text', { class: 'trend-text', x: 0, y: y(deg) + 3 }, `${deg}°`);
  });

  const path = entries.map((entry, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(entry.shoulderTiltDeg)}`).join(' ');
  add('path', { class: 'trend-line', d: path });
  /* Error bars: the spread across framings for that scan, drawn to scale. */
  entries.forEach((entry, i) => {
    const spread = entry.shoulderSpreadDeg ?? 0;
    if (spread > 0) {
      add('line', { class: 'trend-error', x1: x(i), x2: x(i),
        y1: y(Math.max(0, entry.shoulderTiltDeg - spread / 2)), y2: y(entry.shoulderTiltDeg + spread / 2) });
    }
    add('circle', { class: 'trend-dot', cx: x(i), cy: y(entry.shoulderTiltDeg), r: 4 });
  });

  add('text', { class: 'trend-text', x: padLeft, y: height - 4 }, formatDate(entries[0].timestamp));
  if (entries.length > 1) {
    add('text', { class: 'trend-text', x: width, y: height - 4, 'text-anchor': 'end' },
      formatDate(entries.at(-1).timestamp));
  }

  return el('div', { class: 'trend' },
    el('div', { class: 'label', style: 'margin-bottom:var(--space-3)' }, 'Shoulder tilt over time'),
    svg);
}

function entryRow(entry) {
  return el('div', { class: 'log-entry' },
    entry.thumbnail
      ? el('img', { class: 'log-entry__thumb', src: entry.thumbnail, alt: '' })
      : el('div', { class: 'log-entry__thumb' }),
    el('div', {},
      el('div', { class: 'log-entry__date' }, formatDate(entry.timestamp)),
      el('div', { class: 'log-entry__value' },
        `${entry.shoulderTiltDeg.toFixed(1)}°`,
        el('span', { class: 'log-entry__error' }, ` ±${(entry.shoulderSpreadDeg ?? 0).toFixed(1)}`)),
      el('div', { class: 'small muted' },
        `Hips ${entry.hipTiltDeg.toFixed(1)}° · ${entry.passes ?? '—'} framings agreed`),
      el('button', {
        class: 'log-entry__remove',
        onClick: () => { deleteScan(entry.id); renderHistory(); },
      }, 'Remove')),
    el('div', { class: 'log-entry__flag', 'data-level': entry.level, title: entry.level }));
}
