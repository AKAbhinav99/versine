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

/* A back photographed from behind and above, bent forward at the waist: head at
   the top, shoulders below it, hips nearest the camera at the bottom. Bending
   points the trunk away from the camera, so the shoulder-to-hip distance in the
   image is short relative to shoulder width — 144px against 216px here. */
const bentForwardImage = (overrides = {}) => landmarkSet({
  [POSE.NOSE]: { x: 0.50, y: 0.14 },
  [POSE.LEFT_SHOULDER]: { x: 0.38, y: 0.30 },
  [POSE.RIGHT_SHOULDER]: { x: 0.62, y: 0.30 },
  [POSE.LEFT_HIP]: { x: 0.42, y: 0.42 },
  [POSE.RIGHT_HIP]: { x: 0.58, y: 0.42 },
  ...overrides,
});

test('level shoulders read as level, not as a tiny tilt to one side', () => {
  const { tiltDeg, higherSide } = calculateShoulderAsymmetry(bentForwardImage(), FRAME);
  assert.equal(tiltDeg, 0);
  assert.equal(higherSide, 'level');
});

test('a dropped right shoulder reports the left side as higher', () => {
  const landmarks = bentForwardImage({ [POSE.RIGHT_SHOULDER]: { x: 0.62, y: 0.33 } });
  const { tiltDeg, higherSide } = calculateShoulderAsymmetry(landmarks, FRAME);

  // 0.03 * 1200px rise over 0.24 * 900px run => atan(36/216) = 9.46 degrees
  assert.equal(higherSide, 'left');
  assert.ok(Math.abs(tiltDeg - 9.46) < 0.05, `expected ~9.46, got ${tiltDeg}`);
});

test('angles are measured in pixel space, so frame aspect ratio does not skew them', () => {
  const landmarks = bentForwardImage({ [POSE.RIGHT_SHOULDER]: { x: 0.62, y: 0.33 } });
  const tall = calculateShoulderAsymmetry(landmarks, { width: 900, height: 1200 }).tiltDeg;
  const square = calculateShoulderAsymmetry(landmarks, { width: 900, height: 900 }).tiltDeg;
  assert.ok(tall > square, 'a taller frame stretches the same normalized rise into a bigger angle');
});

test('hip tilt is measured independently of the shoulders', () => {
  const landmarks = bentForwardImage({ [POSE.LEFT_HIP]: { x: 0.42, y: 0.45 } });
  const hips = calculateHipAsymmetry(landmarks, FRAME);
  const shoulders = calculateShoulderAsymmetry(landmarks, FRAME);
  assert.equal(hips.higherSide, 'right');
  assert.ok(hips.tiltDeg > 10);
  assert.equal(shoulders.tiltDeg, 0);
});

test('shoulder height difference is also reported relative to shoulder width', () => {
  const landmarks = bentForwardImage({ [POSE.RIGHT_SHOULDER]: { x: 0.62, y: 0.33 } });
  const { percentOfWidth } = calculateShoulderAsymmetry(landmarks, FRAME);
  // 36px of 216px
  assert.ok(Math.abs(percentOfWidth - 16.67) < 0.05, `expected ~16.67%, got ${percentOfWidth}`);
});

test('a proper forward bend passes without notes', () => {
  const bent = bentForwardImage();
  const quality = assessPoseQuality(bent, FRAME, measureAsymmetry(bent, FRAME));
  assert.equal(quality.posture, 'bent forward');
  assert.ok(quality.torsoRatio < 0.8, `expected a foreshortened torso, got ${quality.torsoRatio}`);
  assert.equal(quality.warnings.length, 0);
});

test('standing upright is flagged — the trunk is not foreshortened', () => {
  /* Shoulders are still above the hips, as they are in both poses. What gives it
     away is the shoulder-to-hip distance: 360px against 216px of shoulder width. */
  const upright = landmarkSet({
    [POSE.NOSE]: { x: 0.5, y: 0.14 },
    [POSE.LEFT_SHOULDER]: { x: 0.38, y: 0.28 },
    [POSE.RIGHT_SHOULDER]: { x: 0.62, y: 0.28 },
    [POSE.LEFT_HIP]: { x: 0.42, y: 0.58 },
    [POSE.RIGHT_HIP]: { x: 0.58, y: 0.58 },
  });
  const quality = assessPoseQuality(upright, FRAME, measureAsymmetry(upright, FRAME));
  assert.ok(quality.torsoRatio > 1.0);
  assert.equal(quality.posture, 'upright?');
  assert.match(quality.warnings.join(' '), /close to upright/);
});

test('hips coming out above the shoulders is called out as a camera position problem', () => {
  /* Only happens if the phone is below the trunk or the photo is rotated. */
  const inverted = landmarkSet({
    [POSE.NOSE]: { x: 0.5, y: 0.86 },
    [POSE.LEFT_SHOULDER]: { x: 0.38, y: 0.60 },
    [POSE.RIGHT_SHOULDER]: { x: 0.62, y: 0.60 },
    [POSE.LEFT_HIP]: { x: 0.42, y: 0.26 },
    [POSE.RIGHT_HIP]: { x: 0.58, y: 0.26 },
  });
  const quality = assessPoseQuality(inverted, FRAME, measureAsymmetry(inverted, FRAME));
  assert.equal(quality.posture, 'inverted?');
  assert.match(quality.warnings.join(' '), /hips came out higher in the frame/);
});

test('a camera held at an angle is called out rather than reported as body asymmetry', () => {
  // Shoulders and hips both tilted ~7 degrees the same way: that is the phone, not the spine.
  const landmarks = bentForwardImage({
    [POSE.RIGHT_SHOULDER]: { x: 0.62, y: 0.3221 },
    [POSE.RIGHT_HIP]: { x: 0.58, y: 0.4347 },
  });
  const quality = assessPoseQuality(landmarks, FRAME, measureAsymmetry(landmarks, FRAME));
  assert.match(quality.warnings.join(' '), /camera was held at an angle/);
});

test('landmarks drifting outside the frame make the reading unusable', () => {
  const landmarks = bentForwardImage({ [POSE.LEFT_HIP]: { x: 0.005, y: 0.42 } });
  const quality = assessPoseQuality(landmarks, FRAME, measureAsymmetry(landmarks, FRAME));
  assert.equal(quality.usable, false);
});

test('low landmark visibility is surfaced as a warning', () => {
  const landmarks = bentForwardImage({ [POSE.LEFT_SHOULDER]: { x: 0.38, y: 0.30, visibility: 0.3 } });
  const quality = assessPoseQuality(landmarks, FRAME, measureAsymmetry(landmarks, FRAME));
  assert.match(quality.warnings.join(' '), /hard to see/);
});
