/* Scan history, kept in localStorage. Photos never leave the device. */

import { STORAGE_KEY, HISTORY_LIMIT } from '../config.js';

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false; // quota exceeded — the scan still shows, it just isn't logged
  }
}

/** Newest first. */
export function listScans() {
  return readAll().sort((a, b) => b.timestamp - a.timestamp);
}

export function getScan(id) {
  return readAll().find((entry) => entry.id === id) || null;
}

export function saveScan({ reading, verdict, thumbnail, adjustments = null }) {
  const entry = {
    id: `scan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    thumbnail,
    level: verdict.level,
    shoulderTiltDeg: round(reading.shoulderTiltDeg),
    shoulderSpreadDeg: round(reading.shoulderSpreadDeg),
    hipTiltDeg: round(reading.hipTiltDeg),
    higherShoulder: reading.higherShoulder,
    higherHip: reading.higherHip,
    passes: reading.passes,
    /* How many framings were attempted, not just how many agreed. "3 of 5" and
       "5 of 5" are different reliability statements and the referral summary
       prints both halves. Entries saved before this was kept omit it. */
    totalFramings: reading.totalFramings,
    landmarkConfidence: round(reading.landmarkConfidence, 2),
    /* Rotation applied by hand before measuring. Kept because it shifts the
       reading one-for-one, so a trend built from differently-rotated photos is
       not comparing like with like. */
    rotationDeg: adjustments?.rotationDeg ? round(adjustments.rotationDeg) : 0,
  };

  const entries = [entry, ...readAll()].slice(0, HISTORY_LIMIT);
  writeAll(entries);
  return entry;
}

export function deleteScan(id) {
  writeAll(readAll().filter((entry) => entry.id !== id));
}

export function clearScans() {
  writeAll([]);
}

const round = (value, places = 1) => Number(Number(value).toFixed(places));

/** A downscaled JPEG of the analysed frame, small enough to keep dozens of them. */
export function makeThumbnail(source, size = 220) {
  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;
  const scale = size / Math.max(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
}
