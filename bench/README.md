# Detector bench

A labelled-image benchmark for the Versine detector. It exists because the
first version of this app reported a confident-looking trunk rotation angle that
turned out to be noise, and nothing caught it until the numbers were put next to
photographs with known answers.

## Running it

```bash
python3 -m http.server 4321                       # the app, from the repo root
python3 ../scratchpad/serve-bench.py              # the image set on :4322, with CORS
```

`serve-bench.py` calls `http.server.test()`, which was removed in Python 3.14. On
3.14 run a `ThreadingHTTPServer` with the same CORS and `Cache-Control: no-store`
headers instead.

Open `http://localhost:4321/bench/` and call from the console:

```js
await __bench.runBench()          // full pipeline over every case
__bench.score(rows)               // confusion matrix over the reported cases
await __bench.runInvariance()     // mirror and camera-roll behaviour
await __bench.runSingleFraming()  // the instability that motivated the consensus
```

## The image set

17 posterior photographs, all CC-licensed:

- **9 positives** — clinical photographs of people with confirmed scoliosis. Six
  are panels from a published figure where each photograph is printed beside that
  patient's own X-ray; the rest come from similar case figures.
- **8 controls** — ordinary posterior standing photographs of people with no known
  scoliosis. A weak label, but curves over 10° affect roughly 2–3% of people, so an
  unselected photograph is negative with high probability.

The images live outside the repo (`scratchpad/bench/set/`) and are not
redistributed. Several are clinical photographs of patients; they were used for
local evaluation only and must not be published, embedded in the app, or included
in an artifact.

Caveat that limits everything below: the positives are **standing** posterior
views, not forward-bend views. The forward bend is where trunk asymmetry shows
most, so these numbers do not tell us how the app behaves on the pose it actually
asks for. Getting labelled forward-bend photographs is the obvious next step.

## What the benchmark found

### 1. The depth-derived rotation estimate was noise

The original app estimated an angle of trunk rotation from MediaPipe's
`worldLandmarks` z values — the shoulder depth difference minus the pelvis depth
difference. Against the labelled set it produced:

| case | label | reported ATR |
|---|---|---|
| pos-panel6 | scoliosis | 31.2° |
| pos-adams-standing | scoliosis | 25.3° |
| ctl-man-gray | control | 16.5° |
| pos-panel4 | scoliosis | 0.08° |

No separation between the groups, and values that are anatomically impossible —
a scoliometer rarely reads past 20° even in severe curves.

Two causes, both visible in the raw numbers:

- **The pelvis term amplified its own error.** ATR subtracted two separately
  normalized angles, and the hip span is roughly half the shoulder span, so a
  small pelvic depth error became a large angle. Measured hip spans ranged from
  0.048 m to 0.223 m for adult subjects; the anatomical range is about 0.16–0.20 m.
- **The depth values are not stable.** Re-cropping the same photograph by 6%
  changed the reported ATR by up to 12° and the shoulder-blade depth difference by
  up to 35 mm. The rib hump this was meant to detect is 10–20 mm. The measurement
  error exceeded the entire signal range.

Fixing the formula was not enough — the underlying depth estimate does not carry
the signal. Both the rotation angle and the shoulder-blade prominence measure were
removed from the app.

### 2. A segmentation-mask silhouette measure did not rescue it

Reflecting the person mask about the trunk axis and measuring the non-overlapping
fraction was tried as a depth-free alternative. Positives came out at 2.4–8.9%
asymmetry, controls at 0–3.8% — overlapping — and the values drifted with crop the
same way (one case moved 3.3% → 8.3%). Arms adjacent to the trunk dominate the
silhouette. Dropped.

### 3. Only the in-image tilt measurements survived

Shoulder tilt moved by 0.4–4.6° across framings of the same photo, against a
between-group difference of roughly 3°. Usable, but only if the framing noise is
measured rather than ignored — which is what `src/lib/consensus.js` now does:
every scan is measured at five framings, the median is the reading, the spread is
the error bar, and a spread over 3.5° withholds the number entirely.

Hip tilt did not separate the groups at all (positives 0.7–3.1°, controls
1.1–3.3°). It stays in the app as context and as the camera-roll check, not as a
trigger.

### 4. Mirroring made things worse, so it was reverted

MediaPipe is not mirror-equivariant: flipping a photograph moves the measured tilt
by 1–2° and sometimes flips which side it calls higher. Adding mirrored framings to
the consensus, hoping to average out that handedness prior, instead pooled two
differently-biased distributions: spreads roughly doubled (one case 1.08° → 3.93°),
two more cases fell below the reliability gate, and sensitivity dropped from 0.86
to 0.80. Reverted; the finding is recorded in the code comment.

### 5. The forward-bend check was pointing the wrong way

A separate bug the same images caught. The pose check assumed that photographing a
bent-forward subject from behind puts the hips *higher* in the frame than the
shoulders. It does not — a camera at chest height looks down at both, so shoulders
stay higher either way. Measured across the eight standing photographs, the
shoulder-to-hip distance came out at 1.06 to 1.47 times shoulder width, with
shoulders above hips in every single one.

The check now uses foreshortening instead: bending points the trunk away from the
camera, which collapses that ratio. Hips appearing above shoulders is treated as
its own signal — the phone was below the trunk, or the photo is rotated. The
standing side of the threshold is measured; the bent side is physical reasoning,
since the one forward-bend image in the set is too tightly cropped to detect. It
raises a note and never withholds a reading.

### 6. Re-run twelve times: bit-identical, and every proposed change made it worse

An earlier version of this file said detection "is not bit-identical between
runs" and cited a pass that scored 0.86 with 10 reported. Re-measured properly —
seven runs before any change, five after — **every run was identical, case for
case, number for number.** Not just the same score: the same tilts to two
decimals. Whatever produced that earlier 0.86 was not run-to-run variance on this
machine, and the claim is withdrawn.

That reproducibility made it possible to test changes against the set instead of
arguing about them. Three were tested. All three were rejected by measurement.

**More framings.** Deeper padding does find poses the current set misses —
`ctl-female-bw` detects at −0.2, −0.3, −0.45 and −0.6 where it currently gets
only two hits. But the extra framings are lower quality, and the spread is a
max−min statistic, so one bad framing widens it:

| framing set | reported | sensitivity | specificity |
|---|---|---|---|
| current `[0, .03, .06, −.05, −.1]` | 9 | 0.83 | 1.00 |
| plus `[−.2, −.3]` | 9 | 0.83 | 1.00 |
| pads-heavy `[0, −.05, −.1, −.2, −.3, −.45]` | 6 | 0.67 | 1.00 |
| wide sweep, nine framings | 7 | 0.75 | 1.00 |

The wide sweep loses `pos-panel1` (spread 1.7 → 4.8) and `pos-panel5`
(0.3 → 4.8), both correctly-flagged positives pushed past the gate by framings
that should never have been asked. The current set stands.

**Upscaling small inputs.** `pos-adams-bend` is 213×200 and detects in only one
usable framing, so resolution was the obvious suspect. Upscaling 2×, 3×, 4× and
6× changed nothing on it or on the other weak cases — `ctl-pair-male` stayed at
0/5 at every scale.

**Gating on side agreement.** Tempting, because the one false negative
(`pos-nenapadna`) has framings agreeing on the higher side only 60% of the time.
Rejected on reflection rather than measurement: at 0.93° the tilt is near zero,
and near zero the higher side flips on noise *because the magnitude is genuinely
small*. Low agreement there is a property of the answer, not a defect in it.
That case has 5/5 passes, a 0.81° spread and 0.97 confidence — it is a confident
measurement of level shoulders in someone who has a curve, which is the
limitation the app states everywhere, not a bug to gate away.

### 7. The forward-bend photograph is mis-fit outright

The single forward-bend image is the pose the app actually instructs, and it is
the worst case in the set. Raw shoulder tilts from its framings:

| framing | tilt |
|---|---|
| 0 | 83.2° |
| +3% | 87.1° |
| −5% | 23.6° |

Those are not tilted shoulders, they are a mis-fitted skeleton. For comparison,
the largest genuine reading anywhere in the set is 8.3° and the result ruler tops
out at 8°.

The app refuses the case, correctly, but it was closer than it looks. The
implausibility guard was 25°, so the 23.6° mis-fit was **kept**, and the reading
was withheld only because too few other framings survived to reach `minPasses`.
Three framings agreeing near 23° would have been reported as a confident
`refer` with the needle pinned off the end of the scale.

Sweeping that guard from 25° down to 8° changes no outcome anywhere on the
benchmark, so it has been moved to 15° — above double any real reading observed,
below every mis-fit observed. It is defence in depth for a region this set cannot
test, and explicitly not a score improvement.

**n = 1.** One forward-bend photograph cannot establish that the app fails on
forward bends generally. It does establish that mis-fits happen on the pose the
app asks for, and that they are large when they happen.

### 8. The burst wrapper is a no-op on a single frame

`combineBurst` now wraps every scan, including single-frame ones. Checked against
all 17 cases with real detections rather than only in unit tests: usable flag,
tilt, spread and band are identical with and without the wrapper, and sway
reports `null` rather than `0` on every one.

## Where the current detector lands

Full pipeline, latest run:

| | reported | withheld | sensitivity | specificity |
|---|---|---|---|---|
| 17 cases | 9 | 8 | 0.83 | 1.00 |

Reported readings, shoulder tilt in degrees:

- positives: 4.42, 3.97, 4.74, 2.06, 2.23, 0.93
- controls: 1.08, 0.76, 0.68

One positive was missed (0.93°, called clear). No control was flagged. Every case
that previously produced a garbage number is now withheld rather than reported —
including one where the framings disagreed by 21.7°.

The bands in `src/config.js` (2° monitor, 3.5° refer) come from this distribution.

## How much to trust this

Not much, and the app says so. Nine reported cases is a demonstration, not a
validation: the confidence interval on 0.83 sensitivity at n=6 spans most of the
range.

Detection *is* reproducible — twelve runs, bit-identical — which an earlier
version of this file wrongly denied. That is a statement about the model on this
machine and nothing more. It does not make nine cases into evidence, and the
reason every number still carries its spread is that re-cropping one photograph
moves the reading by more than the signal, which section 3 measures directly.

What the benchmark does establish is narrower and still worth having: the depth
metric was measurably invalid and is gone, the surviving metric has a known error
bar, and readings that would have been fabrications are now refused.
