# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A personal "life OS" — a suite of interconnected desktop apps built with **Tauri 2 (Rust) + React 19 / TypeScript / Tailwind CSS v4**. All apps are developed in a single npm + Cargo workspace.

## Dev Commands

Run all commands from the repo root (`/Users/bastianthomsen/Repositories/Nexus`).

```bash
# Install all JS dependencies (must be run from root)
npm install

# Start a specific app's dev server + Tauri hot-reload
npm run dev:nexus
npm run dev:pathfinder
npm run dev:vault          # note: Vault lives at apps/Vault/Vault (nested)
npm run dev:timetracker
npm run dev:stonks

# Build all apps
npm run build:all

# Lint all apps
npm run lint:all

# Rust — build/check the whole workspace
cargo build
cargo check
cargo clippy

# Rust — clean build artifacts (~8–10 GB, do this when disk is tight)
cargo clean
```

### Tauri dev (alternative — run inside each app's directory)
```bash
cd apps/PathFinder && npx tauri dev
```

## Workspace Layout

```
Nexus/
├── apps/
│   ├── nexus/           # Hub & launcher (IPC server, 3D graph view)
│   ├── NexusLocal/      # Grid node (macOS) + the ONE native iOS app — see below
│   ├── PathFinder/      # Life planning — goals, projects, tasks
│   ├── Protocol/        # Health — Oura, Garmin, Vellafit body composition
│   ├── TimeTrackerApp/  # Time tracking & focus sessions (macOS + its own iOS build)
│   ├── Stonks/          # Financial tracking & portfolio
│   └── Vault/
│       └── Vault/       # ← NESTED: the real app source is one level deeper
├── packages/
│   ├── nexus-core/      # Shared JS/TS library (client SDK + React components)
│   │   ├── src/         # TypeScript source
│   │   └── crate/       # Rust mirror of shared types (used by Nexus backend)
│   └── nexus-core/crate/
└── src-tauri/           # Root Tauri config (not an app — workspace glue only)
```

**Vault's nested path is intentional** — the app source lives at `apps/Vault/Vault/`. The root `package.json` explicitly lists `"apps/Vault/Vault"` as a workspace entry alongside `"apps/*"`.

## Architecture: How the Ecosystem Connects

Nexus acts as a central hub. When Nexus starts, it launches an **HTTP IPC server on port 1430** (axum, in `apps/nexus/src-tauri/src/lib.rs`). Every other app calls `useNexusRegistration()` on mount to POST to `/register`, and the Nexus UI polls `/apps` to show which apps are live.

```
Nexus (IPC hub :1430)
  ├── GET  /health
  ├── POST /register      ← each app calls this on startup
  ├── DEL  /unregister/:id ← each app calls this on close
  └── GET  /apps          ← returns all currently connected apps

PathFinder | TimeTrackerApp | Stonks | Vault
     └── all use NexusClient from nexus-core to register/unregister
```

The registry is **in-memory only** — it resets when Nexus restarts.

## nexus-core: The Shared Library

`packages/nexus-core/src/` is the single source of truth for anything shared across apps. Import via the `@nexus/core` alias (resolved in each app's `vite.config.ts`).

Key exports:
- `NexusClient` — IPC client (register, unregister, getConnectedApps)
- `useNexusRegistration(appName, version)` — drop into any app's root component
- `useConnectedApps(pollInterval?)` — polls `/apps` and returns live app list
- `NexusHeader` — shared top navigation bar rendered by every app
- `LifeBar`, `AgentBar`, `CalendarSidebar`, `AppGraph3D`, `Chart2D`, `Chart3D`, `WorkflowViewer` — shared UI components

The Rust mirror at `packages/nexus-core/crate/` re-exports the same types for use in Nexus's axum backend.

## Dev Ports

| App            | Vite port |
|----------------|-----------|
| nexus          | 1420      |
| PathFinder     | 1421      |
| Vault          | 1422      |
| TimeTrackerApp | 1423      |
| Stonks         | 1424      |
| NexusLocal     | 1426      |
| Nexus IPC      | 1430      |

⚠️ **`npm run dev:nexuslocal` is bare `vite`** — it starts the dev server and opens
**no Tauri window**. It proves nothing about the app booting. Use
`cd apps/NexusLocal && npx tauri dev`. And note even a clean boot only proves the
Rust side came up: a React render throw lives in the WebView and leaves the Rust
process healthy, so "the panel renders" is not something a terminal can tell you.

## Critical: Tailwind CSS v4 + nexus-core

Tailwind v4 with `@tailwindcss/vite` only scans files Vite touches directly. It will **not** automatically pick up classes used in `packages/nexus-core/src/` (shared components like `NexusHeader`). Every app must explicitly declare the source:

**Apps that have their own Tailwind setup** (PathFinder, Stonks): add to their main CSS file:
```css
@source "../../../packages/nexus-core/src";
```

**Apps without native Tailwind** (Vault, TimeTrackerApp): create a separate `src/tailwind.css`:
```css
@import "tailwindcss";
@source "../../../../packages/nexus-core/src";  /* adjust depth for nesting */
```
Then import it in `main.tsx` **before** `App.css`. Keeping it separate prevents Tailwind's CSS parser from choking on plain CSS in `App.css`.

If `NexusHeader` or any nexus-core component renders unstyled, a missing `@source` directive is the likely cause.

## Critical: React Version Parity

All apps **must use React 19**. If an app ships its own `node_modules/react` at a different version (e.g. React 18 from a local `package.json`), it creates a dual-React instance — the app will render a blank white screen with no error message. Always keep `react` and `react-dom` versions aligned with the root `package.json` and run `npm install` from the repo root after changing them.

## Rust / Tauri Notes

- Each app has its own `src-tauri/` with a `tauri.conf.json` and `Cargo.toml` that is a member of the root Cargo workspace.
- Shared Rust types live in `packages/nexus-core/crate/` — add the crate as a dependency in any app's `Cargo.toml` to reuse `ConnectedApp`, `RegisterRequest`, etc.
- SQLite databases are managed via `tauri-plugin-sql` with inline migrations in each app's `lib.rs`. Nexus uses `nexus.db`; most other apps use their own DB files. **Exception:** PathFinder migrated to Supabase on 2026-04-25 — see the section below.
- The `launch_app` Tauri command in Nexus handles `.app` bundles, `.sh` scripts, and raw binary paths.

## PathFinder: Supabase Backend

PathFinder migrated from local SQLite (via `tauri-plugin-sql`) to **Supabase** as the primary data store on 2026-04-25 (commit `efa8a64`). All `pf_*` tables live in the NEXUS Supabase project (`efxmzsdisaymtpebaxlp`).

**Setup** (per developer, per machine):

1. Copy `apps/PathFinder/.env.example` → `apps/PathFinder/.env`.
2. Fill in `VITE_SUPABASE_ANON_KEY` from Supabase dashboard → Project Settings → API. The legacy anon (JWT) key and the new `sb_publishable_*` key both work.
3. `.env` is gitignored — never commit it.

**Current sync model — read this before assuming anything:**

- Every CRUD call in `src/lib/api.ts` goes directly to Supabase. No local cache, no offline support — if the network drops, every operation throws.
- Auth is **disabled**. Every row uses a hardcoded `USER_ID = "default"`, and every `pf_*` table has a permissive `anon_all` RLS policy (`USING (true) WITH CHECK (true)`).
- No realtime subscriptions — multi-device awareness only on refresh.
- Last-writer-wins on concurrent edits; no conflict detection.
- The Rust SQLite plumbing (`src-tauri/src/{db,commands}.rs`) is **dead code** — left in tree for now but no longer called from the frontend.

**To turn on multi-user / multi-device safely:**

- Replace `USER_ID = "default"` in `api.ts` with `auth.uid()` after wiring `supabase.auth`.
- Migrate RLS policies from `anon_all` to `USING (user_id = auth.uid())`.
- TimeTrackerApp's commit `c29f73c` (multi-device active timer sync) is the closest in-tree precedent — start there.

## Nexus Local: the grid node and the one native iOS app

`apps/NexusLocal` is two things wearing one binary: a **macOS background grid node**
that executes queued work, and the **only native app on the iPhone** — the container
that carries every widget and app-extension so the free-tier 3-sideloaded-app cap is
never hit (`IOS_PLAN.md`). Other apps reach the phone as Vercel PWAs, which cost 0 slots.

### Two module patterns, and only one runs on the phone

`src-tauri/src/modules/mod.rs`'s `registry()` returns `Vec::new()` on iOS. This is
deliberate and catches people out:

| | **Pattern A — grid module** | **Pattern B — iOS native bridge** |
|---|---|---|
| Where | `src-tauri/src/modules/<name>.rs` + `registry()` | `src-tauri/src/<name>.rs` → `src-tauri/ios/<Name>Bridge.swift` |
| Runs on | macOS only | the iPhone |
| Triggered by | a Supabase queue row (`nexus_local_commands`) | React `invoke()` |
| Examples | `garmin`, `blocking` | `apply_content_blocker`, `ble_scan_*`, `start_live_activity` |

The iPhone still heartbeats into `nexus_local_nodes`, so it appears online with
`modules: []` — a presence node, not an execution node. **Pattern C** is a widget:
a `TimelineProvider` in `gen/apple/NexusLocalWidgets/` that queries Supabase directly.

Adding a Tauri command touches exactly one place: the `generate_handler!` list in
`lib.rs`. The `capabilities` block in `tauri.conf.json` is plugin ACL — app-defined
commands need no entry there.

### The productivity stack: policy is computed server-side

`src-tauri/src/timetracker/` + `src/lib/timetracker/` carry session recording,
pomodoro, focus schedules, blocking management and time-unlock rewards.

**No client derives blocking policy.** A sideloaded free-tier iOS app gets no
`BGTaskScheduler` and no silent push (grep the repo — zero hits), so a `setInterval`
in the WebView dies the moment the app backgrounds. Instead the `focus-evaluate`
edge function runs on pg_cron every 5 minutes and collapses `focus_blocks` +
`schedule_block_{apps,sites}` + `unlock_rules` + `blocked_{sites,apps}` + today's
`time_entries` into **one** row:

```
blocking_state(user_id, effective_domains, effective_processes, reasons, today_minutes, computed_at)
```

Every client — iPhone widget, Mac grid node, app UI — reads that row and acts. This
is the same split as the Vellafit bridge (`bodyscan-sync`): the device does the cheap
thing, the server does the thinking on a schedule. It is what lets a schedule window
open and a reward unlock while every device is asleep.

**The invariant that matters most: an empty or missing verdict is never "nothing is
blocked."** `blocking_state` is deliberately *not seeded* — a missing row means "no
verdict has ever been computed", which is different from "computed, nothing blocked".
Seeding zeros would collapse the two and hand clients a fresh-looking `computed_at`.
Every consumer treats missing/failed as *unknown* and keeps enforcing the last known
state. The Mac module skips the tick rather than writing an empty hosts block; the
widget keeps its previously compiled rules. Every accidental path must fail toward
"still blocked", because the alternative is blocking that silently switches itself off.

Related trap, already fixed: `content_blocker.rs` emitted `{"url-filter": ".*"}` for a
blank domain — which matches **every URL**. Inputs yielding no hostname are skipped.

### Mac enforcement: three things had to be true, and none of them were

The Mac node is the *only* place blocking is actually enforced (the phone's Safari
path is inert on the SideStore install — see below). Until 2026-08-07 it had never
run once, for three independent reasons. If enforcement looks dead, check them in
this order:

| | Was | Now |
|---|---|---|
| **Reachable** | `blocking_enabled` only in `~/.nexuslocalrc`, defaulting `false` | `EnforcementPanel` toggle → `tt_enforcement_set` persists it |
| **Live** | flag copied into the module at construction; `tick_interval_secs` returned `None` when off, so the runtime spawned **no loop at all** | shared `Arc<AtomicBool>`; the loop always runs and `tick` re-reads the flag |
| **Alive** | menubar app, no launch-at-login — a reboot left the Mac unprotected | LaunchAgent running a headless daemon |

The middle one is the subtle trap: `Grid::spawn` reads `tick_interval_secs` **once**,
at startup. Returning `None` while disabled meant a toggle could never start
enforcing without a full relaunch. Gate inside `tick`, never in the manifest.

### One binary, two roles: `nexus-local --daemon`

Enforcement must outlive the app being *quit*, not merely closed, so the LaunchAgent
runs the same binary with `--daemon` (`main.rs` dispatches). That process creates no
window, no tray icon and no Dock entry, and never initialises Tauri — it is just the
grid: `run_daemon()` in `lib.rs`. Sharing the binary means the daemon already lives
inside the installed `.app`; there is no second artefact to build, ship or keep in
version lockstep.

**On macOS the desktop app therefore spawns no grid at all.** Two grid nodes sharing
one `device_id` is a conflict, not redundancy: both heartbeat as the same node, both
claim from the same command queue, and both write `/etc/hosts` — and since
`hosts_write_lock` is per-process, a changed verdict would raise **two** admin
password dialogs. The app is a UI onto the daemon's work. Every other platform keeps
the old in-process behaviour; iOS has no daemon and still needs to heartbeat presence.

**The toggle crosses the process boundary by polling, not IPC.** The app writes
`blocking_enabled` to `~/.nexuslocalrc`; the daemon re-reads it every 5s via
`AppConfig::read_blocking_enabled()` (which deliberately has none of `load`'s
persist-on-read side effect) and updates the shared flag. 5s is well inside the 30s
enforcement tick, so a toggle lands before the pass that would act on it.

Because two processes now share that file, **`save()` is write-temp-then-`rename`**.
A plain `fs::write` truncates first, and a poll landing in that window read a
half-written file — whereupon `load()`'s old `unwrap_or_default()` swallowed the parse
error and *persisted* `blocking_enabled: false`, switching enforcement off with no
trace. `load()` now leaves a file it could not parse completely untouched. Both
behaviours have tests; they are the config-layer version of "never fail toward
unblocked".

**The LaunchAgent uses `KeepAlive: {SuccessfulExit: false}`, not `KeepAlive: true`.**
It relaunches on a crash but respects a clean quit — a bare `true` would make the
service impossible to stop short of deleting the plist. It also sets
`StandardOutPath`/`StandardErrorPath` to `~/Library/Logs/nexus-local.log`: launchd
discards both streams by default, which would leave a headless failure with no
evidence anywhere on the machine. **That log is the first place to look** when
blocking isn't happening. `ProgramArguments` points at `/Applications/Nexus Local.app/…`;
pointing it at a `target/debug` binary (what `current_exe()` returns under
`tauri dev`) registers a path every rebuild replaces, so `EnforcementPanel` warns when
it sees one.

**Writing `/etc/hosts` needs an admin password**, and the mechanism that keeps that
bearable is `render_hosts` being a **fixed point**: an already-correct file renders to
itself byte-for-byte, so an unchanged verdict writes nothing and the 30s tick is
silent. Every deviation from that property — a dropped trailing newline, an unsorted
`effective_domains` — is a password dialog every thirty seconds. There are tests
pinning it; don't loosen them.

A *refused* dialog is the other half: `osascript` exits nonzero and the tick would
retry 30 seconds later, forever. A 10-minute backoff (`HOSTS_RETRY_BACKOFF_SECS`)
suppresses the retry, and is cleared by any successful write or by the verdict
becoming a no-op. User-initiated applies (`tt_enforcement_apply_now`, `clear`) ignore
the backoff — someone pressing a button is asking for the dialog. Process killing is
never backed off; it needs no privileges.

**Block both address families or you block nothing in Chrome.** A `/etc/hosts` entry
that only maps `127.0.0.1` overrides the **A** lookup; the **AAAA** lookup still goes
to real DNS, and Chrome's Happy Eyeballs prefers the IPv6 answer — so it loads the
site normally while Safari (which took the IPv4 answer) appears blocked. `build_block`
emits both `127.0.0.1` and `::1` for every domain.

This hid for weeks because the obvious check lies: `ping youtube.com` asks for IPv4
and dutifully reports `127.0.0.1`. The honest diagnostic is
`dscacheutil -q host -a name youtube.com`, which prints *both* answers — a real
`ipv6_address` next to `ip_address: 127.0.0.1` is the bug. TimeTracker's blocker
still has it. Note Chrome also caches DNS internally, so after a rule change it needs
`chrome://net-internals/#dns` → *Clear host cache*, or a restart.

**Editing the block list takes up to ~5½ minutes to bite on the Mac**, and this looks
exactly like a bug if you don't expect it: `focus-evaluate` runs on a 5-minute cron,
and the Mac tick is 30s behind that. Toggling a site on at 12:56 leaves it unblocked
until the 13:00 pass. Before diagnosing a domain that "should" be blocked, compare
`blocked_sites.updated_at` against `blocking_state.computed_at` — if the edit is
newer, the verdict simply hasn't been recomputed yet. Nothing is wrong.

**Two enforcers share `/etc/hosts`.** TimeTracker writes its own `# BEGIN
TimeTracker-Block` region and neither app knows about the other. Ours is rewritten
**in place** rather than stripped-and-appended precisely so the two don't shuffle each
other's blocks and prompt for a password each round. Both regions coexist today; the
duplication (`disney.com`, `hbo.com` in both) is harmless.

**The block lists are one-way in the app.** `BlockingPanel` can add a site or app but
has no delete, no on/off switch and no block-mode switch — removing a block means
opening the Supabase dashboard. That friction is the product decision, not an
oversight: a blocker you can switch off from the blocked device isn't a blocker. Note
the three removed controls were one loophole wearing three hats (`enabled = false`,
deleting the row, and flipping `block_mode` from `always` to `focus_only` all end with
the thing unblocked) — restoring any one restores all three.

### Usage tracking, and the one table with different RLS

The daemon measures foreground time: `modules/usage_tracker.rs` samples the frontmost
app via `lsappinfo` every 5s (no TCC prompt) with idle from `ioreg -c IOHIDSystem`
(idle >120s closes the interval at `now - idle`, or you log lunch as work). Websites
come from a Chrome MV3 extension in `apps/NexusLocal/extensions/chrome-usage/`, which
POSTs to `usage_ingest.rs` on **127.0.0.1:1431** authenticated by a token in
`state_dir()/browser_token`. Everything lands as JSONL in `~/.nexuslocal/usage/`.

**`usage_intervals` is the only table in this project with sane RLS, and that is
deliberate.** It holds full URLs and page titles; the anon key is committed in
`config.rs` and the repo is public, so a permissive policy would publish every page
you visit. It has **no anon policy at all** — reads require `auth.uid()`, which the
web apps already have via `useNexusAuth`. Do not "fix" the inconsistency by adding
one. Read `usage_daily_totals` (a `security_invoker = on` view — without that flag a
view silently bypasses the base table's RLS) rather than raw intervals.

The daemon has no session, so it cannot satisfy `auth.uid()`. Writes go through the
`usage-ingest` edge function with a scoped secret, exactly like `session-toggle`. That
secret lives in `~/.nexuslocalrc` as `usage_ingest_key`, **never in the source** — the
repo is public. No key means sync is simply off. `usage_sync.rs` uploads every 5 min,
tracking a byte offset per day file; the offset is an optimisation, not a correctness
mechanism, because the server dedupes on `(user_id, device_id, dedupe_key)` and a
rewound cursor therefore re-sends rather than loses.

⚠️ **`AppConfig::load()` persists on read, so a binary that predates a config field
deletes it.** Adding `usage_ingest_key` while an older daemon was still running wiped
it within seconds, and the only symptom was one line in a log. `#[serde(flatten)]
extra` now round-trips unknown keys — two processes share that file and are not always
the same build. Keep it when adding fields.

### Garmin: the bridge, and where the mapping lives

`modules/garmin.rs` wraps a vendored Python script driven by
`std::process::Command`, using tokens in `~/.garminconnect`. It only **fetches**.

⚠️ **The installed daemon looks for the script in `~/.nexuslocal/modules/garmin/`.**
Path resolution also has a `#[cfg(debug_assertions)]` dev path and a walk-up from
the executable, but the release daemon runs from `/Applications/Nexus Local.app/…`,
which has no `modules/` above it, and the bundle carries no copy — so Garmin worked
under `tauri dev` and failed on every installed build until that lookup existed.
After changing the bridge, `cp` it to `~/.nexuslocal/modules/garmin/` or nothing
picks it up. Keep the two vendored copies (`apps/NexusLocal/modules/garmin/` and
`apps/Protocol/garmin_bridge/`) **identical**; NexusLocal's was a stale fork missing
`exercise_sets`, so strength sync silently could not work through the grid.

**Mapping into `protocol_*` happens in the `garmin-import` edge function**, not in
any client. It was Protocol-only before, which is why Nexus Local could pull but not
import. Do not re-implement it client-side: two drifting copies of health-data
mapping produce *wrong* numbers, which is worse than none.

Three things that function gets right and a reimplementation won't:

- **`protocol_data_source_settings` is load-bearing.** It decides per metric whether
  Garmin or Oura wins. The real config here is Garmin for workouts, Oura for sleep
  and body — so importing everything Garmin returns would overwrite Oura's sleep.
  Skips are reported explicitly; "0 imported because Oura owns it" and "0 imported
  because it broke" must not look the same.
- **Idempotency comes from Garmin's `activityId`**, which the bridge now emits
  (it was being discarded). The primary key is derived from it, and
  `(user_id, external_id)` is uniquely indexed — Protocol's importer mints a random
  UUID per sync against tables unique on `id` alone, which is how duplicate
  activities got into this database. The index is **not partial**: PostgREST cannot
  infer a partial index for `on_conflict`, and NULLs are distinct anyway, so manual
  entries stay unconstrained.
- **Exercise sets are replaced by date range, never upserted.** Three sets of 10 reps
  at 60 kg in one session are three legitimately identical rows, and Garmin gives
  sets no per-set id. The range is required — a delete without bounds would wipe the
  history.

Nearly every numeric column in `protocol_*` is `integer` while Garmin sends floats
(elevation arrives as `156.109375`); the function rounds on the way in.

### Conventions that fail silently

- **`supabasePublic`, not `supabase`**, for `time_entries` / `active_sessions` /
  `blocked_sites` / `blocked_apps` / `focus_blocks` / `unlock_rules` /
  `blocking_state` / `pomodoro_config`. These are keyed `user_id = "default"` under
  anon-role RLS; reading them with the authenticated JWT returns an **empty set, not
  an error** — indistinguishable from "no data". Both clients are exported from
  `src/lib/supabase.ts`.
- **Timestamps: two formats are live in the same columns.** `TimeTrackerApp` writes
  `Local::now()` with **no offset** on every `start_timer` (`db/timer.rs`), while
  NexusLocal writes RFC3339 UTC. `start_time` is a `text` column and nothing
  normalises it. JS parses an offset-less string as *local*, so mixing them shifts
  durations by the whole UTC offset — and a clamp at zero turns that into a
  **0-second entry**. Anything parsing those columns must handle both.
- **camelCase IPC keys**: `invoke("tt_session_start", { taskName })`. snake_case
  works on macOS and hard-fails on iOS with `invalid args`. Rust stays snake_case.
- Panels register in `src/lib/timetracker/index.tsx`, never in `App.tsx` — one entry
  per line, so parallel work doesn't conflict on the same line.
- Everything renders **outside** `AuthGate`. It is a full-screen replacement, so
  gating hid the entire productivity surface from a signed-out launch; these tables
  need no session anyway. A session only buys widgets a JWT.

### Widget writes go through one hole only

`SupabaseClient.swift` deliberately exposes no generic write. Every widget mutation
goes through a dedicated edge function with its own scoped secret — `habit-toggle`
(`WIDGET_HABIT_KEY`), `session-toggle` (`WIDGET_SESSION_KEY`) — POST-only,
constant-time compare, fail-closed under 32 chars, service-role client with a
server-side owner check. The secret ships in a distributed binary and is extractable;
what the design buys is a blast radius of "this user's sessions" rather than
"everything the anon role can reach". Don't widen it.

## iOS Deployment Notes

TimeTrackerApp is the first app in the ecosystem to ship to a physical iPhone
(iOS 26.2, free Apple Developer tier). The plumbing is fiddly enough that the
lessons learned are worth preserving before porting Vault / PathFinder / Stonks
next. See `apps/TimeTrackerApp/IOS_MIGRATION.md` for the full walkthrough —
these are the rules that apply to any app in the workspace:

**Bundle IDs must be globally unique on the free tier.** Generic IDs like
`com.<appname>.app` are often already claimed by someone else's free account.
Use a personal namespace like `com.bastianthomsen.<appname>`. Set it in both
`tauri.conf.json` (`identifier`) and `gen/apple/project.yml` (`bundleIdPrefix`
and `PRODUCT_BUNDLE_IDENTIFIER`).

**`tauri.conf.json`'s `iOS.developmentTeam` must match a signed-in Xcode
account.** The personal team is `G9D6JYJSLT`. If you see "No Account for Team
'...'" in the build log, the team ID doesn't match any account visible in
Xcode → Settings → Accounts.

**`ENABLE_USER_SCRIPT_SANDBOXING` must be `NO` in the iOS target's Build
Settings** (both Debug and Release). Xcode 15+ enables it by default; it
blocks Tauri's `node tauri ios xcode-script` pre-build phase from reading the
`tauri` helper folder. Pin it in `gen/apple/project.yml` under the target's
`settings.base` block so it survives `tauri ios init` regeneration.

**Writes to the iOS app container root are denied by sandbox.** `home_dir()`
on iOS returns the container root (`/var/mobile/Containers/Data/Application/
<uuid>/`) which is **read-only**. Apps may only write under `Documents/`,
`Library/`, or `tmp/`. Any code that currently does
`home_dir().join(".something")` will crash at startup on iOS with
`Sandbox: <App>(pid) deny(1) file-write-create ...`. TimeTrackerApp solves
this with a `writable_root()` helper in `src-tauri/src/config/settings.rs`
that routes through `$HOME/Documents/` on iOS and leaves desktop paths
unchanged — copy the same pattern to any other app touching the filesystem
directly.

**Tauri 2 IPC keys must be camelCase.** `invoke("my_cmd", { task_name: ... })`
silently works on macOS but hard-fails on iOS with
`invalid args 'taskName' for command 'my_cmd'`. JS side = camelCase; Rust
side stays snake_case, Tauri bridges the two.

**SQLite on iOS 26.x betas hates `UNIQUE` and `CHECK` constraints** inside
`CREATE TABLE IF NOT EXISTS`. Drop them from the DDL and enforce at the app
layer, and wrap migrations in a loop that swallows errors per statement.

**Free-tier certificates expire in ~7 days.** Re-running `npx tauri ios dev`
(with the phone plugged in) refreshes the install. There's no App Store or
TestFlight path on the free tier.

### Two delivery paths, and the choice decides whether App Groups work

This is the single most consequential thing to understand about this repo's iOS
story, and it is *not* a free-tier limitation — it is a consequence of **how the
app reaches the phone**.

| | **Xcode-direct** (TimeTracker) | **SideStore** (Nexus Local) |
|---|---|---|
| How | `./ios-build.sh` → `npx tauri ios build` → `xcrun devicectl device install` | CI builds an **unsigned** IPA → SideStore re-signs **on-device** |
| Signed by | Xcode on this Mac, with your Apple ID | SideStore, with your Apple ID, after download |
| App Group | **Survives** — the entitlement it was signed with is what ships | **Dies** — re-signing drops it |
| Updating | plug the phone in, re-run the script | one tap in SideStore |
| Apple creds in CI | n/a | **none** — that's the whole point |

Verified on-device 2026-08-06 via `appgroup_debug` in the KeychainDebug panel:
Nexus Local reports `ctr:NIL` and `alt:0 []` — SideStore injected **zero**
`ALTAppGroups` entries, so `AppGroup.swift`'s runtime resolver (written expecting
SideStore to rewrite the group ID and record the real one there) has nothing to find.

**What that costs.** The Safari content blocker needs a shared container: the widget
compiles a `WKContentRuleList`, the extension reads it. Without an App Group they are
separate containers and no rules cross. So on the SideStore path, on-phone Safari
blocking does not work — enforcement falls to the Mac grid node (`modules/blocking.rs`,
`/etc/hosts` + process kill), which reads the same `blocking_state` row.

**TimeTracker's iOS site blocking works** precisely because `ios-build.sh` installs it
directly and nothing re-signs it afterwards. If Nexus Local needs the full autonomous
chain, add a `nexuslocal` case to `resolve_app()` in `ios-build.sh` (it still only
knows `PHONE_APPS=(timetracker)`) and install it the same way — trading the one-tap
SideStore update for a ~7-day cable refresh. A paid developer account ($99/yr) is the
other route: a registered App Group survives re-signing.

**Two more reads from that same panel worth knowing how to interpret:**
- `grp:… ctr:NIL sess:yes` is a **false positive**. With no App Group entitlement,
  `UserDefaults(suiteName:)` silently falls back to the app's own defaults — so the
  session was written where only the app can see it. The widget never reads it.
- `kc grp:… sess:no` with `probe:OK` is a **real bug, not a provisioning limit**: the
  keychain access group resolves and round-trips, but no session is stored there.
  `SessionBridge` is meant to write both channels. Fixing it is what would give
  widgets a JWT instead of falling back to the anon key.

### Releasing Nexus Local — bump all three, in lockstep

`tauri.conf.json` decides what `apps.json` advertises; `gen/apple/project.yml` decides
what the installed binary reports; `Cargo.toml` feeds `GridStatus.version`. CI restores
the committed `project.yml` after `tauri ios init`, so bumping only `tauri.conf.json`
makes SideStore advertise a version the binary doesn't report and re-offer the same
update forever. `AUTOUPDATE.md` names only the first — it is wrong.

```bash
# edit all three to the same value, then:
git tag nexuslocal-v0.12.0 && git push origin nexuslocal-v0.12.0
```

**Never run `tauri ios init`** — it overwrites `project.yml` with a stock single-target
spec. CI has to `git checkout --` it for exactly this reason. Edit `project.yml`
directly. `gen/` is gitignored *except* `project.yml` and `NexusLocalWidgets/*`, so
committing `project.yml` needs `git add -f`. `NexusLocalWidgets/Secrets.swift` is
gitignored and generated in CI — a fresh worktree cannot link the app until you copy
it in from the main checkout.

## ⚠️ Security: 13 tables are world-writable — read before touching RLS

The repo is public, the anon key is committed in `config.rs`, and 13
productivity/grid tables carry `USING (true)` for **ALL** commands — so anyone
can delete your time entries or rewrite your block list. The full audit, the
ordered migration plan, and the reasons the obvious fixes are wrong live in
**`SECURITY_RLS_MIGRATION.md`**. Read it before changing any policy.

The two things most likely to be got wrong:

- **A mismatched JWT returns an empty set, not an error.** A half-finished
  migration does not fail loudly — blocking silently stops on Mac *and* phone and
  the widget reads "nothing blocked", which looks exactly like success.
- **Do not make the repo private.** It breaks GitHub Pages (SideStore's
  `apps.json` source), unauthenticated release-asset downloads, and unlimited
  Actions minutes. It was only ever mitigation against key scraping, and the key
  ships inside the IPA anyway.

## Supabase: Shared Cloud Backend

All apps that need cloud persistence use the single **NEXUS** Supabase project
(`efxmzsdisaymtpebaxlp`, region `eu-north-1`). Tables are namespaced by app
prefix to avoid collisions.

Migrations live at `supabase/migrations/` (`YYYYMMDDHHMMSS_slug.sql`, forward-only,
`IF NOT EXISTS`-guarded). Edge functions at `supabase/functions/`; Protocol keeps its
own under `apps/Protocol/supabase/functions/`. Deploying a function and applying a
migration are separate steps.

| App prefix | Tables |
|------------|--------|
| *(none)*   | `time_entries`, `active_sessions`, `blocked_sites`, `blocked_apps`, `focus_blocks`, `unlock_rules` (TimeTracker) |
| *(none)*   | `blocking_state`, `pomodoro_config`, `schedule_block_apps`, `schedule_block_sites` (Nexus Local productivity stack) |
| *(none)*   | `nexus_local_nodes`, `nexus_local_commands` (grid queue), `nexus_ble_captures` |
| `pf_`      | 45 tables — goals, plans, tasks, systems, calendar, pipelines, habits, games, … (PathFinder) |
| `vault_`   | `vault_nodes`, `vault_edges`, `vault_tag_colors`, `vault_content`, `vault_journals` + Storage bucket `vault-assets` (Vault) |
| `protocol_`| 28 tables — health/fitness. Body/sleep (`protocol_body_metrics`, `protocol_sleep`), workouts (`protocol_workout_sessions`/`_routines`/`_plans`, `protocol_exercises`, `protocol_exercise_sets`/`_library`/`_aliases`, `protocol_running_sessions`/`_plans`), nutrition (`protocol_foods` + static `protocol_foods_dk`, `protocol_meals`/`_meal_items`/`_meal_plan_entries`/`_nutrition_goals`, `protocol_supplements`/`_logs`), habits, config (`protocol_data_source_settings`, `protocol_progress_config`), Oura auth (`protocol_oura_tokens`, `protocol_oauth_states`). **`protocol_foods`, `protocol_meals`, `protocol_meal_items` are shared read-all / write-own** — any user sees & logs another's foods/meals, edit/delete owner-only; most other tables are owner-only `auth.uid()`; `protocol_foods_dk` is public-read reference data (Protocol) |

**PathFinder data layer** (`apps/PathFinder/src/lib/`):
- `supabase.ts` — creates the shared client from `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` env vars.
- `api.ts` — every data function that previously called `invoke()` into Rust
  now calls Supabase directly. Function signatures are **unchanged** so all
  page components work without modification.

Required `.env` file at `apps/PathFinder/.env` (gitignored):
```
VITE_SUPABASE_URL=https://efxmzsdisaymtpebaxlp.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from Supabase dashboard>
```

**RLS posture**: all `pf_` tables have RLS enabled with a permissive `anon`
policy (`USING (true)`). Tighten policies and add `auth.uid()` checks when
Supabase Auth is introduced.

**Computed fields** (`task_count`, `done_count`, `feature_count`, streaks,
`recent_dates`): resolved client-side via parallel Supabase queries inside
`api.ts` — no DB functions or views required.

**Recurring calendar blocks**: `pf_recurring_cal_blocks` stores the rules;
`getCalBlocks()` expands them into virtual `CalBlock` entries client-side
(stable negative IDs derived from `recurring_id × 100 000 + dayOffset`).

**`user_id` convention**: all root-level tables carry `user_id TEXT DEFAULT
'default'`. When Supabase Auth is added, replace `'default'` with
`auth.uid()` and update RLS policies accordingly.

**Vault data layer** (`apps/Vault/Vault/src/lib/`):
- `supabase.ts` — shared client from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
- `api.ts` — all graph operations (loadGraph, createNode, deleteNode, addEdge,
  removeEdge, tag CRUD) plus `readContent`, `saveContent`, `readJournal`,
  `saveJournal`, and `uploadAsset` (→ Supabase Storage bucket `vault-assets`).
- The `VaultGraph` structure (nodes, edges, back_edges, tag_colors) is
  assembled client-side on every mutating call via a single `loadGraph()` pass.
- PDF/Video binaries live in Storage; `vault_content` stores their public URL.
- `vault_content.node_id` has no FK so annotation keys (`{id}_annot`) work.
- Two Postgres helper functions handle bulk array operations:
  `vault_rename_tag(user_id, old, new)` and `vault_delete_tag(user_id, tag)`.

Required `.env` at `apps/Vault/Vault/.env` (gitignored):
```
VITE_SUPABASE_URL=https://efxmzsdisaymtpebaxlp.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

## Vault: Frontend Gotchas

These are non-obvious requirements that broke the 3D graph and PDF viewer once and will again if you regress them — keep them in `vite.config.ts` and `PdfViewer.tsx`.

**`resolve.dedupe: ["three", "react", "react-dom"]` is required.** `@nexus/core` is aliased to source and imports `three` directly (`AppGraph3D`, `Chart3D`); `react-force-graph-3d` pre-bundles its own `three`. Without dedupe you end up with two `THREE` instances and three-forcegraph's `state.layout` ends up undefined — every animation frame crashes with `Cannot read properties of undefined (reading 'tick')` inside `layoutTick`. Same logic for React (dual-React = blank screen, per the React-19 parity rule above).

**Pre-bundle the heavy deps** in `optimizeDeps.include`: `three`, `three-spritetext`, `react-force-graph-2d`, `react-force-graph-3d`, `pdfjs-dist`, `@react-three/fiber`, `@react-three/drei`, `@tiptap/react`, `@tiptap/starter-kit`. Don't include `@tiptap/pm` (no `.` exports). The pre-bundling makes failures deterministic at boot rather than mid-session when AVG quarantines a lazy chunk.

**ForceGraph3D ↔ kapsule ↔ React useEffect race.** `react-force-graph-3d`'s wrapper calls `comp(domEl)` in `useLayoutEffect` which schedules a 1ms-debounced `_updateGraph` that sets `state.layout`. React's `useEffect` (where `applyForces` lives) fires through `MessageChannel` scheduling and beats that timer. If `applyForces` calls `d3ReheatSimulation()` before the debounce, `engineRunning=true` flips while `state.layout` is still undefined → next animation frame crashes. Two-line fix in `App.tsx`:

1. Gate `<ForceGraph3D>`/`<ForceGraph2D>` mount on `filteredGraphData.nodes.length > 0` (show a "Loading…" placeholder otherwise).
2. Schedule the initial `applyForces()` via `setTimeout(applyForces, 50)` instead of calling it synchronously.

**PDF.js v5+ has four sharp edges; PdfViewer.tsx has them all wired:**

1. `page.cleanup()` returns `void`, not a `Promise`. `page.cleanup().catch(...)` throws `TypeError: page.cleanup(...).catch is not a function` and React unmounts cascade-fail across every `<PdfPage>`. Use `try { page?.cleanup() } catch {}`.
2. `page.render({ canvasContext })` is deprecated and silently produces no pixels in v5; use `page.render({ canvas })` instead.
3. v5 ships image decoders (JBig2, OpenJPEG) and color management as WASM, plus the 14 PDF base fonts as separate files. Without `wasmUrl` and `standardFontDataUrl` passed to **`getDocument`** (NOT `GlobalWorkerOptions` — those keys are ignored on the global), pages with JBig2 images render blank and the console floods with "Ensure that the `standardFontDataUrl` API parameter is provided". The asset directories are copied from `node_modules/pdfjs-dist/{wasm,standard_fonts}` into `apps/Vault/Vault/public/pdfjs-{wasm,fonts}/`.
4. Set `useSystemFonts: false` in the `getDocument` options — the Tauri WebView2 has no path to the OS font directory and pdfjs falls back to the standard fonts cleanly.

**PDF page wrappers must use block layout, not inline-block in a flex column.** `.pdf-scroll-area` cannot be `display: flex; flex-direction: column; align-items: center` if its children are inline-block: WebView2 (Chromium) collapses them to height 0 inside the `overflow: auto` container, and pages render correctly into invisible boxes. Use plain block layout on the scroll area and `display: block; width: max-content; margin: 0 auto` on the wrapper.

## Scheduled server-side work (pg_cron)

Three jobs run in the database, and this is the pattern for anything that must happen
while every device is asleep:

| Job | Every | Function |
|---|---|---|
| `protocol-oura-daily-sync` | daily | `oura-sync` |
| `protocol-bodyscan-sync` | 10 min | `bodyscan-sync` — decodes raw BLE scale captures |
| `nexus-focus-evaluate` | 5 min | `focus-evaluate` — writes `blocking_state` |

They `net.http_post` the function with the service-role key read from
**Vault** (`vault.decrypted_secrets`), not inlined — rotating the key needs no job edit.
Copy that shape. Function secrets (`SESSION_LOCAL_TZ`, `WIDGET_HABIT_KEY`,
`WIDGET_SESSION_KEY`) are set with `npx supabase secrets set`, separately from repo
secrets used by CI.

`bodyscan-sync` duplicates the BIA calibration constants from
`apps/NexusLocal/src/lib/bodyScan.ts` with only a comment enforcing the match — keep
the `CAL` blocks in sync after any re-calibration.

## Environment gotchas on this machine

Cost real time; check here first.

- **`ls`, `cat` and friends are aliased** to `eza` / `bat`, which are not installed.
  A bare `cat` in a script fails with `command not found: bat` and silently yields an
  empty variable. Use `/bin/ls`, `/bin/cat`.
- **`gh`, `xcodegen` and `supabase` are not on `PATH`** — `/opt/homebrew/bin/` and
  `npx supabase`. The bundled CLI is old: `supabase functions logs --project-ref`
  doesn't exist; use the Supabase MCP `get_logs` instead.
- **xcodebuild configs here are lowercase** — `-configuration debug`, not `Debug`
  (`project.yml` declares `configs: {debug, release}`).
- **Parallel builds will fill the disk and stall the machine.** Each git worktree gets
  its own ~2 GB `target/`, and cargo defaults to one job per core *per invocation* —
  a dozen concurrent worktrees drove this 8-core machine to load 163 with swap
  thrashing. `~/.cargo/config.toml` now pins `jobs = 2`. For big fan-outs also set a
  shared `CARGO_TARGET_DIR`: cargo's lock then serialises builds instead of letting
  them stampede, and the per-worktree disk cost disappears. `cargo clean` at the repo
  root frees ~20 GB.

## Adding a New App to the Ecosystem

1. Scaffold with `npm create tauri-app` inside `apps/<AppName>/`.
2. Add `"@nexus/core": "*"` to the app's `package.json` dependencies.
3. Add `"@nexus/core": path.resolve(__dirname, "../../packages/nexus-core/src/index.ts")` to `vite.config.ts` resolve aliases (adjust depth for Vault-style nesting).
4. Add a `@source` directive pointing at `packages/nexus-core/src` in the app's Tailwind CSS entry.
5. Call `useNexusRegistration("AppName")` in the root component.
6. Render `<NexusHeader appName="AppName" />` at the top of the app layout.
7. Add the workspace path to root `package.json` `workspaces` array and a `dev:<appname>` script.
8. Add the app's `src-tauri` to the root `Cargo.toml` workspace members.
