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

## Finding care

[`src/lib/places.js`](src/lib/places.js) has two live providers behind one interface:

- **Google Places API (New)** text search — used when an API key is present. Gives
  ratings, review counts, phone numbers, and opening hours. Enter a key in the
  Care tab (stored in `localStorage`, sent only to `places.googleapis.com`), or set
  `PLACES.googleApiKey` in [`src/config.js`](src/config.js).
- **OpenStreetMap via Overpass** — the keyless default. Real, current data; no
  ratings. Every Overpass clause is a plain indexed tag lookup with relevance
  filtering done in JS, because regex inside the query makes Overpass time out.

Geocoding for typed locations uses Nominatim. The map is Leaflet with CARTO tiles.

**Postal codes get a country.** "2000" is a valid postcode in Australia, Belgium,
Denmark and a dozen other places, so a bare code is sent through Nominatim's
structured `postalcode` field constrained to a selected country (defaulted from the
browser locale) rather than free-text search. Wherever the search lands, the
resolved place is printed above the map — "Cambridge, Massachusetts 02138, United
States" — so a wrong match is visible instead of silent. GPS results are
reverse-geocoded for the same reason.

**The rating filter follows the data.** OpenStreetMap publishes no ratings, so
against that provider the rating chips are disabled with an explanation rather than
silently emptying the list, which is what they used to do. Empty results now name
the filter responsible instead of always blaming the radius. Neither provider
publishes insurance acceptance, so the app doesn't invent it — it says so and tells
the user to ask when they call.

## Layout

```
index.html              app shell, all screens, resources copy
styles/                 tokens, base, capture, result, care
src/
  config.js             model URLs, thresholds, places config
  router.js             screen switching with enter/leave hooks
  lib/
    geometry.js         the asymmetry math (pure, testable)
    screening.js        quality checks, banding, next steps
    pose.js             MediaPipe Pose wrapper
    places.js           Google Places + OpenStreetMap providers
    storage.js          scan history in localStorage
    dom.js              small DOM helpers
  screens/
    capture.js          camera, framing guide, self-timer, camera switch, upload
    adjust.js           pan/zoom/rotate the photo onto the guide before measuring
    analyze.js          the analysis pipeline and its progress log
    overlay.js          landmark/measurement drawing on the photo
    result.js           verdict, readouts, threshold ruler
    doctors.js          map, filters, clinic cards
    history.js          trend chart and scan log
    consensus.js        multi-framing measurement and the reliability gate
  dev/demo.js           ?demo fixture, never used in a real scan
bench/                  labelled-image benchmark for the detector
tests/                  unit tests for the math and the consensus
```

## Tests

```bash
cd ~/spinecheck && node --test tests/
```

21 tests: the angle math and its aspect-ratio correction, the pose quality
warnings, and the consensus reduction — median selection, the spread as an error
bar, the reliability gate, warning deduplication, and the threshold bands.

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
- Overpass is a free shared service and gets rate-limited. The UI reports that
  plainly rather than showing an empty list.
