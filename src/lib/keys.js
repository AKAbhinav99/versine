/* API keys for the optional lookup providers.
 *
 * Every one of these is free to obtain and optional — the app works with none of
 * them, on OpenStreetMap's keyless services. Adding one buys reliability: the
 * keyless services are shared, volunteer-run and frequently overloaded.
 *
 * Keys live in localStorage on the device and are sent only to the host they
 * belong to. They are never collected, transmitted anywhere else, or committed. */

export const PROVIDER_KEYS = [
  {
    id: 'google',
    label: 'Google Places',
    storage: 'versine.key.google',
    signup: 'https://developers.google.com/maps/documentation/places/web-service/get-api-key',
    note: 'Clinic search with ratings, review counts and opening hours. The only provider that supplies ratings.',
  },
  {
    id: 'geoapify',
    label: 'Geoapify',
    storage: 'versine.key.geoapify',
    signup: 'https://myprojects.geoapify.com/',
    note: 'Geocoding, plus clinic search — though its healthcare data has no physiotherapy category, so it finds fewer relevant practices here than OpenStreetMap does. Free tier is 3,000 requests a day.',
  },
  {
    id: 'maptiler',
    label: 'MapTiler',
    storage: 'versine.key.maptiler',
    signup: 'https://cloud.maptiler.com/account/keys/',
    note: 'Geocoding only. Free tier is 100,000 map loads a month.',
  },
  {
    id: 'mapsco',
    label: 'Geocode.maps.co',
    storage: 'versine.key.mapsco',
    signup: 'https://geocode.maps.co/',
    note: 'Geocoding only. A hosted Nominatim, free at 1 request a second.',
  },
];

const byId = new Map(PROVIDER_KEYS.map((provider) => [provider.id, provider]));

export function getKey(id) {
  const provider = byId.get(id);
  if (!provider) return '';
  try {
    return localStorage.getItem(provider.storage) || '';
  } catch {
    return '';
  }
}

export function setKey(id, value) {
  const provider = byId.get(id);
  if (!provider) return;
  try {
    const trimmed = value.trim();
    if (trimmed) localStorage.setItem(provider.storage, trimmed);
    else localStorage.removeItem(provider.storage);
  } catch { /* storage unavailable; the key simply will not persist */ }
}

export const hasKey = (id) => getKey(id).length > 0;

/** Which providers are configured, for the "what is in use" line in the UI. */
export const configuredKeys = () => PROVIDER_KEYS.filter((provider) => hasKey(provider.id));

/* One cheap request per provider, against the endpoint Versine actually uses.
   Dashboards differ and some hand out several keys; this answers the only
   question that matters, which is whether this key does the job here. */
const PROBES = {
  google: (key) => ({
    url: 'https://places.googleapis.com/v1/places:searchText',
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.id',
      },
      body: JSON.stringify({ textQuery: 'orthopedic clinic', maxResultCount: 1 }),
    },
    ok: (data) => Array.isArray(data.places) || data.places === undefined,
    used: 'clinic search',
  }),
  geoapify: (key) => ({
    url: `https://api.geoapify.com/v2/places?categories=healthcare.clinic_or_praxis&filter=circle:-71.1,42.37,3000&limit=1&apiKey=${encodeURIComponent(key)}`,
    options: {},
    ok: (data) => Array.isArray(data.features),
    used: 'geocoding, and clinic search as a fallback',
  }),
  maptiler: (key) => ({
    url: `https://api.maptiler.com/geocoding/Boston.json?limit=1&key=${encodeURIComponent(key)}`,
    options: {},
    ok: (data) => Array.isArray(data.features),
    used: 'geocoding only',
  }),
  mapsco: (key) => ({
    url: `https://geocode.maps.co/search?q=Boston&api_key=${encodeURIComponent(key)}`,
    options: {},
    ok: (data) => Array.isArray(data),
    used: 'geocoding only',
  }),
};

/**
 * Checks a key against the endpoint this app uses it for.
 * @returns {Promise<{ok: boolean, message: string}>}
 */
export async function testKey(id, key) {
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, message: 'No key entered.' };

  const probe = PROBES[id]?.(trimmed);
  if (!probe) return { ok: false, message: 'No test available for this provider.' };

  try {
    const response = await fetch(probe.url, probe.options);

    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: `Rejected (${response.status}). This key is not valid for ${byId.get(id).label}'s API — if your dashboard lists several, try the one for Places or Geocoding.` };
    }
    if (response.status === 429) {
      return { ok: false, message: 'The key works, but the quota is exhausted right now. Try again later.' };
    }
    if (!response.ok) {
      return { ok: false, message: `The service answered ${response.status}.` };
    }

    const data = await response.json();
    return probe.ok(data)
      ? { ok: true, message: `Works — Versine will use it for ${probe.used}.` }
      : { ok: false, message: 'The service answered, but not in the expected shape. This key may be for a different API.' };
  } catch {
    return { ok: false, message: 'Could not reach the service to check. Check your connection and try again.' };
  }
}
