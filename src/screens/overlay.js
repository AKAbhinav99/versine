/* Draws the measurement overlay onto the user's own photo.
 *
 * This is the transparency layer: the same points the math used, drawn where they
 * were found, plus the two lines whose tilt produced the shoulder and hip numbers
 * and the vertical plumb reference everything is measured against. */

import { POSE, toPixels, midpoint } from '../lib/geometry.js';

const INK = '#0B1622';
const PAPER = '#EDF0F1';
const MEASURE = '#4FB3DA';   // lighter than the UI blue so it survives a dark photo
const MARKER = '#D6402A';
const MAX_EDGE = 1080;

/* Drawn in this order so the reveal animation reads shoulders first, then hips. */
const DOTS = [
  POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER,
  POSE.LEFT_HIP, POSE.RIGHT_HIP,
  POSE.LEFT_ELBOW, POSE.RIGHT_ELBOW,
  POSE.LEFT_WRIST, POSE.RIGHT_WRIST,
  POSE.LEFT_KNEE, POSE.RIGHT_KNEE,
];
const LIMBS = [
  [POSE.LEFT_SHOULDER, POSE.LEFT_ELBOW], [POSE.LEFT_ELBOW, POSE.LEFT_WRIST],
  [POSE.RIGHT_SHOULDER, POSE.RIGHT_ELBOW], [POSE.RIGHT_ELBOW, POSE.RIGHT_WRIST],
  [POSE.LEFT_HIP, POSE.LEFT_KNEE], [POSE.RIGHT_HIP, POSE.RIGHT_KNEE],
];

const clamp01 = (value) => Math.min(1, Math.max(0, value));
/** Progress of one stage within the overall reveal. */
const stage = (progress, from, to) => clamp01((progress - from) / (to - from));

export function prepareCanvas(canvas, photo) {
  const scale = Math.min(1, MAX_EDGE / Math.max(photo.width, photo.height));
  canvas.width = Math.round(photo.width * scale);
  canvas.height = Math.round(photo.height * scale);
  return canvas;
}

export function drawOverlay(canvas, photo, landmarks, measurements, progress = 1) {
  const ctx = canvas.getContext('2d');
  const frame = { width: canvas.width, height: canvas.height };
  const unit = canvas.width / 100;          // one drawing unit = 1% of image width
  const point = (index) => toPixels(landmarks[index], frame);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(photo, 0, 0, canvas.width, canvas.height);

  /* Dim the photo slightly so light-coloured skin and clothing don't wash out
     the drawing on top of it. */
  ctx.fillStyle = 'rgba(11,22,34,0.28)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const shoulderL = point(POSE.LEFT_SHOULDER);
  const shoulderR = point(POSE.RIGHT_SHOULDER);
  const hipL = point(POSE.LEFT_HIP);
  const hipR = point(POSE.RIGHT_HIP);
  const shoulderMid = midpoint(shoulderL, shoulderR);
  const hipMid = midpoint(hipL, hipR);

  drawPlumbLine(ctx, canvas, hipMid, unit, stage(progress, 0, 0.22));
  drawLimbs(ctx, point, unit, stage(progress, 0.2, 0.5));
  drawMeasureLine(ctx, shoulderL, shoulderR, unit, stage(progress, 0.5, 0.72));
  drawMeasureLine(ctx, hipL, hipR, unit, stage(progress, 0.58, 0.8));
  drawTrunkAxis(ctx, shoulderMid, hipMid, unit, stage(progress, 0.62, 0.82));
  drawDots(ctx, point, unit, stage(progress, 0.28, 0.7));
  drawAngleLabels(ctx, canvas, { shoulderL, shoulderR, hipL, hipR }, measurements, unit, stage(progress, 0.8, 1));
}

/* The vertical reference the whole test is against, dropped through the pelvis. */
function drawPlumbLine(ctx, canvas, hipMid, unit, t) {
  if (t <= 0) return;
  ctx.save();
  ctx.strokeStyle = MARKER;
  ctx.lineWidth = Math.max(1, unit * 0.22);
  ctx.setLineDash([unit * 1.6, unit * 1.2]);
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(hipMid.x, 0);
  ctx.lineTo(hipMid.x, canvas.height * t);
  ctx.stroke();
  ctx.restore();
}

function drawLimbs(ctx, point, unit, t) {
  if (t <= 0) return;
  ctx.save();
  ctx.strokeStyle = PAPER;
  ctx.globalAlpha = 0.4 * t;
  ctx.lineWidth = Math.max(1, unit * 0.2);
  ctx.beginPath();
  for (const [a, b] of LIMBS) {
    const from = point(a);
    const to = point(b);
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }
  ctx.stroke();
  ctx.restore();
}

/* Shoulder and hip lines: the actual measured line plus its horizontal reference,
   so the tilt being reported is visible as the gap between the two. */
function drawMeasureLine(ctx, left, right, unit, t) {
  if (t <= 0) return;
  const mid = midpoint(left, right);
  const halfSpan = (Math.abs(right.x - left.x) / 2) * 1.18;

  ctx.save();
  ctx.globalAlpha = t;
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = Math.max(1, unit * 0.16);
  ctx.setLineDash([unit * 0.9, unit * 0.9]);
  ctx.beginPath();
  ctx.moveTo(mid.x - halfSpan, mid.y);
  ctx.lineTo(mid.x + halfSpan, mid.y);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.strokeStyle = MEASURE;
  ctx.lineWidth = Math.max(3, unit * 0.62);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.lineTo(left.x + (right.x - left.x) * t, left.y + (right.y - left.y) * t);
  ctx.stroke();
  ctx.restore();
}

function drawTrunkAxis(ctx, shoulderMid, hipMid, unit, t) {
  if (t <= 0) return;
  ctx.save();
  ctx.globalAlpha = t * 0.85;
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = Math.max(1, unit * 0.24);
  ctx.beginPath();
  ctx.moveTo(hipMid.x, hipMid.y);
  ctx.lineTo(shoulderMid.x, shoulderMid.y);
  ctx.stroke();
  ctx.restore();
}

function drawDots(ctx, point, unit, t) {
  if (t <= 0) return;
  const perDot = 1 / DOTS.length;
  DOTS.forEach((index, i) => {
    const local = clamp01((t - i * perDot) / perDot);
    if (local <= 0) return;
    const { x, y } = point(index);
    const primary = i < 4;
    const radius = unit * (primary ? 1.15 : 0.8) * local;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = primary ? MARKER : PAPER;
    ctx.globalAlpha = primary ? 1 : 0.85;
    ctx.fill();
    ctx.lineWidth = Math.max(1, unit * 0.18);
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.restore();
  });
}

function drawAngleLabels(ctx, canvas, points, measurements, unit, t) {
  if (t <= 0) return;
  const size = Math.max(11, unit * 3);
  ctx.save();
  ctx.globalAlpha = t;
  ctx.font = `500 ${size}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.textBaseline = 'middle';

  label(ctx, canvas, midpoint(points.shoulderL, points.shoulderR),
    `SHOULDERS ${measurements.shoulders.tiltDeg.toFixed(1)}°`, size, unit);
  label(ctx, canvas, midpoint(points.hipL, points.hipR),
    `HIPS ${measurements.hips.tiltDeg.toFixed(1)}°`, size, unit);
  ctx.restore();
}

function label(ctx, canvas, anchor, text, size, unit) {
  const padding = unit * 0.9;
  const width = ctx.measureText(text).width + padding * 2;
  const height = size + padding * 1.4;
  /* Flip the label to the other side if it would run off the image. */
  const preferRight = anchor.x + unit * 2 + width < canvas.width;
  const x = preferRight ? anchor.x + unit * 1.5 : anchor.x - unit * 1.5 - width;
  /* Sit the label above its line so it never covers the landmark dots it describes. */
  const y = Math.min(Math.max(anchor.y - height * 1.5, 0), canvas.height - height);

  ctx.fillStyle = 'rgba(11,22,34,0.86)';
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = MEASURE;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
  /* Leader line down to the measurement it labels. */
  ctx.beginPath();
  ctx.moveTo(preferRight ? x : x + width, y + height);
  ctx.lineTo(anchor.x, anchor.y);
  ctx.stroke();
  ctx.fillStyle = PAPER;
  ctx.fillText(text, x + padding, y + height / 2);
}
