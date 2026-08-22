/* Demo scan, for showing the result screen without a camera or a real photo.
 * Loaded only when the page is opened with ?demo — never part of a normal scan.
 * The landmarks below are hand-written, not detected: this is a UI fixture. */

import { POSE } from '../lib/geometry.js';
import { measureAsymmetry, assessPoseQuality, classifyReading } from '../lib/screening.js';
import { saveScan, makeThumbnail } from '../lib/storage.js';
import { showScreen } from '../router.js';
import { renderResult } from '../screens/result.js';

/* A back with the left shoulder sitting a few degrees high. */
const IMAGE_LANDMARKS = {
  [POSE.NOSE]: { x: 0.50, y: 0.86 },
  [POSE.LEFT_SHOULDER]: { x: 0.36, y: 0.580 },
  [POSE.RIGHT_SHOULDER]: { x: 0.64, y: 0.605 },
  [POSE.LEFT_ELBOW]: { x: 0.30, y: 0.74 },
  [POSE.RIGHT_ELBOW]: { x: 0.70, y: 0.75 },
  [POSE.LEFT_WRIST]: { x: 0.27, y: 0.90 },
  [POSE.RIGHT_WRIST]: { x: 0.73, y: 0.91 },
  [POSE.LEFT_HIP]: { x: 0.41, y: 0.220 },
  [POSE.RIGHT_HIP]: { x: 0.59, y: 0.225 },
  [POSE.LEFT_KNEE]: { x: 0.42, y: 0.04 },
  [POSE.RIGHT_KNEE]: { x: 0.58, y: 0.04 },
};

const fill = (overrides, base) => {
  const points = Array.from({ length: 33 }, () => ({ ...base }));
  for (const [index, value] of Object.entries(overrides)) points[index] = { ...points[index], ...value };
  return points;
};

/** A stand-in photo, so the overlay has a surface to draw on. */
function placeholderPhoto() {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 960;
  const ctx = canvas.getContext('2d');

  const backdrop = ctx.createLinearGradient(0, 0, 0, canvas.height);
  backdrop.addColorStop(0, '#55636b');
  backdrop.addColorStop(1, '#262f36');
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#8d7a6b';
  ctx.beginPath();
  ctx.moveTo(280, 190);
  ctx.quadraticCurveTo(360, 158, 442, 190);
  ctx.lineTo(470, 600);
  ctx.quadraticCurveTo(360, 645, 250, 600);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(360, 760, 70, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = '500 20px "IBM Plex Mono", monospace';
  ctx.fillStyle = 'rgba(237,240,241,0.75)';
  ctx.fillText('DEMO IMAGE — NOT A REAL SCAN', 150, 60);
  return canvas;
}

export function runDemoScan() {
  const photo = placeholderPhoto();
  const frame = { width: photo.width, height: photo.height };
  const landmarks = fill(IMAGE_LANDMARKS, { x: 0.5, y: 0.5, z: 0, visibility: 0.93 });

  const measurements = measureAsymmetry(landmarks, frame);
  const quality = assessPoseQuality(landmarks, frame, measurements);

  /* Shaped like a real consensus reading, with a plausible spread. */
  const reading = {
    usable: true,
    reason: null,
    passes: 5,
    totalFramings: 5,
    shoulderTiltDeg: measurements.shoulders.tiltDeg,
    shoulderSpreadDeg: 0.8,
    hipTiltDeg: measurements.hips.tiltDeg,
    hipSpreadDeg: 0.5,
    higherShoulder: measurements.shoulders.higherSide,
    higherHip: measurements.hips.higherSide,
    sideAgreement: 1,
    warnings: quality.warnings,
    landmarkConfidence: quality.landmarkConfidence,
    primary: { framing: 'as shot', canvas: photo, pose: { landmarks }, measurements, quality },
    photo,
  };

  const verdict = classifyReading(reading);
  const entry = saveScan({ reading, verdict, thumbnail: makeThumbnail(photo) });

  showScreen('result');
  renderResult({ reading, verdict, entry });
}
