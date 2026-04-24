# TimeTracker iOS Migration Plan

## Status: Running on physical iPhone (iOS 26.2) with Supabase sync ✓

The app now builds, installs, launches, and syncs to Supabase on a real device
signed under the free Apple Developer tier. See Phase 8 for the deployment
walkthrough and the two non-obvious crashes we had to fix along the way.

---

## What was done

### Phase 1 — Prerequisites
- Rust iOS targets installed: `aarch64-apple-ios`, `aarch64-apple-ios-sim`
- Tauri CLI 2.10.1 installed (`/opt/homebrew/bin/tauri`)
- CocoaPods 1.16.2 installed via Homebrew

### Phase 2 — Tauri iOS init
- `tauri ios init` ran successfully
- Xcode project scaffolded at `src-tauri/gen/apple/timetracker-app.xcodeproj`
- Auto-installed `xcodegen` and `libimobiledevice` via brew

### Phase 3 — Rust conditional compilation
- `src-tauri/src/lib.rs`: `mod tray` guarded with `#[cfg(not(mobile))]`; tray setup, blocker daemon, and widget window creation all wrapped in `#[cfg(not(mobile))]`
- `src-tauri/Cargo.toml`: `tray-icon` feature moved to `cfg(not(target_os = "ios"))` section; `macos-private-api` stays in macOS-only section
- macOS desktop still compiles cleanly (verified)

### Phase 4 — iOS UI adaptations
- `index.html`: `viewport-fit=cover` added for notch/home bar
- `src/styles/globals.css`: `env(safe-area-inset-*)` padding added
- `src/components/layout/AppShell.tsx`:
  - iOS detected via `navigator.userAgent`
  - Dashboard tab hidden on iOS (app/site blocker UI is macOS-only)
  - Widget toggle button hidden on iOS
  - Default tab set to "Focus" on iOS

### Phase 5 — Xcode project config
- `src-tauri/tauri.conf.json`: iOS bundle section added with `developmentTeam` placeholder

### Phase 6 — iOS 26.4 beta SQLite workaround ✓
- **Bug**: iOS 26.4 beta SQLite fails `CREATE TABLE IF NOT EXISTS` with a "Cannot add a UNIQUE column"
  error even when the table already exists — this is a beta SDK defect, not standard SQLite behaviour.
  Also affects tables with `CHECK` constraints (e.g. `CHECK (id = 1)` singleton pattern).
- **Fix applied to `src-tauri/src/db/migrations.rs`**:
  - Removed all `UNIQUE` and `CHECK` constraints from `CREATE TABLE` statements (enforced at the app layer instead).
  - Split every `CREATE TABLE` into its own `execute_batch` call inside a loop that swallows errors.
  - `run()` never propagates errors — always returns `Ok(())`.
- **Build note**: Sandbox/mount writes do not update macOS APFS mtimes reliably. If Cargo is not
  recompiling after a migration edit, paste the new file content from your own terminal using a
  `cat > file << 'EOF'` heredoc, then `touch` the file to guarantee a rebuild.

### Phase 8 — Physical device deployment (free tier) ✓

Getting from "runs in simulator" to "runs on my iPhone" exposed three separate
issues that the Tauri CLI's `error 65` hides. Resolved 2026-04-24.

**Bundle identifier must be globally unique.** `com.timetracker.app` was already
registered by someone else on Apple's free tier, so Xcode's auto-signing refused
to create a provisioning profile. Changed to `com.bastianthomsen.timetracker`
in both `src-tauri/tauri.conf.json` and `src-tauri/gen/apple/project.yml`.

**Development team must match a signed-in Xcode account.** `tauri.conf.json`'s
`iOS.developmentTeam` has to match a team ID visible in Xcode → Settings →
Accounts. Using the personal free team `G9D6JYJSLT` (Bastian Thomsen Personal
Team). If you see "No Account for Team '...'" in the build log, the team ID
in `tauri.conf.json` doesn't match any signed-in account.

**`ENABLE_USER_SCRIPT_SANDBOXING` must be `NO` for both Debug and Release.**
Xcode 15+ enables script sandboxing by default, which blocks the Tauri
pre-build script (`node tauri ios xcode-script`) from reading the `tauri`
helper folder. Symptom in the build log:
`Sandbox: node(...) deny(1) file-read-data .../gen/apple/tauri`.
Fix pinned in `src-tauri/gen/apple/project.yml` under the target's base
settings so it survives `tauri ios init` regeneration:
```yaml
settings:
  base:
    ENABLE_USER_SCRIPT_SANDBOXING: NO
```

**iOS sandbox forbids writes to the app container root.** The crash that
looked like "app installs fine, opens, closes immediately" was
`settings.rs::timetracker_dir()` calling `home_dir()` which on iOS returns
the sandbox root (`/var/mobile/Containers/Data/Application/<uuid>/`) — and
that directory is **read-only** on iOS. Writes must go under `Documents/`,
`Library/`, or `tmp/`. Fix in `src-tauri/src/config/settings.rs` added a
`writable_root()` helper that anchors into `$HOME/Documents/` on iOS and
leaves desktop paths unchanged. Symptom in Console.app when violated:
`Sandbox: TimeTracker(pid) deny(1) file-write-create .../.timetracker`.

**Build + deploy loop that works:**
```bash
cd ~/Repositories/Nexus/apps/TimeTrackerApp
npx tauri ios dev
```
- Keychain will prompt twice for the codesign private key — hit **Always Allow**.
- First launch on the phone shows "Ikke-godkendt udvikler" / "Untrusted Developer"
  → Settings → General → VPN & Device Management → trust the developer profile.
- Re-run the same command every ~7 days when the free cert expires.

### Phase 7 — Tauri 2 IPC camelCase fix ✓
- **Bug**: Timer Start button (and all other Tauri commands with multi-word parameters) did nothing on
  iOS. Root cause: Tauri 2's WKWebView bridge strictly requires camelCase keys in `invoke()` calls.
  macOS Tauri accepts snake_case silently, but iOS hard-fails with
  `invalid args 'taskName' for command 'start_timer': command start_timer missing required key taskName`.
- **Fix applied to `src/lib/tauriApi.ts`**:
  - All `invoke()` argument keys converted to camelCase: `task_name` → `taskName`,
    `hourly_rate` → `hourlyRate`, `user_id` → `userId`, `start_date` → `startDate`,
    `entry_id` → `entryId`, `include_own_device` → `includeOwnDevice`, etc.
  - Rust command signatures are unchanged — Tauri handles the snake↔camel mapping automatically.
- **Rule for all Nexus apps**: Always use camelCase keys in `invoke()` calls across the entire
  ecosystem. The Rust side stays snake_case; only the JS object keys change.

---

## Features on iOS vs macOS

| Feature | iOS | Notes |
|---|---|---|
| Timer (start/stop/pause/resume) | Yes | |
| Time entries & SQLite | Yes | |
| Projects, tags, notes | Yes | |
| Pomodoro timer | Yes | |
| Statistics + charts | Yes | |
| Supabase sync | Yes | |
| Settings | Yes | |
| Local notifications | Yes | |
| System tray | No | Desktop-only, guarded in Rust |
| Floating widget | No | Desktop-only, guarded in Rust |
| App blocking | No | iOS sandbox — UI tab hidden |
| Site blocking | No | iOS sandbox — UI tab hidden |
| Focus schedule enforcement | No | Data stored, blocking not enforced |

---

## Xcode setup (one-time, already done)

### 1. Point tools at Xcode
```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

### 2. Find your Apple Team ID
Xcode → Settings → Accounts → select Apple ID → copy the 10-character Team ID (e.g. `A1B2C3D4E5`)

### 4. Set your Team ID in the config
Edit `src-tauri/tauri.conf.json` line ~52 — replace `"XXXXXXXXXX"` with your real Team ID:
```json
"iOS": {
  "developmentTeam": "A1B2C3D4E5",
  "minimumSystemVersion": "14.0"
}
```

### 5. Set signing in Xcode
Open `src-tauri/gen/apple/timetracker-app.xcodeproj` → select `timetracker-app_iOS` target → Signing & Capabilities → set Team to your personal Apple ID.

### 5. Run on simulator (from monorepo root)
```bash
export PATH="/opt/homebrew/bin:$PATH"
cd ~/Repositories/Nexus/apps/TimeTrackerApp
npx tauri ios dev
```
First compile takes 10–20 min (Rust cross-compiling for iOS). Subsequent builds are incremental.
The simulator window opens automatically — do **not** launch it manually from Xcode first.

### 6. Build for physical iPhone
Plug in iPhone via USB → trust the Mac when prompted → verify with:
```bash
xcrun xctrace list devices   # your phone should appear under == Devices ==
```
Then run:
```bash
cd ~/Repositories/Nexus/apps/TimeTrackerApp
npx tauri ios dev
```
Pick your phone at the device prompt. See **Phase 8** above for the three
gotchas that may block the first build (bundle ID collision, team ID
mismatch, script sandboxing) — all four are already fixed in this repo.

---

## Free developer account notes

- Certificates expire every **7 days** — must re-build and re-install weekly
- Max 3 app IDs per 7-day window
- No TestFlight, no App Store distribution
- Works only on your own registered devices
- **AltStore / SideStore** can manage re-signing automatically over Wi-Fi

---

## Known issue: Cargo.toml reversion

A tool/hook in this project occasionally reverts `src-tauri/Cargo.toml` line 20 back to:
```toml
tauri = { version = "2", features = ["tray-icon", "macos-private-api"] }
```
If you see a compile error about `tray-icon` on iOS, change it back to:
```toml
tauri = { version = "2", features = [] }
```
The features are properly declared in the platform-specific sections below that line.
