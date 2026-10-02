/* Demo scan, for showing the result screen without a camera or a real photo.
 * Loaded only when the page is opened with ?demo, never part of a normal scan.
 * The landmarks below are hand-written, not detected: this is a UI fixture. */

import { POSE } from '../lib/geometry.js';
import { measureAsymmetry, assessPoseQuality, classifyReading } from '../lib/screening.js';
import { saveScan, makeThumbnail } from '../lib/storage.js';
import { showScreen } from '../router.js';
import { renderResult } from '../screens/result.js';

/* A back seen from behind and above, bent forward: head at the top, shoulders
   below it, hips nearest the camera at the bottom. The left shoulder sits a few
   degrees high. */
const IMAGE_LANDMARKS = {
  [POSE.NOSE]: { x: 0.50, y: 0.19 },
  [POSE.LEFT_SHOULDER]: { x: 0.36, y: 0.360 },
  [POSE.RIGHT_SHOULDER]: { x: 0.64, y: 0.385 },
  [POSE.LEFT_ELBOW]: { x: 0.30, y: 0.50 },
  [POSE.RIGHT_ELBOW]: { x: 0.70, y: 0.51 },
  [POSE.LEFT_WRIST]: { x: 0.27, y: 0.63 },
  [POSE.RIGHT_WRIST]: { x: 0.73, y: 0.64 },
  [POSE.LEFT_HIP]: { x: 0.41, y: 0.520 },
  [POSE.RIGHT_HIP]: { x: 0.59, y: 0.525 },
  [POSE.LEFT_KNEE]: { x: 0.44, y: 0.78 },
  [POSE.RIGHT_KNEE]: { x: 0.56, y: 0.78 },
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

  /* Head at the top, back widening down toward the hips at the bottom. */
  ctx.fillStyle = '#8d7a6b';
  ctx.beginPath();
  ctx.arc(360, 182, 56, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(288, 330);
  ctx.quadraticCurveTo(360, 306, 432, 330);
  ctx.lineTo(458, 528);
  ctx.quadraticCurveTo(360, 566, 262, 528);
  ctx.closePath();
  ctx.fill();

  ctx.font = '600 20px "Archivo", sans-serif';
  ctx.fillStyle = 'rgba(237,240,241,0.75)';
  ctx.fillText('DEMO IMAGE, NOT A REAL SCAN', 150, 40);
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
    /* A three-frame burst that moved a little more than the crop did, which is
       the ordinary case and the one worth seeing on the demo. */
    swayDeg: 1.4,
    frames: 3,
    usableFrames: 3,
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
