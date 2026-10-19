/* The shoulder-tilt chart: on the iOS app's Home and Log, and in the scan
 * history report on both the app and the website.
 *
 * One chart in every place, in the manner of Health's: the line through the
 * readings, the area under it filled faintly, and around the line a band as
 * wide as each reading's error bar, so the uncertainty reads as part of the
 * trend rather than as tick marks beside it. The band edges (2° and 3.5°) are
 * dashed lines in their bands' colours, labelled on the right. Error bars are
 * drawn as the scan log draws them: half the spread across framings each side.
 *
 * Flat fills, no gradients: the chart appears on two screens at once, and a
 * gradient is found by id, so the hidden screen's copy would be the one used. */

import { THRESHOLDS } from '../config.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** @param {object[]} entries scans, oldest first, at least two */
export function tiltChart(entries) {
  const width = 320;
  const height = 150;
  const right = 30;
  const bottom = 20;
  const half = (entry) => (entry.shoulderSpreadDeg ?? 0) / 2;
  const top = Math.max(THRESHOLDS.shoulderReferDeg + 1.5, ...entries.map((entry) => entry.shoulderTiltDeg + half(entry) + 0.5));
  const plotWidth = width - right;
  const x = (i) => 8 + (i * (plotWidth - 16)) / Math.max(1, entries.length - 1);
  const y = (deg) => 6 + (height - bottom - 6) * (1 - Math.max(0, deg) / top);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'tilt-chart');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label',
    `Shoulder tilt across ${entries.length} scans, from ${entries[0].shoulderTiltDeg.toFixed(1)} to ${entries.at(-1).shoulderTiltDeg.toFixed(1)} degrees`);
  const add = (tag, attrs, text) => {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => { if (value !== null) node.setAttribute(key, value); });
    if (text !== undefined) node.textContent = text;
    svg.append(node);
    return node;
  };
  const path = (points) => points.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join(' ');

  [[0, null], [THRESHOLDS.shoulderMonitorDeg, 'monitor'], [THRESHOLDS.shoulderReferDeg, 'refer']].forEach(([deg, zone]) => {
    add('line', { class: zone ? 'chart-edge' : 'chart-axis', 'data-zone': zone, x1: 0, x2: plotWidth, y1: y(deg), y2: y(deg) });
    add('text', { class: 'chart-label', 'data-zone': zone, x: width, y: y(deg) + 4, 'text-anchor': 'end' }, `${deg}°`);
  });

  const line = entries.map((entry, i) => [x(i), y(entry.shoulderTiltDeg)]);
  const upper = entries.map((entry, i) => [x(i), y(entry.shoulderTiltDeg + half(entry))]);
  const lower = entries.map((entry, i) => [x(i), y(entry.shoulderTiltDeg - half(entry))]).reverse();

  add('path', { class: 'chart-area', d: `${path([[x(0), y(0)], ...line, [x(entries.length - 1), y(0)]])} Z` });
  add('path', { class: 'chart-band', d: `${path([...upper, ...lower])} Z` });
  add('path', { class: 'chart-line', d: path(line), pathLength: 1 });
  entries.forEach((entry, i) => {
    const last = i === entries.length - 1;
    add('circle', { class: last ? 'chart-point chart-point--last' : 'chart-point', 'data-level': entry.level, cx: x(i), cy: y(entry.shoulderTiltDeg), r: last ? 5 : 3.5 });
  });

  add('text', { class: 'chart-label', x: x(0), y: height - 3, 'text-anchor': 'start' }, shortDate(entries[0].timestamp));
  add('text', { class: 'chart-label', x: x(entries.length - 1), y: height - 3, 'text-anchor': 'end' }, shortDate(entries.at(-1).timestamp));
  return svg;
}

const shortDate = (timestamp) => new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
