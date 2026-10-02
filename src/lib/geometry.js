/* Asymmetry geometry.
 *
 * Everything here is plain trigonometry on pose landmark coordinates. There is no
 * classifier and no trained model in this file, given the same landmarks you get
 * the same numbers, and every number shown in the UI comes from one of these
 * functions.
 *
 * Image-plane coordinates only. MediaPipe also reports metric worldLandmarks with
 * a depth axis, and an earlier version of this file used that depth to estimate
 * trunk rotation and rib-hump prominence. Benchmarking against labelled clinical
 * photographs showed those depth values move by more than their own signal range
 * when the same photo is merely re-cropped, so nothing here reads z. See
 * bench/README.md for the numbers.
 *
 * landmarks are normalized image coords, x/y in 0..1, y increasing downward. They
 * must be scaled by image width/height before measuring angles, otherwise the
 * image aspect ratio skews them.
 */

export const POSE = {
  NOSE: 0,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
};

const EPSILON = 1e-6;
const LEVEL_DEG = 0.35; // below this we call a line level rather than naming a side

const toDegrees = (radians) => (radians * 180) / Math.PI;

/** Scale a normalized landmark into pixel space so angles aren't aspect-skewed. */
export function toPixels(landmark, frame) {
  return { x: landmark.x * frame.width, y: landmark.y * frame.height };
}

export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function distance2d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Tilt of the line through two paired landmarks, relative to horizontal.
 * Returns the magnitude in degrees plus which of the subject's sides sits higher.
 */
function tiltOfPair(leftPx, rightPx) {
  const rise = rightPx.y - leftPx.y;          // +y is down, so + means the right side is lower
  const run = Math.abs(rightPx.x - leftPx.x);
  const tiltDeg = toDegrees(Math.atan2(Math.abs(rise), Math.max(run, EPSILON)));
  const higherSide = tiltDeg < LEVEL_DEG ? 'level' : rise > 0 ? 'left' : 'right';
  return { tiltDeg, higherSide, heightDiffPx: Math.abs(rise), spanPx: run };
}

export function calculateShoulderAsymmetry(landmarks, frame) {
  const left = toPixels(landmarks[POSE.LEFT_SHOULDER], frame);
  const right = toPixels(landmarks[POSE.RIGHT_SHOULDER], frame);
  const result = tiltOfPair(left, right);
  return { ...result, percentOfWidth: (result.heightDiffPx / Math.max(result.spanPx, EPSILON)) * 100 };
}

export function calculateHipAsymmetry(landmarks, frame) {
  const left = toPixels(landmarks[POSE.LEFT_HIP], frame);
  const right = toPixels(landmarks[POSE.RIGHT_HIP], frame);
  const result = tiltOfPair(left, right);
  return { ...result, percentOfWidth: (result.heightDiffPx / Math.max(result.spanPx, EPSILON)) * 100 };
}
