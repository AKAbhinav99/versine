/* Finding clinicians near a point.
 *
 * Three providers, richest first: Google Places has ratings, Geoapify has good
 * coverage without them, and Overpass is the keyless last resort. Overpass is
 * last on purpose, it is a free, shared, volunteer-run service that is often
 * overloaded, and it is the one that made this chain necessary. */

import { fetchWithTimeout, readJson, runChain, haversineMeters, delay, CancelledError } from './net.js';
import { getKey, hasKey } from './keys.js';
import { localSearch, remember } from './clinic-index.js';

const SPECIALTY_LABEL = {
  ortho: 'Orthopedics',
  pediatric: 'Pediatric ortho',
  pt: 'Physical therapy',
  general: 'General clinic',
};

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

/* Verified against the live API, an unsupported category 400s the whole request,
   which is what "healthcare.physiotherapist" did. Geoapify has no physiotherapy
   category at all, which is the main reason its coverage for this app is thinner
   than OpenStreetMap's. */
const GEOAPIFY_CATEGORIES = [
  'healthcare.clinic_or_praxis',
  'healthcare.clinic_or_praxis.orthopaedics',
  'healthcare.clinic_or_praxis.paediatrics',
  'healthcare.hospital',
].join(',');

/* With no physiotherapy category and mostly general-practice names, filtering
   Geoapify by name the way OpenStreetMap is filtered discards everything. So
   sub-category decides where it can, the name decides where it cannot, and what
   is left stays in labelled as general, a hospital is a real place to get a
   scoliosis referral, it just is not a specialist. */
function geoapifySpecialty(name, categories) {
  const cats = categories.join(' ');
  if (cats.includes('.orthopaedics')) return 'ortho';
  if (cats.includes('.paediatrics')) return 'pediatric';
  if (RELEVANT.test(name)) return classify(name);
  if (cats.includes('healthcare.hospital')) return 'general';
  return 'general';
}

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
    const lat = p.lat ?? feature.geometry?.coordinates?.[1];
    const lng = p.lon ?? feature.geometry?.coordinates?.[0];
    if (!lat || !lng) return null;

    const specialty = geoapifySpecialty(p.name, categories);
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
      tags: buildTags(
        categories
          .filter((c) => c.startsWith('healthcare.') && c !== 'healthcare.clinic_or_praxis')
          .map((c) => c.split('.').pop()),
        specialty,
      ),
      website: p.website || null,
      directionsUrl: directionsFor(lat, lng),
      source: 'geoapify',
    };
  }).filter(Boolean);

  return dedupe(results);
}

/* ------------------------------------------------------------------ Photon --- */

/* Photon is komoot's OpenStreetMap search engine. Same data as Overpass, but it
 * answers from a prebuilt search index rather than running a database query, so
 * it comes back in well under a second where Overpass takes five to twenty and
 * regularly 504s. It is the keyless default for that reason.
 *
 * Two kinds of request, all small and run in parallel:
 *  - "nearest N with this tag" for the practice types OpenStreetMap tags
 *    explicitly (physiotherapists, rehabilitation). Capped at 50 by Photon,
 *    which is why it is one request per tag rather than one for all of them.
 *  - name searches inside the search box for orthopedic and spine practices,
 *    which OpenStreetMap mostly tags as plain "doctors" with the specialty only
 *    in the name.
 *
 * Measured on the same 15 km circle in Denver: a comparable set to Overpass, in
 * 0.6 s per request. No phone numbers, which Photon does not return; Overpass
 * stays below it in the chain and is tried when Photon finds nothing. */
const PHOTON = 'https://photon.komoot.io';
const PHOTON_TAGS = ['healthcare:physiotherapist', 'healthcare:rehabilitation'];
const PHOTON_TERMS = ['orthopedic', 'orthopaedic', 'spine', 'sports medicine', 'physical therapy', 'physiotherapy'];
/* Anything else that matches a name search (a massage shop called "Spine
   Align", an apartment block) is not a practice. */
const PHOTON_PRACTICE = new Set([
  'physiotherapist', 'rehabilitation', 'doctors', 'doctor', 'clinic', 'hospital', 'therapist',
]);

function bboxAround(center, radiusM) {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((center.lat * Math.PI) / 180));
  return [center.lng - dLng, center.lat - dLat, center.lng + dLng, center.lat + dLat].map((v) => v.toFixed(5)).join(',');
}

async function searchPhoton(center, radiusM, signal) {
  const radius = Math.min(radiusM, 50000);
  const near = { lat: String(center.lat), lon: String(center.lng) };
  const urls = [
    ...PHOTON_TAGS.map((tag) => `${PHOTON}/reverse?${new URLSearchParams({ ...near, radius: String(radius / 1000), limit: '50', osm_tag: tag })}`),
    ...PHOTON_TERMS.map((q) => `${PHOTON}/api/?${new URLSearchParams({ ...near, q, bbox: bboxAround(center, radius), limit: '50' })}`),
  ];

  const settled = await Promise.allSettled(
    urls.map(async (url) => readJson(await fetchWithTimeout(url, {}, 9000, signal), 'Photon')),
  );
  if (signal?.aborted) throw new CancelledError();
  const answered = settled.filter((outcome) => outcome.status === 'fulfilled');
  /* Some requests failing is fine; all of them failing is the service being down. */
  if (!answered.length) throw settled[0].reason;

  const results = answered.flatMap((outcome) => outcome.value.features || []).map((feature) => {
    const p = feature.properties || {};
    if (!p.name || !PHOTON_PRACTICE.has(p.osm_value)) return null;

    const haystack = `${p.name} ${p.osm_value}`;
    if (p.osm_value !== 'physiotherapist' && !RELEVANT.test(haystack)) return null;

    const [lng, lat] = feature.geometry?.coordinates || [];
    if (!lat || !lng) return null;
    const distanceM = haversineMeters(center, { lat, lng });
    if (distanceM > radius) return null;

    const specialty = classify(haystack);
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    return {
      id: `photon-${p.osm_type}-${p.osm_id}`,
      name: p.name,
      address: [street, p.city, p.postcode].filter(Boolean).join(', '),
      lat, lng,
      distanceM,
      rating: null,
      reviewCount: null,
      phone: null,
      openNow: null,
      specialty,
      tags: buildTags([], specialty),
      website: null,
      directionsUrl: directionsFor(lat, lng),
      source: 'photon',
    };
  }).filter(Boolean);

  return dedupe(results);
}

/* --------------------------------------------------------------- Nominatim --- */

/* OpenStreetMap's own geocoder, asked for practices by name and category inside
   a bounded box. It is a separate server from Photon, run by the OSM
   Foundation, and answers in well under two seconds where Photon (shared,
   rate-limited per address) can take ten or refuse outright. Its usage policy
   allows one request a second, so the terms go out one at a time. "hospital"
   is the one general term: a hospital is a real route to a referral, and it is
   labelled general rather than dressed up as a specialist. */
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_TERMS = ['physical therapy', 'orthopedic', 'spine', 'physiotherapy', 'hospital'];
const NOMINATIM_GAP_MS = 1100;

async function searchNominatim(center, radiusM, signal) {
  const radius = Math.min(radiusM, 50000);
  const [west, south, east, north] = bboxAround(center, radius).split(',');
  const answered = [];
  let lastError = null;

  for (let i = 0; i < NOMINATIM_TERMS.length; i += 1) {
    if (i) await delay(NOMINATIM_GAP_MS, signal);
    const url = `${NOMINATIM}?${new URLSearchParams({
      q: NOMINATIM_TERMS[i], format: 'jsonv2', limit: '40', addressdetails: '1', extratags: '1',
      viewbox: [west, north, east, south].join(','), bounded: '1',
    })}`;
    try {
      answered.push(...await readJson(await fetchWithTimeout(url, {}, 8000, signal), 'Nominatim'));
    } catch (error) {
      if (error instanceof CancelledError || signal?.aborted) throw new CancelledError();
      lastError = error;
    }
  }
  if (!answered.length && lastError) throw lastError;

  const results = answered.map((place) => {
    const type = place.type;
    const isPractice = ['healthcare', 'amenity'].includes(place.category)
      && (PHOTON_PRACTICE.has(type) || type === 'hospital');
    if (!place.name || !isPractice) return null;

    const haystack = `${place.name} ${type}`;
    const relevant = type === 'physiotherapist' || RELEVANT.test(haystack);
    if (!relevant && type !== 'hospital') return null;

    const lat = Number(place.lat);
    const lng = Number(place.lon);
    if (!lat || !lng) return null;
    const distanceM = haversineMeters(center, { lat, lng });
    if (distanceM > radius) return null;

    const specialty = relevant ? classify(haystack) : 'general';
    const a = place.address || {};
    const street = [a.house_number, a.road].filter(Boolean).join(' ');
    const extra = place.extratags || {};
    return {
      id: `nominatim-${place.osm_type}-${place.osm_id}`,
      name: place.name,
      address: [street, a.city || a.town || a.village || a.suburb, a.postcode].filter(Boolean).join(', '),
      lat, lng,
      distanceM,
      rating: null,
      reviewCount: null,
      phone: extra.phone || extra['contact:phone'] || null,
      openNow: null,
      specialty,
      tags: buildTags([extra['healthcare:speciality']], specialty),
      website: extra.website || extra['contact:website'] || null,
      directionsUrl: directionsFor(lat, lng),
      source: 'nominatim',
    };
  }).filter(Boolean);

  return dedupe(results);
}

/* Photon and Nominatim at once: two independent servers over the same map
   data. Either one answering is an answer; both are merged when both do. This
   is what makes the keyless path dependable, where asking them in turn meant
   waiting out Photon's timeout before Nominatim was even tried. */
const OSM_GRACE_MS = 1500;

async function searchOpenStreetMap(center, radiusM, signal) {
  const collected = [];
  const searches = [searchPhoton, searchNominatim].map((search) => search(center, radiusM, signal)
    .then((results) => { collected.push(...results); return results; }));

  /* Answer once the first useful reply lands, giving the other a moment to
     add to it rather than waiting out its whole timeout. */
  try {
    await Promise.any(searches.map((search) => search.then((results) => {
      if (!results.length) throw new Error('nothing found');
    })));
    await Promise.race([Promise.allSettled(searches), delay(OSM_GRACE_MS, signal).catch(() => {})]);
  } catch (error) {
    if (signal?.aborted) throw new CancelledError();
    const settled = await Promise.allSettled(searches);
    const failure = settled.find((outcome) => outcome.status === 'rejected');
    if (!collected.length && failure) throw failure.reason;
  }
  if (signal?.aborted) throw new CancelledError();
  return dedupe(collected);
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

/* overpass-api.de is a load balancer over several backends, and a 504 usually
   means the request landed on a busy one. Retrying the same address three times
   kept landing there. Alternating with the mail.ru mirror (separate hardware,
   CORS-enabled, slower but steadier) gives each retry a real second chance. */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const OVERPASS_ATTEMPTS = OVERPASS_ENDPOINTS.length;
const OVERPASS_BACKOFF_MS = [0, 500, 3000];

/* Overpass answers 429 when its per-IP slots are full and 504 when its gateway
   gives up, and both clear on their own within seconds, so they are retried
   rather than reported. */
async function searchOverpass(center, radiusM, signal) {
  let lastError = null;

  for (let attempt = 0; attempt < OVERPASS_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new CancelledError();
    if (OVERPASS_BACKOFF_MS[attempt]) await delay(OVERPASS_BACKOFF_MS[attempt], signal);

    try {
      return await overpassAttempt(OVERPASS_ENDPOINTS[attempt], center, radiusM, signal);
    } catch (error) {
      if (error instanceof CancelledError) throw error;
      if (!error.transient) throw error;
      lastError = error;
    }
  }
  throw new Error(`${lastError.message} Tried ${OVERPASS_ATTEMPTS} times.`);
}

async function overpassAttempt(endpoint, center, radiusM, signal) {
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(overpassQuery(center, Math.min(radiusM, 50000)))}`,
  }, 25000, signal);

  const data = await readJson(response, 'Overpass');
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

/* Ordered by how useful the answer is for this particular question, not by how
   reliable the service is.
 *
 * The local index goes first because it is same-origin static data: it cannot be
 * rate-limited or time out, and it answers only for areas it covers.
 *
 * OpenStreetMap sits above Geoapify despite being the flakier service, because it
 * tags physiotherapists explicitly and Geoapify has no physiotherapy category at
 * all. Measured on the same 15km circle: OpenStreetMap returned 27 practices that
 * actually treat backs, Geoapify returned 59 general clinics and hospitals and no
 * specialists. Geoapify is the fallback beneath it, hospitals are a real route to
 * a referral, and they are labelled as general rather than dressed up.
 *
 * OpenStreetMap is asked through Photon and Nominatim together first, and
 * Overpass second. Same data; the first two are the fast ways in, and Overpass
 * is kept beneath them because it catches practices a name search misses. */
const PROVIDERS = [
  { id: 'local', label: 'Local index', ratings: false, live: false, available: () => true, search: (c, r) => localSearch(c, r) },
  { id: 'google', label: 'Google Places', ratings: true, live: true, available: () => hasKey('google'), search: searchGoogle },
  { id: 'photon', label: 'OpenStreetMap', ratings: false, live: true, available: () => true, search: searchOpenStreetMap },
  { id: 'osm', label: 'OpenStreetMap (Overpass)', ratings: false, live: true, available: () => true, search: searchOverpass },
  { id: 'geoapify', label: 'Geoapify', ratings: false, live: true, available: () => hasKey('geoapify'), search: searchGeoapify },
];

export const clinicProviders = () => PROVIDERS.filter((p) => p.available()).map((p) => p.label);
export const liveProviders = () => PROVIDERS.filter((p) => p.live && p.available()).map((p) => p.label);

/**
 * Finds clinicians around a point, falling through the providers until one
 * answers with results.
 *
 * @returns {Promise<{results: object[], provider: string, label: string,
 *                    hasRatings: boolean, attempts: string[]}>}
 */
export async function findClinicians(center, radiusM, { signal = null, skipLocal = false } = {}) {
  const providers = skipLocal ? PROVIDERS.filter((p) => p.live) : PROVIDERS;

  const { value, provider, attempts } = await runChain(
    providers, (p) => nonEmpty(p.search(center, radiusM, signal)), { signal },
  );

  /* Anything fetched live is folded into the local index, so the next search of
     this area needs no network at all. */
  if (provider.live) remember(value, center, radiusM);

  return {
    results: value.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity)),
    provider: provider.id,
    label: provider.label,
    hasRatings: provider.ratings,
    fromNetwork: provider.live,
    attempts,
  };
}

/* An empty answer is treated as a miss so the chain moves on, so a provider with
   no coverage in this country does not end the search. The local index answers
   null rather than [] for an area it does not cover, which used to throw here and
   surface as "Local index: Cannot read properties of null" above the results. */
const nonEmpty = async (promise) => {
  const results = await promise;
  return results?.length ? results : null;
};

function dedupe(results) {
  const seen = new Map();
  for (const item of results) {
    const key = `${item.name.toLowerCase()}|${Math.round((item.lat || 0) * 1e4)}`;
    if (!seen.has(key)) seen.set(key, item);
  }
  return Array.from(seen.values());
}
