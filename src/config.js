/* Tunables and thresholds in one place. */

export const POSE_MODEL = {
  /* MediaPipe Tasks Vision, loaded from CDN as an ES module. */
  visionBundle: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',
  wasmRoot: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  /* "full" is the accuracy/size middle ground; "heavy" is more accurate and ~4x larger. */
  asset: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
};

/* Screening bands.
 *
 * These are calibrated on the labelled image set in bench/ — a small set of
 * clinical photographs of confirmed scoliosis alongside ordinary posterior
 * photographs. They are provisional, not clinically validated, and the UI says so.
 *
 * scoliometerReferenceDeg is a different thing: the real 7 degree angle-of-trunk-
 * rotation referral cutoff used with a scoliometer in the forward bend. It is
 * shown for context only. This app cannot measure that angle from a photograph —
 * see bench/README.md.
 */
export const THRESHOLDS = {
  shoulderMonitorDeg: 2.0,
  shoulderReferDeg: 3.5,
  rulerMaxDeg: 8,
  hipNotableDeg: 3,
  scoliometerReferenceDeg: 7,
  minLandmarkVisibility: 0.6,
};

/* Is the subject actually bent forward?
 *
 * Photographed from behind, the shoulders sit higher in the frame than the hips
 * whether the subject is standing or bent — a camera held at chest height looks
 * down at both. What changes is foreshortening: bending forward points the trunk
 * away from the camera, so the shoulder-to-hip distance in the image collapses
 * relative to shoulder width.
 *
 * standingTorsoRatio is measured: every standing photograph in bench/ came out
 * between 1.06 and 1.47. The bent-forward side is physical reasoning, not data —
 * the one forward-bend image in the set is too tightly cropped to detect. So this
 * raises a note, never withholds a reading.
 */
export const POSE_CHECK = {
  standingTorsoRatio: 1.0,
  bentTorsoRatio: 0.8,
};

/* How much disagreement between framings is tolerable before a reading is
   withheld. Derived from the same benchmark: readings whose spread across
   framings exceeded ~3.5 degrees came from detections that had gone wrong.
 *
 * implausibleTiltDeg discards a single framing whose geometry cannot be a real
 * shoulder line. It is a guard against the pose model mis-fitting the subject
 * rather than a screening threshold, and it sits between two measured
 * populations: across the whole labelled set the largest genuine reading is
 * 8.3 degrees and the ruler tops out at 8, while observed mis-fits on the
 * forward-bend photograph came in at 23.6, 83.2 and 87.1 degrees.
 *
 * It was 25, which let that 23.6 through — it was discarded only because too few
 * other framings survived to meet minPasses. Moving it to 15 keeps roughly
 * double the headroom over any real reading and still excludes every mis-fit
 * seen. Sweeping the value from 25 down to 8 changes no outcome anywhere on the
 * benchmark, so this buys defence in depth for a region the set cannot test, and
 * is explicitly not a score improvement. */
export const RELIABILITY = {
  minPasses: 3,
  maxShoulderSpreadDeg: 3.5,
  implausibleTiltDeg: 15,
};

/* Clinician finder. Providers and their keys live in lib/keys.js, lib/clinics.js
   and lib/geocoding.js — this is just the shared search shape. */
export const PLACES = {
  countryStorage: 'versine.country',
  defaultRadiusM: 15000,
};

export const STORAGE_KEY = 'versine.history.v1';
export const INTRO_KEY = 'versine.introAccepted.v1';

/* The app was called SpineCheck until the rename. Anything stored under the old
   namespace is carried across on first load, so a rename does not silently throw
   away someone's scan history. */
export const LEGACY_KEYS = {
  'spinecheck.history.v1': STORAGE_KEY,
  'spinecheck.introAccepted.v1': INTRO_KEY,
  'spinecheck.placesKey': 'versine.placesKey',
  'spinecheck.country': 'versine.country',
  'spinecheck.lastCenter': 'versine.lastCenter',
};
export const HISTORY_LIMIT = 60;
