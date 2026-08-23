/* Clinician lookup against live places data.
 *
 * Primary provider is the Google Places API (New) text search, which needs a key.
 * Without one, the app queries OpenStreetMap via Overpass — real, current data,
 * no key, but sparser and without ratings. Both return the same normalized shape
 * so the UI never has to care which one answered. */

import { PLACES } from '../config.js';
import { looksLikePostalCode } from './countries.js';

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

export async function currentPosition(options = {}) {
  if (!navigator.geolocation) {
    throw new Error('This browser has no location support. Type a postal code or city instead.');
  }
  if (!window.isSecureContext) {
    throw new Error('Browsers only share location over HTTPS. Open this page over https (or on localhost), or type a postal code instead.');
  }

  /* A denied permission is sticky — the browser will not prompt again, it just
     fails. Checking first means saying so immediately instead of after a wait. */
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' });
    if (status?.state === 'denied') throw new Error(DENIED_MESSAGE);
  } catch (error) {
    if (error.message === DENIED_MESSAGE) throw error;
    /* permissions API unavailable — fall through and just ask */
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) => reject(new Error(geolocationMessage(error))),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000, ...options },
    );
  });
}

const DENIED_MESSAGE = 'Location is blocked for this site. Allow it from the padlock or ⓘ icon in the address bar, then try again — or just type a postal code or city, which works the same way.';

function geolocationMessage(error) {
  if (error.code === 1) return DENIED_MESSAGE;
  if (error.code === 2) return 'Your device could not work out where it is. This is common indoors and on desktops without GPS. Type a postal code or city instead.';
  return 'The location request timed out after 12 seconds. Type a postal code or city instead.';
}

/**
 * Place lookup via OpenStreetMap Nominatim (no key required).
 *
 * A bare postal code goes through Nominatim's structured `postalcode` field
 * rather than free text, and both forms are constrained to a country when one is
 * given — otherwise "2000" matches a postcode in a dozen different countries and
 * the map silently lands on the wrong continent.
 */
export async function geocode(query, { country = '' } = {}) {
  const trimmed = query.trim();
  const params = new URLSearchParams({ format: 'json', limit: '1', addressdetails: '1' });
  if (country) params.set('countrycodes', country.toLowerCase());
  if (looksLikePostalCode(trimmed)) params.set('postalcode', trimmed);
  else params.set('q', trimmed);

  const response = await fetchWithTimeout(
    `${PLACES.nominatimUrl}?${params}`, { headers: { Accept: 'application/json' } }, 12000,
  );
  if (!response.ok) throw new Error('Location lookup failed. Try a different spelling.');

  const [match] = await response.json();
  if (!match) {
    throw new Error(country
      ? `No place found for "${trimmed}" in the selected country. Check the country, or try a city name.`
      : `No place found for "${trimmed}". Try adding a city or picking a country.`);
  }
  return { lat: Number(match.lat), lng: Number(match.lon), label: placeLabel(match) };
}

/** Turn coordinates back into a readable place, so a GPS fix can be confirmed. */
export async function describePlace({ lat, lng }) {
  try {
    const params = new URLSearchParams({
      format: 'json', addressdetails: '1', zoom: '14', lat: String(lat), lon: String(lng),
    });
    const response = await fetchWithTimeout(
      `${PLACES.nominatimReverseUrl}?${params}`, { headers: { Accept: 'application/json' } }, 10000,
    );
    if (!response.ok) return null;
    return placeLabel(await response.json());
  } catch {
    return null; // a missing label is cosmetic; the search still works
  }
}

/** "Cambridge, Massachusetts 02138, United States" from Nominatim's address parts. */
function placeLabel(match) {
  const a = match?.address;
  if (!a) return match?.display_name || null;
  const town = a.city || a.town || a.village || a.municipality || a.suburb || a.county;
  const region = a.state || a.region;
  const line = [town, [region, a.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [line, a.country].filter(Boolean).join(', ') || match.display_name;
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
