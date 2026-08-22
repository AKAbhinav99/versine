/* Unit tests for the asymmetry math. Run with: node --test tests/
 * These are the numbers the whole app rests on, so they get pinned. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { POSE, calculateShoulderAsymmetry, calculateHipAsymmetry } from '../src/lib/geometry.js';
import { assessPoseQuality, measureAsymmetry } from '../src/lib/screening.js';

const FRAME = { width: 900, height: 1200 };

/** 33 landmarks, all centred, with the named ones overridden. */
function landmarkSet(overrides = {}) {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.92 }));
  for (const [index, value] of Object.entries(overrides)) {
    points[index] = { visibility: 0.92, z: 0, ...points[index], ...value };
  }
  return points;
}

/* A back photographed from behind and above: hips high in frame, shoulders lower,
   head hanging below them. */
const bentForwardImage = (overrides = {}) => landmarkSet({
  [POSE.NOSE]: { x: 0.50, y: 0.82 },
  [POSE.LEFT_SHOULDER]: { x: 0.38, y: 0.60 },
  [POSE.RIGHT_SHOULDER]: { x: 0.62, y: 0.60 },
  [POSE.LEFT_HIP]: { x: 0.42, y: 0.26 },
  [POSE.RIGHT_HIP]: { x: 0.58, y: 0.26 },
  ...overrides,
});

test('level shoulders read as level, not as a tiny tilt to one side', () => {
  const { tiltDeg, higherSide } = calculateShoulderAsymmetry(bentForwardImage(), FRAME);
  assert.equal(tiltDeg, 0);
  assert.equal(higherSide, 'level');
});

test('a dropped right shoulder reports the left side as higher', () => {
  const landmarks = bentForwardImage({ [POSE.RIGHT_SHOULDER]: { x: 0.62, y: 0.63 } });
  const { tiltDeg, higherSide } = calculateShoulderAsymmetry(landmarks, FRAME);

  // 0.03 * 1200px rise over 0.24 * 900px run => atan(36/216) = 9.46 degrees
  assert.equal(higherSide, 'left');
  assert.ok(Math.abs(tiltDeg - 9.46) < 0.05, `expected ~9.46, got ${tiltDeg}`);
});

test('angles are measured in pixel space, so frame aspect ratio does not skew them', () => {
  const landmarks = bentForwardImage({ [POSE.RIGHT_SHOULDER]: { x: 0.62, y: 0.63 } });
  const tall = calculateShoulderAsymmetry(landmarks, { width: 900, height: 1200 }).tiltDeg;
  const square = calculateShoulderAsymmetry(landmarks, { width: 900, height: 900 }).tiltDeg;
  assert.ok(tall > square, 'a taller frame stretches the same normalized rise into a bigger angle');
});

test('hip tilt is measured independently of the shoulders', () => {
  const landmarks = bentForwardImage({ [POSE.LEFT_HIP]: { x: 0.42, y: 0.29 } });
  const hips = calculateHipAsymmetry(landmarks, FRAME);
  const shoulders = calculateShoulderAsymmetry(landmarks, FRAME);
  assert.equal(hips.higherSide, 'right');
  assert.ok(hips.tiltDeg > 10);
  assert.equal(shoulders.tiltDeg, 0);
});

test('shoulder height difference is also reported relative to shoulder width', () => {
  const landmarks = bentForwardImage({ [POSE.RIGHT_SHOULDER]: { x: 0.62, y: 0.63 } });
  const { percentOfWidth } = calculateShoulderAsymmetry(landmarks, FRAME);
  // 36px of 216px
  assert.ok(Math.abs(percentOfWidth - 16.67) < 0.05, `expected ~16.67%, got ${percentOfWidth}`);
});

test('an upright pose is flagged, a proper forward bend is not', () => {
  const bent = bentForwardImage();
  const bentQuality = assessPoseQuality(bent, FRAME, measureAsymmetry(bent, FRAME));
  assert.equal(bentQuality.posture, 'bent forward');
  assert.equal(bentQuality.warnings.length, 0);

  // Standing: shoulders above hips in the image, head above the shoulders.
  const upright = landmarkSet({
    [POSE.NOSE]: { x: 0.5, y: 0.14 },
    [POSE.LEFT_SHOULDER]: { x: 0.38, y: 0.28 },
    [POSE.RIGHT_SHOULDER]: { x: 0.62, y: 0.28 },
    [POSE.LEFT_HIP]: { x: 0.42, y: 0.58 },
    [POSE.RIGHT_HIP]: { x: 0.58, y: 0.58 },
  });
  const uprightQuality = assessPoseQuality(upright, FRAME, measureAsymmetry(upright, FRAME));
  assert.match(uprightQuality.warnings.join(' '), /standing pose/);
});

test('a camera held at an angle is called out rather than reported as body asymmetry', () => {
  // Shoulders and hips both tilted ~7 degrees the same way: that is the phone, not the spine.
  const landmarks = bentForwardImage({
    [POSE.RIGHT_SHOULDER]: { x: 0.62, y: 0.622 },
    [POSE.RIGHT_HIP]: { x: 0.58, y: 0.2745 },
  });
  const quality = assessPoseQuality(landmarks, FRAME, measureAsymmetry(landmarks, FRAME));
  assert.match(quality.warnings.join(' '), /camera was held at an angle/);
});

test('landmarks drifting outside the frame make the reading unusable', () => {
  const landmarks = bentForwardImage({ [POSE.LEFT_HIP]: { x: 0.005, y: 0.26 } });
  const quality = assessPoseQuality(landmarks, FRAME, measureAsymmetry(landmarks, FRAME));
  assert.equal(quality.usable, false);
});

test('low landmark visibility is surfaced as a warning', () => {
  const landmarks = bentForwardImage({ [POSE.LEFT_SHOULDER]: { x: 0.38, y: 0.60, visibility: 0.3 } });
  const quality = assessPoseQuality(landmarks, FRAME, measureAsymmetry(landmarks, FRAME));
  assert.match(quality.warnings.join(' '), /hard to see/);
});
