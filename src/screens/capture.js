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

const video = () => $('#capture-video');

export function initCapture() {
  $('#capture-shutter').addEventListener('click', onShutter);
  $('#capture-timer-toggle').addEventListener('click', toggleTimer);
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
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1706 } },
      audio: false,
    });
    video().srcObject = stream;
    await video().play();
  } catch (error) {
    stream = null;
    showError(
      error?.name === 'NotAllowedError'
        ? 'Camera access is blocked. Allow it in your browser settings, or use Upload to analyse a photo someone else took.'
        : 'No camera available here. Use Upload to analyse a photo taken on another device.',
    );
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
