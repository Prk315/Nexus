#!/usr/bin/env bash
# collect-ipa.sh — find the unsigned .ipa (or .app) that `tauri ios build --no-sign`
# produced, normalise it into dist-ipa/NexusLocal-<version>.ipa, and emit metadata
# (path / filename / size / sha256) for the workflow to consume.
#
# Usage: collect-ipa.sh <version>
#
# SideStore/AltStore re-sign on device, so an unsigned IPA is exactly what we want.
# `--no-sign` usually yields a ready .ipa; if it only leaves a .app we zip it into
# the classic Payload/ layout ourselves.

set -euo pipefail

VERSION="${1:?usage: collect-ipa.sh <version>}"
APP_ROOT="apps/NexusLocal"
OUT_DIR="dist-ipa"
OUT_NAME="NexusLocal-${VERSION}.ipa"

emit() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1=$2" >> "$GITHUB_OUTPUT" || true; echo "  $1=$2"; }

mkdir -p "$OUT_DIR"

echo "▶  Searching for build output under ${APP_ROOT}/src-tauri/gen/apple ..."
# Show the tree so the first CI run is self-documenting about where things land.
find "${APP_ROOT}/src-tauri/gen/apple/build" -maxdepth 4 \( -name '*.ipa' -o -name '*.app' \) 2>/dev/null | sed 's/^/    /' || true

# 1) Prefer a real .ipa if tauri made one.
IPA_PATH="$(find "${APP_ROOT}/src-tauri/gen/apple" -name '*.ipa' -type f 2>/dev/null | head -1 || true)"

if [ -n "$IPA_PATH" ]; then
  echo "✓  Found IPA: $IPA_PATH"
  cp "$IPA_PATH" "${OUT_DIR}/${OUT_NAME}"
else
  echo "⚠  No .ipa found — falling back to zipping the .app into Payload/."
  # Grab the device (arm64) build, not a simulator build.
  APP_PATH="$(find "${APP_ROOT}/src-tauri/gen/apple/build" -name '*.app' -path '*iphoneos*' -type d 2>/dev/null | head -1 || true)"
  [ -z "$APP_PATH" ] && APP_PATH="$(find "${APP_ROOT}/src-tauri/gen/apple" -name '*.app' -type d 2>/dev/null | head -1 || true)"
  if [ -z "$APP_PATH" ]; then
    echo "✗  No .app or .ipa produced — the build did not emit an installable bundle." >&2
    echo "   Dumping gen/apple/build tree for diagnosis:" >&2
    find "${APP_ROOT}/src-tauri/gen/apple/build" -maxdepth 5 2>/dev/null | sed 's/^/      /' >&2 || true
    exit 1
  fi
  echo "✓  Found app bundle: $APP_PATH"
  STAGE="$(mktemp -d)"
  mkdir -p "${STAGE}/Payload"
  cp -R "$APP_PATH" "${STAGE}/Payload/"
  ( cd "$STAGE" && zip -qry "payload.zip" Payload )
  mv "${STAGE}/payload.zip" "${OUT_DIR}/${OUT_NAME}"
  rm -rf "$STAGE"
fi

SIZE=$(stat -f%z "${OUT_DIR}/${OUT_NAME}" 2>/dev/null || stat -c%s "${OUT_DIR}/${OUT_NAME}")
SHA=$(shasum -a 256 "${OUT_DIR}/${OUT_NAME}" | awk '{print $1}')

echo "✓  Packaged ${OUT_DIR}/${OUT_NAME} (${SIZE} bytes)"
emit ipa_path "${OUT_DIR}/${OUT_NAME}"
emit ipa_name "${OUT_NAME}"
emit ipa_size "${SIZE}"
emit ipa_sha256 "${SHA}"
