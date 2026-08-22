/* Guided capture: live preview, framing guide, self-timer, and photo upload.
 * Designed for one hand — the shutter is thumb-sized and centred, and the timer
 * exists because you cannot tap a phone while bent over with arms hanging. */

import { $ } from '../lib/dom.js';
import { onEnter, onLeave } from '../router.js';
import { runAnalysis } from './analyze.js';

const TIMER_SECONDS = 8;
const MAX_ANALYSIS_EDGE = 1440; // downscale huge uploads before pose detection

let stream = null;
let timerEnabled = true;
let countdown = null;
let facingMode = 'environment';   // the back camera is the one pointed at a back
let switching = false;

const video = () => $('#capture-video');

export function initCapture() {
  $('#capture-shutter').addEventListener('click', onShutter);
  $('#capture-timer-toggle').addEventListener('click', toggleTimer);
  $('#capture-flip').addEventListener('click', flipCamera);
  $('#capture-upload-btn').addEventListener('click', () => $('#capture-file').click());
  $('#capture-file').addEventListener('change', onFileChosen);

  onEnter('capture', startCamera);
  onLeave('capture', stopCamera);
}

/* ---------------------------------------------------------------- camera --- */

async function startCamera() {
  if (stream) return;
  showError(null);
  try {
    stream = await openStream(facingMode);
    await showStream();
    await updateFlipAvailability();
  } catch (error) {
    stream = null;
    showError(
      error?.name === 'NotAllowedError'
        ? 'Camera access is blocked. Allow it in your browser settings, or use Upload to analyse a photo someone else took.'
        : 'No camera available here. Use Upload to analyse a photo taken on another device.',
    );
  }
}

/** `ideal` rather than `exact` so a device with one camera still opens it. */
const openStream = (facing) => navigator.mediaDevices.getUserMedia({
  video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 1706 } },
  audio: false,
});

async function showStream() {
  const element = video();
  element.srcObject = stream;
  element.dataset.facing = actualFacing();
  await element.play();
}

/** What the granted track actually is, which need not be what was asked for. */
function actualFacing() {
  const settings = stream?.getVideoTracks()[0]?.getSettings?.() || {};
  return settings.facingMode || facingMode;
}

/* ------------------------------------------------------------------ flip --- */

/** Hide the control on hardware with nothing to switch to. */
async function updateFlipAvailability() {
  const button = $('#capture-flip');
  let cameras = 0;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    cameras = devices.filter((device) => device.kind === 'videoinput').length;
  } catch {
    cameras = 0;
  }
  button.classList.toggle('hidden', cameras < 2);
  setFlipLabel();
}

const setFlipLabel = () => {
  $('#capture-flip-label').textContent = actualFacing() === 'user' ? 'Front' : 'Rear';
};

async function flipCamera() {
  if (switching) return;
  switching = true;
  cancelCountdown();

  const previous = facingMode;
  const button = $('#capture-flip');
  button.disabled = true;

  /* The old track has to be released first — many devices refuse to open the
     second camera while the first one is still held. */
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;

  facingMode = previous === 'environment' ? 'user' : 'environment';
  try {
    stream = await openStream(facingMode);
    await showStream();
    setFlipLabel();
    showError(null);
  } catch {
    facingMode = previous;
    try {
      stream = await openStream(facingMode);
      await showStream();
      setFlipLabel();
      showError('That camera would not open, so the previous one is still running.');
    } catch {
      stream = null;
      showError('The camera stopped responding. Reload the page, or use Upload instead.');
    }
  } finally {
    button.disabled = false;
    switching = false;
  }
}

function stopCamera() {
  cancelCountdown();
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
  stream = null;
  video().srcObject = null;
}

/* ---------------------------------------------------------------- shutter --- */

function toggleTimer() {
  timerEnabled = !timerEnabled;
  const button = $('#capture-timer-toggle');
  button.setAttribute('aria-pressed', String(timerEnabled));
  button.textContent = timerEnabled ? `Timer ${TIMER_SECONDS}s` : 'Timer off';
}

function onShutter() {
  if (countdown) { cancelCountdown(); return; }
  if (!stream) { $('#capture-file').click(); return; }
  if (timerEnabled) startCountdown(); else captureFrame();
}

function startCountdown() {
  let remaining = TIMER_SECONDS;
  const readout = $('#capture-timer');
  const shutter = $('#capture-shutter');

  shutter.dataset.armed = 'true';
  readout.classList.remove('hidden');
  readout.textContent = String(remaining);
  setHint('Get into position — <b>bend forward, arms hanging</b>');

  countdown = setInterval(() => {
    remaining -= 1;
    readout.textContent = String(Math.max(remaining, 0));
    if (remaining <= 0) { cancelCountdown(); captureFrame(); }
  }, 1000);
}

function cancelCountdown() {
  if (countdown) clearInterval(countdown);
  countdown = null;
  $('#capture-timer').classList.add('hidden');
  $('#capture-shutter').dataset.armed = 'false';
  resetHint();
}

/* ---------------------------------------------------------------- frames --- */

function captureFrame() {
  const source = video();
  if (!source.videoWidth) { showError('The camera has not started yet. Give it a second and try again.'); return; }

  const canvas = document.createElement('canvas');
  canvas.width = source.videoWidth;
  canvas.height = source.videoHeight;
  canvas.getContext('2d').drawImage(source, 0, 0);
  stopCamera();
  runAnalysis(canvas);
}

function onFileChosen(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    stopCamera();
    runAnalysis(canvasFromImage(image));
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    showError("That file couldn't be read as an image.");
  };
  image.src = url;
  event.target.value = '';
}

function canvasFromImage(image) {
  const scale = Math.min(1, MAX_ANALYSIS_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/* ------------------------------------------------------------------- ui ---- */

function showError(message) {
  const box = $('#capture-error');
  box.classList.toggle('hidden', !message);
  if (message) box.textContent = message;
}

function setHint(html) { $('#capture-hint').innerHTML = html; }
function resetHint() {
  setHint('<b>Bend forward at the waist</b> · arms hanging loose · back to the camera');
}
