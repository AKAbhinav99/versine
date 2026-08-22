/* Multi-framing measurement.
 *
 * Landmark positions shift when the same photo is re-cropped, and the shift is
 * the same size as the asymmetry being measured. Benchmarking (bench/README.md)
 * showed a single-framing reading is not trustworthy on its own: shoulder tilt
 * moved by up to 4 degrees across a 6% crop of one photograph.
 *
 * So every scan is measured several times at slightly different framings. The
 * median is the reading; the spread across framings is the error bar, and a wide
 * spread means the photo cannot support a reading at all. */

import { detectPose } from './pose.js';
import { measureAsymmetry, assessPoseQuality } from './screening.js';
import { RELIABILITY } from '../config.js';

/* Two mild crops and two mild pads. Small enough that a human would call it the
   same photo, large enough to expose an unstable detection.
   Mirrored framings were tried too — the pose model is not mirror-equivariant, so
   the idea was to average out its handedness prior. Measured, it made things
   worse: pooling flipped and unflipped readings mixes two differently-biased
   distributions, which roughly doubled the spread and cost sensitivity. Crops and
   pads only. */
const FRAMINGS = [
  { label: 'as shot', inset: 0 },
  { label: 'crop 3%', inset: 0.03 },
  { label: 'crop 6%', inset: 0.06 },
  { label: 'pad 5%', inset: -0.05 },
  { label: 'pad 10%', inset: -0.1 },
];

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const spread = (values) => Math.max(...values) - Math.min(...values);

/** Re-frame a photo by cropping in (positive inset) or padding out (negative). */
export function reframe(photo, inset) {
  const width = photo.width;
  const height = photo.height;
  const scale = 1 - inset * 2;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.drawImage(photo, -width / 2, -height / 2);
  return canvas;
}

/**
 * Measures one photo at every framing and reduces the results to a reading.
 *
 * @param {HTMLCanvasElement} photo
 * @param {(step: string) => void} [onProgress]
 * @returns {Promise<object>} reading with medians, spreads, and a reliability verdict
 */
export async function measureWithConsensus(photo, onProgress = () => {}) {
  const passes = [];

  for (const framing of FRAMINGS) {
    onProgress(framing.label);
    try {
      const canvas = reframe(photo, framing.inset);
      const pose = await detectPose(canvas);
      const frame = { width: canvas.width, height: canvas.height };
      const measurements = measureAsymmetry(pose.landmarks, frame);
      const quality = assessPoseQuality(pose.landmarks, frame, measurements);
      /* A framing that produced anatomically impossible geometry is a failed
         detection, not a data point. */
      if (measurements.shoulders.tiltDeg > RELIABILITY.implausibleTiltDeg) continue;
      passes.push({ framing: framing.label, measurements, quality, pose, canvas });
    } catch {
      /* This framing found no pose. The others still count. */
    }
  }

  return summariseReading(passes, photo);
}

/** Reduce the per-framing passes to one reading. Pure — exported for testing. */
export function summariseReading(passes, photo = null) {
  if (passes.length < RELIABILITY.minPasses) {
    return {
      usable: false,
      reason: passes.length ? 'unstable' : 'no-pose',
      passes: passes.length,
      totalFramings: FRAMINGS.length,
      primary: passes[0] || null,
      photo,
    };
  }

  const shoulderTilts = passes.map((p) => p.measurements.shoulders.tiltDeg);
  const hipTilts = passes.map((p) => p.measurements.hips.tiltDeg);
  const shoulderSpread = spread(shoulderTilts);

  /* The framing closest to the median is the one whose landmarks get drawn, so the
     overlay the user sees is the one the reported number came from. */
  const shoulderMedian = median(shoulderTilts);
  const primary = passes.reduce((best, pass) => (
    Math.abs(pass.measurements.shoulders.tiltDeg - shoulderMedian)
      < Math.abs(best.measurements.shoulders.tiltDeg - shoulderMedian) ? pass : best
  ), passes[0]);

  return {
    usable: shoulderSpread <= RELIABILITY.maxShoulderSpreadDeg,
    reason: shoulderSpread <= RELIABILITY.maxShoulderSpreadDeg ? null : 'unstable',
    passes: passes.length,
    totalFramings: FRAMINGS.length,
    shoulderTiltDeg: shoulderMedian,
    shoulderSpreadDeg: shoulderSpread,
    hipTiltDeg: median(hipTilts),
    hipSpreadDeg: spread(hipTilts),
    higherShoulder: majority(passes.map((p) => p.measurements.shoulders.higherSide)),
    higherHip: majority(passes.map((p) => p.measurements.hips.higherSide)),
    sideAgreement: agreement(passes.map((p) => p.measurements.shoulders.higherSide)),
    warnings: dedupeWarnings(passes),
    landmarkConfidence: median(passes.map((p) => p.quality.landmarkConfidence)),
    primary,
    photo,
  };
}

function majority(values) {
  const counts = values.reduce((acc, v) => ({ ...acc, [v]: (acc[v] || 0) + 1 }), {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/** Fraction of framings that agreed on which side is higher. */
function agreement(values) {
  const top = majority(values);
  return values.filter((v) => v === top).length / values.length;
}

/** A warning that only one framing raised is usually an artefact of that framing. */
function dedupeWarnings(passes) {
  const counts = new Map();
  for (const pass of passes) {
    for (const warning of pass.quality.warnings) {
      counts.set(warning, (counts.get(warning) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= Math.ceil(passes.length / 2))
    .map(([warning]) => warning);
}
