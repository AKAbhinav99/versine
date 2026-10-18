/* MediaPipe Pose (BlazePose) wrapper.
 * The model files load from a CDN on first use and are then cached by the browser,
 * so the first scan of a session takes a few seconds and later ones are instant.
 * The iOS app loads them from its own bundle instead (POSE_MODEL in config.js). */

import { POSE_MODEL } from '../config.js';

let landmarkerPromise = null;

/** Loads the tasks-vision bundle and the pose landmarker once per page load. */
export function loadPoseLandmarker() {
  if (landmarkerPromise) return landmarkerPromise;

  landmarkerPromise = (async () => {
    const { FilesetResolver, PoseLandmarker } = await import(
      /* @vite-ignore */ POSE_MODEL.visionBundle
    );
    const fileset = await FilesetResolver.forVisionTasks(POSE_MODEL.wasmRoot);
    const create = (delegate) => PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: POSE_MODEL.asset, delegate },
      runningMode: 'IMAGE',
      numPoses: 1,
      minPoseDetectionConfidence: 0.4,
      minPosePresenceConfidence: 0.4,
      outputSegmentationMasks: false,
    });
    /* The GPU delegate needs WebGL2 that MediaPipe accepts, which some phones
       and locked-down browsers do not give it. The CPU path is slower but
       runs anywhere WebAssembly does. */
    try {
      return await create('GPU');
    } catch (error) {
      console.warn('[Versine] GPU pose model unavailable, using CPU', error);
      return create('CPU');
    }
  })().catch((error) => {
    landmarkerPromise = null; // let a later attempt retry a transient CDN failure
    throw error;
  });

  return landmarkerPromise;
}

/**
 * Detects a single pose in a still image.
 * @param {HTMLImageElement|HTMLCanvasElement} source
 * @returns {Promise<{landmarks: object[], worldLandmarks: object[]}>}
 */
export async function detectPose(source) {
  const landmarker = await loadPoseLandmarker();
  const result = landmarker.detect(source);

  if (!result.landmarks?.length || !result.worldLandmarks?.length) {
    const error = new Error('NO_POSE');
    error.code = 'NO_POSE';
    throw error;
  }
  return { landmarks: result.landmarks[0], worldLandmarks: result.worldLandmarks[0] };
}
