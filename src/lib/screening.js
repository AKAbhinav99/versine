/* Turns landmark geometry into a screening reading: measurements, a photo quality
 * assessment, and a plain-language interpretation.
 *
 * What this measures is surface tilt in the image plane — how level the shoulders
 * and hips are. It does not measure trunk rotation. See bench/README.md for why
 * the depth-derived rotation estimate was removed. */

import { THRESHOLDS, POSE_CHECK } from '../config.js';
import {
  POSE, toPixels, distance2d, midpoint,
  calculateShoulderAsymmetry, calculateHipAsymmetry,
} from './geometry.js';

const KEY_LANDMARKS = [
  POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER, POSE.LEFT_HIP, POSE.RIGHT_HIP,
];

export const shortSide = (side) => (
  { left: 'Left higher', right: 'Right higher', level: 'Level' }[side] || '—'
);

const sideLabel = (side) => (
  { left: "the subject's left", right: "the subject's right", level: 'neither side' }[side] || side
);

export function measureAsymmetry(landmarks, frame) {
  return {
    shoulders: calculateShoulderAsymmetry(landmarks, frame),
    hips: calculateHipAsymmetry(landmarks, frame),
  };
}

/**
 * Checks that would change how much weight the numbers deserve: are the landmarks
 * confident, is the person actually bent forward, was the phone held level.
 */
export function assessPoseQuality(landmarks, frame, measurements) {
  const warnings = [];

  const weakest = Math.min(...KEY_LANDMARKS.map((i) => landmarks[i]?.visibility ?? 0));
  if (weakest < THRESHOLDS.minLandmarkVisibility) {
    warnings.push('Some shoulder or hip points were hard to see. Better light, a plain background, or a more fitted top will sharpen the reading.');
  }

  const inFrame = KEY_LANDMARKS.every((i) => {
    const point = landmarks[i];
    return point.x > 0.02 && point.x < 0.98 && point.y > 0.02 && point.y < 0.98;
  });
  if (!inFrame) {
    warnings.push('Part of your torso sits at the edge of the frame. Step back so hips and shoulders are both well inside the photo.');
  }

  /* Bending forward points the trunk away from the camera, so the shoulder-to-hip
     distance in the image shrinks against shoulder width. Shoulders stay higher in
     the frame than hips either way — that ordering only inverts if the camera is
     below the trunk or the photo is rotated, which is worth its own note. */
  const shoulderMid = midpoint(toPixels(landmarks[POSE.LEFT_SHOULDER], frame), toPixels(landmarks[POSE.RIGHT_SHOULDER], frame));
  const hipMid = midpoint(toPixels(landmarks[POSE.LEFT_HIP], frame), toPixels(landmarks[POSE.RIGHT_HIP], frame));
  const shoulderWidth = distance2d(toPixels(landmarks[POSE.LEFT_SHOULDER], frame), toPixels(landmarks[POSE.RIGHT_SHOULDER], frame));

  const torsoRatio = distance2d(shoulderMid, hipMid) / Math.max(shoulderWidth, 1);
  const shouldersAboveHips = shoulderMid.y < hipMid.y;

  if (!shouldersAboveHips) {
    warnings.push('Your hips came out higher in the frame than your shoulders. That usually means the phone was below waist height or the photo is rotated. Hold it at about chest height, angled down at your back.');
  } else if (torsoRatio > POSE_CHECK.standingTorsoRatio) {
    warnings.push('Your back looks close to upright rather than bent forward. Bending at the waist until your back is flat is what makes trunk asymmetry visible, so the reading means more from that position.');
  }

  /* A phone rolled sideways tilts shoulders and hips together by the same amount. */
  const { shoulders, hips } = measurements;
  const sameDirection = shoulders.higherSide === hips.higherSide && shoulders.higherSide !== 'level';
  const similarTilt = Math.abs(shoulders.tiltDeg - hips.tiltDeg) < 1.5;
  if (sameDirection && similarTilt && shoulders.tiltDeg > 4) {
    warnings.push('Shoulders and hips are tilted by almost the same amount, which usually means the camera was held at an angle rather than that the body is uneven.');
  }

  return {
    landmarkConfidence: weakest,
    torsoRatio,
    posture: !shouldersAboveHips ? 'inverted?'
      : torsoRatio <= POSE_CHECK.bentTorsoRatio ? 'bent forward'
      : torsoRatio > POSE_CHECK.standingTorsoRatio ? 'upright?' : 'partly bent',
    warnings,
    usable: weakest >= 0.35 && inFrame,
  };
}

/**
 * Bands a consensus reading (see lib/consensus.js). Shoulder tilt carries the
 * decision because it was the only measure that survived the framing-stability
 * benchmark. Hip tilt is context and a camera-angle check, not a trigger — in the
 * benchmark it did not separate the two groups at all.
 */
export function classifyReading(reading) {
  if (!reading.usable) return unusable(reading);

  const tilt = reading.shoulderTiltDeg;
  const precision = `±${reading.shoulderSpreadDeg.toFixed(1)}° across ${reading.passes} framings`;

  if (tilt >= THRESHOLDS.shoulderReferDeg) {
    return {
      level: 'refer',
      kicker: `Shoulder tilt ${tilt.toFixed(1)}° · ${precision}`,
      headline: 'Enough asymmetry to be worth a professional look',
      body: `Your shoulders measured about ${tilt.toFixed(1)}° off level, with ${sideLabel(reading.higherShoulder)} higher. In the small set of clinical photos this app is calibrated against, readings this size came from people with a confirmed curve. That is not a diagnosis — it means a physical exam, which can check the things a photo cannot, is a reasonable next step.`,
    };
  }

  if (tilt >= THRESHOLDS.shoulderMonitorDeg) {
    return {
      level: 'monitor',
      kicker: `Shoulder tilt ${tilt.toFixed(1)}° · ${precision}`,
      headline: 'Mild asymmetry — worth tracking rather than acting on',
      body: 'Small shoulder differences are common and this size of reading overlaps between people with and without a curve. A single measurement cannot separate the two. Rescan every couple of months and watch whether the number moves — a trend says far more than one photo.',
    };
  }

  return {
    level: 'clear',
    kicker: `Shoulder tilt ${tilt.toFixed(1)}° · ${precision}`,
    headline: 'No significant asymmetry detected',
    body: "Your shoulders and hips measured close to level in this photo. That is reassuring but not proof: a curve can be present with very little visible asymmetry, and this app only sees the surface. Keep the usual check-ups, and rescan if anything looks or feels different.",
  };
}

function unusable(reading) {
  if (reading.reason === 'no-pose') {
    return {
      level: 'unclear',
      kicker: `No body found in ${reading.totalFramings} attempts`,
      headline: "This photo couldn't be measured",
      body: 'The pose model needs to see your whole body, with space around it. Step back so your head, torso, and legs are all in frame with a margin, use even light, and avoid a busy background.',
    };
  }
  return {
    level: 'unclear',
    kicker: `Readings disagreed by ${reading.shoulderSpreadDeg?.toFixed(1) ?? '—'}°`,
    headline: 'This photo gave an unstable reading',
    body: 'SpineCheck measures each photo at several slightly different framings and only reports a number when they agree. This one did not, which usually means blurred edges, an awkward angle, or clothing hiding the shoulder line. Retake it and the numbers should settle.',
  };
}

export function nextSteps(level) {
  if (level === 'refer') {
    return [
      'Book with a pediatrician, family doctor, or orthopedist. Bring this reading and the photo.',
      'Ask for the forward bend test with a scoliometer — that instrument measures the trunk rotation a photo cannot.',
      'If a curve is found, ask about growth remaining, since that drives whether bracing is an option.',
      'Rescan here monthly so you arrive with a trend rather than a single number.',
    ];
  }
  if (level === 'monitor') {
    return [
      'Rescan in 2–3 months, same lighting and same camera height, so the readings are comparable.',
      'Mention it at your next routine check-up — no need to book a special visit for this alone.',
      'Go sooner if you notice back pain at night, numbness or weakness, or a visible change in shape.',
    ];
  }
  if (level === 'unclear') {
    return [
      'Retake with your whole body in frame and a margin around it — the model needs to see head to feet.',
      'Even light, plain background, fitted clothing or bare back.',
      'Have someone hold the phone level rather than propping it up.',
    ];
  }
  return [
    'Rescan every 6 months during the teenage growth years — a single reading says less than a trend.',
    'Keep normal check-ups; scoliosis screening is a routine part of them.',
    'Come back sooner if a shoulder, shoulder blade, or waistline starts looking uneven in the mirror.',
  ];
}
