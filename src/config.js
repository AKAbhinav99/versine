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
 * These are calibrated on the labelled image set in bench/, a small set of
 * clinical photographs of confirmed scoliosis alongside ordinary posterior
 * photographs. They are provisional, not clinically validated, and the UI says so.
 *
 * scoliometerReferenceDeg is a different thing: the real 7 degree angle-of-trunk-
 * rotation referral cutoff used with a scoliometer in the forward bend. It is
 * shown for context only. This app cannot measure that angle from a photograph,
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
 * whether the subject is standing or bent, a camera held at chest height looks
 * down at both. What changes is foreshortening: bending forward points the trunk
 * away from the camera, so the shoulder-to-hip distance in the image collapses
 * relative to shoulder width.
 *
 * standingTorsoRatio is measured: every standing photograph in bench/ came out
 * between 1.06 and 1.47. The bent-forward side is physical reasoning, not data,
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
 * shoulder line, a guard against the pose model mis-fitting the subject.
 *
 * It was briefly lowered to 15 on the reasoning that the largest genuine reading
 * anywhere in the labelled set was 8.3 degrees while observed mis-fits ran to 83.
 * That reasoning was wrong, and adding a severe congenital kyphoscoliosis case to
 * the bench proved it: that subject measures 17.3 degrees, from five framings
 * agreeing within 2.1, with every landmark at full visibility and the skeleton
 * visibly fitted to the right shoulders. A cutoff of 15 threw away a correct
 * reading of an obvious deformity. The old set simply had no case that severe.
 *
 * Magnitude does not separate a real reading from a mis-fit. Consistency does,
 * and that is already measured: the genuine 17.3 clusters within 2.1 degrees,
 * while the bend mis-fits scatter across 83, 87 and 23.6. maxShoulderSpreadDeg
 * and minPasses were doing this job correctly all along. */
export const RELIABILITY = {
  minPasses: 3,
  maxShoulderSpreadDeg: 3.5,
  implausibleTiltDeg: 25,
};

/* Clinician finder. Providers and their keys live in lib/keys.js, lib/clinics.js
   and lib/geocoding.js, this is just the shared search shape. */
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
