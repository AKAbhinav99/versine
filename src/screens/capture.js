/* Guided capture: live preview, framing guide, self-timer, and photo upload.
 * Designed for one hand, the shutter is thumb-sized and centred, and the timer
 * exists because you cannot tap a phone while bent over with arms hanging. */

import { $ } from '../lib/dom.js';
import { onEnter, onLeave } from '../router.js';
import { listScans } from '../lib/storage.js';
import { openAdjust } from './adjust.js';
import { bindPoseSwitch } from '../lib/poseswitch.js';

/* Getting into a forward bend and settling takes longer than a snapshot timer
   usually allows, so the choices run past the usual 3 and 10 seconds. Off is for
   when someone else is holding the phone. */
const TIMER_OPTIONS = [0, 3, 5, 10, 15, 20];
const TIMER_STORAGE = 'versine.timerSeconds';
const DEFAULT_TIMER_SECONDS = 10;
const CUE_FROM = 3;             // start the audible countdown this many seconds out
const MAX_ANALYSIS_EDGE = 1440; // downscale huge uploads before pose detection
const GHOST_STORAGE = 'versine.ghost';
const GUIDE_STORAGE = 'versine.guide';

/* A scan is a short burst rather than one frame. Three frames roughly a second
   apart is enough to see whether the person is holding still, and short enough
   that nobody has to hold a forward bend for it. */
const BURST_FRAMES = 3;
const BURST_GAP_MS = 900;

let stream = null;
let timerSeconds = DEFAULT_TIMER_SECONDS;
let countdown = null;
let facingMode = 'environment';   // the back camera is the one pointed at a back
let switching = false;
let ghostOn = true;

const video = () => $('#capture-video');

export function initCapture() {
  restoreTimerChoice();
  $('#capture-shutter').addEventListener('click', onShutter);
  $('#capture-timer-toggle').addEventListener('click', cycleTimer);
  $('#capture-flip').addEventListener('click', flipCamera);
  $('#capture-ghost-toggle').addEventListener('click', toggleGhost);
  $('#capture-upload-btn').addEventListener('click', () => $('#capture-file').click());
  $('#capture-file').addEventListener('change', onFileChosen);
  $('#capture-guide-toggle').addEventListener('click', toggleGuide);
  restoreGuide();
  const poses = $('.capture__poses');
  if (poses) bindPoseSwitch(poses, (pose) => { $('.capture__stage').dataset.pose = pose; });

  onEnter('capture', () => { refreshGhost(); startCamera(); });
  onLeave('capture', stopCamera);
}

/* ----------------------------------------------------------------- ghost --- */

/* Re-scanning from a different spot is the largest error in this whole app: the
 * spread across framings is exactly what the reliability gate withholds readings
 * for, and framing is the part the person holding the phone controls. So the last
 * scan is drawn faintly over the viewfinder to stand in the same place again.
 *
 * It is a framing aid and nothing more. It never touches the captured pixels,
 * matching a previous photo cannot make a curve look better or worse, only make
 * two readings comparable. */

function restoreGhostChoice() {
  const stored = localStorage.getItem(GHOST_STORAGE);
  ghostOn = stored === null ? true : stored === 'on';
}

/** The most recent scan that actually kept a thumbnail. */
const lastThumbnail = () => listScans().find((scan) => scan.thumbnail) || null;

function refreshGhost() {
  restoreGhostChoice();

  const previous = lastThumbnail();
  const button = $('#capture-ghost-toggle');
  const image = $('#capture-ghost');

  /* Nothing to match against on a first scan, the control would be a dead end. */
  button.classList.toggle('hidden', !previous);
  if (!previous) {
    image.classList.add('hidden');
    image.removeAttribute('src');
    resetHint();
    return;
  }

  if (image.getAttribute('src') !== previous.thumbnail) image.src = previous.thumbnail;
  applyGhostState();
}

function applyGhostState() {
  const image = $('#capture-ghost');
  const button = $('#capture-ghost-toggle');

  image.classList.toggle('hidden', !ghostOn);
  /* The preview mirrors for the front camera but the captured frame does not, so
     an unmirrored thumbnail over a mirrored preview would be reversed. */
  image.dataset.facing = actualFacing();
  $('.capture__stage').dataset.ghost = ghostOn ? 'on' : 'off';

  button.setAttribute('aria-pressed', String(ghostOn));
  button.title = ghostOn
    ? 'Your last scan is shown faintly. Tap to hide it.'
    : 'Show your last scan faintly, to line this one up with it.';
  $('#capture-ghost-label').textContent = ghostOn ? 'Ghost on' : 'Ghost';

  if (ghostOn) {
    setHint('<b>Stand where the faint outline stands.</b> Same spot, same phone height.');
  } else {
    resetHint();
  }
}

function toggleGhost() {
  ghostOn = !ghostOn;
  try { localStorage.setItem(GHOST_STORAGE, ghostOn ? 'on' : 'off'); } catch { /* not persisted */ }
  applyGhostState();
}

/* ---------------------------------------------------------------- guide --- */

/* The framing figure can be put away for anyone who would rather see the
   whole live image; the choice is kept, like the ghost's. */
function restoreGuide() {
  let stored = null;
  try { stored = localStorage.getItem(GUIDE_STORAGE); } catch { /* storage blocked */ }
  setGuide(stored !== 'off');
}

function setGuide(on) {
  $('.capture__stage').dataset.guide = on ? 'on' : 'off';
  const button = $('#capture-guide-toggle');
  button.setAttribute('aria-pressed', String(on));
}

function toggleGuide() {
  const on = $('.capture__stage').dataset.guide === 'off';
  setGuide(on);
  try { localStorage.setItem(GUIDE_STORAGE, on ? 'on' : 'off'); } catch { /* not persisted */ }
}

/* ---------------------------------------------------------------- camera --- */

/* Camera start, made to survive the ways it fails in practice. Each one used
   to read as "no camera" and leave the shutter opening the file picker, which
   looked like the camera request had simply been ignored:
   - another app holding the camera (NotReadableError);
   - a webcam refusing the requested size or facing (OverconstrainedError, and
     some desktop drivers throw NotReadableError for this too), so any failure
     that is not a refusal is retried once with no constraints at all;
   - a page opened over a LAN address, which is not a secure context, so the
     browser hides navigator.mediaDevices entirely;
   - autoplay held back (Safari in low power mode), where the stream is fine and
     only play() was refused, so the stream is kept and the next tap plays it.
   A request still pending when the screen is left is dropped on arrival, so a
   late permission grant never leaves the light on behind another screen. */
let starting = null;
let generation = 0;

function startCamera() {
  if (stream) return Promise.resolve();
  if (starting) return starting;
  showError(null);
  const mine = ++generation;
  starting = (async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      showError(window.isSecureContext
        ? 'This browser cannot open a camera. Use Upload to analyse a photo instead.'
        : 'The camera only works over a secure connection. Open this page over https (or on localhost), or use Upload.', true);
      return;
    }
    let opened = null;
    try {
      opened = await openStream(facingMode);
    } catch (error) {
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
        if (mine === generation) showError(cameraMessage(error), true);
        return;
      }
      try {
        opened = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (retryError) {
        if (mine === generation) showError(cameraMessage(retryError), true);
        return;
      }
    }
    if (mine !== generation) { opened.getTracks().forEach((track) => track.stop()); return; }
    stream = opened;
    await showStream();
    await updateFlipAvailability();
  })().finally(() => { starting = null; });
  return starting;
}

function cameraMessage(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access is blocked for this page. Allow it from the camera icon in the address bar, then try again, or use Upload.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is busy, probably open in another app or tab. Close it there, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device. Use Upload to analyse a photo taken on another one.';
    default:
      return 'The camera would not start. Try again, or use Upload.';
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
  try {
    await element.play();
  } catch {
    /* The stream is good; only autoplay was refused. The next tap plays it. */
    setHint('<b>Tap the shutter once</b> to start the preview.');
  }
  if (!$('#capture-ghost').classList.contains('hidden')) applyGhostState();
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

  /* The old track has to be released first, many devices refuse to open the
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
  generation += 1;   // a request still in flight is dropped when it lands
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
  stream = null;
  video().srcObject = null;
}

/* ---------------------------------------------------------------- shutter --- */

/* ------------------------------------------------------------------ timer --- */

function restoreTimerChoice() {
  /* Not Number(getItem(...)), that turns a missing key into 0, which is itself a
     valid choice, so the default would never have applied. */
  const stored = localStorage.getItem(TIMER_STORAGE);
  const saved = stored === null ? NaN : Number(stored);
  timerSeconds = TIMER_OPTIONS.includes(saved) ? saved : DEFAULT_TIMER_SECONDS;
  renderTimerButton();
}

/** Tapping cycles the delay, one control, no menu to open one-handed. */
function cycleTimer() {
  cancelCountdown();
  const next = (TIMER_OPTIONS.indexOf(timerSeconds) + 1) % TIMER_OPTIONS.length;
  timerSeconds = TIMER_OPTIONS[next];
  try { localStorage.setItem(TIMER_STORAGE, String(timerSeconds)); } catch { /* not persisted */ }
  renderTimerButton();
}

function renderTimerButton() {
  const button = $('#capture-timer-toggle');
  button.setAttribute('aria-pressed', String(timerSeconds > 0));
  button.textContent = timerSeconds > 0 ? `Timer ${timerSeconds}s` : 'Timer off';
  button.title = timerSeconds > 0
    ? `${timerSeconds} second delay. Tap to change.`
    : 'Shutter fires immediately. Tap to add a delay.';
}

/* You are bent over with your back to the phone when this fires, so the count
   has to be audible. Vibration where it exists, a short tone where it does not,
   iOS supports one and not the other. */
let audio = null;

function cue(kind) {
  const isCapture = kind === 'capture';
  if (navigator.vibrate) navigator.vibrate(isCapture ? 240 : 40);
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    audio = audio || new Ctor();
    const now = audio.currentTime;
    const length = isCapture ? 0.34 : 0.09;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = isCapture ? 880 : 620;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + length + 0.02);
  } catch { /* no audio available; the vibration and the on-screen count remain */ }
}

function onShutter() {
  if (countdown) { cancelCountdown(); return; }
  /* No stream yet: ask for the camera again rather than opening the file
     picker, which read as the camera request being ignored. Upload has its own
     button. */
  if (!stream) { startCamera(); return; }
  if (video().paused) { video().play().then(resetHint).catch(() => {}); return; }
  if (timerSeconds > 0) startCountdown(); else captureFrame();
}

function startCountdown() {
  let remaining = timerSeconds;
  const readout = $('#capture-timer');
  const shutter = $('#capture-shutter');

  shutter.dataset.armed = 'true';
  readout.classList.remove('hidden');
  readout.textContent = String(remaining);
  setHint('Get into position: <b>bend forward, arms hanging</b>. Tap again to cancel.');

  countdown = setInterval(() => {
    remaining -= 1;
    readout.textContent = String(Math.max(remaining, 0));
    if (remaining > 0 && remaining <= CUE_FROM) cue('tick');
    if (remaining <= 0) { cue('capture'); cancelCountdown(); captureFrame(); }
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

/** One frame off the live track, at its native resolution. */
function grabFrame(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.videoWidth;
  canvas.height = source.videoHeight;
  canvas.getContext('2d').drawImage(source, 0, 0);
  return canvas;
}

async function captureFrame() {
  const source = video();
  if (!source.videoWidth) { showError('The camera has not started yet. Give it a second and try again.'); return; }

  const frames = [grabFrame(source)];
  setHint('<b>Hold still</b> while it takes a few frames.');

  /* The gaps are what make the burst worth taking: three frames of the same
     instant would only re-measure the same posture. */
  for (let i = 1; i < BURST_FRAMES; i += 1) {
    await wait(BURST_GAP_MS);
    /* Someone can stand up, or the track can drop, between frames. Whatever was
       collected before that still measures. */
    if (!stream || !source.videoWidth) break;
    frames.push(grabFrame(source));
    cue('tick');
  }

  stopCamera();
  resetHint();
  openAdjust(frames);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function onFileChosen(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    stopCamera();
    /* An uploaded photograph is a burst of one. Sway is unknown for it, and the
       reading says so rather than assuming none. */
    openAdjust([canvasFromImage(image)]);
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

function showError(message, retry = false) {
  const box = $('#capture-error');
  box.classList.toggle('hidden', !message);
  box.replaceChildren();
  if (!message) return;
  box.append(message);
  if (retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--quiet capture__retry';
    button.textContent = 'Try camera again';
    button.addEventListener('click', () => startCamera());
    box.append(button);
  }
}

function setHint(html) { $('#capture-hint').innerHTML = html; }
function resetHint() {
  setHint(ghostOn && !$('#capture-ghost').classList.contains('hidden')
    ? '<b>Stand where the faint outline stands.</b> Same spot, same phone height.'
    : '<b>Bend forward at the waist</b> · arms hanging · shoulders on the upper mark, hips on the lower');
}
