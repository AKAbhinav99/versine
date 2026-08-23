/* Finding clinicians near a point.
 *
 * Three providers, richest first: Google Places has ratings, Geoapify has good
 * coverage without them, and Overpass is the keyless last resort. Overpass is
 * last on purpose — it is a free, shared, volunteer-run service that is often
 * overloaded, and it is the one that made this chain necessary. */

import { fetchWithTimeout, readJson, runChain, haversineMeters, delay, CancelledError } from './net.js';
import { getKey, hasKey } from './keys.js';

const SPECIALTY_LABEL = { ortho: 'Orthopedics', pediatric: 'Pediatric ortho', pt: 'Physical therapy' };

/** Does this practice plausibly treat scoliosis? */
const RELEVANT = /ortho|spine|spinal|scolio|physical therapy|physiotherap|sports medicine|rehab|chiro/i;

const directionsFor = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

function classify(text) {
  const haystack = text.toLowerCase();
  if (/p(a)?ediatric|child|kids/.test(haystack)) return 'pediatric';
  if (/physio|physical therapy|therapist|rehab/.test(haystack)) return 'pt';
  return 'ortho';
}

function buildTags(rawTypes, spec) {
  const extras = rawTypes
    .filter((type) => type && !['point_of_interest', 'establishment', 'health', 'yes'].includes(type))
    .slice(0, 2)
    .map((type) => String(type).replace(/[_;.]/g, ' ').trim());
  return [SPECIALTY_LABEL[spec], ...extras].filter(Boolean);
}

/* ------------------------------------------------------------ Google Places --- */

const GOOGLE_QUERIES = [
  { text: 'orthopedic surgeon scoliosis', spec: 'ortho' },
  { text: 'pediatric orthopedic doctor', spec: 'pediatric' },
  { text: 'physical therapist scoliosis', spec: 'pt' },
];

async function searchGoogle(center, radiusM, signal) {
  const requests = GOOGLE_QUERIES.map(async ({ text, spec }) => {
    const response = await fetchWithTimeout('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': getKey('google'),
        'X-Goog-FieldMask': [
          'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
          'places.rating', 'places.userRatingCount', 'places.nationalPhoneNumber',
          'places.types', 'places.googleMapsUri', 'places.currentOpeningHours.openNow',
        ].join(','),
      },
      body: JSON.stringify({
        textQuery: text,
        maxResultCount: 20,
        locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(radiusM, 50000) } },
      }),
    }, 15000, signal);

    const data = await readJson(response, 'Google Places');
    return (data.places || []).map((place) => {
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
    });
  });

  const settled = await Promise.allSettled(requests);
  const results = settled.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
  if (!results.length) {
    const failure = settled.find((r) => r.status === 'rejected');
    if (failure) throw failure.reason;
  }
  return dedupe(results);
}

/* ---------------------------------------------------------------- Geoapify --- */

/* Broad categories plus the same name filter used for OpenStreetMap, rather than
   narrow sub-categories — a category name this app gets wrong would be a 400 for
   the whole request, and coverage varies by country anyway. */
const GEOAPIFY_CATEGORIES = 'healthcare.physiotherapist,healthcare.clinic_or_praxis,healthcare.hospital';

async function searchGeoapify(center, radiusM, signal) {
  const params = new URLSearchParams({
    categories: GEOAPIFY_CATEGORIES,
    filter: `circle:${center.lng},${center.lat},${Math.min(radiusM, 50000)}`,
    bias: `proximity:${center.lng},${center.lat}`,
    limit: '60',
    apiKey: getKey('geoapify'),
  });

  const data = await readJson(
    await fetchWithTimeout(`https://api.geoapify.com/v2/places?${params}`, {}, 20000, signal),
    'Geoapify',
  );

  const results = (data.features || []).map((feature) => {
    const p = feature.properties || {};
    if (!p.name) return null;

    const categories = p.categories || [];
    const haystack = `${p.name} ${categories.join(' ')}`;
    if (!RELEVANT.test(haystack)) return null;

    const lat = p.lat ?? feature.geometry?.coordinates?.[1];
    const lng = p.lon ?? feature.geometry?.coordinates?.[0];
    if (!lat || !lng) return null;

    const specialty = classify(haystack);
    return {
      id: `geoapify-${p.place_id || `${lat},${lng}`}`,
      name: p.name,
      address: p.formatted || [p.address_line1, p.address_line2].filter(Boolean).join(', '),
      lat, lng,
      distanceM: haversineMeters(center, { lat, lng }),
      rating: null,
      reviewCount: null,
      phone: p.contact?.phone || p.phone || null,
      openNow: null,
      specialty,
      tags: buildTags(categories.filter((c) => c !== 'healthcare'), specialty),
      website: p.website || null,
      directionsUrl: directionsFor(lat, lng),
      source: 'geoapify',
    };
  }).filter(Boolean);

  return dedupe(results);
}

/* ---------------------------------------------------------------- Overpass --- */

/* Every clause leads with an indexed tag. Regex or name matching inside the query
   makes Overpass scan the whole radius and blow past its own timeout, so the
   relevance filtering happens in JS below. */
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

const OVERPASS_ATTEMPTS = 3;
const OVERPASS_BACKOFF_MS = [0, 1500, 4000];

/* Overpass answers 429 when its per-IP slots are full and 504 when its gateway
   gives up, and both clear on their own within seconds — so they are retried
   rather than reported. */
async function searchOverpass(center, radiusM, signal) {
  let lastError = null;

  for (let attempt = 0; attempt < OVERPASS_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new CancelledError();
    if (OVERPASS_BACKOFF_MS[attempt]) await delay(OVERPASS_BACKOFF_MS[attempt], signal);

    try {
      return await overpassAttempt(center, radiusM, signal);
    } catch (error) {
      if (error instanceof CancelledError) throw error;
      if (!error.transient) throw error;
      lastError = error;
    }
  }
  throw new Error(`${lastError.message} Tried ${OVERPASS_ATTEMPTS} times.`);
}

async function overpassAttempt(center, radiusM, signal) {
  const response = await fetchWithTimeout('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(overpassQuery(center, Math.min(radiusM, 50000)))}`,
  }, 30000, signal);

  const data = await readJson(response, 'OpenStreetMap');
  if (data.remark && /timed out|error/i.test(data.remark)) {
    throw Object.assign(new Error('The OpenStreetMap query timed out.'), { transient: true });
  }

  const results = (data.elements || []).map((element) => {
    const tags = element.tags || {};
    if (!tags.name) return null;

    const haystack = `${tags.name} ${tags['healthcare:speciality'] || ''} ${tags.healthcare || ''}`;
    const isPhysio = tags.healthcare === 'physiotherapist';
    if (!isPhysio && !RELEVANT.test(haystack)) return null;

    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (!lat || !lng) return null;

    const specialty = classify(haystack);
    const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
    return {
      id: `osm-${element.type}-${element.id}`,
      name: tags.name,
      address: [street, tags['addr:city'], tags['addr:postcode']].filter(Boolean).join(', '),
      lat, lng,
      distanceM: haversineMeters(center, { lat, lng }),
      rating: null,
      reviewCount: null,
      phone: tags.phone || tags['contact:phone'] || null,
      openNow: null,
      specialty,
      tags: buildTags([tags['healthcare:speciality']], specialty),
      website: tags.website || tags['contact:website'] || null,
      directionsUrl: directionsFor(lat, lng),
      source: 'osm',
    };
  }).filter(Boolean);

  return dedupe(results);
}

/* ------------------------------------------------------------------- chain --- */

const PROVIDERS = [
  { id: 'google', label: 'Google Places', ratings: true, available: () => hasKey('google'), search: searchGoogle },
  { id: 'geoapify', label: 'Geoapify', ratings: false, available: () => hasKey('geoapify'), search: searchGeoapify },
  { id: 'osm', label: 'OpenStreetMap', ratings: false, available: () => true, search: searchOverpass },
];

export const clinicProviders = () => PROVIDERS.filter((p) => p.available()).map((p) => p.label);

/**
 * Finds clinicians around a point, falling through the providers until one
 * answers with results.
 *
 * @returns {Promise<{results: object[], provider: string, label: string,
 *                    hasRatings: boolean, attempts: string[]}>}
 */
export async function findClinicians(center, radiusM, { signal = null } = {}) {
  const { value, provider, attempts } = await runChain(
    PROVIDERS, (p) => nonEmpty(p.search(center, radiusM, signal)), { signal },
  );

  return {
    results: value.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity)),
    provider: provider.id,
    label: provider.label,
    hasRatings: provider.ratings,
    attempts,
  };
}

/* An empty answer is treated as a miss so the chain moves on — a provider with
   no coverage in this country should not end the search. */
const nonEmpty = async (promise) => {
  const results = await promise;
  return results.length ? results : null;
};

function dedupe(results) {
  const seen = new Map();
  for (const item of results) {
    const key = `${item.name.toLowerCase()}|${Math.round((item.lat || 0) * 1e4)}`;
    if (!seen.has(key)) seen.set(key, item);
  }
  return Array.from(seen.values());
}
