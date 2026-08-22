/* Clinician finder: live geolocation plus a real places lookup, drawn on a map
 * and listed with the things you actually need — distance, specialty, phone,
 * directions. */

import { $, $$, el, formatDistance, escapeHtml } from '../lib/dom.js';
import { PLACES } from '../config.js';
import { findClinicians, currentPosition, geocode, getApiKey, setApiKey } from '../lib/places.js';
import { onEnter } from '../router.js';

const LAST_CENTER_KEY = 'spinecheck.lastCenter';

const state = {
  center: null,
  radiusM: PLACES.defaultRadiusM,
  specs: new Set(),
  minRating: 0,
  results: [],
  loading: false,
};

let map = null;
let markerLayer = null;

export function initDoctors() {
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

function restoreCenter() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_CENTER_KEY) || 'null');
    if (saved?.lat) state.center = saved;
  } catch { /* ignore malformed cache */ }
}

function rememberCenter() {
  localStorage.setItem(LAST_CENTER_KEY, JSON.stringify(state.center));
}

async function useCurrentLocation() {
  setStatus('Locating you…');
  try {
    state.center = await currentPosition();
    rememberCenter();
    await search();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function useTypedLocation() {
  const query = $('#loc-input').value.trim();
  if (!query) return;
  setStatus(`Looking up “${query}”…`);
  try {
    const place = await geocode(query);
    state.center = { lat: place.lat, lng: place.lng };
    rememberCenter();
    await search();
  } catch (error) {
    setStatus(error.message, true);
  }
}

/* ----------------------------------------------------------------- search --- */

async function search() {
  if (!state.center || state.loading) return;
  state.loading = true;
  setStatus('Searching for clinicians nearby…');

  try {
    const { results, provider, notice } = await findClinicians(state.center, state.radiusM);
    state.results = results;
    $('#places-source').textContent = provider === 'google'
      ? 'Source: Google Places' : 'Source: OpenStreetMap';
    renderResults(notice);
  } catch (error) {
    state.results = [];
    setStatus(`Search failed: ${error.message}`, true);
  } finally {
    state.loading = false;
  }
}

function visibleResults() {
  return state.results.filter((clinic) => {
    if (state.specs.size && !state.specs.has(clinic.specialty)) return false;
    if (state.minRating && !(clinic.rating >= state.minRating)) return false;
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
    list.append(el('div', { class: 'empty' },
      state.center
        ? 'No matching practices in this radius. Widen the distance filter, or search a nearby larger town.'
        : 'Set a location above to see clinicians near you.'));
    return;
  }
  results.forEach((clinic, index) => list.append(clinicCard(clinic, index)));
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
      'Neither Google Places nor OpenStreetMap publishes which insurance a practice accepts, so SpineCheck does not guess at it. Ask when you call — and ask whether they see scoliosis patients, since not every orthopedist does.'),
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

function setStatus(message, isError = false) {
  $('#places-list').replaceChildren(
    el('div', { class: isError ? 'quality-note' : 'empty' }, message));
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
