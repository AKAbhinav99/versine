/* Tests for the multi-framing reduction and the screening bands.
 *
 * The rule these protect: a number is only reported when the framings agree. The
 * benchmark that motivated this (bench/README.md) found single-framing readings
 * swinging by more than the signal, so the gate matters more than the threshold. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { summariseReading } from '../src/lib/consensus.js';
import { classifyReading } from '../src/lib/screening.js';
import { RELIABILITY, THRESHOLDS } from '../src/config.js';

/** One framing's worth of results, shaped as measureWithConsensus produces them. */
const pass = (shoulderTilt, hipTilt = 1, { side = 'left', warnings = [], visibility = 0.9 } = {}) => ({
  framing: `t${shoulderTilt}`,
  measurements: {
    shoulders: { tiltDeg: shoulderTilt, higherSide: side },
    hips: { tiltDeg: hipTilt, higherSide: 'left' },
  },
  quality: { landmarkConfidence: visibility, warnings },
  pose: { landmarks: [] },
  canvas: null,
});

test('the reading is the median of the framings, not the first or the largest', () => {
  const reading = summariseReading([pass(3.0), pass(4.0), pass(3.4), pass(9.0), pass(3.2)]);
  assert.equal(reading.shoulderTiltDeg, 3.4);
});

test('the error bar is the real spread across framings', () => {
  const reading = summariseReading([pass(3.0), pass(4.2), pass(3.4)]);
  assert.ok(Math.abs(reading.shoulderSpreadDeg - 1.2) < 1e-9);
});

test('a reading is withheld when too few framings produced a pose', () => {
  const reading = summariseReading([pass(3.0), pass(3.1)]);
  assert.equal(reading.usable, false);
  assert.equal(reading.reason, 'unstable');
  assert.equal(classifyReading(reading).level, 'unclear');
});

test('no pose at all is reported differently from an unstable pose', () => {
  const reading = summariseReading([]);
  assert.equal(reading.reason, 'no-pose');
  assert.match(classifyReading(reading).headline, /couldn't be measured/i);
});

test('framings that disagree wildly withhold the number rather than averaging it', () => {
  const wide = summariseReading([pass(1.0), pass(3.0), pass(12.0), pass(2.0), pass(2.5)]);
  assert.ok(wide.shoulderSpreadDeg > RELIABILITY.maxShoulderSpreadDeg);
  assert.equal(wide.usable, false);
  const verdict = classifyReading(wide);
  assert.equal(verdict.level, 'unclear');
  assert.match(verdict.body, /several slightly different framings/);
});

test('the overlay is drawn from the framing closest to the reported number', () => {
  const reading = summariseReading([pass(1.0), pass(2.0), pass(2.1), pass(3.0), pass(2.6)]);
  assert.equal(reading.shoulderTiltDeg, 2.1);
  assert.equal(reading.primary.framing, 't2.1');
});

test('the named side is the one most framings agreed on, with the agreement reported', () => {
  const reading = summariseReading([
    pass(3, 1, { side: 'left' }), pass(3.2, 1, { side: 'left' }),
    pass(3.1, 1, { side: 'right' }), pass(3.3, 1, { side: 'left' }),
  ]);
  assert.equal(reading.higherShoulder, 'left');
  assert.equal(reading.sideAgreement, 0.75);
});

test('a warning raised by only one framing is dropped as a framing artefact', () => {
  const odd = 'Shoulders and hips are tilted by almost the same amount, which usually means the camera was held at an angle rather than that the body is uneven.';
  const common = 'Some shoulder or hip points were hard to see. Better light, a plain background, or a more fitted top will sharpen the reading.';
  const reading = summariseReading([
    pass(3, 1, { warnings: [odd, common] }),
    pass(3.1, 1, { warnings: [common] }),
    pass(3.2, 1, { warnings: [common] }),
    pass(3.3, 1, { warnings: [] }),
  ]);
  assert.deepEqual(reading.warnings, [common]);
});

test('readings are banded against the calibrated thresholds', () => {
  const band = (tilt) => classifyReading(summariseReading([pass(tilt), pass(tilt), pass(tilt)])).level;
  assert.equal(band(0.8), 'clear');
  assert.equal(band(THRESHOLDS.shoulderMonitorDeg + 0.1), 'monitor');
  assert.equal(band(THRESHOLDS.shoulderReferDeg + 0.1), 'refer');
});

test('every verdict quotes the spread, so no number is shown without its uncertainty', () => {
  const verdict = classifyReading(summariseReading([pass(4.0), pass(4.6), pass(4.3)]));
  assert.match(verdict.kicker, /±0\.6° across 3 framings/);
});
