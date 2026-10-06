/* Clinician finder: live geolocation plus a real places lookup, drawn on a map
 * and listed with the things you actually need, distance, specialty, phone,
 * directions. */

import { $, $$, el, formatDistance, escapeHtml } from '../lib/dom.js';
import { PLACES } from '../config.js';
import { findClinicians, clinicProviders, checkSiteRatings } from '../lib/clinics.js';
import { geocode, describePlace } from '../lib/geocoding.js';
import { currentPosition } from '../lib/geolocation.js';
import { CancelledError, fetchWithTimeout } from '../lib/net.js';
import { PROVIDER_KEYS, getKey, setKey, configuredKeys, testKey } from '../lib/keys.js';
import { localInView, indexCoverage, clearLearned } from '../lib/clinic-index.js';
import { countryOptions, defaultCountry } from '../lib/countries.js';

const LAST_CENTER_KEY = 'versine.lastCenter';

const state = {
  center: null,
  country: '',
  radiusM: PLACES.defaultRadiusM,
  specs: new Set(),
  minRating: 0,
  results: [],
  provider: null,
};

/* Every lookup takes a token. A response is only applied if its token is still
   the newest, so pressing the button again supersedes the request in flight
   instead of being dropped, which is what used to happen. Overpass can take
   fifteen seconds, and for that whole window every press did nothing. */
let searchToken = 0;
let inFlight = null;   // AbortController for the search currently running

/* Only Google publishes ratings, so the rating filter is meaningless against the
   others. Without this the filter silently emptied the list. */
let providerHasRatings = () => false;

let map = null;
let resultMarkers = [];   // numbered pins for the current result list, by list index
let hereMarker = null;    // the search centre

export function initDoctors() {
  initCountrySelect();
  /* Ask once whether this site serves ratings, and redraw the service list
     when the answer arrives, so it names Google when ratings are on. */
  checkSiteRatings().then((configured) => { if (configured && !state.center) renderNotice(); });
  $('#loc-gps').addEventListener('click', useCurrentLocation);
  $('#loc-search').addEventListener('click', useTypedLocation);
  $('#loc-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') useTypedLocation();
  });

  $$('[data-filter-spec]').forEach((chip) => chip.addEventListener('click', () => {
    const spec = chip.dataset.filterSpec;
    const on = chip.getAttribute('aria-pressed') === 'true';
    chip.setAttribute('aria-pressed', String(!on));
    if (on) state.specs.delete(spec); else state.specs.add(spec);
    renderResults();
  }));

  $$('[data-filter-radius]').forEach((chip) => chip.addEventListener('click', () => {
    $$('[data-filter-radius]').forEach((other) => other.setAttribute('aria-pressed', 'false'));
    chip.setAttribute('aria-pressed', 'true');
    state.radiusM = Number(chip.dataset.filterRadius);
    if (state.center) search();
  }));

  $$('[data-filter-rating]').forEach((chip) => chip.addEventListener('click', () => {
    if (chip.getAttribute('aria-disabled') === 'true') return;
    const on = chip.getAttribute('aria-pressed') === 'true';
    chip.setAttribute('aria-pressed', String(!on));
    state.minRating = on ? 0 : Number(chip.dataset.filterRating);
    renderResults();
  }));

  $('#search-area').addEventListener('click', searchMapArea);

  restoreCenter();
}

/** Called by the router each time this screen is shown. */
export function showDoctors() {
  ensureMap();
  if (map) setTimeout(() => map.resize(), 60);
  if (!state.results.length && state.center) search();
  if (!state.center) renderNotice();
}

/* ------------------------------------------------------------------ where --- */

function initCountrySelect() {
  const select = $('#loc-country');
  state.country = localStorage.getItem(PLACES.countryStorage) ?? defaultCountry();

  select.append(new Option('Any country', ''));
  for (const { code, name } of countryOptions()) select.append(new Option(name, code));
  select.value = state.country;

  select.addEventListener('change', () => {
    state.country = select.value;
    localStorage.setItem(PLACES.countryStorage, state.country);
  });
}

function restoreCenter() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_CENTER_KEY) || 'null');
    if (saved?.lat) state.center = saved;
  } catch { /* ignore malformed cache */ }
}

/** Show where the search actually landed, so a wrong postal-code match is obvious. */
async function showResolvedPlace(label) {
  const box = $('#loc-resolved');
  const text = label || await describePlace(state.center);
  if (!text) { box.classList.add('hidden'); return; }
  box.replaceChildren(el('b', {}, 'Searching near'), el('span', {}, text));
  box.classList.remove('hidden');
}

function rememberCenter() {
  localStorage.setItem(LAST_CENTER_KEY, JSON.stringify(state.center));
}

async function useCurrentLocation() {
  const button = $('#loc-gps');
  setBusy(button, true, 'Locating…');
  setStatus('Asking your browser for your location…');
  try {
    state.center = await currentPosition();
    rememberCenter();
    /* Say the location was found before the clinic search runs. Otherwise a
       failing search reads as if the GPS itself failed, which it did not. */
    setStatus('Found you. Looking for clinicians nearby…');
    showResolvedPlace(null);
    flyTo(state.center);
    await search();
  } catch (error) {
    setStatus(error.message, true);
    $('#loc-input').focus();   // the typed fallback is the way out
  } finally {
    setBusy(button, false, 'Use my location');
  }
}

async function useTypedLocation() {
  const query = $('#loc-input').value.trim();
  if (!query) {
    setStatus('Type a postal code, city, or address first, or use your location.', true);
    $('#loc-input').focus();
    return;
  }

  const button = $('#loc-search');
  setBusy(button, true, '…');
  setStatus(`Looking up “${query}”…`);
  try {
    const place = await geocode(query, { country: state.country });
    state.center = { lat: place.lat, lng: place.lng };
    rememberCenter();
    showResolvedPlace(place.label);
    flyTo(state.center);
    await search();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(button, false, 'Find');
  }
}

/* ----------------------------------------------------------------- search --- */

/** Force a live lookup for wherever the map is now, and fold it into the index. */
async function searchMapArea() {
  if (!map) return;
  const button = $('#search-area');
  const centre = map.getCenter();
  state.center = { lat: centre.lat, lng: centre.lng };
  rememberCenter();

  setBusy(button, true, 'Searching…');
  try {
    showResolvedPlace(await describePlace(state.center));
    await search({ skipLocal: true });
  } finally {
    setBusy(button, false, 'Search this area for more');
  }
}

/** @returns {Promise<boolean>} true if this search was still the current one. */
async function search({ skipLocal = false } = {}) {
  if (!state.center) return false;
  const token = ++searchToken;

  /* Cancel the request this one supersedes. Ignoring a stale response was not
     enough, the abandoned request kept holding one of the few per-IP slots the
     free service allows, so repeated presses starved each other. */
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;

  setStatus('Searching for clinicians nearby…');
  $('#places-list').replaceChildren(el('div', { class: 'empty' }, 'Searching…'));

  /* OpenStreetMap's free query service routinely takes 15 to 20 seconds when it
     is busy. Without a word about that, a working search looks like a hung one. */
  const slowNotice = setTimeout(() => {
    if (token === searchToken) {
      setStatus('Still searching. The free OpenStreetMap service can take up to 20 seconds when it is busy.');
    }
  }, 5000);

  try {
    const answer = await findClinicians(state.center, state.radiusM, { signal: controller.signal, skipLocal });
    if (token !== searchToken) return false;   // a newer search has taken over

    state.results = answer.results;
    state.provider = answer.provider;
    providerHasRatings = () => answer.hasRatings;
    $('#places-source').textContent = `Source: ${answer.label}`;
    syncRatingFilter();

    /* If earlier providers were tried and failed, say which, silently falling
       back hides a broken key or an outage the user could fix. */
    renderResults(answer.attempts.length
      ? `Answered by ${answer.label} after ${answer.attempts.join('; ')}.`
      : undefined);
    clearStatus();
    return true;
  } catch (error) {
    if (error instanceof CancelledError || token !== searchToken) return false;
    state.results = [];
    renderResults();
    setStatus(error.message, true, { retry: true });
    return false;
  } finally {
    clearTimeout(slowNotice);
    if (inFlight === controller) inFlight = null;
  }
}

/** Turn the rating chips off when the answering provider publishes no ratings. */
function syncRatingFilter() {
  const available = providerHasRatings();
  if (!available) state.minRating = 0;

  $$('[data-filter-rating]').forEach((chip) => {
    chip.setAttribute('aria-disabled', String(!available));
    if (!available) chip.setAttribute('aria-pressed', 'false');
    chip.title = available
      ? 'Filter to practices rated at least this highly'
      : 'This lookup service does not publish ratings (OpenStreetMap has none at all). Only Google Places does.';
  });
}

function visibleResults() {
  return state.results.filter((clinic) => {
    if (state.specs.size && !state.specs.has(clinic.specialty)) return false;
    if (state.minRating && providerHasRatings() && !(clinic.rating >= state.minRating)) return false;
    if (clinic.distanceM !== null && clinic.distanceM > state.radiusM) return false;
    return true;
  });
}

/* ------------------------------------------------------------------- view --- */

function renderResults(notice) {
  const list = $('#places-list');
  const results = visibleResults();
  $('#places-count').textContent = results.length ? `${results.length} found` : '';

  renderNotice(notice);
  drawMarkers(results);

  list.replaceChildren();
  if (!results.length) {
    list.append(el('div', { class: 'empty' }, emptyReason()));
    return;
  }
  results.forEach((clinic, index) => list.append(clinicCard(clinic, index)));
}

/** Say which filter emptied the list, rather than blaming the radius every time. */
function emptyReason() {
  if (!state.center) return 'Set a location above to see clinicians near you.';
  if (!state.results.length) {
    return 'Nothing found around this point. Widen the distance filter, or search a nearby larger town.';
  }
  const hidden = state.results.length - visibleResults().length;
  if (state.minRating && providerHasRatings()) {
    return `All ${hidden} nearby practices were hidden by the ${state.minRating.toFixed(1)}+ rating filter. Many clinics have no rating at all, so this filter is aggressive. Turn it off to see them.`;
  }
  if (state.specs.size) {
    return `All ${hidden} nearby practices were hidden by the specialty filter. Turn one off to widen the search.`;
  }
  return `All ${hidden} results are further away than the current distance filter allows.`;
}

/* OpenStreetMap has no ratings, and every service that does charges for
   them. A Google Maps search link costs nothing and needs no key: one tap
   shows the practice's real stars and reviews. The address (or, without one,
   the coordinates) keeps the search on this practice rather than a namesake. */
function reviewsUrl(clinic) {
  const where = clinic.address || (clinic.lat && clinic.lng ? `near ${clinic.lat.toFixed(5)},${clinic.lng.toFixed(5)}` : '');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${clinic.name} ${where}`.trim())}`;
}

function clinicCard(clinic, index) {
  const rating = clinic.rating
    ? el('div', { class: 'clinic__rating' },
        el('b', {}, clinic.rating.toFixed(1)), ` / 5 · ${clinic.reviewCount ?? 0} reviews`)
    : el('a', {
        class: 'clinic__rating clinic__reviews',
        href: reviewsUrl(clinic),
        target: '_blank',
        rel: 'noopener',
      }, 'See ratings and reviews on Google Maps');

  return el('div', { class: 'clinic', 'data-index': index },
    el('div', { class: 'clinic__head' },
      el('span', { class: 'clinic__index' }, String(index + 1)),
      /* The name doubles as a "show me where" control: it flies the map to this
         pin and opens its label. */
      el('button', {
        class: 'clinic__locate',
        type: 'button',
        'aria-label': `Show ${clinic.name} on the map`,
        onClick: () => focusClinic(index, { fromList: true }),
      },
        el('div', { class: 'clinic__name' }, clinic.name),
        el('div', { class: 'clinic__addr' }, clinic.address || 'Address not listed')),
      el('div', { class: 'clinic__dist' }, formatDistance(clinic.distanceM))),
    el('div', { class: 'clinic__meta' },
      ...clinic.tags.map((tag, i) => el('span', { class: i === 0 ? 'tag tag--spec' : 'tag' }, tag)),
      clinic.openNow === true ? el('span', { class: 'tag' }, 'Open now') : null,
      clinic.openNow === false ? el('span', { class: 'tag' }, 'Closed now') : null),
    rating,
    el('div', { class: 'clinic__actions' },
      clinic.phone
        ? el('a', { class: 'btn', href: `tel:${clinic.phone.replace(/[^\d+]/g, '')}` }, 'Call')
        : el('a', { class: 'btn btn--ghost', href: clinic.website || clinic.directionsUrl, target: '_blank', rel: 'noopener' }, 'Look up'),
      el('a', { class: 'btn btn--ghost', href: clinic.directionsUrl, target: '_blank', rel: 'noopener' }, 'Directions')));
}

function renderNotice(extra) {
  const box = $('#places-notice');
  const configured = configuredKeys();
  box.replaceChildren();

  if (extra) box.append(el('div', { class: 'notice' }, extra));

  box.append(el('details', { class: 'notice' },
    el('summary', {}, configured.length
      ? `Lookup services · ${configured.length} key${configured.length > 1 ? 's' : ''} saved`
      : 'Lookup services · running keyless, add a key for reliability'),

    el('p', { class: 'small', style: 'margin-top:var(--space-3)' },
      'Clinics are looked up in this order, falling through to the next whenever one fails: '),
    el('p', { class: 'label' }, clinicProviders().join('  →  ')),
    el('p', { class: 'small', id: 'index-coverage' }, 'Checking the local index…'),

    el('p', { class: 'small' },
      "OpenStreetMap's services need no key and cost nothing, but they are shared, volunteer-run and often overloaded. They are the reason a lookup sometimes fails. Any key below is free to obtain and moves that provider ahead of them."),

    el('p', { class: 'small' },
      'Nobody publishes which insurance a practice accepts, so Versine does not guess at it. Ask when you call, and ask whether they see scoliosis patients, since not every orthopedist does.'),

    ...PROVIDER_KEYS.map(keyRow),

    el('p', { class: 'small muted', style: 'margin-top:var(--space-3)' },
      'Keys are stored in this browser only, and each is sent solely to the service it belongs to.')));

  describeCoverage();
}

/* The local index is the first thing tried, so say plainly how much of it there
   is, bundled with the app, and learned from searches on this device. */
async function describeCoverage() {
  const box = $('#index-coverage');
  if (!box) return;
  const c = await indexCoverage();

  const bundled = c.bundledRegions
    ? `${c.bundledClinics.toLocaleString()} clinics bundled across ${c.bundledRegions} regions (built ${c.builtAt})`
    : 'nothing bundled yet (run tools/build-clinic-index.mjs)';
  const learned = c.learnedClinics
    ? `${c.learnedClinics.toLocaleString()} learned from ${c.learnedAreas} searched area${c.learnedAreas === 1 ? '' : 's'} on this device`
    : 'nothing learned yet; every live search adds to it';

  box.replaceChildren(
    el('span', {}, `Local index: ${bundled}; ${learned}. `),
    c.learnedClinics
      ? el('button', { class: 'btn btn--quiet', style: 'padding:0', onClick: () => { clearLearned(); describeCoverage(); } }, 'Clear learned')
      : null,
  );
}

function keyRow(provider) {
  const input = el('input', {
    type: 'password',
    placeholder: `${provider.label} key`,
    value: getKey(provider.id),
    'aria-label': `${provider.label} API key`,
    style: 'flex:1;min-width:0',
  });

  const verdict = el('p', { class: 'small muted key-row__verdict' }, '');

  /* Dashboards hand out several keys and do not say which is which. Checking the
     key against the endpoint it will actually be used for is the only answer
     that means anything. */
  const check = async () => {
    verdict.textContent = 'Checking…';
    verdict.classList.remove('key-row__verdict--ok', 'key-row__verdict--bad');
    const result = await testKey(provider.id, input.value);
    verdict.textContent = result.message;
    verdict.classList.add(result.ok ? 'key-row__verdict--ok' : 'key-row__verdict--bad');
  };

  return el('div', { class: 'key-row' },
    el('div', { class: 'key-row__head' },
      el('span', { class: 'label' }, provider.label),
      /* Four of these on the screen, all reading the same out of context. */
      el('a', {
        href: provider.signup, target: '_blank', rel: 'noopener',
        class: 'small key-row__signup',
        'aria-label': `Get a free ${provider.label} key (opens in a new tab)`,
      }, 'Get a free key')),
    el('p', { class: 'small muted' }, provider.note),
    el('div', { class: 'locbar' }, input,
      el('button', { class: 'btn btn--ghost', onClick: check }, 'Test'),
      el('button', {
        class: 'btn',
        onClick: () => {
          setKey(provider.id, input.value);
          renderNotice();
          if (state.center) search();
        },
      }, 'Save')),
    verdict);
}

/* Status sits beside the controls rather than inside the results list, so a
   search finishing cannot wipe out the message explaining why the last one
   failed. */
function setStatus(message, isError = false, { retry = false } = {}) {
  const box = $('#loc-status');
  box.replaceChildren(el('span', {}, message));
  if (retry) {
    box.append(el('button', {
      class: 'btn btn--quiet loc-status__retry',
      onClick: () => search(),
    }, 'Try again'));
  }
  box.classList.toggle('loc-status--error', isError);
  box.classList.remove('hidden');
}

function clearStatus() {
  const box = $('#loc-status');
  box.textContent = '';
  box.classList.remove('loc-status--error');
  box.classList.add('hidden');
}

/** Move the map to a place immediately, before any lookup runs. */
function flyTo(center) {
  ensureMap();
  if (!map) return;
  map.flyTo({ center: [center.lng, center.lat], zoom: 13, duration: 1400 });
}

function setBusy(button, busy, label) {
  button.setAttribute('aria-busy', String(busy));
  button.textContent = label;
}

/* -------------------------------------------------------------------- map --- */

/* MapLibre GL drawing OpenFreeMap's vector tiles.
 *
 * This replaced Leaflet over CARTO raster tiles, after CARTO's basemaps began
 * answering every keyless request with a placeholder tile reading "API KEY
 * REQUIRED": the map loaded, drew nothing but those placeholders, and failed
 * no request, so nothing reported it. OpenFreeMap is free, needs no key or
 * account, and sets no request limit. Vector tiles also stay sharp at any zoom
 * and let the camera fly between places rather than jump.
 *
 * If OpenFreeMap is unreachable, the map falls back to OpenStreetMap's own raster
 * tiles, which are keyless too. Losing the basemap never loses the list.
 *
 * Pinned to 5.x: 6.x ships ES modules only and dropped the single-file build
 * this lazy loader uses. Like Leaflet before it, it is fetched only the first
 * time the map is wanted, so no other screen pays for it. */
const MAPLIBRE = 'https://unpkg.com/maplibre-gl@5.24.0/dist';
const VECTOR_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/* Liberty has the right layers (parks, water, road classes, buildings) but
   OpenStreetMap's own colours; these repaint it the way Apple Maps reads in
   light mode, which differs from Google's in a few telling ways: warm cream
   land rather than grey, lime-leaning parks, a brighter cyan-blue water,
   arterials left white (only motorways carry colour, a soft apricot yellow
   with almost no darker edge), near-white buildings, and near-black place
   names over pale grey road names. Rules run in order; the first one that
   matches a layer's id and can paint its type wins. The low-zoom satellite
   raster is dropped, Apple's map has none. */
const APPLE_TINT = [
  [/^background$/, { 'background-color': '#F7F4EE' }],
  [/^landuse_residential$/, { 'fill-color': '#F2EFE9', 'fill-opacity': 0.6 }],
  [/^park$/, { 'fill-color': '#BEE3A4', 'fill-outline-color': 'rgba(0,0,0,0)' }],
  [/^park_outline$/, { 'line-color': 'rgba(0,0,0,0)' }],
  [/^landcover_wood$/, { 'fill-color': '#B2DB98', 'fill-opacity': 0.85 }],
  [/^landcover_grass$|^landuse_pitch$|^landuse_track$/, { 'fill-color': '#C6E7B0' }],
  [/^landuse_cemetery$/, { 'fill-color': '#CFE6C0' }],
  [/^landcover_ice$/, { 'fill-color': '#F0F6F8' }],
  [/^landcover_sand$/, { 'fill-color': '#F5EDD0' }],
  [/^landuse_hospital$/, { 'fill-color': '#FADDE0' }],
  [/^landuse_school$/, { 'fill-color': '#F4EDDC' }],
  [/^water$/, { 'fill-color': '#86C6F1' }],
  [/^waterway/, { 'line-color': '#86C6F1' }],
  [/^aeroway_fill$/, { 'fill-color': '#ECE9F1' }],
  [/^aeroway_/, { 'line-color': '#FFFFFF' }],
  [/motorway.*casing$/, { 'line-color': '#F0C873' }],
  [/motorway/, { 'line-color': '#FFD98A' }],
  [/casing$/, { 'line-color': '#E7E2DA' }],
  [/trunk_primary|_link$|secondary_tertiary|minor|street|service_track|path_pedestrian/, { 'line-color': '#FFFFFF' }],
  [/rail/, { 'line-color': '#D3CFC9' }],
  [/^building$/, { 'fill-color': '#EDEAE5', 'fill-outline-color': '#E1DDD6' }],
  [/^building-3d$/, { 'fill-extrusion-color': '#EDEAE5' }],
  [/^boundary/, { 'line-color': '#C6BEDA' }],
  [/water.*label$/, { 'text-color': '#2C7BC0', 'text-halo-color': 'rgba(255,255,255,0.85)' }],
  [/^poi_transit$/, { 'text-color': '#2C6FB5' }],
  [/^poi_/, { 'text-color': '#6E6E73', 'text-halo-color': '#FFFFFF' }],
  [/^highway-name/, { 'text-color': '#8A8A8F', 'text-halo-color': '#FFFFFF' }],
  [/^airport$/, { 'text-color': '#6E6E73' }],
  [/^label_/, { 'text-color': '#1D1D1F', 'text-halo-color': '#FFFFFF' }],
];

/* A paint property belongs to one layer type: line-color to lines, text-color
   to symbols. A rule only matches layers it can paint, so a road rule whose
   pattern also matches a road's name label passes it on to the label rules. */
const paints = (key, layer) => (layer.type === 'symbol'
  ? key.startsWith('text-') || key.startsWith('icon-')
  : key.startsWith(`${layer.type}-`) || (layer.type === 'fill' && key.startsWith('fill-') && !key.startsWith('fill-extrusion')));

function appleTint(style) {
  style.layers = style.layers.filter((layer) => layer.id !== 'natural_earth');
  for (const layer of style.layers) {
    const rule = APPLE_TINT.find(([pattern, props]) => pattern.test(layer.id)
      && Object.keys(props).some((key) => paints(key, layer)));
    if (!rule) continue;
    const paint = { ...(layer.paint || {}) };
    for (const [key, value] of Object.entries(rule[1])) {
      if (paints(key, layer)) paint[key] = value;
    }
    layer.paint = paint;
  }
  return style;
}
const RASTER_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};
/* Tile failures tolerated from the vector source before switching to raster. */
const VECTOR_FAILURES_BEFORE_FALLBACK = 4;

const SCRUB = '#1F6E8C';
const PAPER = '#F7F9F9';

let mapLibPromise = null;
let mapBuilding = false;
let usingRaster = false;
let vectorFailures = 0;

function loadMapLibrary() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (mapLibPromise) return mapLibPromise;

  mapLibPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${MAPLIBRE}/maplibre-gl.css`;
    document.head.append(css);

    const script = document.createElement('script');
    script.src = `${MAPLIBRE}/maplibre-gl.js`;
    script.onload = () => resolve(window.maplibregl);
    script.onerror = () => {
      mapLibPromise = null;      // a later visit can retry a transient failure
      reject(new Error('MAP_LIBRARY_UNAVAILABLE'));
    };
    document.head.append(script);
  });

  return mapLibPromise;
}

/* The vector style is fetched up front so an outage is caught before the map
   exists, rather than as a blank canvas afterwards. */
async function chooseStyle() {
  try {
    const response = await fetchWithTimeout(VECTOR_STYLE_URL, {}, 6000);
    if (!response.ok) throw new Error(String(response.status));
    return appleTint(await response.json());
  } catch {
    usingRaster = true;
    return RASTER_STYLE;
  }
}

function ensureMap() {
  if (map || mapBuilding) return;
  mapBuilding = true;

  /* Every caller of ensureMap already copes with the map not existing yet, so
     the load can resolve later and catch up. */
  Promise.all([loadMapLibrary(), chooseStyle()])
    .then(([maplibregl, style]) => {
      buildMap(maplibregl, style);
      if (!map) return;
      if (state.results.length) drawMarkers(visibleResults());
    })
    .catch(() => {
      const host = $('#map');
      if (host) host.textContent = 'The map could not load. The list below still works.';
      host?.classList.add('map--failed');
    })
    .finally(() => { mapBuilding = false; });
}

function buildMap(maplibregl, style) {
  if (map) return;
  try {
    map = new maplibregl.Map({
      container: 'map',
      style,
      center: state.center ? [state.center.lng, state.center.lat] : [-98.35, 39.5],
      zoom: state.center ? 12 : 3,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      cooperativeGestures: false,
    });
  } catch {
    /* No WebGL, most often. The list still works without a map. */
    map = null;
    throw new Error('MAP_UNSUPPORTED');
  }

  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  /* Fires for the first style and again after any fallback swaps it, since a
     style swap discards every source and layer added on top. */
  map.on('style.load', () => {
    addIndexLayer();
    drawIndexMarkers();
  });
  map.on('moveend', drawIndexMarkers);

  /* Tiles that fail after the style loaded: switch to raster rather than leave
     holes in the map. */
  map.on('error', (event) => {
    if (usingRaster || event.sourceId !== 'openmaptiles') return;
    vectorFailures += 1;
    if (vectorFailures >= VECTOR_FAILURES_BEFORE_FALLBACK) {
      usingRaster = true;
      map.setStyle(RASTER_STYLE);
    }
  });
}

/* Every clinic the local index holds for the visible area, drawn as a GPU
   circle layer so hundreds of them cost nothing. Populated before anyone
   searches, and costs no network. */
function addIndexLayer() {
  if (!map || map.getSource('index')) return;
  map.addSource('index', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'index-dots',
    type: 'circle',
    source: 'index',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3, 15, 6],
      'circle-color': PAPER,
      'circle-stroke-color': SCRUB,
      'circle-stroke-width': 1.75,
    },
  });

  map.on('click', 'index-dots', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    new window.maplibregl.Popup({ offset: 10 })
      .setLngLat(feature.geometry.coordinates)
      .setHTML(popupHtml(feature.properties))
      .addTo(map);
  });
  map.on('mouseenter', 'index-dots', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'index-dots', () => { map.getCanvas().style.cursor = ''; });
}

const popupHtml = (clinic) => `<b>${escapeHtml(clinic.name)}</b>${escapeHtml(clinic.address || '')}`;

async function drawIndexMarkers() {
  const source = map?.getSource('index');
  if (!source) return;
  const b = map.getBounds();
  const clinics = await localInView({
    south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast(),
  });

  const listed = new Set(state.results.map((clinic) => `${clinic.name}|${Math.round(clinic.lat * 1e4)}`));
  const features = clinics
    .filter((clinic) => !listed.has(`${clinic.name}|${Math.round(clinic.lat * 1e4)}`))
    .map((clinic) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [clinic.lng, clinic.lat] },
      properties: { name: clinic.name, address: clinic.address || '' },
    }));

  source.setData({ type: 'FeatureCollection', features });
  $('#map-count').textContent = clinics.length ? `${clinics.length} in view` : '';
}

function drawMarkers(results) {
  ensureMap();
  if (!map) return;
  const maplibregl = window.maplibregl;

  resultMarkers.forEach((marker) => marker?.remove());
  resultMarkers = [];
  hereMarker?.remove();
  hereMarker = null;
  if (!state.center) return;

  const here = el('div', { class: 'here', title: 'Search centre' });
  hereMarker = new maplibregl.Marker({ element: here })
    .setLngLat([state.center.lng, state.center.lat])
    .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML('<b>Searching from here</b>'))
    .addTo(map);

  const bounds = new maplibregl.LngLatBounds([state.center.lng, state.center.lat], [state.center.lng, state.center.lat]);
  results.forEach((clinic, index) => {
    if (!clinic.lat || !clinic.lng) { resultMarkers.push(null); return; }

    /* MapLibre positions the outer element with a transform, so the pin that
       animates is the inner one. The drop is staggered down the list. */
    const pin = el('div', { class: 'pin', style: `animation-delay:${Math.min(index, 20) * 25}ms` }, String(index + 1));
    const wrap = el('div', { class: 'pin-wrap' }, pin);
    wrap.addEventListener('click', () => highlight(index, { scrollList: true }));

    const marker = new maplibregl.Marker({ element: wrap })
      .setLngLat([clinic.lng, clinic.lat])
      .setPopup(new maplibregl.Popup({ offset: 18 }).setHTML(popupHtml(clinic)))
      .addTo(map);
    resultMarkers.push(marker);
    bounds.extend([clinic.lng, clinic.lat]);
  });

  if (resultMarkers.some(Boolean)) {
    map.fitBounds(bounds, { padding: 56, maxZoom: 14, duration: 1100 });
  } else {
    map.flyTo({ center: [state.center.lng, state.center.lat], zoom: 12, duration: 1100 });
  }
  drawIndexMarkers();
}

/** Mark one clinic as current, in the list and on the map. */
function highlight(index, { scrollList = false } = {}) {
  $$('.clinic').forEach((card) => card.classList.toggle('clinic--active', Number(card.dataset.index) === index));
  resultMarkers.forEach((marker, i) => marker?.getElement().firstChild.classList.toggle('pin--active', i === index));
  if (scrollList) {
    $(`.clinic[data-index="${index}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/** Fly to a clinic picked from the list and open its label. */
function focusClinic(index, { fromList = false } = {}) {
  const marker = resultMarkers[index];
  highlight(index);
  if (!map || !marker) return;

  /* On a phone the map sits above the list, out of view once you have scrolled
     down to a card, so bring it back first. */
  if (fromList && !window.matchMedia('(min-width: 960px)').matches) {
    $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  map.flyTo({ center: marker.getLngLat(), zoom: Math.max(map.getZoom(), 15), duration: 1000 });
  resultMarkers.forEach((other) => { if (other?.getPopup()?.isOpen()) other.togglePopup(); });
  marker.togglePopup();
}
