# Versine

A mobile-first web app (which also spreads into columns on a desktop window) that screens for the surface asymmetry associated with
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
| `RELIABILITY.implausibleTiltDeg` | Discards a framing whose geometry cannot be a real shoulder line. A mis-fit guard, not a screening threshold — see bench/README.md section 7. |
| `POSE_CHECK` | Photographed from behind, shoulders sit higher in the frame than hips whether standing or bent — a camera at chest height looks down at both. What bending changes is foreshortening, so the check is the shoulder-to-hip distance against shoulder width, not their vertical order. |
| `measureWithConsensus` | Runs the above at five framings of one photo and reduces them to a median, a spread, and a usable/withheld verdict. |
| `combineBurst` | Reduces the frames of one burst to a single reading, keeping the two kinds of uncertainty apart. |

**A scan is a burst, not a photograph.** The spread across five re-croppings
answers *how much does re-cropping change the answer*. It does not answer *how
much does the person change the answer*, and the second is the bigger one —
people breathe and sway, and two photographs a second apart disagree by more
than five crops of one photograph do. So the shutter takes three frames about a
second apart, and the two sources are reported separately:

- **crop spread** — across framings of one frame. This is what the reliability
  gate has always used, and it keeps using exactly that.
- **sway** — across the per-frame readings. Reported on the result and on the
  referral summary, and **never gated on**, because no threshold for it has been
  calibrated against anything.

Pooling them would have been simpler and wrong: it would push a larger number
against a threshold derived from a smaller one. A single uploaded photograph is
a burst of one, and its sway is reported as unknown rather than as zero.

The honest limit: **the benchmark cannot validate this.** `bench/` is a set of
still photographs, and a still photograph cannot sway. The reduction is covered
by unit tests and the capture path is verified, but whether the sway figure is
*accurate* needs real people photographed over time, which has not been done.

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

## The referral summary

Any logged scan prints a one-page summary to hand a clinician — from the result
screen, or from any row in the log.

The honest version of "a report of what is wrong" is not a narrative. This app
measures one angle and withholds roughly half its readings; a page describing a
condition would be fabricating one. What a clinician actually needs from a
measurement taken on a phone by a stranger is narrower: what was measured, how,
what was not, and what the number is worth.

So the page carries the reading with its error bar, the annotated photograph, a
**how this was taken** block, an explicit **not measured** list, the self-reported
history, previous readings, and blank fields for the examining clinician —
scoliometer ATR, Adam's test, imaging, Cobb angle, follow-up interval.

Two things it refuses to leave implicit. Any hand-applied rotation is printed
above the angle it moved, because rotation shifts the reading one degree for one
degree and the app cannot tell whether a tilted camera or a pair of shoulders was
being levelled. And a trend whose rows were rotated by different amounts is
labelled as not directly comparable rather than drawn as a line.

The limitations are not a disclaimer at the end; they are what makes the page
usable. A summary claiming less gets read. One announcing a finding gets
dismissed, correctly.

Printing goes through `window.print()` and [`styles/print.css`](styles/print.css)
— no PDF library, no bundle cost, and "Save as PDF" is already in every print
dialog including iOS Safari's. Nothing is uploaded to produce it.

## Finding care

Two provider chains, each trying the next when one fails. Everything is optional:
with no keys at all the app runs entirely on OpenStreetMap's keyless services.

**Clinics** ([`src/lib/clinics.js`](src/lib/clinics.js)) — local first, then richest:

| | key | gives |
|---|---|---|
| Local index | none | instant, offline, cannot fail — see below |
| Google Places | required | ratings, review counts, opening hours |
| OpenStreetMap / Photon | none | the same OpenStreetMap data from a search index: under a second, rarely down |
| OpenStreetMap / Overpass | none | the same data again, plus phone numbers; slow and often overloaded |
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
quota is spent while the free services are healthy: Nominatim → Photon → Geoapify
→ MapTiler → Geocode.maps.co.

Overpass now sits behind Photon, komoot's OpenStreetMap search engine, which
answers the same questions from a prebuilt index in about 0.6 s per request.
Overpass is the backstop, and its retries alternate between overpass-api.de and
the maps.mail.ru mirror, because overpass-api.de is a load balancer and retrying
it tends to land on the same overloaded backend. Overpass is deliberately last
of the keyless services. It is free, shared and volunteer-run, and it is the
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

The map is MapLibre GL drawing [OpenFreeMap](https://openfreemap.org)'s Positron
vector style: free, no key, no account, no request limit. It used to be Leaflet
over CARTO raster tiles, until CARTO started answering keyless requests with a
placeholder tile reading "API KEY REQUIRED". That is a 200 and a valid image, so
nothing failed and the map silently drew no streets. If OpenFreeMap is
unreachable, or its tiles keep failing after load, the map switches to
OpenStreetMap's own raster tiles, which are keyless too.

Picking a clinic's name in the list flies the map to its pin and opens its label;
picking a pin highlights its card.

## Layout

```
index.html              app shell, all screens, resources copy
styles/                 tokens, base, capture, result, care, intake, report, print
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
    report.js           the one-page referral summary, built for print
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

## Accessibility

Audited by measuring rather than by inspection: a script walks every text node on
every populated screen, composites the real backdrop, and computes the contrast
ratio; a second pass checks target sizes and accessible names. Seven colour pairs
failed AA on the first run.

The fix was not to darken the palette. `--marker`, `--amber` and `--clear` are
tuned for 1px rules, strokes and fills, where the bar is 3:1 — they only fail when
they carry words. So there are now text-weight variants (`--marker-text`,
`--amber-text`, `--clear-text`) used wherever the colour is type, and `--ink-400`
for tertiary text, since `--ink-300` reads at 2.66:1 on paper. The mirror of that
problem also existed: this app has dark surfaces, and `--scrub` drops to 3.18:1
against them, hence `--scrub-on-dark` and `--marker-on-dark`. `--rule-control`
exists because a control's boundary needs 3:1 and the drawing hairline gives 1.37.

Also fixed: a `role="radiogroup"` that contained a button (invalid, and redundant
beside the fieldset and legend already naming the group), an `h1` rendered beneath
a hidden `h2`, missing `scope` on the trend table's column headers, four identical
"Get a free key" links, "Summary"/"Remove" buttons that named no scan, a camera
error that was announced to sighted users only, and two empty tab stops — the
video preview and the hidden file input.

## Load

The app opens on a viewfinder, so that is all the first load fetches.

ES modules resolve their imports only after each file is fetched and parsed, so
a module graph costs one round trip per level of depth, not one for the whole
thing. The graph was 26 modules and four levels deep, every one of them blocking
the first screen — on a high-latency connection that alone is over a second of
nothing happening. It is now ten modules (the seven of the capture flow plus the
three that run the page's motion), all named in `<link rel="modulepreload">` so
they fetch in parallel as a single round.

Everything else arrives when it is wanted:

| cluster | when |
|---|---|
| capture flow — router, capture, adjust, storage | at load, 7 modules |
| motion: motion, field, scenes | at load, 3 modules |
| GSAP, ScrollTrigger, SplitText, Lenis (jsDelivr) | deferred classic scripts, about 55 KB gzipped; the page is complete without them |
| analysis — pose, consensus, screening, result, report | on idle after first paint |
| clinician finder — clinics, geocoding, index, keys, MapLibre | first time the Care tab is opened |

The map library mattered most. It was Leaflet then, 46 KB across two files on a
third origin, loaded from the document head on every visit for a screen most
people never open. It is fetched by `doctors.js` at the point the map is first
wanted, and every caller of `ensureMap` copes with the map not existing yet. If it
fails to load the list still works. MapLibre, which replaced Leaflet, is heavier
(about 275 KB gzipped) and is loaded the same way, so it still costs nothing
until the Care tab opens. It is pinned to 5.x because 6.x ships ES modules only.

Measured on a cold load: 20 requests before the app is interactive, no contact
with unpkg at all, and four font files rather than five — `Archivo 500` was
declared and used by nothing.

One thing worth knowing if you touch the lazy loading: **a failed dynamic import
is cached by the browser itself.** Clearing your own promise is not enough. The
module map records a module whose fetch failed, and importing the same specifier
again returns that cached failure without going near the network — verified with
the server back up and the file returning 200, where a plain re-import still
rejected and the identical file behind a fresh query string resolved. Retries
therefore import `path?retry=N`. That recovers the case that actually happens, a
whole subtree failing while the network was down; it cannot recover a partial
failure deeper in the graph, because those modules keep their canonical
specifiers, so the second failure offers a reload instead.

Not changed: the seven stylesheets. They are about 15 KB gzipped in total and
HTTP/2 fetches them in one parallel round, so splitting or inlining them would
trade real complexity for very little. The CSP also forbids the inline `onload`
handler the usual non-blocking-CSS trick depends on, which would have failed
silently in production.

## Tests

```bash
cd ~/spinecheck && node --test tests/*.mjs
```

(Newer Node versions treat a bare `tests/` as a file path and fail before running
anything, so the glob is spelled out.)

42 tests: the angle math and its aspect-ratio correction, the pose quality
warnings, the consensus reduction — median selection, the spread as an error bar,
the reliability gate, warning deduplication, and the threshold bands — the burst
reduction, which exists mainly to keep sway out of the calibrated gate, and the
intake derivations, which exist mainly to keep answers from ever reaching the
measurement.

Beyond unit tests there is [bench/](bench/README.md), which runs the whole pipeline
over labelled clinical photographs and reports a confusion matrix. That benchmark
is what removed the rotation metric; it should be re-run after any change to the
geometry, the consensus, or the thresholds.

## Design

Light only. The visual idea is a physio's posture board: a field of dots on a
clean surface with a plumb line hanging through it, the vertical reference the
whole test measures against. Page `#F2F5F6`, white cards, ink `#0E2230`, scrub
blue `#1F6E8C` for measurement and action, marker red-orange `#D6402A` reserved
for signals. Bricolage Grotesque for headings only, Archivo for UI, IBM Plex
Mono for every number.

That board is the page itself: one fixed canvas behind every screen
([`src/lib/field.js`](src/lib/field.js)). Each dot sits on a slightly
under-damped spring, so whatever moves it wobbles home like a pin rather than
snapping like a pixel. The cursor acts as a lens (dots swell, turn scrub blue and
part around it, and a fast cursor drags a wake), a click sends a shockwave,
scrolling sends a wave across the columns, and a slow swell rolls across the
field at rest. It halves its frame rate after a few seconds untouched and stops
with the tab hidden.

The intro's hero is a spine standing in that field: 17 vertebrae on a sacrum, a
plumb line dropped from the top one. The pointer (or a sideways drag on a touch
screen) bends it into the compensated S of a double curve, the Cobb lines are
drawn along the end plates, and the readout gives the curve's angle, which turns
red at 10°, the angle at which a curve is called scoliosis. It is the subject
explained in one gesture, before a word of copy is read. The geometry is honest
to itself (the angle shown is the angle drawn) but it is a model, not a
measurement, and the copy around it says what the app actually measures.

Scroll storytelling uses GSAP and ScrollTrigger
([`src/lib/scenes.js`](src/lib/scenes.js)), and only on the two read-once pages:
the intro (a word-by-word headline, a band of type that slides with the scroll
and leans with its speed, a pinned sequence that draws how a reading is made
stage by stage, rows that land one by one, a closing line that fills in as it
is read) and the Learn article (a reading-progress rule, the Cobb diagram drawing
itself, headings rising out of their lines). Lenis smooths the wheel on desktop
pointers only. Each screen's scenes live in a `gsap.context` that is reverted
when the screen is left, so no hidden screen keeps a pin or a trigger alive. The
screens used again and again stay crisp: blocks reveal as they scroll into view
([`src/lib/motion.js`](src/lib/motion.js)), cards carry a spotlight under the
cursor, primary buttons lean toward it, the tab highlight slides between tabs,
and a reading counts up the first time it appears.

All of it is optional. The markup is the finished state; GSAP blocked, or
`prefers-reduced-motion`, leaves a complete static page (the field draws one
still frame, spine straight). One trap when changing this: the tab highlight's
observer must not watch `class` or `style`, because the highlight lives inside
what it observes, and its own writes would re-trigger it forever, hanging the
page.

Nothing is written over a photograph or the live camera: the measurement legend
sits under the result photo and coaching sits above the viewfinder, because text
on an arbitrary image is legible on some backgrounds and not others. The adjust
step's canvas still fills uncovered corners dark, because that canvas also
produces the frames the pose model measures and the benchmark ran with it.

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
