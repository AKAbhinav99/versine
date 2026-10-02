/* Benchmark harness: runs the real pipeline over a labelled image set and reports
 * the numbers, so the detector and its thresholds rest on measurements rather than
 * intuition. This is what removed the depth-based rotation estimate, see
 * bench/README.md for the results.
 *
 * The image set is served separately (scratchpad/serve-bench.py) and is not part
 * of the app. Every image is CC-licensed; several are clinical photographs of
 * patients, used here for local evaluation only and not redistributed. */

import { measureWithConsensus, reframe } from '../src/lib/consensus.js';
import { measureAsymmetry, assessPoseQuality, classifyReading } from '../src/lib/screening.js';
import { detectPose } from '../src/lib/pose.js';

const IMAGE_ROOT = 'http://localhost:4322/set';

export const CASES = [
  // Confirmed scoliosis. Panels 1-6 are clinical posterior photographs, each
  // published alongside the patient's own X-ray.
  { file: 'pos-panel1.jpg', label: 'pos' },
  { file: 'pos-panel2.jpg', label: 'pos' },
  { file: 'pos-panel3.jpg', label: 'pos' },
  { file: 'pos-panel4.jpg', label: 'pos' },
  { file: 'pos-panel5.jpg', label: 'pos' },
  { file: 'pos-panel6.jpg', label: 'pos' },
  { file: 'pos-nenapadna.jpg', label: 'pos' },
  { file: 'pos-adams-standing.jpg', label: 'pos' },
  { file: 'pos-adams-bend.jpg', label: 'pos' },

  // No known scoliosis. Ordinary posterior standing photographs.
  { file: 'ctl-wellcome-man.jpg', label: 'ctl' },
  { file: 'ctl-female-40s.jpg', label: 'ctl' },
  { file: 'ctl-man-22.jpg', label: 'ctl' },
  { file: 'ctl-female-bw.jpg', label: 'ctl' },
  { file: 'ctl-man-gray.jpg', label: 'ctl' },
  { file: 'ctl-male-anatomy.jpg', label: 'ctl' },
  { file: 'ctl-pair-female.jpg', label: 'ctl' },
  { file: 'ctl-pair-male.jpg', label: 'ctl' },
];

/* Paired cases: the same patient photographed standing and bent forward in the
 * same session. The 17-case set is entirely standing views, which cannot say how
 * the detector behaves on the pose the app actually instructs. Pairing removes
 * the subject as a variable, anything that differs between the two rows is the
 * pose or the photograph, not the person.
 *
 * Only three such pairs exist in what is publicly available, and all three are
 * positives. Posterior forward-bend photographs of people without scoliosis are
 * essentially not published: searches of Wikimedia Commons and the PMC
 * open-access subset returned illustrations, plots, lateral yoga views and
 * trunk-only close-ups, but no usable control. Specificity on the bend pose
 * therefore cannot be measured from public sources at all. */
export const POSE_PAIRS = [
  { subject: 'adams', label: 'pos', standing: 'pos-adams-standing.jpg', bent: 'pos-adams-bend.jpg' },
  { subject: 'kyphoscoliosis', label: 'pos', standing: 'stand-pos-kyphoscoliosis.jpg', bent: 'bend-pos-kyphoscoliosis.jpg' },
  { subject: 'schroth3cp', label: 'pos', standing: 'stand-pos-schroth3cp.jpg', bent: 'bend-pos-schroth3cp.jpg' },
];

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`could not load ${url}`));
    image.src = url;
  });
}

/** The pipeline expects a canvas, not an <img>. */
function toCanvas(image, { mirror = false, rotateDeg = 0 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  if (rotateDeg) ctx.rotate((rotateDeg * Math.PI) / 180);
  if (mirror) ctx.scale(-1, 1);
  ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  return canvas;
}

const round = (v, p = 2) => (v === null || v === undefined ? null : Number(Number(v).toFixed(p)));

function row(testCase, reading, verdict) {
  return {
    case: testCase.file.replace('.jpg', ''),
    label: testCase.label,
    usable: reading.usable,
    passes: `${reading.passes}/${reading.totalFramings}`,
    shoulder: round(reading.shoulderTiltDeg),
    spread: round(reading.shoulderSpreadDeg),
    hip: round(reading.hipTiltDeg),
    side: reading.higherShoulder ?? ', ',
    agree: round(reading.sideAgreement),
    conf: round(reading.landmarkConfidence),
    level: verdict.level,
  };
}

/** Main sweep: the full pipeline, exactly as the app runs it. */
export async function runBench() {
  const rows = [];
  for (const testCase of CASES) {
    const image = await loadImage(`${IMAGE_ROOT}/${testCase.file}`);
    const reading = await measureWithConsensus(toCanvas(image));
    rows.push(row(testCase, reading, classifyReading(reading)));
  }
  return rows;
}

/** Confusion matrix over the cases the pipeline was willing to report on. */
export function score(rows) {
  const reported = rows.filter((r) => r.usable);
  const flagged = (r) => r.level === 'refer' || r.level === 'monitor';

  const truePos = reported.filter((r) => r.label === 'pos' && flagged(r)).length;
  const falseNeg = reported.filter((r) => r.label === 'pos' && !flagged(r)).length;
  const falsePos = reported.filter((r) => r.label === 'ctl' && flagged(r)).length;
  const trueNeg = reported.filter((r) => r.label === 'ctl' && !flagged(r)).length;

  return {
    cases: rows.length,
    reported: reported.length,
    withheld: rows.length - reported.length,
    truePos, falseNeg, falsePos, trueNeg,
    sensitivity: truePos + falseNeg ? round(truePos / (truePos + falseNeg)) : null,
    specificity: trueNeg + falsePos ? round(trueNeg / (trueNeg + falsePos)) : null,
  };
}

/** Standing against bent, same subject. Reports both readings plus the raw
 *  per-framing tilts, because the interesting failure is a mis-fitted skeleton
 *  producing a large number rather than no number. */
export async function runPairedPose() {
  const rows = [];
  for (const pair of POSE_PAIRS) {
    for (const pose of ['standing', 'bent']) {
      const image = await loadImage(`${IMAGE_ROOT}/${pair[pose]}`);
      const photo = toCanvas(image);
      const reading = await measureWithConsensus(photo);

      /* Every framing's raw tilt, including the ones the pipeline discarded as
         anatomically impossible, that discard is the whole story on bend photos. */
      const raw = [];
      for (const inset of [0, 0.03, 0.06, -0.05, -0.1]) {
        try {
          const canvas = reframe(photo, inset);
          const pose2 = await detectPose(canvas);
          const m = measureAsymmetry(pose2.landmarks, { width: canvas.width, height: canvas.height });
          raw.push(round(m.shoulders.tiltDeg, 1));
        } catch { raw.push(null); }
      }

      rows.push({
        subject: pair.subject, pose, label: pair.label,
        size: `${image.naturalWidth}x${image.naturalHeight}`,
        usable: reading.usable,
        passes: `${reading.passes}/${reading.totalFramings}`,
        shoulder: round(reading.shoulderTiltDeg),
        spread: round(reading.shoulderSpreadDeg),
        level: classifyReading(reading).level,
        rawTilts: raw.map((t) => (t === null ? 'no-pose' : t)).join(', '),
      });
    }
  }
  return rows;
}

/** Mirroring must flip the named side and leave the magnitude alone; a rolled
 *  camera must move both tilts together and raise the camera-angle warning. */
export async function runInvariance(files = ['pos-panel4.jpg', 'ctl-male-anatomy.jpg']) {
  const rows = [];
  for (const file of files) {
    const image = await loadImage(`${IMAGE_ROOT}/${file}`);
    const base = await measureWithConsensus(toCanvas(image));
    const mirrored = await measureWithConsensus(toCanvas(image, { mirror: true }));
    const rolled = await measureWithConsensus(toCanvas(image, { rotateDeg: 6 }));
    rows.push({
      case: file.replace('.jpg', ''),
      baseTilt: round(base.shoulderTiltDeg), baseSide: base.higherShoulder,
      mirrorTilt: round(mirrored.shoulderTiltDeg), mirrorSide: mirrored.higherShoulder,
      rolledShoulder: round(rolled.shoulderTiltDeg), rolledHip: round(rolled.hipTiltDeg),
      rolledWarns: rolled.warnings?.length ?? 0,
    });
  }
  return rows;
}

/** Single-framing measurements, kept so the instability that motivated the
 *  consensus design can be re-demonstrated rather than taken on trust. */
export async function runSingleFraming(file = 'pos-panel1.jpg') {
  const image = await loadImage(`${IMAGE_ROOT}/${file}`);
  const out = [];
  for (const inset of [0, 0.02, 0.04, 0.06, -0.05, -0.1]) {
    try {
      const canvas = reframe(toCanvas(image), inset);
      const pose = await detectPose(canvas);
      const frame = { width: canvas.width, height: canvas.height };
      const measurements = measureAsymmetry(pose.landmarks, frame);
      const quality = assessPoseQuality(pose.landmarks, frame, measurements);
      out.push({
        inset,
        shoulder: round(measurements.shoulders.tiltDeg),
        hip: round(measurements.hips.tiltDeg),
        side: measurements.shoulders.higherSide,
        conf: round(quality.landmarkConfidence),
      });
    } catch (error) {
      out.push({ inset, shoulder: error.code || error.message });
    }
  }
  return out;
}

window.__bench = { runBench, score, runInvariance, runSingleFraming, runPairedPose, CASES, POSE_PAIRS };
