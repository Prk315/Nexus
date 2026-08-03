#!/usr/bin/env bash
# ios-build.sh — Build and install a Nexus app to a connected iPhone
#
# Usage:
#   ./ios-build.sh [options]
#
# Options:
#   --app <name>     App to build: timetracker (default), pathfinder, vault,
#                    or "all" to refresh every app in PHONE_APPS
#   --refresh        Weekly re-sign: same as --app all --no-launch
#   --release        Build release instead of debug (slower, optimised)
#   --clean          Wipe DerivedData + Cargo cache before building
#   --no-launch      Don't auto-launch the app after install
#   --logs           Stream filtered device logs after install (Ctrl-C to stop)
#   --check          Only report provisioning-profile expiry, build nothing
#   -h, --help       Show this help
#
# Free-tier note: development profiles expire after 7 days. Re-running this
# script re-signs and reinstalls, which resets the clock. Nothing in the app
# source can extend it — the expiry lives in the embedded provisioning profile
# and is validated by iOS at launch.

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
APP="timetracker"
DEVICE_ID="D094F44C-167F-57DA-8759-7949066F91D3"
CONFIGURATION="debug"       # debug = much faster for daily iteration
CLEAN=false
AUTO_LAUNCH=true
STREAM_LOGS=false
CHECK_ONLY=false

# Apps that live on the phone long-term. `--app all` and `--refresh` walk this
# list. Free Apple IDs allow only 3 sideloaded apps at once, so keep it short.
# PathFinder retired 2026-08-03 to free a slot for Nexus Local (installed via
# SideStore's own source, so it isn't listed here). Re-add pathfinder if you
# want the Mac/Xcode refresh flow to manage it again.
PHONE_APPS=(timetracker)

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --app)      APP="$2"; shift 2 ;;
    --refresh)  APP="all"; AUTO_LAUNCH=false; shift ;;
    --release)  CONFIGURATION="release"; shift ;;
    --clean)    CLEAN=true; shift ;;
    --no-launch) AUTO_LAUNCH=false; shift ;;
    --logs)     STREAM_LOGS=true; shift ;;
    --check)    CHECK_ONLY=true; shift ;;
    -h|--help)
      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown flag: $1 (run with --help)"; exit 1 ;;
  esac
done

# ── App registry ──────────────────────────────────────────────────────────────
# Sets APP_DIR / BUNDLE_ID / APP_DISPLAY / DERIVED_PATTERN for the named app.
resolve_app() {
  case "$1" in
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
      echo "Unknown app '$1'. Valid options: timetracker, pathfinder, vault, all"
      exit 1
      ;;
  esac
}

# Expand the requested target into a list of apps to process.
if [ "$APP" = "all" ]; then
  TARGETS=("${PHONE_APPS[@]}")
else
  resolve_app "$APP"      # validate early so typos fail before any building
  TARGETS=("$APP")
fi

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

# ── Provisioning profile expiry ───────────────────────────────────────────────
# Free-tier development profiles last 7 days. Read ExpirationDate straight out
# of the signed bundle's embedded.mobileprovision (a CMS blob wrapping a plist)
# and return whole days remaining. Echoes nothing if it can't be determined.
profile_days_left() {
  local app_path="$1"
  local prof="$app_path/embedded.mobileprovision"
  [ -f "$prof" ] || return 0

  local exp exp_epoch now_epoch
  exp=$(security cms -D -i "$prof" 2>/dev/null \
        | plutil -extract ExpirationDate raw - 2>/dev/null) || return 0
  [ -n "$exp" ] || return 0

  # plutil emits ISO-8601 Zulu, e.g. 2026-08-02T09:14:33Z
  exp_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$exp" +%s 2>/dev/null) || return 0
  now_epoch=$(date +%s)
  echo $(( (exp_epoch - now_epoch) / 86400 ))
}

# Locate the most recently built .app bundle for the resolved app.
find_app_bundle() {
  find ~/Library/Developer/Xcode/DerivedData \
    -name "${APP_DISPLAY}.app" \
    -path "*/${CONFIGURATION}-iphoneos/*" \
    2>/dev/null | sort | tail -1
}

# Human-readable expiry line, colour-coded by urgency.
report_expiry() {
  local label="$1" days="$2"
  if [ -z "$days" ]; then
    dim "$label — expiry unknown (no embedded profile found)"
  elif (( days < 0 )); then
    echo -e "${R}   ✗  $label — EXPIRED $(( -days )) day(s) ago${N}"
  elif (( days <= 2 )); then
    echo -e "${Y}   ⚠  $label — expires in ${days} day(s)${N}"
  else
    echo -e "${G}   ✓  $label — ${days} day(s) left${N}"
  fi
}

# ── Repo root ─────────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT"

TOTAL_START=$(date +%s)

# ── Header ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
echo -e "${B}  Nexus iOS  ·  ${TARGETS[*]}  ·  ${CONFIGURATION}${N}"
echo -e "${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"

# ── 0. Expiry check (no build) ────────────────────────────────────────────────
if [ "$CHECK_ONLY" = true ]; then
  step "Provisioning profile status"
  for target in "${TARGETS[@]}"; do
    resolve_app "$target"
    bundle=$(find_app_bundle)
    if [ -z "$bundle" ]; then
      dim "${APP_DISPLAY} — no local build found"
    else
      report_expiry "$APP_DISPLAY" "$(profile_days_left "$bundle")"
    fi
  done
  echo ""
  exit 0
fi

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

# ── 3–6. Per-app clean / build / install / launch ─────────────────────────────
# One app failing must not abort the others: a refresh run that gets TimeTracker
# onto the phone but trips over PathFinder is still worth completing. Failures
# are collected and surfaced in the summary, and set the exit code.
SUMMARY_LABELS=()
SUMMARY_DAYS=()
FAILED_APPS=()

for target in "${TARGETS[@]}"; do
  resolve_app "$target"

  echo ""
  echo -e "${B}────  ${APP_DISPLAY}  ────${N}"

  # ── Optional clean ──────────────────────────────────────────────────────────
  if [ "$CLEAN" = true ]; then
    step "Cleaning build artifacts"

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

  # ── Build ───────────────────────────────────────────────────────────────────
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

  APP_PATH=$(find_app_bundle)
  if [ -z "$APP_PATH" ]; then
    warn "Build failed — ${APP_DISPLAY}.app not found in DerivedData"
    FAILED_APPS+=("$APP_DISPLAY (build)")
    continue
  fi
  ok "Build complete in $(elapsed $T)"
  dim "${APP_PATH}"

  # ── Install ─────────────────────────────────────────────────────────────────
  step "Installing on device"
  T=$(date +%s)
  if xcrun devicectl device install app \
       --device "$DEVICE_ID" \
       "$APP_PATH" 2>&1 | grep -v "^[[:space:]]*$" | sed 's/^/   /'; then
    ok "Installed in $(elapsed $T)"
  else
    warn "Install failed for ${APP_DISPLAY}"
    FAILED_APPS+=("$APP_DISPLAY (install)")
    continue
  fi

  # ── Launch ──────────────────────────────────────────────────────────────────
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

  # Record the freshly-signed profile's remaining life for the summary.
  SUMMARY_LABELS+=("$APP_DISPLAY")
  SUMMARY_DAYS+=("$(profile_days_left "$APP_PATH")")
done

# ── 7. Summary ────────────────────────────────────────────────────────────────
echo ""
if (( ${#SUMMARY_LABELS[@]} > 0 )); then
  step "Provisioning profiles"
  for i in "${!SUMMARY_LABELS[@]}"; do
    report_expiry "${SUMMARY_LABELS[$i]}" "${SUMMARY_DAYS[$i]}"
  done
fi

if (( ${#FAILED_APPS[@]} > 0 )); then
  echo ""
  echo -e "${R}${B}━━━  Finished with errors in $(elapsed $TOTAL_START)  ━━━${N}"
  for f in "${FAILED_APPS[@]}"; do echo -e "${R}   ✗  $f${N}"; done
  echo ""
  exit 1
fi

echo ""
echo -e "${G}${B}━━━  Done in $(elapsed $TOTAL_START)  ━━━${N}"
dim "Re-run weekly to reset the 7-day clock:  npm run ios:refresh"
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
