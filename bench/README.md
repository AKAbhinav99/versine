# Detector bench

A labelled-image benchmark for the SpineCheck detector. It exists because the
first version of this app reported a confident-looking trunk rotation angle that
turned out to be noise, and nothing caught it until the numbers were put next to
photographs with known answers.

## Running it

```bash
python3 -m http.server 4321                       # the app, from the repo root
python3 ../scratchpad/serve-bench.py              # the image set on :4322, with CORS
```

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
range. Detection is also not bit-identical between runs — the same sweep gave
sensitivity 0.86 with 10 reported on an earlier pass — which is itself part of why
the spread is reported alongside every number.

What the benchmark does establish is narrower and still worth having: the depth
metric was measurably invalid and is gone, the surviving metric has a known error
bar, and readings that would have been fabrications are now refused.
