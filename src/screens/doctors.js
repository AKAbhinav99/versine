/* Clinician finder: live geolocation plus a real places lookup, drawn on a map
 * and listed with the things you actually need — distance, specialty, phone,
 * directions. */

import { $, $$, el, formatDistance, escapeHtml } from '../lib/dom.js';
import { PLACES } from '../config.js';
import { findClinicians, clinicProviders } from '../lib/clinics.js';
import { geocode, describePlace } from '../lib/geocoding.js';
import { currentPosition } from '../lib/geolocation.js';
import { CancelledError } from '../lib/net.js';
import { PROVIDER_KEYS, getKey, setKey, configuredKeys } from '../lib/keys.js';
import { localInView, indexCoverage, clearLearned } from '../lib/clinic-index.js';
import { countryOptions, defaultCountry } from '../lib/countries.js';
import { onEnter } from '../router.js';

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
   the newest — so pressing the button again supersedes the request in flight
   instead of being dropped, which is what used to happen. Overpass can take
   fifteen seconds, and for that whole window every press did nothing. */
let searchToken = 0;
let inFlight = null;   // AbortController for the search currently running

/* Only Google publishes ratings, so the rating filter is meaningless against the
   others. Without this the filter silently emptied the list. */
let providerHasRatings = () => false;

let map = null;
let markerLayer = null;   // numbered pins for the current result list
let indexLayer = null;    // every clinic the local index knows about, in view

export function initDoctors() {
  initCountrySelect();
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

  onEnter('doctors', onShow);
  restoreCenter();
}

function onShow() {
  ensureMap();
  if (map) setTimeout(() => map.invalidateSize(), 60);
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
    setStatus('Type a postal code, city, or address first — or use your location.', true);
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
     enough — the abandoned request kept holding one of the few per-IP slots the
     free service allows, so repeated presses starved each other. */
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;

  setStatus('Searching for clinicians nearby…');
  $('#places-list').replaceChildren(el('div', { class: 'empty' }, 'Searching…'));

  try {
    const answer = await findClinicians(state.center, state.radiusM, { signal: controller.signal, skipLocal });
    if (token !== searchToken) return false;   // a newer search has taken over

    state.results = answer.results;
    state.provider = answer.provider;
    providerHasRatings = () => answer.hasRatings;
    $('#places-source').textContent = `Source: ${answer.label}`;
    syncRatingFilter();

    /* If earlier providers were tried and failed, say which — silently falling
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
      : 'This lookup service does not publish ratings. Only Google Places does — add a key below.';
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
    return `All ${hidden} nearby practices were hidden by the ${state.minRating.toFixed(1)}+ rating filter. Many clinics have no rating at all, so this filter is aggressive — turn it off to see them.`;
  }
  if (state.specs.size) {
    return `All ${hidden} nearby practices were hidden by the specialty filter. Turn one off to widen the search.`;
  }
  return `All ${hidden} results are further away than the current distance filter allows.`;
}

function clinicCard(clinic, index) {
  const rating = clinic.rating
    ? el('div', { class: 'clinic__rating' },
        el('b', {}, clinic.rating.toFixed(1)), ` / 5 · ${clinic.reviewCount ?? 0} reviews`)
    : el('div', { class: 'clinic__rating muted' }, 'No rating data in OpenStreetMap');

  return el('div', { class: 'clinic' },
    el('div', { class: 'clinic__head' },
      el('span', { class: 'clinic__index' }, String(index + 1)),
      el('div', {},
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
      "OpenStreetMap's services need no key and cost nothing, but they are shared, volunteer-run and often overloaded — they are the reason a lookup sometimes fails. Any key below is free to obtain and moves that provider ahead of them."),

    el('p', { class: 'small' },
      'Nobody publishes which insurance a practice accepts, so Versine does not guess at it. Ask when you call — and ask whether they see scoliosis patients, since not every orthopedist does.'),

    ...PROVIDER_KEYS.map(keyRow),

    el('p', { class: 'small muted', style: 'margin-top:var(--space-3)' },
      'Keys are stored in this browser only, and each is sent solely to the service it belongs to.')));

  describeCoverage();
}

/* The local index is the first thing tried, so say plainly how much of it there
   is — bundled with the app, and learned from searches on this device. */
async function describeCoverage() {
  const box = $('#index-coverage');
  if (!box) return;
  const c = await indexCoverage();

  const bundled = c.bundledRegions
    ? `${c.bundledClinics.toLocaleString()} clinics bundled across ${c.bundledRegions} regions (built ${c.builtAt})`
    : 'nothing bundled yet — run tools/build-clinic-index.mjs';
  const learned = c.learnedClinics
    ? `${c.learnedClinics.toLocaleString()} learned from ${c.learnedAreas} searched area${c.learnedAreas === 1 ? '' : 's'} on this device`
    : 'nothing learned yet — every live search adds to it';

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

  return el('div', { class: 'key-row' },
    el('div', { class: 'key-row__head' },
      el('span', { class: 'label' }, provider.label),
      el('a', { href: provider.signup, target: '_blank', rel: 'noopener', class: 'small' }, 'Get a free key')),
    el('p', { class: 'small muted' }, provider.note),
    el('div', { class: 'locbar' }, input,
      el('button', {
        class: 'btn',
        onClick: () => {
          setKey(provider.id, input.value);
          renderNotice();
          if (state.center) search();
        },
      }, 'Save')));
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
  map.setView([center.lat, center.lng], 13);
  drawIndexMarkers();
}

function setBusy(button, busy, label) {
  button.setAttribute('aria-busy', String(busy));
  button.textContent = label;
}

/* -------------------------------------------------------------------- map --- */

function ensureMap() {
  if (map || typeof window.L === 'undefined') return;
  map = window.L.map('map', { zoomControl: false, attributionControl: true });
  map.on('moveend', drawIndexMarkers);
  window.L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  }).addTo(map);
  indexLayer = window.L.layerGroup().addTo(map);
  markerLayer = window.L.layerGroup().addTo(map);
  map.setView(state.center ? [state.center.lat, state.center.lng] : [39.5, -98.35], state.center ? 12 : 3);
}

/* Everything the local index holds for the visible area, drawn as plain dots so
   the map is populated before anyone searches anything. Costs no network. */
async function drawIndexMarkers() {
  if (!map || !indexLayer) return;
  const b = map.getBounds();
  const clinics = await localInView({
    south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast(),
  });

  indexLayer.clearLayers();
  const listed = new Set(state.results.map((clinic) => `${clinic.name}|${Math.round(clinic.lat * 1e4)}`));

  for (const clinic of clinics) {
    if (listed.has(`${clinic.name}|${Math.round(clinic.lat * 1e4)}`)) continue;
    window.L.circleMarker([clinic.lat, clinic.lng], {
      radius: 4, color: '#1F6E8C', weight: 1.5, fillColor: '#EDF0F1', fillOpacity: 0.9,
    }).addTo(indexLayer).bindPopup(`<b>${escapeHtml(clinic.name)}</b><br>${escapeHtml(clinic.address || '')}`);
  }

  $('#map-count').textContent = clinics.length ? `${clinics.length} in view` : '';
}

function drawMarkers(results) {
  ensureMap();
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  if (!state.center) return;

  window.L.circleMarker([state.center.lat, state.center.lng], {
    radius: 6, color: '#D6402A', fillColor: '#D6402A', fillOpacity: 1, weight: 2,
  }).addTo(markerLayer).bindPopup('You are here');

  const bounds = [[state.center.lat, state.center.lng]];
  results.forEach((clinic, index) => {
    if (!clinic.lat || !clinic.lng) return;
    window.L.marker([clinic.lat, clinic.lng], {
      icon: window.L.divIcon({ className: '', html: `<div class="pin">${index + 1}</div>`, iconSize: [26, 26] }),
    }).addTo(markerLayer).bindPopup(
      `<b>${escapeHtml(clinic.name)}</b><br>${escapeHtml(clinic.address || '')}`,
    );
    bounds.push([clinic.lat, clinic.lng]);
  });

  if (bounds.length > 1) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
  else map.setView([state.center.lat, state.center.lng], 12);
  drawIndexMarkers();
}
