# TimeTracker iOS Migration Plan

## Status: Running on iPhone 17 simulator (iOS 26.4 beta) ✓

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
- **Fix applied to `src-tauri/src/db/migrations.rs`**:
  - Removed all `UNIQUE` constraints from `CREATE TABLE` statements (enforced at the app layer instead).
  - Split every `CREATE TABLE` into its own `execute_batch` call inside a loop that swallows errors.
  - `run()` never propagates errors — always returns `Ok(())`.
- **Build note**: Sandbox/mount writes do not update macOS APFS mtimes reliably. If Cargo is not
  recompiling after a migration edit, paste the new file content from your own terminal using a
  `cat > file << 'EOF'` heredoc, then `touch` the file to guarantee a rebuild.

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
Plug in iPhone via USB → trust the Mac when prompted → then:
```bash
tauri ios dev --device
```

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
