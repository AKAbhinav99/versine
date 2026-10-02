/* Builds the bundled clinic index from OpenStreetMap.
 *
 * Run occasionally, by hand, never at page load:
 *   node tools/build-clinic-index.mjs                  # every region, via Overpass
 *   node tools/build-clinic-index.mjs boston nyc       # named regions only
 *   GEOAPIFY_KEY=xxx node tools/build-clinic-index.mjs # via Geoapify instead
 *
 * Prefer the Geoapify path if you have a key. It is built for bulk queries,
 * answers in a second, and a whole index costs a few dozen of a 3,000-a-day free
 * allowance. Overpass works but is slow, easily overloaded, and will start
 * refusing connections if you push it, which is exactly what it is for.
 *
 * The point is to move the clinic lookup off the network entirely for covered
 * areas. Overpass is a free, shared, volunteer-run service that is frequently
 * overloaded, asking it a question every time a user searches is both fragile
 * and rude. Asking it once per region, offline, and shipping the answer is
 * neither.
 *
 * Being a good citizen of that service is the reason this file is slow on
 * purpose: one request at a time, a pause between each, small bounding boxes so
 * no single query is expensive, and a real User-Agent so the operators can see
 * who is asking. Do not parallelise it. */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'data', 'clinics');

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const GEOAPIFY_KEY = process.env.GEOAPIFY_KEY || '';
/* Verified live: "healthcare.physiotherapist" is not a Geoapify category and
   400s the whole request. Geoapify has no physiotherapy category at all. */
const GEOAPIFY_CATEGORIES = [
  'healthcare.clinic_or_praxis',
  'healthcare.clinic_or_praxis.orthopaedics',
  'healthcare.clinic_or_praxis.paediatrics',
  'healthcare.hospital',
].join(',');
const USER_AGENT = 'versine-clinic-index/1.0 (scoliosis screening aid; one-off index build)';
const PAUSE_MS = 2500;      // between requests, always
const RETRIES = 4;

/* bbox is [south, west, north, east]. Keep each under roughly half a degree,
   larger boxes make Overpass time out rather than answer slowly. */
const REGIONS = [
  { id: 'boston', name: 'Boston', bbox: [42.20, -71.30, 42.55, -70.95] },
  { id: 'nyc', name: 'New York City', bbox: [40.55, -74.10, 40.90, -73.75] },
  { id: 'philadelphia', name: 'Philadelphia', bbox: [39.87, -75.32, 40.14, -74.95] },
  { id: 'washington', name: 'Washington DC', bbox: [38.79, -77.15, 39.00, -76.90] },
  { id: 'atlanta', name: 'Atlanta', bbox: [33.64, -84.55, 33.90, -84.28] },
  { id: 'miami', name: 'Miami', bbox: [25.68, -80.35, 25.90, -80.12] },
  { id: 'chicago', name: 'Chicago', bbox: [41.70, -87.90, 42.05, -87.52] },
  { id: 'houston', name: 'Houston', bbox: [29.65, -95.55, 29.90, -95.25] },
  { id: 'dallas', name: 'Dallas', bbox: [32.70, -96.90, 32.95, -96.65] },
  { id: 'austin', name: 'Austin', bbox: [30.18, -97.85, 30.45, -97.65] },
  { id: 'denver', name: 'Denver', bbox: [39.62, -105.10, 39.85, -104.85] },
  { id: 'phoenix', name: 'Phoenix', bbox: [33.35, -112.20, 33.60, -111.90] },
  { id: 'seattle', name: 'Seattle', bbox: [47.50, -122.44, 47.73, -122.24] },
  { id: 'sanfrancisco', name: 'San Francisco Bay', bbox: [37.70, -122.52, 37.90, -122.20] },
  { id: 'losangeles', name: 'Los Angeles', bbox: [33.95, -118.50, 34.15, -118.20] },
  { id: 'sandiego', name: 'San Diego', bbox: [32.68, -117.28, 32.90, -117.05] },
];

const CLAUSES = [
  'nwr["healthcare"="physiotherapist"]',
  'nwr["healthcare"="doctor"]',
  'nwr["amenity"="doctors"]',
];

/* The same relevance test the live providers use, so bundled and live results
   are the same kind of thing. */
const RELEVANT = /ortho|spine|spinal|scolio|physical therapy|physiotherap|sports medicine|rehab|chiro/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ask(clause, bbox) {
  const [s, w, n, e] = bbox;
  const body = new URLSearchParams({
    data: `[out:json][timeout:60];${clause}(${s},${w},${n},${e});out center 2000;`,
  });

  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    if (attempt) await sleep(3000 * attempt);
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.remark && /timed out|error/i.test(data.remark)) throw new Error(data.remark);
      return data.elements || [];
    } catch (error) {
      if (attempt === RETRIES - 1) throw error;
      process.stdout.write(` retry(${error.message.slice(0, 28)})`);
    }
  }
  return [];
}

function classify(text) {
  const haystack = text.toLowerCase();
  if (/p(a)?ediatric|child|kids/.test(haystack)) return 'pediatric';
  if (/physio|physical therapy|therapist|rehab/.test(haystack)) return 'pt';
  return 'ortho';
}

/** Compact tuple per clinic, this ships to every phone, so every byte counts.
 *  [name, lat, lng, specialty, phone|0, address|0] */
function toRecord(element) {
  const tags = element.tags || {};
  if (!tags.name) return null;

  const haystack = `${tags.name} ${tags['healthcare:speciality'] || ''} ${tags.healthcare || ''}`;
  const isPhysio = tags.healthcare === 'physiotherapist';
  if (!isPhysio && !RELEVANT.test(haystack)) return null;

  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (!lat || !lng) return null;

  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const address = [street, tags['addr:city'], tags['addr:postcode']].filter(Boolean).join(', ');

  return [
    tags.name.slice(0, 80),
    Number(lat.toFixed(5)),
    Number(lng.toFixed(5)),
    classify(haystack),
    tags.phone || tags['contact:phone'] || 0,
    address || 0,
  ];
}

/* Geoapify returns the same places in its own shape, and takes a bounding box
   directly, so one request replaces the three Overpass clauses. */
async function askGeoapify(bbox) {
  const [s, w, n, e] = bbox;
  const params = new URLSearchParams({
    categories: GEOAPIFY_CATEGORIES,
    filter: `rect:${w},${s},${e},${n}`,
    limit: '500',
    apiKey: GEOAPIFY_KEY,
  });

  const response = await fetch(`https://api.geoapify.com/v2/places?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`Geoapify HTTP ${response.status}`);
  const data = await response.json();

  return (data.features || []).map((feature) => {
    const p = feature.properties || {};
    return {
      lat: p.lat ?? feature.geometry?.coordinates?.[1],
      lon: p.lon ?? feature.geometry?.coordinates?.[0],
      tags: {
        name: p.name,
        healthcare: (p.categories || []).some((c) => c.includes('.orthopaedics')) ? 'orthopaedics' : '',
        'healthcare:speciality': (p.categories || []).join(' '),
        phone: p.contact?.phone || p.phone,
        'addr:street': p.street,
        'addr:housenumber': p.housenumber,
        'addr:city': p.city,
        'addr:postcode': p.postcode,
      },
    };
  });
}

async function buildRegion(region) {
  const seen = new Map();
  const collect = (elements) => {
    for (const element of elements) {
      const record = toRecord(element);
      if (!record) continue;
      seen.set(`${record[0].toLowerCase()}|${Math.round(record[1] * 1e4)}`, record);
    }
  };

  if (GEOAPIFY_KEY) {
    collect(await askGeoapify(region.bbox));
    await sleep(500);
  } else {
    for (const clause of CLAUSES) {
      collect(await ask(clause, region.bbox));
      await sleep(PAUSE_MS);
    }
  }

  const records = [...seen.values()].sort((a, b) => a[1] - b[1]);
  await writeFile(join(OUT_DIR, `${region.id}.json`), JSON.stringify(records));
  return records.length;
}

async function main() {
  console.log(GEOAPIFY_KEY
    ? 'Source: Geoapify (GEOAPIFY_KEY set)\n'
    : 'Source: Overpass. Slow and easily overloaded, set GEOAPIFY_KEY for a faster, kinder build.\n');

  const wanted = process.argv.slice(2);
  const regions = wanted.length ? REGIONS.filter((r) => wanted.includes(r.id)) : REGIONS;
  await mkdir(OUT_DIR, { recursive: true });

  const entries = [];
  for (const region of regions) {
    process.stdout.write(`${region.name.padEnd(22)}`);
    try {
      const count = await buildRegion(region);
      entries.push({ id: region.id, name: region.name, bbox: region.bbox, count });
      console.log(` ${String(count).padStart(4)} clinics`);
    } catch (error) {
      console.log(` FAILED ${error.message}`);
    }
    await sleep(PAUSE_MS);
  }

  const manifest = {
    builtAt: new Date().toISOString().slice(0, 10),
    source: 'OpenStreetMap contributors, ODbL',
    regions: entries,
    total: entries.reduce((sum, entry) => sum + entry.count, 0),
  };
  await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n${manifest.total} clinics across ${entries.length} regions -> data/clinics/`);
}

main().catch((error) => { console.error(error); process.exit(1); });
