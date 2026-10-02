/* Ratings for the clinician finder, through Google Places, with the key kept
 * on the server.
 *
 * OpenStreetMap has no ratings at all (it is a map, not a review site), and
 * asking every visitor to bring their own Google key meant nobody saw ratings.
 * This function holds one key, set as GOOGLE_PLACES_API_KEY in the Vercel
 * project, and answers GET /api/places?lat=..&lng=..&radius=.. with practices
 * near that point. Without the key it answers 503 { configured: false } and the
 * app carries on with OpenStreetMap, so the site works either way.
 *
 * Privacy and cost, together: the point is rounded to two decimal places
 * (about a kilometre) before it leaves for Google, and the response is cached
 * at Vercel's edge per rounded point for a day. Neighbours searching the same
 * area share one Google call, and Google never sees a precise location. */

const QUERIES = [
  { text: 'orthopedic surgeon scoliosis', spec: 'ortho' },
  { text: 'pediatric orthopedic doctor', spec: 'pediatric' },
  { text: 'physical therapist scoliosis', spec: 'pt' },
];

const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
  'places.rating', 'places.userRatingCount', 'places.nationalPhoneNumber',
  'places.types', 'places.googleMapsUri', 'places.websiteUri',
].join(',');

const json = (body, status, cache) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
});

export async function GET(request) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const url = new URL(request.url);

  /* The app asks once per visit whether ratings are available here. */
  if (url.searchParams.has('probe')) {
    return json({ configured: Boolean(key) }, 200, 'public, max-age=300, s-maxage=300');
  }
  if (!key) return json({ configured: false }, 503, 'public, max-age=60, s-maxage=60');

  /* Same-site browser requests only. Not a security boundary (a script can
     send any header), but it stops other sites from spending the quota from
     their visitors' browsers. The real cap is the daily quota set on the key. */
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'same-site') {
    return json({ error: 'Cross-site requests are not served.' }, 403, 'no-store');
  }

  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  const radius = Math.round(Number(url.searchParams.get('radius')) || 15000);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return json({ error: 'lat and lng are required.' }, 400, 'no-store');
  }
  const point = { latitude: Number(lat.toFixed(2)), longitude: Number(lng.toFixed(2)) };
  const circle = { center: point, radius: Math.max(1000, Math.min(radius, 50000)) };

  const settled = await Promise.allSettled(QUERIES.map(async ({ text, spec }) => {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
      body: JSON.stringify({ textQuery: text, maxResultCount: 20, locationBias: { circle } }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(`Google answered ${response.status}${detail.error?.status ? ` (${detail.error.status})` : ''}`);
    }
    const data = await response.json();
    return (data.places || []).map((place) => ({
      id: place.id,
      name: place.displayName?.text || 'Unnamed practice',
      address: place.formattedAddress || '',
      lat: place.location?.latitude ?? null,
      lng: place.location?.longitude ?? null,
      rating: place.rating ?? null,
      reviewCount: place.userRatingCount ?? null,
      phone: place.nationalPhoneNumber || null,
      types: place.types || [],
      website: place.websiteUri || null,
      mapsUrl: place.googleMapsUri || null,
      spec,
    }));
  }));

  const places = settled.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
  if (!places.length) {
    const failure = settled.find((r) => r.status === 'rejected');
    if (failure) return json({ error: failure.reason.message }, 502, 'no-store');
  }
  /* Ratings move slowly; a day at the edge, and a week of serving stale while
     it refreshes. That is also why "open now" is not asked for: a cached
     answer to it would be wrong for most of the day. */
  return json({ configured: true, places }, 200, 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
}
