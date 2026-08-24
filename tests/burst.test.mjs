/* Tests for the burst reduction.
 *
 * The rule these protect: the two kinds of uncertainty stay apart. The gate is
 * calibrated against the spread across framings of one photograph, and it must
 * keep being fed exactly that quantity — pooling sway into it would push a
 * bigger number against a threshold derived from a smaller one. Sway is
 * reported and never gated, because nothing has calibrated a threshold for it. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { combineBurst } from '../src/lib/consensus.js';
import { RELIABILITY } from '../src/config.js';

/** A frame reading shaped as measureWithConsensus returns one. */
const frame = (tilt, cropSpread = 1, { usable = true, hip = 1 } = {}) => ({
  usable,
  reason: usable ? null : 'unstable',
  passes: 5,
  totalFramings: 5,
  shoulderTiltDeg: tilt,
  shoulderSpreadDeg: cropSpread,
  hipTiltDeg: hip,
  higherShoulder: 'left',
  warnings: [],
  landmarkConfidence: 0.9,
  primary: { framing: `t${tilt}` },
});

test('a single frame behaves exactly as before, with sway unknown', () => {
  const out = combineBurst([frame(4.0, 1.2)]);
  assert.equal(out.shoulderTiltDeg, 4.0);
  assert.equal(out.shoulderSpreadDeg, 1.2);
  assert.equal(out.usable, true);
  assert.equal(out.swayDeg, null, 'one frame cannot show movement, and must not claim none');
  assert.equal(out.frames, 1);
});

test('the reading is the median across frames', () => {
  const out = combineBurst([frame(3.0), frame(5.0), frame(4.0)]);
  assert.equal(out.shoulderTiltDeg, 4.0);
});

test('sway is the spread across frames, not across framings', () => {
  const out = combineBurst([frame(3.0, 0.5), frame(5.0, 0.5), frame(4.0, 0.5)]);
  assert.equal(out.swayDeg, 2.0);
  assert.equal(out.shoulderSpreadDeg, 0.5, 'the error bar stays the crop spread');
});

test('sway is never pooled into the gated spread', () => {
  /* Frames that individually measured tightly, but disagree wildly with each
     other. The gate sees only the tight crop spread; the movement is reported. */
  const out = combineBurst([frame(1.0, 0.4), frame(9.0, 0.4), frame(5.0, 0.4)]);
  assert.equal(out.shoulderSpreadDeg, 0.4);
  assert.ok(out.shoulderSpreadDeg <= RELIABILITY.maxShoulderSpreadDeg);
  assert.equal(out.usable, true, 'a calibrated gate must not be moved by an uncalibrated quantity');
  assert.equal(out.swayDeg, 8.0, 'but the movement is not hidden either');
});

test('the gated spread is the median of the per-frame crop spreads', () => {
  const out = combineBurst([frame(4.0, 1.0), frame(4.0, 2.0), frame(4.0, 6.0)]);
  assert.equal(out.shoulderSpreadDeg, 2.0);
});

test('unusable frames are dropped, and the rest still measure', () => {
  const out = combineBurst([frame(4.0, 1), frame(99, 9, { usable: false }), frame(6.0, 1)]);
  assert.equal(out.usableFrames, 2);
  assert.equal(out.frames, 3);
  assert.equal(out.shoulderTiltDeg, 5.0);
  assert.equal(out.swayDeg, 2.0);
});

test('one usable frame out of several still reports sway as unknown', () => {
  const out = combineBurst([frame(4.0, 1), frame(99, 9, { usable: false })]);
  assert.equal(out.usableFrames, 1);
  assert.equal(out.frames, 2);
  assert.equal(out.swayDeg, null);
});

test('a burst with nothing usable stays unusable and reports the failure', () => {
  const out = combineBurst([frame(0, 9, { usable: false }), frame(0, 9, { usable: false })]);
  assert.equal(out.usable, false);
  assert.equal(out.usableFrames, 0);
  assert.equal(out.swayDeg, null);
  assert.equal(out.reason, 'unstable');
});

test('an empty burst does not throw', () => {
  const out = combineBurst([]);
  assert.equal(out.usable, false);
  assert.equal(out.usableFrames, 0);
});

test('the frame carrying the overlay is the one nearest the reported reading', () => {
  const out = combineBurst([frame(1.0), frame(4.0), frame(9.0)]);
  assert.equal(out.shoulderTiltDeg, 4.0);
  assert.equal(out.primary.framing, 't4', 'the photo shown must be the one the number came from');
});

test('warnings from any usable frame are carried, once each', () => {
  const a = frame(4.0); a.warnings = ['Some shoulder points were hard to see.'];
  const b = frame(5.0); b.warnings = ['Some shoulder points were hard to see.', 'Part of your torso sits at the edge.'];
  const out = combineBurst([a, b]);
  assert.equal(out.warnings.length, 2);
});
