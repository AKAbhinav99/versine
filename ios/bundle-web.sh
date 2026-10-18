#!/bin/sh
# Copies the web app into the app bundle, under Web/, as an Xcode build phase.
#
# These are the same files Vercel serves, straight from the repository, so the
# app and the site never drift apart: the app is the site, run in app mode
# (src/app/shell.js, styles/app.css). Nothing here is transformed.
set -eu

REPO="${SRCROOT}/.."
DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/Web"

mkdir -p "$DEST"
rsync -a --delete --exclude '.DS_Store' \
  "$REPO/index.html" "$REPO/favicon.svg" "$REPO/src" "$REPO/styles" "$REPO/data" \
  "$DEST/"

# MediaPipe and the pose model, so a scan works with no signal. The website
# loads these from CDNs (POSE_MODEL in src/config.js); in the app config.js
# points at Web/vendor/mediapipe/ instead. They are downloaded once into a cache
# outside the repository, checked against the hashes below, and never committed.
#
# Only the SIMD build of the wasm is shipped: MediaPipe falls back to the other
# one where WebAssembly SIMD is missing, and every iOS this app runs on has it.
TASKS=https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14
MODEL=https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task
CACHE="${HOME}/Library/Caches/versine-model"
VENDOR="$DEST/vendor/mediapipe"

if ! grep -qF "'$TASKS/" "$REPO/src/config.js" || ! grep -qF "'$MODEL'" "$REPO/src/config.js"; then
  echo "error: POSE_MODEL in src/config.js no longer names the files ios/bundle-web.sh bundles; update both" >&2
  exit 1
fi

# vendor URL SHA-256 DESTINATION
vendor() {
  cached="$CACHE/${1#https://}"
  if ! echo "$2  $cached" | shasum -a 256 -c -s 2>/dev/null; then
    mkdir -p "$(dirname "$cached")"
    curl -fsSL --retry 2 -o "$cached.part" "$1"
    if ! echo "$2  $cached.part" | shasum -a 256 -c -s; then
      echo "error: $1 does not match its pinned SHA-256" >&2
      exit 1
    fi
    mv "$cached.part" "$cached"
  fi
  mkdir -p "$(dirname "$3")"
  cp "$cached" "$3"
}

vendor "$TASKS/vision_bundle.mjs" \
  e77f281f9619150d937023c355bae170e9120e3b9e43f1e23a2a7bee07197669 "$VENDOR/vision_bundle.mjs"
vendor "$TASKS/wasm/vision_wasm_internal.js" \
  9440cf0cc0cea21800e31581ec32aeedcc5fbf9df4509796bbc7d3f99e52ab9c "$VENDOR/wasm/vision_wasm_internal.js"
vendor "$TASKS/wasm/vision_wasm_internal.wasm" \
  f82a8e6c05e08a44cc9f9e7ec5f845935bcbb1b1500ebe8c2f4812fb4e2917dc "$VENDOR/wasm/vision_wasm_internal.wasm"
vendor "$MODEL" \
  5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1 "$VENDOR/pose_landmarker_full.task"
