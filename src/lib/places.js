/* Clinician lookup against live places data.
 *
 * Primary provider is the Google Places API (New) text search, which needs a key.
 * Without one, the app queries OpenStreetMap via Overpass — real, current data,
 * no key, but sparser and without ratings. Both return the same normalized shape
 * so the UI never has to care which one answered. */

import { PLACES } from '../config.js';

const EARTH_RADIUS_M = 6371000;

export function getApiKey() {
  return localStorage.getItem(PLACES.keyStorage) || PLACES.googleApiKey || '';
}

export function setApiKey(key) {
  if (key) localStorage.setItem(PLACES.keyStorage, key.trim());
  else localStorage.removeItem(PLACES.keyStorage);
}

export function haversineMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** fetch with a hard deadline — no network call may leave the UI spinning. */
async function fetchWithTimeout(url, options = {}, ms = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The lookup took too long. Try a smaller radius.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function currentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not available in this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) => reject(new Error(geolocationMessage(error))),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000, ...options },
    );
  });
}

function geolocationMessage(error) {
  if (error.code === 1) return 'Location permission was denied. Type a ZIP code or city instead.';
  if (error.code === 2) return "Couldn't determine your position. Type a ZIP code or city instead.";
  return 'Location lookup timed out. Type a ZIP code or city instead.';
}

/** Free-text place lookup via OpenStreetMap Nominatim (no key required). */
export async function geocode(query) {
  const url = `${PLACES.nominatimUrl}?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 12000);
  if (!response.ok) throw new Error('Location lookup failed. Try a different spelling.');
  const [match] = await response.json();
  if (!match) throw new Error(`No place found for "${query}".`);
  return { lat: Number(match.lat), lng: Number(match.lon), label: match.display_name };
}

/* ---------------------------------------------------------------- Google --- */

async function searchGoogle(center, radiusM, key) {
  const requests = PLACES.queries.map(async ({ text, spec }) => {
    const response = await fetchWithTimeout(PLACES.textSearchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': [
          'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
          'places.rating', 'places.userRatingCount', 'places.nationalPhoneNumber',
          'places.types', 'places.googleMapsUri', 'places.currentOpeningHours.openNow',
        ].join(','),
      },
      body: JSON.stringify({
        textQuery: text,
        maxResultCount: 20,
        locationBias: {
          circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(radiusM, 50000) },
        },
      }),
    }, 15000);

    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      const error = new Error(detail?.error?.message || `Places request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }

    const data = await response.json();
    return (data.places || []).map((place) => normalizeGoogle(place, spec, center));
  });

  const settled = await Promise.allSettled(requests);
  const failure = settled.find((entry) => entry.status === 'rejected');
  const results = settled.filter((entry) => entry.status === 'fulfilled').flatMap((entry) => entry.value);
  if (!results.length && failure) throw failure.reason;
  return dedupe(results);
}

function normalizeGoogle(place, spec, center) {
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  return {
    id: place.id,
    name: place.displayName?.text || 'Unnamed practice',
    address: place.formattedAddress || '',
    lat, lng,
    distanceM: lat && lng ? haversineMeters(center, { lat, lng }) : null,
    rating: place.rating ?? null,
    reviewCount: place.userRatingCount ?? null,
    phone: place.nationalPhoneNumber || null,
    openNow: place.currentOpeningHours?.openNow ?? null,
    specialty: spec,
    tags: buildTags(place.types || [], spec),
    directionsUrl: place.googleMapsUri || directionsFor(lat, lng),
    source: 'google',
  };
}

/* ------------------------------------------------------------ OpenStreetMap --- */

/* Keep every clause a plain indexed tag lookup. Regex or name matching inside the
   query makes Overpass scan the whole radius and blow past its own timeout, so the
   relevance filtering happens below in JS instead. */
const overpassQuery = (center, radiusM) => {
  const near = `(around:${radiusM},${center.lat},${center.lng})`;
  return `[out:json][timeout:25];
(
  nwr["healthcare"="physiotherapist"]${near};
  nwr["healthcare"="doctor"]${near};
  nwr["amenity"="doctors"]${near};
);
out center 200;`;
};

const RELEVANT = /ortho|spine|spinal|scolio|physical therapy|physiotherap|sports medicine|rehab/i;

/** Does this OSM feature plausibly treat scoliosis? */
function isRelevant(tags) {
  if (!tags.name) return false;
  if (tags.healthcare === 'physiotherapist') return true;
  return RELEVANT.test(tags['healthcare:speciality'] || '') || RELEVANT.test(tags.name);
}

async function searchOverpass(center, radiusM) {
  const response = await fetchWithTimeout(PLACES.overpassUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(overpassQuery(center, Math.min(radiusM, 50000)))}`,
  }, 30000);

  if (response.status === 429 || response.status === 504) {
    throw new Error("OpenStreetMap's free lookup service is busy right now. Wait a moment and try again, or add a Google Places key below for faster results.");
  }
  if (!response.ok) throw new Error(`OpenStreetMap lookup failed (${response.status}).`);

  const data = await response.json();
  if (data.remark && /timed out|error/i.test(data.remark)) {
    throw new Error('The OpenStreetMap query timed out. Try a smaller radius.');
  }

  return dedupe(
    (data.elements || [])
      .filter((element) => isRelevant(element.tags || {}))
      .map((element) => normalizeOverpass(element, center))
      .filter(Boolean),
  );
}

function normalizeOverpass(element, center) {
  const tags = element.tags || {};
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (!lat || !lng) return null;

  const haystack = `${tags.name} ${tags['healthcare:speciality'] || ''} ${tags.healthcare || ''}`.toLowerCase();
  const specialty = /physio|physical therapy|therapist|rehab/.test(haystack) ? 'pt'
    : /p(a)?ediatric|child|kids/.test(haystack) ? 'pediatric'
    : 'ortho';

  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const address = [street, tags['addr:city'], tags['addr:postcode']].filter(Boolean).join(', ');

  return {
    id: `osm-${element.type}-${element.id}`,
    name: tags.name,
    address,
    lat, lng,
    distanceM: haversineMeters(center, { lat, lng }),
    rating: null,
    reviewCount: null,
    phone: tags.phone || tags['contact:phone'] || null,
    openNow: null,
    specialty,
    tags: buildTags([tags['healthcare:speciality']].filter(Boolean), specialty),
    directionsUrl: directionsFor(lat, lng),
    website: tags.website || tags['contact:website'] || null,
    source: 'osm',
  };
}

/* ------------------------------------------------------------------ Shared --- */

const SPECIALTY_LABEL = { ortho: 'Orthopedics', pediatric: 'Pediatric ortho', pt: 'Physical therapy' };

function buildTags(rawTypes, spec) {
  const label = SPECIALTY_LABEL[spec];
  const extras = rawTypes
    .filter((type) => !['point_of_interest', 'establishment', 'health', 'yes'].includes(type))
    .slice(0, 2)
    .map((type) => String(type).replace(/[_;]/g, ' '));
  return [label, ...extras].filter(Boolean);
}

const directionsFor = (lat, lng) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

function dedupe(results) {
  const seen = new Map();
  for (const item of results) {
    const key = `${item.name.toLowerCase()}|${Math.round((item.lat || 0) * 1e4)}`;
    if (!seen.has(key)) seen.set(key, item);
  }
  return Array.from(seen.values());
}

/**
 * Finds clinicians around a point. Falls back from Google to OpenStreetMap on a
 * missing key or a failed request, and reports which provider actually answered.
 * @returns {Promise<{results: object[], provider: 'google'|'osm', notice: string|null}>}
 */
export async function findClinicians(center, radiusM = PLACES.defaultRadiusM) {
  const key = getApiKey();

  if (key) {
    try {
      const results = await searchGoogle(center, radiusM, key);
      return { results: sortByDistance(results), provider: 'google', notice: null };
    } catch (error) {
      const results = await searchOverpass(center, radiusM);
      return {
        results: sortByDistance(results),
        provider: 'osm',
        notice: `Google Places rejected the request (${error.message}) — showing OpenStreetMap results instead.`,
      };
    }
  }

  const results = await searchOverpass(center, radiusM);
  return { results: sortByDistance(results), provider: 'osm', notice: null };
}

const sortByDistance = (results) =>
  results.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
