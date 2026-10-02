/* A local clinic index, so a search is a filter over data already on the device
 * rather than a question asked of a server that might not answer.
 *
 * Two sources feed it:
 *
 *   bundled, regions built offline by tools/build-clinic-index.mjs and shipped
 *             with the app. Same origin, no key, no rate limit, no failure mode
 *             beyond the page itself failing to load.
 *
 *   learned, every live lookup is folded back in and kept. Search an area once
 *             and it is local from then on, which means the index fills in
 *             wherever it is actually used, without anyone building it.
 *
 * Local results are only offered for areas known to be covered. Otherwise a
 * half-populated corner of the index would suppress the live lookup that would
 * have found the rest. */

import { haversineMeters } from './net.js';

const STORE_KEY = 'versine.clinicIndex.v1';
const MAX_LEARNED = 4000;          // roughly 400 KB of localStorage
const COVERAGE_SLACK = 0.8;        // a remembered area covers this much of its radius

let manifestPromise = null;
const regionCache = new Map();

/* ---------------------------------------------------------------- bundled --- */

/** Reads the shipped manifest once. Absent or malformed is fine, it just means
 *  nothing is bundled yet, and the chain falls through to live lookups. */
export function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch('data/clinics/manifest.json')
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
  }
  return manifestPromise;
}

const inBbox = ({ lat, lng }, [south, west, north, east]) =>
  lat >= south && lat <= north && lng >= west && lng <= east;

async function bundledRegionFor(center) {
  const manifest = await loadManifest();
  return manifest?.regions?.find((region) => inBbox(center, region.bbox)) || null;
}

async function loadRegion(id) {
  if (!regionCache.has(id)) {
    const records = await fetch(`data/clinics/${id}.json`)
      .then((response) => (response.ok ? response.json() : []))
      .catch(() => []);
    regionCache.set(id, records.map((record) => expand(record, `bundled-${id}`)));
  }
  return regionCache.get(id);
}

/* [name, lat, lng, specialty, phone|0, address|0], the compact shipped form. */
function expand([name, lat, lng, specialty, phone, address], idPrefix) {
  return {
    id: `${idPrefix}-${name.toLowerCase().replace(/\W+/g, '')}-${Math.round(lat * 1e4)}`,
    name,
    lat,
    lng,
    specialty,
    phone: phone || null,
    address: address || '',
    rating: null,
    reviewCount: null,
    openNow: null,
    tags: [{ ortho: 'Orthopedics', pediatric: 'Pediatric ortho', pt: 'Physical therapy' }[specialty]].filter(Boolean),
    directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
    source: 'local',
  };
}

const compact = (clinic) => [
  clinic.name.slice(0, 80),
  Number(clinic.lat.toFixed(5)),
  Number(clinic.lng.toFixed(5)),
  clinic.specialty,
  clinic.phone || 0,
  clinic.address || 0,
];

/* ---------------------------------------------------------------- learned --- */

function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.records ? parsed : { records: [], areas: [] };
  } catch {
    return { records: [], areas: [] };
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch { /* quota reached; the index simply stops growing */ }
}

/**
 * Folds a live result set into the local index and records that this area has
 * been covered, so later searches of the same place can be served locally.
 */
export function remember(results, center, radiusM) {
  if (!results.length) return;
  const store = readStore();
  const byKey = new Map(store.records.map((record) => [`${record[0]}|${record[1]}`, record]));

  for (const clinic of results) {
    if (!clinic.lat || !clinic.lng) continue;
    const record = compact(clinic);
    byKey.set(`${record[0]}|${record[1]}`, record);
  }

  const areas = [
    { lat: center.lat, lng: center.lng, r: radiusM, at: Date.now() },
    ...store.areas.filter((area) => haversineMeters(area, center) > radiusM * 0.4),
  ];

  /* Oldest areas go first when the cap is reached, along with nothing else,
     records outside every remaining area simply stop being offered. */
  let records = [...byKey.values()];
  if (records.length > MAX_LEARNED) records = records.slice(-MAX_LEARNED);

  writeStore({ records, areas: areas.slice(0, 60) });
}

function learnedCovers(center, radiusM) {
  return readStore().areas.some((area) =>
    haversineMeters(area, center) + radiusM * COVERAGE_SLACK <= area.r);
}

const learnedRecords = () => readStore().records.map((record) => expand(record, 'learned'));

/* ------------------------------------------------------------------ query --- */

/**
 * Clinics within radius of a point, from local data only.
 * @returns {Promise<object[]|null>} null when this area is not covered locally.
 */
export async function localSearch(center, radiusM) {
  const region = await bundledRegionFor(center);
  const covered = Boolean(region) || learnedCovers(center, radiusM);
  if (!covered) return null;

  const pool = [...(region ? await loadRegion(region.id) : []), ...learnedRecords()];
  const seen = new Map();

  for (const clinic of pool) {
    const distanceM = haversineMeters(center, clinic);
    if (distanceM > radiusM) continue;
    const key = `${clinic.name.toLowerCase()}|${Math.round(clinic.lat * 1e4)}`;
    if (!seen.has(key)) seen.set(key, { ...clinic, distanceM });
  }

  const results = [...seen.values()];
  return results.length ? results : null;
}

/** Everything inside a map viewport, for drawing markers as the map moves. */
export async function localInView(bounds) {
  const centre = { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 };
  const region = await bundledRegionFor(centre);
  const pool = [...(region ? await loadRegion(region.id) : []), ...learnedRecords()];

  return pool.filter((clinic) =>
    clinic.lat >= bounds.south && clinic.lat <= bounds.north
    && clinic.lng >= bounds.west && clinic.lng <= bounds.east);
}

/** What the index currently holds, for the UI to be honest about coverage. */
export async function indexCoverage() {
  const manifest = await loadManifest();
  const store = readStore();
  return {
    builtAt: manifest?.builtAt || null,
    bundledRegions: manifest?.regions?.length || 0,
    bundledClinics: manifest?.total || 0,
    learnedClinics: store.records.length,
    learnedAreas: store.areas.length,
  };
}

export function clearLearned() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* nothing to clear */ }
}
