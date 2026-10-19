/* The level: how the iOS app shows a reading.
 *
 * Versine measures one thing, how far the line through the shoulders sits off
 * horizontal, and the instrument for that is a spirit level. So a reading is
 * drawn as one: a curved vial with a bubble that rises toward the higher
 * shoulder, seen as in the photograph, from behind, the subject's left on the
 * left. The two graduation lines either side of centre are the app's own
 * level band (2°), so a bubble between them reads as level, as it does on a
 * real vial. Under the vial the scale runs out to 8° each way in the bands'
 * colours, and a faint stretch of the vial behind the bubble is the reading's
 * spread across framings.
 *
 * It replaces no number: the reading is always printed beside it. One motion
 * only, the bubble travelling along the vial to its reading when drawn (on
 * the welcome screen, coming to rest at level), and none under reduced motion. */

import { THRESHOLDS } from '../config.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* Geometry, in the viewBox: a shallow arc, convex upward like a vial. */
const W = 340;
const CX = W / 2;
const R = 520;                 // radius of the vial's centre line
const CY = 38 + R;             // the arc's centre, far below
const SWEEP = 18;              // degrees of arc from centre to either end
const VIAL = 34;               // vial thickness
const SCALE_R = R - VIAL / 2 - 9;
const LABEL_R = SCALE_R - 17;

const MAX = THRESHOLDS.rulerMaxDeg;
const toArc = (deg) => (Math.max(-MAX, Math.min(MAX, deg)) / MAX) * SWEEP;

const point = (arcDeg, radius) => {
  const a = (arcDeg * Math.PI) / 180;
  return [CX + radius * Math.sin(a), CY - radius * Math.cos(a)];
};

const arc = (from, to, radius) => {
  const [x1, y1] = point(from, radius);
  const [x2, y2] = point(to, radius);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${radius} ${radius} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

/**
 * @param {object} [reading]  a saved scan, or nothing for an empty level
 * @param {object} [options]
 * @param {boolean} [options.settle]  animate the bubble to its reading
 * @param {number}  [options.from]    where it settles from, in degrees (centre)
 * @param {boolean} [options.labels]  draw the degree scale and side names
 */
export function levelGauge(reading = null, { settle = true, from = 0, labels = true } = {}) {
  const tilt = reading?.shoulderTiltDeg ?? 0;
  const side = reading?.higherShoulder === 'left' ? -1 : reading?.higherShoulder === 'right' ? 1 : 0;
  const signed = tilt * (side || 0);
  const spread = reading?.shoulderSpreadDeg ?? 0;
  /* A saved scan carries its band; a live reading is banded here, the same way. */
  const band = reading?.level || (tilt >= THRESHOLDS.shoulderReferDeg ? 'refer'
    : tilt >= THRESHOLDS.shoulderMonitorDeg ? 'monitor' : 'clear');
  const moves = settle && (reading || from);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'level');
  svg.setAttribute('viewBox', `0 0 ${W} ${labels ? 138 : 70}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', reading
    ? `Level: ${side ? `${side < 0 ? 'left' : 'right'} shoulder higher by ` : ''}${tilt.toFixed(1)} degrees, plus or minus ${spread.toFixed(1)}`
    : 'Level, with no reading yet');

  const add = (parent, tag, attrs) => {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    parent.append(node);
    return node;
  };

  /* The vial: an outline, then the fluid. */
  add(svg, 'path', { class: 'level__glass', d: arc(-SWEEP, SWEEP, R), 'stroke-width': VIAL + 3 });
  add(svg, 'path', { class: 'level__fluid', d: arc(-SWEEP, SWEEP, R), 'stroke-width': VIAL });

  /* The reading's spread across framings, as a faint stretch of the vial. */
  if (reading && spread > 0) {
    add(svg, 'path', {
      class: 'level__spread',
      d: arc(toArc(signed - spread), toArc(signed + spread), R),
      'stroke-width': VIAL - 10,
    });
  }

  /* Graduation lines at the level band's edges. */
  [-1, 1].forEach((sign) => {
    const at = toArc(sign * THRESHOLDS.shoulderMonitorDeg);
    const [x1, y1] = point(at, R - VIAL / 2 + 3);
    const [x2, y2] = point(at, R + VIAL / 2 - 3);
    add(svg, 'line', { class: 'level__grad', x1, y1, x2, y2 });
  });

  /* The bubble, drawn at centre and turned about the arc's centre to its
     reading, so it travels along the vial rather than across it. */
  const bubble = add(svg, 'g', { class: 'level__bubble', 'data-level': reading ? band : 'none' });
  bubble.style.setProperty('--turn', `${moves ? toArc(from) : toArc(signed)}deg`);
  const [bx, by] = point(0, R);
  add(bubble, 'rect', { class: 'level__bubble-body', x: bx - 25, y: by - 11, width: 50, height: 22, rx: 11 });
  add(bubble, 'rect', { class: 'level__bubble-shine', x: bx - 15, y: by - 7, width: 18, height: 4, rx: 2 });

  if (labels) {
    /* The scale: the three bands, mirrored, in their colours. */
    const edges = [THRESHOLDS.shoulderMonitorDeg, THRESHOLDS.shoulderReferDeg, MAX];
    [-1, 1].forEach((sign) => {
      let from = 0;
      ['clear', 'monitor', 'refer'].forEach((zone, i) => {
        const a = toArc(sign * from);
        const b = toArc(sign * edges[i]);
        add(svg, 'path', {
          class: 'level__zone', 'data-zone': zone,
          d: sign > 0 ? arc(a + 0.25, b - 0.25, SCALE_R) : arc(b + 0.25, a - 0.25, SCALE_R),
        });
        from = edges[i];
      });
    });

    /* No 0° label: the graduation lines already mark the centre, and the
       labels there would crowd. */
    [THRESHOLDS.shoulderMonitorDeg, THRESHOLDS.shoulderReferDeg, MAX].forEach((deg) => {
      [-1, 1].forEach((sign) => {
        const [x, y] = point(toArc(sign * deg), LABEL_R);
        const text = add(svg, 'text', { class: 'level__label', x, y: y + 4, 'text-anchor': 'middle' });
        text.textContent = `${deg}°`;
      });
    });

    const [lx, ly] = point(-SWEEP, LABEL_R - 22);
    const [rx, ry] = point(SWEEP, LABEL_R - 22);
    add(svg, 'text', { class: 'level__side', x: lx - 2, y: ly + 4, 'text-anchor': 'start' }).textContent = 'Left higher';
    add(svg, 'text', { class: 'level__side', x: rx + 2, y: ry + 4, 'text-anchor': 'end' }).textContent = 'Right higher';
  }

  if (moves) {
    const target = `${toArc(signed)}deg`;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      bubble.style.setProperty('--turn', target);
    } else {
      /* Two frames, so the starting position is laid out before it moves. */
      requestAnimationFrame(() => requestAnimationFrame(() => bubble.style.setProperty('--turn', target)));
    }
  }
  return svg;
}

