/* Turning a typed place into coordinates, and coordinates back into a place name.
 *
 * Four providers, tried in order. Nominatim is keyless so it goes first and costs
 * nobody a quota; the keyed services below it are the fallback when Nominatim is
 * rate-limited or down. Each one is skipped entirely when it has no key. */

import { fetchWithTimeout, readJson, runChain } from './net.js';
import { getKey, hasKey } from './keys.js';
import { looksLikePostalCode } from './countries.js';

const TIMEOUT_MS = 12000;

/* --------------------------------------------------------------- Nominatim --- */

async function nominatimSearch(query, country, signal) {
  const params = new URLSearchParams({ format: 'json', limit: '1', addressdetails: '1' });
  if (country) params.set('countrycodes', country.toLowerCase());
  if (looksLikePostalCode(query)) params.set('postalcode', query);
  else params.set('q', query);

  const data = await readJson(
    await fetchWithTimeout(`https://nominatim.openstreetmap.org/search?${params}`,
      { headers: { Accept: 'application/json' } }, TIMEOUT_MS, signal),
    'OpenStreetMap',
  );
  const [match] = data;
  return match ? { lat: Number(match.lat), lng: Number(match.lon), label: nominatimLabel(match) } : null;
}

async function nominatimReverse({ lat, lng }, signal) {
  const params = new URLSearchParams({
    format: 'json', addressdetails: '1', zoom: '14', lat: String(lat), lon: String(lng),
  });
  const data = await readJson(
    await fetchWithTimeout(`https://nominatim.openstreetmap.org/reverse?${params}`,
      { headers: { Accept: 'application/json' } }, TIMEOUT_MS, signal),
    'OpenStreetMap',
  );
  return nominatimLabel(data);
}

/** "Cambridge, Massachusetts 02138, United States" from Nominatim address parts. */
function nominatimLabel(match) {
  const a = match?.address;
  if (!a) return match?.display_name || null;
  const town = a.city || a.town || a.village || a.municipality || a.suburb || a.county;
  const region = a.state || a.region;
  const line = [town, [region, a.postcode].filter(Boolean).join(' ').trim()].filter(Boolean).join(', ');
  return [line, a.country].filter(Boolean).join(', ') || match.display_name;
}

/* ---------------------------------------------------------------- Geoapify --- */

async function geoapifySearch(query, country, signal) {
  const params = new URLSearchParams({ text: query, limit: '1', apiKey: getKey('geoapify') });
  if (country) params.set('filter', `countrycode:${country.toLowerCase()}`);

  const data = await readJson(
    await fetchWithTimeout(`https://api.geoapify.com/v1/geocode/search?${params}`, {}, TIMEOUT_MS, signal),
    'Geoapify',
  );
  const feature = data.features?.[0];
  if (!feature) return null;
  const [lng, lat] = feature.geometry.coordinates;
  return { lat, lng, label: feature.properties.formatted };
}

async function geoapifyReverse({ lat, lng }, signal) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lng), apiKey: getKey('geoapify') });
  const data = await readJson(
    await fetchWithTimeout(`https://api.geoapify.com/v1/geocode/reverse?${params}`, {}, TIMEOUT_MS, signal),
    'Geoapify',
  );
  return data.features?.[0]?.properties?.formatted || null;
}

/* ---------------------------------------------------------------- MapTiler --- */

async function maptilerSearch(query, country, signal) {
  const params = new URLSearchParams({ key: getKey('maptiler'), limit: '1' });
  if (country) params.set('country', country.toLowerCase());

  const data = await readJson(
    await fetchWithTimeout(
      `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?${params}`,
      {}, TIMEOUT_MS, signal,
    ),
    'MapTiler',
  );
  const feature = data.features?.[0];
  if (!feature) return null;
  const [lng, lat] = feature.center;
  return { lat, lng, label: feature.place_name };
}

async function maptilerReverse({ lat, lng }, signal) {
  const data = await readJson(
    await fetchWithTimeout(
      `https://api.maptiler.com/geocoding/${lng},${lat}.json?key=${encodeURIComponent(getKey('maptiler'))}`,
      {}, TIMEOUT_MS, signal,
    ),
    'MapTiler',
  );
  return data.features?.[0]?.place_name || null;
}

/* ---------------------------------------------------------- Geocode.maps.co --- */

/* A hosted Nominatim, so the response shape matches — but it takes free text
   only, which is why the country is appended to the query rather than filtered. */
async function mapscoSearch(query, country, signal) {
  const text = country ? `${query}, ${countryName(country)}` : query;
  const params = new URLSearchParams({ q: text, api_key: getKey('mapsco') });

  const data = await readJson(
    await fetchWithTimeout(`https://geocode.maps.co/search?${params}`, {}, TIMEOUT_MS, signal),
    'Geocode.maps.co',
  );
  const [match] = Array.isArray(data) ? data : [];
  return match ? { lat: Number(match.lat), lng: Number(match.lon), label: match.display_name } : null;
}

async function mapscoReverse({ lat, lng }, signal) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lng), api_key: getKey('mapsco') });
  const data = await readJson(
    await fetchWithTimeout(`https://geocode.maps.co/reverse?${params}`, {}, TIMEOUT_MS, signal),
    'Geocode.maps.co',
  );
  return data?.display_name || null;
}

function countryName(code) {
  try {
    return new Intl.DisplayNames(navigator.language, { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
}

/* ------------------------------------------------------------------- chain --- */

const PROVIDERS = [
  { id: 'nominatim', label: 'OpenStreetMap', available: () => true, search: nominatimSearch, reverse: nominatimReverse },
  { id: 'geoapify', label: 'Geoapify', available: () => hasKey('geoapify'), search: geoapifySearch, reverse: geoapifyReverse },
  { id: 'maptiler', label: 'MapTiler', available: () => hasKey('maptiler'), search: maptilerSearch, reverse: maptilerReverse },
  { id: 'mapsco', label: 'Geocode.maps.co', available: () => hasKey('mapsco'), search: mapscoSearch, reverse: mapscoReverse },
];

export const geocodingProviders = () => PROVIDERS.filter((p) => p.available()).map((p) => p.label);

/**
 * Typed place to coordinates, trying each provider until one answers.
 *
 * A bare postal code is ambiguous worldwide — "2000" is valid in a dozen
 * countries — so it is sent as a postal code, constrained to the chosen country,
 * wherever the provider supports saying so.
 */
export async function geocode(query, { country = '', signal = null } = {}) {
  const trimmed = query.trim();

  try {
    const { value, provider } = await runChain(
      PROVIDERS, (p) => p.search(trimmed, country, signal), { signal },
    );
    return { ...value, source: provider.label };
  } catch (error) {
    throw new Error(country
      ? `Nothing found for “${trimmed}” in the selected country. Check the country, or try a city name. (${error.message})`
      : `Nothing found for “${trimmed}”. Try adding a city, or pick a country. (${error.message})`);
  }
}

/** Coordinates back to a readable place, so a GPS fix can be confirmed by eye. */
export async function describePlace(center, { signal = null } = {}) {
  try {
    const { value } = await runChain(PROVIDERS, (p) => p.reverse(center, signal), { signal });
    return value;
  } catch {
    return null; // a missing label is cosmetic; the search still works
  }
}
