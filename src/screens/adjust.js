/* Line the photo up with the framing guide before measuring.
 *
 * Pan and zoom are free, neither changes an angle. Rotation is not: turning the
 * photo turns the measured shoulder tilt with it, one degree for one degree. So
 * rotation is capped at a plausible camera roll, is displayed the whole time it
 * is applied, is carried into the scan record, and is shown again on the result.
 * The screen tells you to level the room rather than your body, and draws
 * horizontal rules across the frame to line the room up against. */

import { $ } from '../lib/dom.js';
import { showScreen, onEnter } from '../router.js';

const MAX_ROTATION_DEG = 20;

const identity = () => ({ rotationDeg: 0, scale: 1, offsetX: 0, offsetY: 0 });

/* The burst being adjusted. frames[0] is what the screen draws and what the
   controls act on; the transform applies to all of them, because it corrects the
   camera and the camera did not move between frames a second apart. */
let frames = [];
let photo = null;
let transform = identity();
let dragging = null;

export function initAdjust() {
  $('#adjust-rotate').addEventListener('input', onRotate);
  $('#adjust-zoom').addEventListener('input', onZoom);
  $('#adjust-reset').addEventListener('click', reset);
  $('#adjust-retake').addEventListener('click', () => showScreen('capture'));
  $('#adjust-accept').addEventListener('click', accept);

  const canvas = $('#adjust-canvas');
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  onEnter('adjust', () => { draw(); });
}

/**
 * Entry point from capture.
 * @param {HTMLCanvasElement[]} burst one or more frames of the same scan
 */
export function openAdjust(burst) {
  frames = Array.isArray(burst) ? burst : [burst];
  photo = frames[0];
  transform = identity();
  showAcceptError(null);
  syncControls();
  cloneGuide();
  showScreen('adjust');
}

/* The framing guide is defined once, in the capture viewfinder. Clone it rather
   than keeping a second copy that could drift out of step. */
function cloneGuide() {
  const source = document.querySelector('.capture__guide');
  const host = $('#adjust-guide');
  host.replaceChildren();
  if (!source) return;
  const copy = source.cloneNode(true);
  /* The silhouette filter needs an id of its own here: a reference to the
     capture screen's copy would resolve into a hidden screen. */
  copy.querySelector('#guide-silhouette')?.setAttribute('id', 'guide-silhouette-adjust');
  copy.querySelector('.guide-figure')?.setAttribute('filter', 'url(#guide-silhouette-adjust)');
  host.append(copy);
}

/* ----------------------------------------------------------------- draw --- */

/** Renders the current transform, fitted so the controls below stay reachable. */
function draw() {
  if (!photo) return;
  const canvas = $('#adjust-canvas');
  const stage = $('#adjust-stage');

  const maxWidth = stage.clientWidth || 360;
  /* On a wide screen the photo has a column of its own beside the controls, so
     it can take most of the window height rather than a third of it. */
  const share = window.matchMedia('(min-width: 960px)').matches ? 0.72 : 0.36;
  const maxHeight = Math.round(window.innerHeight * share);
  const aspect = photo.height / photo.width;

  let width = maxWidth;
  let height = Math.round(width * aspect);
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height / aspect);
  }

  canvas.width = width;
  canvas.height = height;
  paint(canvas, width / photo.width);
}

/** Draws the previewed frame under the current transform. */
const paint = (canvas, unit) => paintSource(photo, canvas, unit);

/** Draws any frame of the burst under the current transform. `unit` scales
 *  source px to canvas px. */
function paintSource(source, canvas, unit) {
  const ctx = canvas.getContext('2d');
  /* Stays dark despite the light UI: this also paints the frames the pose model
     measures, and the benchmark was run with this fill in uncovered corners. */
  ctx.fillStyle = '#0B1622';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(canvas.width / 2 + transform.offsetX * unit, canvas.height / 2 + transform.offsetY * unit);
  ctx.rotate((transform.rotationDeg * Math.PI) / 180);
  ctx.scale(transform.scale * unit, transform.scale * unit);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  ctx.restore();
}

/* -------------------------------------------------------------- controls --- */

function onRotate(event) {
  transform.rotationDeg = clamp(Number(event.target.value), -MAX_ROTATION_DEG, MAX_ROTATION_DEG);
  syncReadouts();
  draw();
}

function onZoom(event) {
  transform.scale = Number(event.target.value) / 100;
  syncReadouts();
  draw();
}

function reset() {
  transform = identity();
  syncControls();
  draw();
}

function syncControls() {
  $('#adjust-rotate').value = String(transform.rotationDeg);
  $('#adjust-zoom').value = String(Math.round(transform.scale * 100));
  syncReadouts();
}

function syncReadouts() {
  $('#adjust-rotate-out').textContent = `${transform.rotationDeg.toFixed(1)}°`;
  $('#adjust-zoom-out').textContent = `${transform.scale.toFixed(2)}×`;
  /* Any rotation at all is worth flagging, since it moves the reading. */
  $('#adjust-warn').classList.toggle('adjust__warn--active', transform.rotationDeg !== 0);
}

/* ------------------------------------------------------------------ pan --- */

function onPointerDown(event) {
  dragging = { x: event.clientX, y: event.clientY, startX: transform.offsetX, startY: transform.offsetY };
  event.target.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (!dragging) return;
  const unit = $('#adjust-canvas').width / photo.width;
  transform.offsetX = dragging.startX + (event.clientX - dragging.x) / unit;
  transform.offsetY = dragging.startY + (event.clientY - dragging.y) / unit;
  draw();
}

function onPointerUp(event) {
  dragging = null;
  if (event.target.hasPointerCapture?.(event.pointerId)) {
    event.target.releasePointerCapture(event.pointerId);
  }
}

/* --------------------------------------------------------------- accept --- */

/** Bake the transform into every frame at full resolution, and measure those.
 *  The analysis cluster, pose model wrapper, consensus, result, report, is
 *  imported here rather than at load, since none of it is needed to show a
 *  viewfinder. main.js warms it on idle so this await is normally already done. */
async function accept() {
  const button = $('#adjust-accept');
  showAcceptError(null);
  button.disabled = true;

  try {
    const baked = frames.map((frame) => {
      const output = document.createElement('canvas');
      output.width = frame.width;
      output.height = frame.height;
      paintSource(frame, output, 1);
      return output;
    });

    const { runAnalysis } = await import('./analyze.js');
    runAnalysis(baked, { rotationDeg: transform.rotationDeg, scale: transform.scale });
  } catch {
    /* Without this the tap did nothing at all, no navigation, no message, and a
       photo the person had just posed for apparently thrown away. */
    showAcceptError('The measuring code could not be loaded, so this photo has not been analysed yet. Your photo is still here. Check your connection and tap again.');
  } finally {
    button.disabled = false;
  }
}

function showAcceptError(message) {
  const box = $('#adjust-error');
  box.classList.toggle('hidden', !message);
  if (message) box.textContent = message;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
