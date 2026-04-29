#!/usr/bin/env bash
# ios-build.sh — Build and install a Nexus app to a connected iPhone
#
# Usage:
#   ./ios-build.sh [options]
#
# Options:
#   --app <name>     App to build: timetracker (default), pathfinder, vault
#   --release        Build release instead of debug (slower, optimised)
#   --clean          Wipe DerivedData + Cargo cache before building
#   --no-launch      Don't auto-launch the app after install
#   --logs           Stream filtered device logs after install (Ctrl-C to stop)
#   -h, --help       Show this help

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
APP="timetracker"
DEVICE_ID="D094F44C-167F-57DA-8759-7949066F91D3"
CONFIGURATION="debug"       # debug = much faster for daily iteration
CLEAN=false
AUTO_LAUNCH=true
STREAM_LOGS=false

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --app)      APP="$2"; shift 2 ;;
    --release)  CONFIGURATION="release"; shift ;;
    --clean)    CLEAN=true; shift ;;
    --no-launch) AUTO_LAUNCH=false; shift ;;
    --logs)     STREAM_LOGS=true; shift ;;
    -h|--help)
      sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown flag: $1 (run with --help)"; exit 1 ;;
  esac
done

# ── App registry ──────────────────────────────────────────────────────────────
case "$APP" in
  timetracker)
    APP_DIR="apps/TimeTrackerApp"
    BUNDLE_ID="com.bastianthomsen.timetracker"
    APP_DISPLAY="TimeTracker"
    DERIVED_PATTERN="timetracker-app-*"
    ;;
  pathfinder)
    APP_DIR="apps/PathFinder"
    BUNDLE_ID="com.bastianthomsen.pathfinder"
    APP_DISPLAY="PathFinder"
    DERIVED_PATTERN="pathfinder-*"
    ;;
  vault)
    APP_DIR="apps/Vault/Vault"
    BUNDLE_ID="com.bastianthomsen.vault"
    APP_DISPLAY="Vault"
    DERIVED_PATTERN="vault-*"
    ;;
  *)
    echo "Unknown app '$APP'. Valid options: timetracker, pathfinder, vault"
    exit 1
    ;;
esac

# ── Colours ───────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  R='\033[0;31m' G='\033[0;32m' Y='\033[1;33m'
  C='\033[0;36m' DIM='\033[2m' B='\033[1m' N='\033[0m'
else
  R='' G='' Y='' C='' DIM='' B='' N=''
fi

step() { echo -e "\n${C}${B}▶  $*${N}"; }
ok()   { echo -e "${G}   ✓  $*${N}"; }
warn() { echo -e "${Y}   ⚠  $*${N}"; }
die()  { echo -e "${R}   ✗  $*${N}"; exit 1; }
dim()  { echo -e "${DIM}   $*${N}"; }

elapsed() {
  local secs=$(( $(date +%s) - $1 ))
  if (( secs >= 60 )); then printf "%dm %ds" $((secs/60)) $((secs%60))
  else printf "%ds" "$secs"; fi
}

# ── Repo root ─────────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT"

TOTAL_START=$(date +%s)

# ── Header ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
echo -e "${B}  ${APP_DISPLAY} iOS  ·  ${CONFIGURATION}${N}"
echo -e "${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"

# ── 1. Device check ───────────────────────────────────────────────────────────
step "Checking device"
DEVICE_INFO=$(xcrun devicectl list devices 2>/dev/null || true)

if echo "$DEVICE_INFO" | grep -q "$DEVICE_ID"; then
  DEVICE_NAME=$(echo "$DEVICE_INFO" | grep "$DEVICE_ID" | \
    awk '{print $1}' | head -1 || echo "iPhone")
  ok "Connected: ${DEVICE_NAME:-iPhone} ($DEVICE_ID)"
else
  warn "Device $DEVICE_ID not found — is your iPhone plugged in and trusted?"
  echo ""
  echo "  Available devices:"
  echo "$DEVICE_INFO" | grep -E "iPhone|iPad" | head -5 | sed 's/^/    /' || \
    echo "    (none detected)"
  echo ""
  read -r -p "  Continue anyway? [y/N] " REPLY
  [[ "$REPLY" =~ ^[Yy]$ ]] || exit 1
fi

# ── 2. npm install (cached — fast on subsequent runs) ─────────────────────────
step "Syncing JS dependencies"
T=$(date +%s)
PATH="/opt/homebrew/bin:$PATH" npm install --silent 2>/dev/null
ok "npm ready ($(elapsed $T))"

# ── 3. Optional clean ────────────────────────────────────────────────────────
if [ "$CLEAN" = true ]; then
  step "Cleaning build artifacts"

  # DerivedData for this app
  DERIVED_COUNT=0
  while IFS= read -r dir; do
    rm -rf "$dir" && (( DERIVED_COUNT++ )) || true
  done < <(find ~/Library/Developer/Xcode/DerivedData \
    -maxdepth 1 -name "$DERIVED_PATTERN" 2>/dev/null)
  (( DERIVED_COUNT > 0 )) && ok "Cleared $DERIVED_COUNT DerivedData folder(s)" \
    || dim "No DerivedData to clear"

  # Cargo cache (keep global registry, just clean the app crate)
  T=$(date +%s)
  if (cd "$APP_DIR/src-tauri" && cargo clean 2>/dev/null); then
    ok "Cargo artifacts cleaned ($(elapsed $T))"
  else
    warn "cargo clean skipped (no src-tauri found?)"
  fi
fi

# ── 4. Build ─────────────────────────────────────────────────────────────────
step "Building ($CONFIGURATION)"
T=$(date +%s)

BUILD_FLAGS=()
[ "$CONFIGURATION" = "debug" ] && BUILD_FLAGS+=("--debug")

# Stream output but only surface errors and key progress lines
(
  cd "$APP_DIR"
  PATH="/opt/homebrew/bin:$PATH" npx tauri ios build "${BUILD_FLAGS[@]}" 2>&1
) | grep --line-buffered -E \
    "^error|error\[|error:|\bwarning\[|Compiling |Finished |Build complete|FAILED|Linking |CodeSign" \
  | sed 's/^/   /' \
  || true

# Verify the build actually produced something
APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData \
  -name "${APP_DISPLAY}.app" \
  -path "*/${CONFIGURATION}-iphoneos/*" \
  2>/dev/null | sort | tail -1)

[ -z "$APP_PATH" ] && die "Build failed — ${APP_DISPLAY}.app not found in DerivedData"
ok "Build complete in $(elapsed $T)"
dim "${APP_PATH}"

# ── 5. Install ────────────────────────────────────────────────────────────────
step "Installing on device"
T=$(date +%s)
xcrun devicectl device install app \
  --device "$DEVICE_ID" \
  "$APP_PATH" 2>&1 | grep -v "^[[:space:]]*$" | sed 's/^/   /' || \
  die "Install failed"
ok "Installed in $(elapsed $T)"

# ── 6. Launch ────────────────────────────────────────────────────────────────
if [ "$AUTO_LAUNCH" = true ]; then
  step "Launching ${APP_DISPLAY}"
  if xcrun devicectl device process launch \
      --device "$DEVICE_ID" \
      "$BUNDLE_ID" 2>/dev/null; then
    ok "App launched"
  else
    warn "Could not auto-launch — unlock your phone and open the app manually"
  fi
fi

# ── 7. Summary ────────────────────────────────────────────────────────────────
echo ""
echo -e "${G}${B}━━━  Done in $(elapsed $TOTAL_START)  ━━━${N}"
echo ""

# ── 8. Log stream (optional) ──────────────────────────────────────────────────
if [ "$STREAM_LOGS" = true ]; then
  echo -e "${C}Streaming device logs — Ctrl-C to stop${N}"
  echo -e "${DIM}(filtering for: ${APP_DISPLAY}, widget, LiveActivity, error)${N}"
  echo ""
  xcrun devicectl device console --device "$DEVICE_ID" 2>/dev/null | \
    grep --line-buffered -i \
      "${APP_DISPLAY}\|widget\|LiveActivity\|live.activity\|error\|assert" || true
fi
