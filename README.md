# Versine

A mobile-first web app that screens for the surface asymmetry associated with
scoliosis, using a phone camera and the Adam's forward bend test, then points the
user toward clinicians who actually treat it.

**Versine does not diagnose scoliosis.** It measures geometry in a photograph.
Scoliosis is diagnosed by a licensed physician from a standing spine X-ray, measured
as a Cobb angle. The UI says so in the onboarding gate, on every result, and in the
resources section.

## Running it

No build step, no dependencies to install. It is static files plus two CDN libraries.

```bash
cd ~/spinecheck && python3 -m http.server 4321
```

Then open `http://localhost:4321`. A few notes:

- **Camera access needs a secure context.** `localhost` counts; a plain-HTTP LAN
  address does not. To test on a real phone, serve over HTTPS or tunnel it
  (`ngrok http 4321`, `cloudflared tunnel --url http://localhost:4321`).
- **The first scan needs a network connection** to fetch the MediaPipe pose model
  (~10 MB, then browser-cached).
- `http://localhost:4321/?demo` renders the result screen from a hand-written
  landmark fixture, for showing the app on a machine with no camera. The demo
  photo is labelled as such on the image itself.

## The measurement

All of it is trigonometry on pose landmarks, in [`src/lib/geometry.js`](src/lib/geometry.js).
There is no classifier and no model inference beyond landmark detection — the same
landmarks always produce the same numbers.

| Function | What it computes |
|---|---|
| `calculateShoulderAsymmetry` | Angle between the shoulder line and horizontal, in pixel space so the image aspect ratio doesn't skew it. |
| `calculateHipAsymmetry` | Same, for the hip line. |
| `assessPoseQuality` | Landmark confidence, framing, forward-bend sanity check, and a "was the phone held level" check. |
| `POSE_CHECK` | Photographed from behind, shoulders sit higher in the frame than hips whether standing or bent — a camera at chest height looks down at both. What bending changes is foreshortening, so the check is the shoulder-to-hip distance against shoulder width, not their vertical order. |
| `measureWithConsensus` | Runs the above at five framings of the same photo and reduces them to a median, a spread, and a usable/withheld verdict. |

**The previous scan can be shown over the viewfinder.** Framing variance is the
largest error in the pipeline — it is literally what `measureWithConsensus`
quantifies by re-cropping the same photo five times, and what the reliability gate
withholds readings for. It is also the part the person holding the phone actually
controls. So once a scan exists, the last one is drawn faintly over the live
preview to stand in the same place again. It is a framing aid and touches no
pixels: matching a previous photo cannot make a curve look better or worse, only
make two readings comparable. The preview mirrors for the front camera and the
captured frame does not, so the ghost mirrors with it.

**The photo can be lined up first.** Capture hands off to an adjust step where
the shot can be panned, zoomed and rotated onto the framing guide. Pan and zoom
are free — neither changes an angle. Rotation is not: it moves the measured
shoulder tilt one degree for one degree, which the benchmark confirmed directly
(a 6° image roll shifted the reading by ~6.5°). So it is capped at 20°, the screen
draws horizontal rules and tells you to level the room rather than your shoulders,
the applied angle is stored with the scan, and the result screen repeats it.

**Every reading is measured five times.** Landmark positions shift when a photo is
re-cropped, by about as much as the asymmetry being measured, so
[`src/lib/consensus.js`](src/lib/consensus.js) measures each photo at two crops,
two pads, and as-shot. The median is the reading, the spread is the error bar shown
as `±`, and a spread over 3.5° withholds the number rather than reporting it.

Banding lives in [`src/lib/screening.js`](src/lib/screening.js), on shoulder tilt:

- **≥ 3.5°** → worth a professional look
- **2–3.5°** → track it, rescan in a couple of months
- **< 2°** → no significant asymmetry

Hip tilt is reported as context and used for the camera-roll check, but does not
trigger anything: in the benchmark it did not separate the two groups.

### What is deliberately not measured

Trunk rotation. An earlier version estimated an angle of trunk rotation from the
depth values MediaPipe reports, and compared it against the 7° scoliometer referral
threshold. Benchmarked against clinical photographs it turned out to be noise — the
depth estimate moved by more than a rib hump's worth when the same photo was
re-cropped. It was removed rather than caveated. A segmentation-mask silhouette
measure was tried as a replacement and did not separate the groups either. See
[bench/README.md](bench/README.md) for the numbers.

## Intake

Growth remaining, family history, and symptoms decide as much about a curve as its
size does, and none of them are visible in a photograph. Eight questions capture
them, kept on the device with the scans.

The answers do exactly two things, and deliberately not a third:

- **Red flags** — night pain, leg numbness or weakness, new bladder or bowel
  trouble, or a back that has visibly changed in months — raise a block that sits
  *above* the verdict on the result screen. A reassuring number should not be the
  first thing read by someone who has just reported leg weakness.
- **Risk factors** are carried onto the referral summary as context.

They never move the screening bands, and they are never combined into a risk
score. There is no data here to support one, and inventing a number that looks
authoritative is the exact failure this app already corrected once, when the
depth-derived rotation estimate turned out to be noise. `tests/intake.test.mjs`
exists mostly to make breaking that rule a deliberate act.

## Finding care

Two provider chains, each trying the next when one fails. Everything is optional:
with no keys at all the app runs entirely on OpenStreetMap's keyless services.

**Clinics** ([`src/lib/clinics.js`](src/lib/clinics.js)) — local first, then richest:

| | key | gives |
|---|---|---|
| Local index | none | instant, offline, cannot fail — see below |
| Google Places | required | ratings, review counts, opening hours |
| OpenStreetMap / Overpass | none | the best data for this niche, and the flakiest service |
| Geoapify Places | required | general clinics and hospitals, as a last resort |

OpenStreetMap sits **above** Geoapify despite being far less reliable, because the
ordering is by how useful the answer is, not how dependable the service is.
Measured on the same 15 km circle in Cambridge MA: OpenStreetMap returned 28
practices that actually treat backs (25 physical therapy, 3 orthopedic); Geoapify
returned 59 general clinics and hospitals and no specialists at all. Geoapify has
no physiotherapy category — `healthcare.physiotherapist` does not exist and 400s
the whole request — so it cannot find the single most common practice type this
app is looking for. It stays as the bottom of the chain because a hospital is a
real route to a referral, and those results are labelled "General clinic" rather
than dressed up as specialists.

### The local index

The most reliable network call is the one you don't make. Clinics are looked up
first in a local index held on the device, and only when that has nothing does the
app go to a server. A search of a covered area makes **zero** clinic network
requests — typing an address geocodes it, moves the map, and filters data already
present.

Two things fill it, in [`src/lib/clinic-index.js`](src/lib/clinic-index.js):

- **bundled** — regions built offline by
  [`tools/build-clinic-index.mjs`](tools/build-clinic-index.mjs) and shipped as
  static JSON under `data/clinics/`. Same origin, no key, no rate limit.
- **learned** — every live lookup is folded back in and kept, so an area searched
  once is local from then on. The index fills in wherever it is actually used.

Local results are offered only for areas known to be covered — a bundled region,
or an area a live search has already swept. Otherwise a half-populated corner
would suppress the live lookup that would have found the rest.

The map draws every clinic the index knows about in the current viewport as you
pan, so it is populated before anyone searches. "Search this area for more" forces
a live lookup for wherever the map is and folds the answer in.

**`data/clinics/` ships empty.** Build it with:

```bash
GEOAPIFY_KEY=xxx node tools/build-clinic-index.mjs
```

Geoapify answers in about a second per region, but bear the coverage caveat above
in mind — an index built from it will be hospitals rather than physiotherapists.
Overpass gives better data for this purpose and is the default, but it is slow and
will start refusing connections if pushed, which is why it runs one request at a
time with pauses. `data/clinics/` currently ships Boston and New York (231
clinics, 28 KB); the rest of the configured regions are yours to build.

Each provider's key can be checked in place from the Care tab — the **Test**
button calls the endpoint Versine actually uses it for, since provider dashboards
hand out several keys and rarely say which is which.

**Geocoding** ([`src/lib/geocoding.js`](src/lib/geocoding.js)) — keyless first, so no
quota is spent while the free service is healthy: Nominatim → Geoapify → MapTiler
→ Geocode.maps.co.

Overpass is deliberately last. It is free, shared and volunteer-run, and it is the
service that made the chain necessary — it answers 429 when its per-IP slots fill,
504 when its gateway gives up, and sometimes drops connections outright, which a
browser reports only as `TypeError: Failed to fetch`. It gets three attempts with
backoff before the chain moves on.

Keys are entered in the Care tab, stored in `localStorage` on the device, and each
is sent only to the service it belongs to. Every provider that fails is named in
the UI, with the reason — an invalid key reports as "rejected the API key (401)"
rather than disappearing into a silent fallback.

**Postal codes get a country.** "2000" is a valid postcode in Australia, Belgium,
Denmark and a dozen other places, so a bare code is sent as a postal code
constrained to the selected country (defaulted from the browser locale) wherever
the provider supports saying so. The resolved place is printed above the map, so a
wrong match is visible rather than silent, and GPS fixes are reverse-geocoded for
the same reason.

**The rating filter follows the data.** Only Google publishes ratings, so against
any other provider the rating chips are disabled with an explanation rather than
silently emptying the list. Empty results name the filter responsible. Nobody
publishes insurance acceptance, so the app doesn't invent it.

The map is Leaflet with CARTO tiles.

## Layout

```
index.html              app shell, all screens, resources copy
styles/                 tokens, base, capture, result, care, intake
src/
  config.js             model URLs, thresholds, places config
  router.js             screen switching with enter/leave hooks
  lib/
    geometry.js         the asymmetry math (pure, testable)
    screening.js        quality checks, banding, next steps
    pose.js             MediaPipe Pose wrapper
    storage.js          scan history in localStorage
    intake.js           the questions a photo cannot ask, and what they mean
    dom.js              small DOM helpers
  screens/
    capture.js          camera, framing guide, self-timer, camera switch, ghost, upload
    adjust.js           pan/zoom/rotate the photo onto the guide before measuring
    analyze.js          the analysis pipeline and its progress log
    overlay.js          landmark/measurement drawing on the photo
    result.js           verdict, readouts, threshold ruler
    intake.js           growth, family history, and symptom questions
    doctors.js          map, filters, clinic cards
    history.js          trend chart and scan log
    consensus.js        multi-framing measurement and the reliability gate
    net.js              shared fetch, cancellation, and the provider chain
    keys.js             optional API keys, stored per device
    geocoding.js        place lookup across four providers
    clinics.js          clinician search across three providers
    geolocation.js      browser position, with failures that explain themselves
  dev/demo.js           ?demo fixture, never used in a real scan
bench/                  labelled-image benchmark for the detector
tests/                  unit tests for the math and the consensus
```

## Tests

```bash
cd ~/spinecheck && node --test tests/
```

31 tests: the angle math and its aspect-ratio correction, the pose quality
warnings, the consensus reduction — median selection, the spread as an error bar,
the reliability gate, warning deduplication, and the threshold bands — and the
intake derivations, which exist mainly to keep answers from ever reaching the
measurement.

Beyond unit tests there is [bench/](bench/README.md), which runs the whole pipeline
over labelled clinical photographs and reports a confusion matrix. That benchmark
is what removed the rotation metric; it should be re-run after any change to the
geometry, the consensus, or the thresholds.

## Design

Deep slate `#0B1622`, cool off-white `#EDF0F1`, scrub blue `#1F6E8C` for
measurement, X-ray marker red-orange `#D6402A` reserved for signals only, plus
amber `#B87514` and green `#2C7A5B` for the monitor and clear states. Archivo for
UI, IBM Plex Mono for every number. The recurring motif is the plumb line — the
vertical reference the whole test measures against — which appears in the wordmark,
the capture guide, and drawn down the pelvis on the result photo.

## Known limits

- **The bands are calibrated on nine reported cases.** That is a demonstration, not
  a validation. Sensitivity 0.83 and specificity 1.00 on that set mean very little
  statistically, and the app's copy is hedged accordingly.
- **The benchmark's positives are standing photographs, not forward-bend ones.**
  The app asks for the forward bend, where asymmetry shows most, but the labelled
  images available were standing posterior views. Labelled forward-bend photographs
  are the obvious next thing to test against.
- **It measures surface tilt, not rotation.** Shoulder and hip level are real
  screening signs but they are not the whole exam. A curve can exist with level
  shoulders, so a clear reading is not an all-clear.
- **Detection needs the whole body in frame with a margin.** Roughly half the
  benchmark images were refused for this reason. The capture guide asks for it, but
  a tight crop will simply get no reading.
- **A phone can measure trunk rotation properly — just not from a photo.** Held
  flat across the back in the forward bend, a phone's inclinometer is a scoliometer.
  That is the natural next feature, and it is deliberately not shipped unverified.
- Camera height and roll move the numbers. The app warns when shoulders and hips
  tilt together, which usually means a tilted phone, but it cannot catch every bad
  angle.
- **Overpass is a free, shared, volunteer-run service and it is often
  overloaded.** It answers 429 when its per-IP slots are full and 504 when its
  gateway gives up, and it sometimes drops connections outright — which a browser
  reports only as `TypeError: Failed to fetch`. Lookups retry three times with
  backoff, cancel any request they supersede so slots are not wasted, name the
  host and the cause when they finally fail, and offer a retry. A Google Places
  key avoids the whole service.
