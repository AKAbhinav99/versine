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
    note: 'Clinic search and geocoding. Free tier is 3,000 requests a day — the best keyless-service replacement here.',
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
