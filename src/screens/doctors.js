/* Clinician finder: live geolocation plus a real places lookup, drawn on a map
 * and listed with the things you actually need — distance, specialty, phone,
 * directions. */

import { $, $$, el, formatDistance, escapeHtml } from '../lib/dom.js';
import { PLACES } from '../config.js';
import { findClinicians, currentPosition, geocode, describePlace, getApiKey, setApiKey } from '../lib/places.js';
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

/* OpenStreetMap carries no ratings, so the rating filter is meaningless against
   it. Without this the filter silently emptied the list. */
const providerHasRatings = () => state.provider === 'google';

let map = null;
let markerLayer = null;

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
    if (await search()) showResolvedPlace(null);
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
    if (await search()) showResolvedPlace(place.label);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(button, false, 'Find');
  }
}

/* ----------------------------------------------------------------- search --- */

/** @returns {Promise<boolean>} true if this search was still the current one. */
async function search() {
  if (!state.center) return false;
  const token = ++searchToken;

  setStatus('Searching for clinicians nearby…');
  $('#places-list').replaceChildren(el('div', { class: 'empty' }, 'Searching…'));

  try {
    const { results, provider, notice } = await findClinicians(state.center, state.radiusM);
    if (token !== searchToken) return false;   // a newer search has taken over

    state.results = results;
    state.provider = provider;
    $('#places-source').textContent = provider === 'google'
      ? 'Source: Google Places' : 'Source: OpenStreetMap';
    syncRatingFilter();
    renderResults(notice);
    clearStatus();
    return true;
  } catch (error) {
    if (token !== searchToken) return false;
    state.results = [];
    renderResults();
    setStatus(error.message, true);
    return false;
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
      : 'OpenStreetMap does not publish ratings. Add a Google Places key below to filter by rating.';
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
  const usingGoogle = Boolean(getApiKey());
  box.replaceChildren();

  if (extra) box.append(el('div', { class: 'notice' }, extra));

  box.append(el('details', { class: 'notice' },
    el('summary', {}, usingGoogle
      ? 'Using your Google Places key · insurance data'
      : 'Using OpenStreetMap · add a Google Places key for ratings'),
    el('p', { style: 'margin-top:var(--space-3)' },
      'Neither Google Places nor OpenStreetMap publishes which insurance a practice accepts, so Versine does not guess at it. Ask when you call — and ask whether they see scoliosis patients, since not every orthopedist does.'),
    el('p', { html: `With a <a href="https://developers.google.com/maps/documentation/places/web-service/get-api-key" target="_blank" rel="noopener">Google Places API key</a> you also get ratings, review counts, and opening hours. The key is stored only in this browser and sent only to <code>places.googleapis.com</code>.` }),
    keyForm()));
}

function keyForm() {
  const input = el('input', {
    type: 'password', placeholder: 'Google Places API key', value: getApiKey(),
    'aria-label': 'Google Places API key', style: 'flex:1;min-width:0',
  });
  return el('div', { class: 'locbar', style: 'margin-top:var(--space-3)' }, input,
    el('button', {
      class: 'btn',
      onClick: () => { setApiKey(input.value); renderNotice(); if (state.center) search(); },
    }, 'Save'));
}

/* Status sits beside the controls rather than inside the results list, so a
   search finishing cannot wipe out the message explaining why the last one
   failed. */
function setStatus(message, isError = false) {
  const box = $('#loc-status');
  box.textContent = message;
  box.classList.toggle('loc-status--error', isError);
  box.classList.remove('hidden');
}

function clearStatus() {
  const box = $('#loc-status');
  box.textContent = '';
  box.classList.remove('loc-status--error');
  box.classList.add('hidden');
}

function setBusy(button, busy, label) {
  button.setAttribute('aria-busy', String(busy));
  button.textContent = label;
}

/* -------------------------------------------------------------------- map --- */

function ensureMap() {
  if (map || typeof window.L === 'undefined') return;
  map = window.L.map('map', { zoomControl: false, attributionControl: true });
  window.L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  }).addTo(map);
  markerLayer = window.L.layerGroup().addTo(map);
  map.setView(state.center ? [state.center.lat, state.center.lng] : [39.5, -98.35], state.center ? 12 : 3);
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
}
