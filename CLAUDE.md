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
`schedule_block_{apps,sites}` + `unlock_rules` + `blocked_{sites,apps}` +
`meal_sessions`/`meal_unlock_targets` + today's `time_entries` into **one** row:

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

**Meal sessions are the sanctioned valve** (`MealsPanel`, added 2026-08-16): breakfast,
lunch and dinner each buy a 30-minute unblock of a per-meal target list
(`meal_unlock_targets`), once per meal per local day (unique index on `meal_sessions`,
not a UI guard). Activation inserts the session row, logs a `pf_cal_blocks` entry so it
shows in PathFinder's Week view, and pokes `focus-evaluate` directly so the unblock
lands on the Mac's next 30 s tick instead of the next cron pass. Expiry re-blocks via a
second poke while the app is open, else on the cron pass (≤5 min late). As always the
panel derives no policy — the evaluator removes active meal targets from
`blocking_state` and every enforcer just reads that.

### Usage tracking, and the one table with different RLS

The daemon measures foreground time: `modules/usage_tracker.rs` samples the frontmost
app via `lsappinfo` every 5s (no TCC prompt) with idle from `ioreg -c IOHIDSystem`
(idle >120s closes the interval at `now - idle`, or you log lunch as work). Websites
come from a Chrome MV3 extension in `apps/NexusLocal/extensions/chrome-usage/`, which
POSTs to `usage_ingest.rs` on **127.0.0.1:1431** authenticated by a token in
`state_dir()/browser_token`. Everything lands as JSONL in `~/.nexuslocal/usage/`.

`DayCoveragePanel` (added 2026-08-16) widens that view to the whole day: it stitches
the tracker's raw spans (`tt_usage_intervals`), Protocol sleep bed/rise times
(`protocol_sleep` read anon via its `widget_anon_read` policy — no session needed),
Garmin training sessions (`protocol_{workout,running}_sessions.started_at`; runs
reconstruct duration as pace × distance and skip when either is missing) and
PathFinder calendar blocks (`pf_cal_blocks` + recurring, expanded with PathFinder's
0=Sun weekday numbering, **not** ISO 1–7) into a 24 h coverage timeline. Leftover
gaps ≥ 30 min carry one-tap category chips (shared list in
`timetracker/categories.ts` — Phase E of `DAY_COVERAGE_ROADMAP.md` reuses these
strings, don't rename casually) that file a `pf_cal_blocks` row over the gap. Honesty
checks (screen-during-sleep, screen-heavy offline blocks) render as footnotes and
never alter the coverage number. Span math lives in `timetracker/coverage.ts`, pure
and React-free on purpose. Usage data itself still never leaves the Mac — the panel
only reads remote rows next to it. `garmin-import` converts Garmin's naive
`startTimeLocal` Copenhagen→UTC into `started_at` (added 2026-08-16; older rows are
NULL until a re-sync backfills them). `timetracker/history.ts` rebuilds the same
coverage picture for the last 30 days in a handful of range queries (screen via
`tt_usage_spans_range`, one call) for the heatmap strip, and
`detectRecurringGaps` turns a gap recurring on ≥3 of the last 7 days into a
one-tap weekly-block suggestion (accepts insert `pf_recurring_cal_blocks`,
dismissals live in localStorage under `nl-coverage-dismissed-suggestions`).

The JSONL *reading* half (entry type, parser, `read_day`, path resolution) lives in
`packages/nexus-core/crate/src/usage_store.rs`; NexusLocal's `usage.rs` re-exports it
and keeps the writers. PathFinder's src-tauri (revived 2026-08-17 after going dormant
in the Supabase migration) reads the same files via `pf_usage_spans` for the Week
view's off-by-default "Actual" overlay (sleep/screen/training behind the planned
blocks — usage data still never leaves this Mac). The shared span math is
`packages/nexus-core/src/coverage.ts`, imported via the `@nexus/core/coverage` deep
alias in both apps' vite configs — deliberately not the `@nexus/core` barrel, which
would drag three.js into every consumer.

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
(`WIDGET_HABIT_KEY`), `session-toggle` (`WIDGET_SESSION_KEY`), `task-quick`
(`WIDGET_TASK_KEY`, complete/create quick tasks in `pf_tasks`), `meal-log`
(`WIDGET_MEAL_KEY`, toggle/insert `protocol_meal_plan_entries`) — POST-only,
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

## What am I working on — `pf_agent_brief`

Planning happens in PathFinder and Vault; work happens in a terminal. To see the
current goals, active tasks, what's due and which plans are live, call
`select pf_agent_brief('<uid>')` — one round trip, ~1600 tokens, facts only.
**Pass the uid**: the MCP is service-role, where `auth.uid()` is NULL and an
omitted argument returns an empty brief that looks like "nothing planned".

Everything else — looking a task up by id, reading a Vault note, and the three
rules you must NOT re-derive — is in the `brief` skill, which loads on demand so
it costs nothing until it is needed.

## Supabase: Shared Cloud Backend

All apps that need cloud persistence use the single **NEXUS** Supabase project
(`efxmzsdisaymtpebaxlp`, region `eu-north-1`). Tables are namespaced by app
prefix to avoid collisions.

Migrations live at `supabase/migrations/` (`YYYYMMDDHHMMSS_slug.sql`, forward-only,
`IF NOT EXISTS`-guarded). Edge functions at `supabase/functions/`; Protocol keeps its
own under `apps/Protocol/supabase/functions/`. Deploying a function and applying a
migration are separate steps.

⚠️ **One database, every branch — so schema REMOVALS are strictly ordered.**
There is no staging project. The apps Vercel serves are built from `main`, and
they talk to the same Supabase project a feature branch does. Additive changes
(new columns, tables, indexes) are therefore safe in any order — deployed code
simply ignores them. **Removals are not.** Dropping a table or column that
deployed code still queries breaks production the moment it is applied, before
anything is merged.

This is not theoretical: `pf_reminders` was dropped while it was empty and
believed orphaned, but `main`'s `getReminders()` ends in `if (error) err(error)`
and the dashboard calls it inside a `Promise.all` — so the missing table did not
degrade to an empty list, it rejected the entire dashboard load. Emptiness was
never the relevant fact; *deployed code still reading it* was. It had to be
recreated (`20260821130000_restore_pf_reminders.sql`).

The order is: **stop reading it → merge → deploy → then drop.** Before applying
any removal, grep `origin/main` — not your branch — for the thing being removed.

| App prefix | Tables |
|------------|--------|
| *(none)*   | `time_entries`, `active_sessions`, `blocked_sites`, `blocked_apps`, `focus_blocks`, `unlock_rules` (TimeTracker) |
| *(none)*   | `blocking_state`, `pomodoro_config`, `schedule_block_apps`, `schedule_block_sites` (Nexus Local productivity stack) |
| *(none)*   | `nexus_local_nodes`, `nexus_local_commands` (grid queue), `nexus_ble_captures` |
| `pf_`      | 51 tables — goals, plans, tasks (an ISA hierarchy: `pf_tasks` + `pf_task_{planning,reminders,chores,shopping}`), `pf_task_sessions`, systems, calendar, pipelines, habits, games, … + views `pf_goals_with_counts` / `pf_plans_with_counts` (PathFinder) |
| `vault_`   | `vault_nodes`, `vault_edges`, `vault_tag_colors`, `vault_content`, `vault_journals` + Storage bucket `vault-assets` (Vault) |
| `protocol_`| 28 tables — health/fitness. Body/sleep (`protocol_body_metrics`, `protocol_sleep`), workouts (`protocol_workout_sessions`/`_routines`/`_plans`, `protocol_exercises`, `protocol_exercise_sets`/`_library`/`_aliases`, `protocol_running_sessions`/`_plans`), nutrition (`protocol_foods` + static `protocol_foods_dk`, `protocol_meals`/`_meal_items`/`_meal_plan_entries`/`_nutrition_goals`, `protocol_supplements`/`_logs`), habits, config (`protocol_data_source_settings`, `protocol_progress_config`), Oura auth (`protocol_oura_tokens`, `protocol_oauth_states`). **`protocol_foods`, `protocol_meals`, `protocol_meal_items` are shared read-all / write-own** — any user sees & logs another's foods/meals, edit/delete owner-only; most other tables are owner-only `auth.uid()`; `protocol_foods_dk` is public-read reference data (Protocol) |

**PathFinder data layer** (`apps/PathFinder/src/lib/`):
- `supabase.ts` — creates the shared client from `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` env vars.
- `api/` — **a directory, not a file.** Every data function calls Supabase
  directly. Split into twelve domain modules (`tasks`, `calendar`, `daily`,
  `courses`, `training`, `week`, `goals`, `plans`, `systems`, `notes`, `games`,
  `misc`) plus `_shared.ts`, which holds the client, `err`/`num`, **every row
  mapper**, and the `TASK_SELECT` constants. `api/index.ts` re-exports the lot,
  so every `from "../lib/api"` still resolves and no call site changed.

  It was one 3,142-line file until 2026-08-21. Keeping the mappers and
  `TASK_SELECT` together is the point: a `pf_tasks` read that omits the
  `pf_task_planning` embed does not fail, it silently yields default urgency and
  stage — and that mistake was sitting in four separate places because the file
  was too big for anyone to see the others.

**Pure logic lives outside components, and is tested.** `taskTree.ts` (breakdown
roll-ups, coverage, the gate), `systems.ts` (the one due-rule), `nextUp.ts` (the
"work on now" ranking) and `coverage.ts` are React-free on purpose. `npm test`
in `apps/PathFinder` runs vitest over `src/**/*.test.ts` — 78 cases, each drawn
from a bug that actually happened rather than for coverage. Add to these before
touching the rules they encode.

**Page components live in `components/dashboard/` and `components/week/`.**
`Dashboard.tsx` (382 lines) and `Week.tsx` (880) are now state + layout only.
Watch for the trap that splitting them exposed: constants declared *between*
components get swept into whichever neighbour precedes them, so anything shared
belongs in that folder's `_shared.ts`.

Required `.env` file at `apps/PathFinder/.env` (gitignored):
```
VITE_SUPABASE_URL=https://efxmzsdisaymtpebaxlp.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from Supabase dashboard>
```

⚠️ **RLS posture — this section was stale and is corrected here.** It used to say
every `pf_` table carried a permissive `anon` policy (`USING (true)`) pending some
future auth work. **PathFinder's auth is live.** `pf_tasks` and its neighbours are
scoped to `auth.uid()` for the `authenticated` role, which is why `api.ts` reads them
with the session client and why `apps/NexusLocal/src/lib/pathfinder/api.ts` says
"`supabase`, not `supabasePublic`" at the top.

This mattered in practice: correct code comments asserting owner-scoping were being
"corrected" against this paragraph. The tables still carrying `USING (true)` are the
thirteen productivity/grid ones — `time_entries`, `blocked_sites`, `focus_blocks` and
company — enumerated in `SECURITY_RLS_MIGRATION.md`. Those are the defect. The `pf_`
tables are not.

The exception worth knowing is `pf_cal_blocks`, which additionally carries an anon
read policy so the iOS widgets can render a day without a JWT.

**Computed fields**: `pf_goals_with_counts` and `pf_plans_with_counts` are
Postgres views (both `security_invoker = on` — without it a view bypasses the
base table's RLS and would publish every user's task titles). Streaks and
`recent_dates` are still resolved client-side.

**Recurring calendar blocks**: `pf_recurring_cal_blocks` stores the rules;
`getCalBlocks()` expands them into virtual `CalBlock` entries client-side
(stable negative IDs derived from `recurring_id × 100 000 + dayOffset`).

**`user_id` convention**: all root-level tables carry `user_id TEXT DEFAULT
'default'`. When Supabase Auth is added, replace `'default'` with
`auth.uid()` and update RLS policies accordingly.

### PathFinder tasks are an ISA hierarchy, not one wide table

`pf_tasks` is a **supertype**. Each kind of task has its own subtype table, and
they are deliberately unequal in size — this is the whole point, so do not
"simplify" it back into nullable columns on `pf_tasks`:

| discriminator | subtype table | columns |
|---|---|---|
| `task` | `pf_task_planning` | urgency, stage, completion_mode, target_count, notes |
| `reminder` | `pf_task_reminders` | remind_at, lead_minutes |
| `chore` | `pf_task_chores` | area, rotation_days |
| `shopping` | `pf_task_shopping` | quantity, store |

`task_type` is a **generated column** (`coalesce(category, 'task')`), so it can
never drift from the `category` that existing writers — the `task-quick` edge
function, the iOS widgets, Nexus Local — already set. Nothing had to change to
adopt it.

What belongs where is a modelling call: `priority`, `due_date` and
`time_estimate` stay on the supertype because they mean something for a chore
("medium, 15 min, by Friday"). `stage` and `completion_mode` do not — a reminder
has no lifecycle to gate and nothing to measure.

Specialization is **disjoint** (a trigger refuses a subtype row whose supertype
has the wrong `task_type`) and **total for `task`** (a trigger materialises the
planning row, and drops it if the task is re-typed to a sparse kind — demotion is
lossy by construction). Read tasks with the embed `*, pf_task_planning(*)`:
PostgREST returns an object for a full task and **`null`** for the sparse kinds,
which is exactly the ISA shape. `api.ts` `splitPatch` routes a flat patch to the
right relation so callers never have to know; `taskTree.ts` `applyTaskPatch` is
its client-side mirror for optimistic updates — spreading a patch containing
`urgency` straight onto a task sets a dead property, and the matrix pad appears
frozen until the refetch lands.

### Goals are reached from the task, not only through plans

`pf_tasks.goal_id` points at a goal directly. The original model was goal → plan
→ task only, and that chain went **unused**: of 162 root project tasks 48 carried
a plan, and of 15 plans **zero** carried a `goal_id`. No task could reach a goal,
so `pf_goals_with_counts` — which joins through plans — counted nothing and every
goal sat permanently at 0%. The bars could never move. If a goal reads 0%, check
the linkage before suspecting the renderer.

A **direct** goal beats the one inherited via plan. It is the more specific
statement, and preferring it is what stops a task that reaches a goal both ways
being counted twice. The view and `mapTaskWithContext` implement the same
precedence deliberately — if they diverge, the header and the board disagree.

Only **root, non-quick** tasks count toward a goal. Counting steps would mean
breaking a task into five pieces inflates its goal's denominator from 1 to 6 —
the same class of bug that made the dashboard's open-task pill grow the more
carefully you planned. `ON DELETE SET NULL`, never CASCADE: deleting a goal must
not delete the work aimed at it.

⚠️ `pf_tasks` now reaches `pf_goals` **two ways**, so PostgREST refuses an
ambiguous embed — `TASK_SELECT_CTX` disambiguates with
`pf_goals!pf_tasks_goal_id_fkey`.

### One recurrence engine: Systems, with two kinds of cadence

`pf_systems.frequency` accepts `daily` / `weekly` / `monthly` — **calendar**
recurrence, due-ness follows the date — and `interval` (+ `interval_days`) —
**since-completion** recurrence, due-ness follows `last_done` and the schedule
floats with behaviour. Wash the clothes on Friday instead of Tuesday and the next
one moves with you; `weekly` cannot express that, which is why chores promote
into an interval system rather than growing a second engine on `pf_tasks`.

The due rule lives **only** in `lib/systems.ts`. It was previously written out
three times (QuickPanels, Week, `getTodayFocus`) and the copies already disagreed
about monthly and about unknown frequencies. A CHECK constraint enforces the
pairing so an `interval` system cannot exist without a positive `interval_days`
(which would read as due forever) and a calendar frequency cannot carry one.

**Three more traps in the task model:**

- **`aggregate_estimate` is trigger-maintained; never write it.** `time_estimate`
  is what a task claims for *itself*, and stops being true the moment it is
  broken down. The trigger keeps `aggregate_estimate` = sum of children's
  aggregates (or own estimate for a leaf) up the whole ancestor chain, so
  `select *` gives every consumer the real total. `taskTree.ts`'s
  `rollupEstimate` mirrors that rule **exactly** — an unset estimate contributes
  0, not a guessed default. If the two rules diverge the number visibly jumps on
  refresh.
- **The scheduling gate lives in `api.ts` `setTaskStage`, not in the database.**
  A task cannot reach `stage = 'active'` without calendar minutes behind it. The
  predicate spans three tables, so a trigger evaluating it on every task write
  would tax unrelated bulk updates (reorder writes one row per task). That means
  it is only enforced through that one function — add new stage writers there.
- **Partial scheduling needs no new table.** A task may have many
  `pf_cal_blocks` rows, and `pf_recurring_cal_blocks` now carries `task_id` too,
  so "4h of a 6h task is committed" is just a sum. Recurring series are counted
  by *occurrence* over a bounded 365-day horizon — an open-ended series would
  otherwise contribute infinite scheduled time.
- **`pf_task_sessions.cal_block_id` is not a foreign key, and its unique index
  is not partial.** Ticking a *recurring* occurrence off stores the occurrence's
  **virtual negative id** (`-(recurring_id × 100 000 + dayOffset)`), for which no
  row exists — that is what stops one Wednesday's tick marking the whole series.
  The `(task_id, cal_block_id)` index was first written partial (`where
  cal_block_id is not null`) and the upsert failed outright: PostgREST cannot
  infer a partial index for `on_conflict`. Same trap as garmin-import's
  `(user_id, external_id)`, same fix — drop the WHERE. NULLs are distinct anyway,
  so freehand sessions stay unconstrained.

**Working a task** happens on the calendar surfaces, not in the planner: a block
with a `task_id` renders a tick in Week and Dashboard, and ticking it logs a
session. That is the only thing that advances `sessions`- and `time`-mode
completion, so a recurring step that is never ticked never finishes no matter how
often it is scheduled.

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

## Vault CSS: there were two palettes, not one untokenised palette

⚠️ `App.css` grew an oklch scale on `:root` AND a separate hex palette that
predates it. Measured before touching anything: of 234 colour literals outside
`:root`, **exactly one** matched a declared token. They were never untokenised
references to the scale — they were a second scale.

So "tokenise the CSS" is not a find-and-replace. The fifteen colours used three
or more times are now named (`--accent`, `--danger-solid`, `--handle`, …),
covering 104 of the 234; `lib/cssTokens.test.ts` is a ratchet that fails if any
of them is written as a hex literal again, naming the token to use instead.

**92 colours are used exactly once and are deliberately NOT tokenised.** A token
used once is a rename, not an abstraction, and naming them is a design decision
rather than a cleanup — so a dark theme (833) still needs that conversation
before it can override everything.

⚠️ `--accent`/`--accent-pdf` and `--danger-solid`/`--danger-pdf` are near
duplicates that drifted apart, not two intentional colours. They are kept
distinct because unifying them would change pixels, which is a decision rather
than a cleanup.

The rule the whole change was held to: **no rendered colour may move.** Verified
rather than asserted — expanding every new token back to its value reproduces
the original file's colour multiset exactly.

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

**CanvasEditor renders in two layers, and a block must pick exactly one.** Vector
blocks (`divider`, `draw_arrow`, `draw_ellipse`, `draw_polygon`, `ink_stroke`) draw
themselves in the SVG layer at `z-index: 1`; everything else gets a `.canvas-block`
wrapper at `z-index: 2`. That wrapper is an **opaque** card the size of the block's
bounding rect with a ≥32px header — so a vector block that is missing from the
early-return list in `blockElements` renders *twice*, with the card hiding the very
stroke it belongs to. `ink_stroke` was missing from that list, which is why every pen
stroke came out buried under a white edit box. Add new vector types to both the
early-return and the SVG layer. The corollary: with no wrapper there is no drag
header, so the shape's own hit path must arm the drag (`onInkStrokePointerDown`), and
its `strokeWidth` should be divided by `zoom` to stay finger-sized on iPad.

**Destructive actions use `useConfirm()` from `components/ConfirmDialog.tsx`, never
`window.confirm()`** — the latter is a silent no-op in iOS WKWebView, so a confirm
that "returns false" would just make deletes stop working on the iPad. Node deletion
has exactly one gate: `App.handleDeleteNode`. The tree row ×, both graph Delete
buttons and EditorPane's folder graph all route through it (EditorPane receives it as
its `deleteNode` prop), and it resolves `false` on cancel so callers skip their
post-delete cleanup. Wire new delete entry points to that function rather than to
`useGraph().deleteNode`.

## Vault: the note editor (Tiptap)

`NoteEditor.tsx` is the Tiptap surface for the plain **Note** kind — and the
fallback for any kind `EditorPane`'s switch doesn't special-case. Its schema is
built in exactly one place, `extensions/noteExtensions.ts`. Never inline an
extension list anywhere else: `lib/noteSchemaGuard.ts` derives the schema from
that same function to audit stored content *before* an editor is mounted, and a
second copy would make the guard validate against a schema the editor doesn't
have.

⚠️ **An unknown node type does not get dropped — it blanks the whole note.**
`@tiptap/core`'s `createNodeFromContent` catches ProseMirror's "Unknown node
type" and returns `createNodeFromContent("")`, i.e. an empty document. The first
keystroke then autosaves that blank, and the note history below is a five-minute
snapshot, not an undo log — it can get you back to the previous *iteration*, not
to the keystroke before the blank. Web,
Mac and iPad update independently, so from the moment one note holds one new
block type the race is live. That is what the guard exists for: it names the
unknown types and refuses to mount an editor. **Deploy a schema addition
everywhere — including a fresh `npm run ios:vault` — before creating content
that uses it.** `enableContentCheck` alone is not enough; `setContent` forwards
the flag and does *not* catch, so it turns a bad load into a sync throw inside a
React effect.

**A destroyed or not-yet-mounted editor is still truthy.** `if (!editor) return`
is not a sufficient guard and this white-screened production once already:
teardown only nulls the internals, so `editor.commands` reaches
`get commands() { return this.commandManager.commands }` with a null
`commandManager`. Guard with `editor.isDestroyed`, and wrap `editor.view` in a
try/catch — in v3 that getter *throws* before the view exists, which a layout
effect can hit during React's remount. Anywhere async work can outlive the
editor (a content effect, an image upload, a pointerup listener on `window`)
needs both.

**Custom nodes with keymaps need `priority: 1000`.** Tiptap sorts extensions by
priority descending and collects keymap plugins in that order, so at the default
100 StarterKit's baseKeymap claims Backspace first and a container's handlers
never run — `joinBackward` then merges across an `isolating` boundary that is
correctly set in the schema. The symptom is a callout's text silently absorbed
into the paragraph above it.

**Structural blocks are a family, not one-offs**
(`extensions/structural/`): `createContainerNode` supplies the schema flags,
serialization and shared keymap for callout, container, toggle and columns.
`isolating` is load-bearing on all of them, and because ProseMirror gives up
*politely* at an isolating boundary, each needs explicit Backspace/Enter/Mod-Enter
rescues or the keys read as a freeze. Containment is schema-enforced: `column`
and the toggle parts are deliberately **not** in `group: "block"`, which is what
makes them unplaceable anywhere else.

**Nesting was never a schema limit — the UI was refusing it.** `columnBlock` is
`column{2,}` and `column` is `block+`, so a row inside a column, or a callout
inside a column inside a row, has always been legal. What blocked it was an
`isAvailable` guard in `blockRegistry.ts` and a `return false` in the resize
plugin's `descendants` walk, both written on the belief that a row cannot
contain a row — true only because nothing could make one. Both are gone; nesting
is now offered and every nested row gets its own resize gutters.

**Inline text size is a TextStyle mark attribute, in `em`.** `@tiptap/extension-text-style`
already ships `FontSize` (and `FontFamily`), so this needed registering rather
than writing. `em` and never `px` is the design: the note has its own `textSize`
and the same note opens on an iPad, so a run pinned to 11px would ignore both.
Three sizes rather than a spectrum — this is for a caption or an aside, and
headings already exist for structure.

It is registered `surfaces: ["bubble"]` only, which also sidesteps the trap that
made card colours unreachable: the bubble menu renders every bubble action
without filtering by group, so no toolbar group list has to know about it.

**Per-note appearance lives on the DOC node: `width` and `textSize`.** Both are
properties of the NOTE rather than of a browser — a dense reference note wants
small text and a journal page wants large, and the iPad is simultaneously where
you most want bigger text and the device least likely to have set a local
preference. Text size is a scale on the editor root, never a `font-size` on the
paragraph: every heading, list and table cell is already sized in `em` relative
to it, so scaling once keeps the type hierarchy in proportion instead of growing
body text past its own H3. It is deliberately independent of `width` — coupling
them would mean choosing large text silently re-flowed the note.

⚠️ **Anything that reads doc attributes must read them ALL, not a named list.**
`width` was handled by name in three places (the `[content]` effect, the restore
handle, and the collab seed rescue), and a second attribute would have been
stale in all three without a single line changing. `applyDocAttrs` and
`readSeedDocAttrs` now iterate whatever the stored JSON carries. The collab one
matters most: ySync rebuilds the root with `topNodeType.create(null, …)`, so it
is the only thing standing between a doc-level setting and Yjs dropping it —
`textSize` needed no change there, and that property has a test.

**Three things are stored on nodes rather than as structure, and the reason is
always the same one.** The per-note width lives on the DOC node (`noteDocument.ts`),
a heading's fold state lives on the HEADING (`headingFold.ts`), and a sketch's
strokes live on the block (`SketchBlock.ts`). An attribute an older client
doesn't know is **dropped silently** — `Node.fromJSON` builds attrs by iterating
the *type's* declared attributes and never looks for extras — whereas an unknown
NODE type blanks the whole note. So an attribute can ship ahead of the Mac and
iPad builds; a node type cannot. `sketchBlock` IS a node type, so it must be
deployed everywhere (including a fresh `npm run ios:vault`) before any note
containing one is created.

Two consequences worth knowing:
- **ProseMirror never renders the TOP node**, so a doc attribute reaches no DOM
  and CSS cannot see it. `NoteDocument` runs a plugin whose `props.attributes`
  projects `data-note-width` onto the editable. Without it the setting silently
  does nothing.
- **`setContent` replaces the content RANGE, not the doc node**, so doc-level
  attributes survive it untouched. Loading a `wide` note into an editor showing
  `full` keeps `full`. The mount path is fine (`useEditor` builds the doc from
  the JSON); NoteEditor's `[content]` effect dispatches the width explicitly.

**Folding a heading hides its siblings; it does not contain them.** The document
stays flat and the fold is decorations — a class on each block the heading owns,
plus a widget for the arrow. Wrapping the section in a `toggleBlock` would make
every fold and unfold a structural edit (lose one and you have lost the section,
not its fold state), and would reshuffle the outline, which walks siblings.
Ownership is scoped to the heading's PARENT, so a heading in a column folds that
column and cannot reach across the row — that falls out of the recursion rather
than being special-cased.

Two traps it hit:
- **`display: none` on a folded block needs `!important`.** `.columns-row` is
  `display: flex` at equal specificity and declared later in App.css, so a folded
  row stayed fully visible while correctly carrying `is-folded`. Folding must beat
  every block type's own layout, including types added later.
- **Hiding the block the caret is in does not move the caret**, so typing edits
  invisible text. Collapsing parks the selection at the end of the heading.

**The inline sketch keeps its strokes in the document, unlike every other ink
surface in Vault.** PDF annotations (`{id}_annot`) and book margins
(`{id}_margins`) get their own `vault_content` row; a sketch cannot, because
`NoteEditor`'s `nodeId` is optional (WorkbookEditor passes none) and one note may
hold many sketches. In the document, copy-paste clones the drawing, Cmd-Z undoes
a stroke, and deleting the block deletes the ink. The cost is size, capped at
`SKETCH_MAX_CHARS` (400 kB) — a sketch shares the note's 2 MB `saveContent`
budget, so an unbounded one would stop the note's *text* saving too.

Two rules it depends on:
- **Coordinates are a 1000-unit logical space, not CSS pixels**, and `height` is
  in those units — an aspect ratio. Note width now spans 720 px to full-bleed and
  the same note opens on an iPad, so pixel coordinates would put a third of a
  drawing outside its box with nothing to suggest it was ever wider.
- **The eraser hit-tests SEGMENTS, not stored points.** `simplify` (RDP) exists
  to delete interior points from straight runs, so a ruled line or a box edge is
  stored as exactly two points — a point-wise eraser can only rub out its ends,
  and in a diagram that is most of the ink.

**BubbleMenu's props must be referentially stable.** `@tiptap/react`'s BubbleMenu
has an effect that DISPATCHES A TRANSACTION when any prop changes identity, and
NoteEditor's `onTransaction` calls `forceUpdate` so the toolbar refreshes. An
inline `options={{ placement: "top" }}` therefore closed the circle: render → new
identity → dispatch → forceUpdate → render, at ~130 transactions a second, with
React's "Maximum update depth exceeded" filling the console and every keystroke
competing with it. `BUBBLE_OPTIONS` and `bubbleShouldShow` are module-level
constants so there is no dependency array to get wrong.

**Costly drags dispatch nothing until pointerup.** Column resize writes
`flexGrow` straight to the DOM while the pointer moves and commits one
transaction on release; a transaction per `pointermove` would be ~60 document
rewrites a second, each waking the 400 ms autosave — the shape of the
2026-08-15 incident. Same rule for the block drag handle.

**Images go to Storage, never inline.** `allowBase64` is off and paste, drop and
the file picker all route through `api.uploadCanvasImage`. On failure they
insert *nothing* rather than falling back to a data URI.

Two dependency traps: `@tiptap/extension-drag-handle` imports
`extension-collaboration` and `y-tiptap` at the top level, so it drags the whole
yjs stack in for a grip icon — the handle here is hand-rolled instead. And every
`@tiptap/*` package peer-depends on the others at an **exact** version, so a new
one added with a caret range resolves to the newest release, fails to hoist, and
nests **a second `@tiptap/core`** under `apps/Vault/Vault/node_modules` — the
same dual-instance class as the React and three.js rules above. Pin new
`@tiptap/*` deps to the version the tree is on and check `@tiptap/core` appears
once in `package-lock.json`.

Tests live in `apps/Vault/Vault` (`npm test`, vitest + a happy-dom setup file —
vitest resolves `environment:` from its own install location, which is the repo
root, hence the setup file). The HTML round-trip cases are the highest-value
ones: a `renderHTML`/`parseHTML` mismatch is invisible to `tsc`, survives every
manual click-through, and only shows up as content quietly vanishing on paste.

## Vault: sharing, and live co-editing

A node carries `team_id` (→ `pf_teams`, the same seeded two-person team
PathFinder's Team tab uses) and additive `team_shared_*` RLS sits alongside each
`vault_*` table's `owner_all`. Sharing a **folder** is the same operation applied
to its whole reachable subtree — a folder is just a node with children, so
`shareNode` walks `graph.edges` and there is nothing folder-specific in it.
`addEdge` propagates `team_id` from parent to child, or a node dropped into a
shared folder would be invisible to the other person: `team_id` is what RLS
checks, not the edge.

**DELETE is governed only by USING, never WITH CHECK.** That is why "a teammate
may edit but not delete" is spelled as separate FOR SELECT/INSERT/UPDATE
policies, and why no `vault_*` table has a team DELETE policy. And
`vault_content` / `vault_journals` policies must strip suffix keys with
`split_part(node_id, '_', 1)`, because `<id>_hl` / `_annot` / `_textannot` /
`_bookmarks` / `_margins` share those tables — getting that wrong makes a shared
PDF's annotations invisible to the teammate, as an empty set rather than an
error.

### Live co-editing is Notes only, shared only, and behind a flag

`VITE_VAULT_COLLAB=1` turns on a Yjs CRDT for shared **Tiptap notes**. Everything
else — Canvas, PDF ink, Journal, Workbook, Bookshelf, and every private note —
keeps the sync-on-save path, where `assertContentNotConflicted` compares
`updated_at` and raises a conflict the user resolves with the Reload button.

```
vault_ydoc.state   ← base64 Y.encodeStateAsUpdate. THE TRUTH while co-editing.
vault_content.data ← JSON projection. What noteSchemaGuard audits, PDF export
                     and WorkbookEditor read, and an old client still sees.
```

Sync is a **private Supabase Realtime broadcast channel** per note
(`vault:doc:<nodeId>`) — no collaboration server, so nothing hangs on the Mac
being awake. Awareness (the carets) rides the same channel under its own event
rather than using Supabase Presence, which has a 5× smaller quota and would need
its own RLS branch; y-protocols already expires a stale caret after 30 s.

**Five traps, all of which are silent:**

- **RLS on `realtime.messages` does NOT make a channel private.** Broadcast
  routes by topic and `private` is a per-client *join flag*, so a client that
  omits it never has the policies evaluated and receives every delta. The anon
  key is committed and this repo is public. The actual enforcement is a
  project-wide dashboard setting — Realtime → Settings → **Allow public access
  off** — and it is not expressible in a migration. See `APPLY.md` §9.
- **Two clients seeding a Y.Doc from the same JSON duplicates the note.**
  `prosemirrorJSONToYDoc` mints *new* operations each call, so two "identical"
  seeds merge into two copies. Hence the election in `collab/seed.ts`: upsert
  with `ignoreDuplicates`, then re-read **unconditionally** — winner and loser
  take the same path, so there is no rarely-taken branch to rot. A client with
  empty content never enters the election. `seed.test.ts` asserts the *bug* on
  purpose; if that test ever goes green, read the header before touching
  anything.
- **Yjs drops doc-level attributes.** ySync rebuilds the root as
  `topNodeType.create(null, …)`, so `NoteDocument`'s per-note `width` resets on
  open. Which means the projection must come from `editor.getJSON()` — never
  `yDocToProsemirrorJSON`, which would write the default back and lose the
  layout for good. NoteEditor re-applies the seed width after first render.
- **An editor cannot gain Collaboration after mount.** `useEditor` builds its
  extension list once, so EditorPane renders a placeholder until the session
  resolves, and keys the editor on whether there is one. Mounting early gives a
  non-collab editor on a co-edited note that happily saves over the other person.
- ⚠️ **Anything derived from starting a session must carry the node id it was
  resolved FOR.** Starting one is async, so React state describing it lags the
  `nodeId` prop by at least one render — and in that render `nodeId` is already
  note B while `session` is still note A's. `useCollabSession` originally kept
  `session`/`status`/`loading` as three plain useStates and froze the seed on
  `session ? keep : take`, which meant **note B's CRDT got seeded from note A's
  document**: with no `vault_ydoc` row for B yet, A's text became B's
  authoritative state and the projection wrote it into B's `vault_content`. Two
  notes, one document, no undo. The same lag handed A's about-to-be-destroyed
  session to the editor mounted for B, and `loading` could not cover the gap
  because it was state too. The hook now holds **one** state — a slot stamped
  with its node id — and derives everything through `collab/slot.ts`, which is
  where the rule and its tests live. `startCollabSession` re-reads the seed from
  the server by node id as a second, independent lock on the same door: the
  caller's copy is the one input that can be about the wrong note.
- **The fragment name is `"default"`.** `Collaboration`'s `field` defaults to
  `"default"` but `prosemirrorJSONToYDoc`'s third argument defaults to
  `"prosemirror"`. Mixing them raises nothing — the note just opens blank, and
  the first keystroke's projection erases it.

`saveContentProjection` is a **separate exported function**, not a flag on
`saveContent`: a boolean is the kind of thing a refactor drops, and dropping it
would disable the conflict guard for every private note with no symptom until two
devices quietly overwrite each other. `forgetContentVersion` is its necessary
other half — a note unshared mid-session otherwise inherits a stale timestamp and
shows a permanent, unclearable conflict.

An out-of-date client is a real data-loss vector (it reads a healthy-looking
projection, edits, and saves the whole document over the CRDT), so `saveContent`
throws `CollabOnlyError` for any note that has a `vault_ydoc` row. Ship that
guard a release **before** the writer, iOS first — the iPad installs over a cable
on ~7-day certs and is the client most likely to be stale. Enable the writer in
the reverse order, web first, because web rolls back fastest.

**Yjs state grows forever** and there is no safe automatic compaction: rebuilding
a document mints fresh client ids and re-collides with any live peer, i.e. it
reintroduces the duplication bug as a scheduled job. Recovery is manual and is
what `owner_all`'s DELETE exists for — with nobody editing, the owner deletes the
`vault_ydoc` row and the next open re-seeds from the projection.

Bundle discipline: the entire stack sits behind one dynamic import
(`collab/loadCollab.ts`), and everything outside `src/collab/` uses `import type`
only — a single value import of `isChangeOrigin` would pull ~126 kB into the
eager note bundle for every private-note user and onto the iPad, which is why
`CollabSession` carries `isRemoteTransaction` as a function instead. `yjs` **must**
stay in `resolve.dedupe`: two copies make Yjs's internal `instanceof` checks fail
and `applyUpdate` silently no-ops, so the session looks connected and simply
never converges. (The `BlockHandle.ts` comment about "an app with no
collaboration" is now out of date, but its conclusion still holds — the stack is
lazy, and `@tiptap/extension-drag-handle` would import it eagerly.)

### Note history, and the second exit from a conflict

`vault_content` used to keep none, which is why several comments in this repo
warn about how much one bad write costs. `vault_content_versions`
(`20260827160000`, `APPLY.md` §10) is the other half of those fixes: they prevent
the write, this survives it.

Snapshots are taken by a **BEFORE UPDATE trigger on `vault_content`**, capturing
`OLD.data` — not by the client. Two reasons, both load-bearing:

- A client saving "a copy alongside each save" records the NEW document, so the
  state you actually want back (what it looked like when you opened it) is the
  one never recorded.
- The rule then covers every writer at once: web, Mac, iPad, the JSON projection
  written by the co-editing runtime, and anything added later.

It is rate-limited to **one snapshot per node per five minutes**, which makes it
a history rather than an undo log — and under co-editing that gate is not
optional: `vault_content` is rewritten every couple of seconds by *both* clients.
It also **skips any document over 2 MB**, the same number as `MAX_CONTENT_BYTES`:
the client refuses to write those at all, so they are frozen, and versioning
something nothing can change is pure cost.

**Retention is byte-budgeted, not count-based, and the live data is why.** A
plain "keep the newest 40" looked obvious and was wrong: measured against a 96 MB
database, 40 versions each would cost ≈3.8 MB for the 87 notes under 10 kB but
≈94 MB for the four rows between 100 kB and 2 MB — and ≈791 MB for the three
frozen Canvases. No single count serves a distribution that wide, and one low
enough for the big documents would leave the small notes (the ones actually
edited all day) with almost no history. So the prune keeps the newest entries
while their cumulative `byte_len` stays under **8 MB per node**, capped at 40 and
floored at 2. The floor is load-bearing: without it a document larger than the
whole budget would prune away the snapshot just taken.

This is the only trigger this repo puts on a hot write path, so
`vault_content_versions_node_idx` is what keeps the gate's `EXISTS` from becoming
a sequential scan on every keystroke. If note saving ever gets slow, check that
index first.

The panel (`components/VersionHistory.tsx`) **never mounts an editor on an old
version** — it renders a flat line projection and a diff (`lib/versionDiff.ts`,
pure and tested). That is a safety property, not a shortcut: an editor that
exists can emit, and one emit autosaves the old document over the current one. It
also means a version whose schema this build cannot parse is still viewable,
which is exactly when history is most needed.

Restoring goes **through the editor**, via `NoteEditor`'s `docRef` handle. Under
a CRDT a restore written straight to `vault_content` is invisible to the Y.Doc
and the next projection flush undoes it; `setContent` makes ySync turn it into
operations the other person receives. There is a direct-write fallback for when
no editor is mounted (the schema guard is showing, or a non-Tiptap kind), and it
deliberately refuses on a co-edited note rather than appearing to work.

⚠️ **`vault_content.user_id` is the OWNER, never the author.**
`vault_content_force_owner()` rewrites it to the parent node's owner on every
write — correct, and it must stay, since `owner_all` is written against that
column — so on a shared note it names the owner no matter who typed. The History
panel displayed it as a byline for one release and was therefore putting the
owner's name against versions the owner did not write. `updated_by`
(`20260827180000`, `APPLY.md` §12) is the real answer: a separate BEFORE trigger
stamps it from `auth.uid()`, SECURITY **INVOKER** so the claim resolves against
the caller. It is nullable with no backfill on purpose — rows written earlier
have an author nobody recorded, and NULL says so; backfilling from `user_id`
would manufacture exactly the false attribution it exists to remove. Render NULL
as "unknown", never as the owner.

The editor toolbar shows a **resting** "Saved · 4 min ago" line whenever nothing
transient is happening. `saveStatus` is deliberately short-lived ("Saving…",
then "Saved" for 1.5 s, then nothing), which left the pane silent about whether
the work was safe for almost all of every minute — the wrong default for a
surface whose entire failure mode is a save that quietly did not happen. The
"by whom" half appears only on a shared note: on a private one the answer is
always "you", and a byline that can only say one thing is noise.

A conflict now has three exits instead of one — **Reload**, **Keep mine**, and
**Compare**. "Keep mine" (`api.overwriteContent`) is only safe to offer because
it snapshots the server's copy first, so the person being overwritten can
recover from this same panel. Order is snapshot → refresh the guard → write, so a
failed snapshot leaves the conflict standing rather than clearing the guard for
a write with no safety net. Like `saveContentProjection`, it is a separate
exported name rather than a `force` flag — the one sanctioned way past
`assertContentNotConflicted`.

### The conflict guard, and the false alarm that trained people to ignore it

⚠️ **The conflict guard compares INSTANTS, not strings** (`lib/timestamps.ts`
`sameInstant`). It compared strings once, and every note then reported "changed
by the other user" on its second save and every save after, alone: `updated_at`
is a `timestamptz`, the client cached `new Date().toISOString()` (`…628Z`) after
a save, and PostgREST returns `…628+00:00`. The same instant, two spellings. The
first save of a session passed only because the cache had been seeded from a
READ; the first WRITE reseeded it and the formats never matched again. Parsing
also absorbs Postgres trimming trailing zeros (`.100Z` → `.1+00:00`), so
normalising the suffix alone would not have been enough. Both raw savers now
also `.select("updated_at")` and cache what the SERVER stored — `updated_at` is
written from the client's clock, so a device a few seconds off would otherwise
cache an instant the row does not hold.

The general rule: **a timestamp that crosses a serialisation boundary is a
value, not a string.**

### Two more ways a note could be written over another, both in EditorPane

Neither involved collaboration, and both had the same tell: the damage was
invisible in-session because `globalContentCache` still held the right thing.

- **A tab switch inside the autosave debounce cancelled the pending write.**
  `selectedId` is a dependency of the autosave effect, so its cleanup cleared the
  timer — the edit survived in the cache (so reopening the tab showed it) and was
  lost on reload, on closing the tab, or to any other device. The armed save now
  lives in `pendingSaveRef` and a node change **flushes** it. A flush that lands
  after the pane has moved on reports nothing into the save status: that status
  describes what is on screen, and a conflict attributed to the wrong note sends
  you to reload the wrong document.
- **Closing a tab could blank the tab it fell back to.** `closeTab` set the next
  node id next to `content = ""` and only *then* started reading, with no
  `persistedContent` entry to mark it unloaded — so the autosave effect could not
  tell that from "the user deleted everything" and wrote the empty string 400 ms
  later over a note that had never been opened. It routes through `selectNode`
  now, which sets `isLoading` and commits only once the content is in hand.
## ⚠️ The note SCHEMA path must never reach a Supabase client

`lib/noteSchemaGuard.ts` decides whether a stored note is safe to open, and it
does that by building the schema from `buildNoteExtensions()`. `lib/supabase.ts`
calls `createClient()` at MODULE SCOPE and throws "supabaseUrl is required" when
the env vars are absent — so one import anywhere in that graph makes "is this
note safe?" depend on a configured network client. Backwards: the guard exists
to run when things are broken.

This had been worked around by hand twice (`lib/taskTags.ts` and
`lib/taskFields.ts` are each "the pure half" of a module whose other half talks
to the network) and stated in a comment at the top of `PathfinderBlockLazy.tsx`
— and it was **still broken**, through
`noteExtensions → noteImage → lib/api → lib/supabase`. Nothing pointed at it:
the app runs fine, and only the guard fails, only when the env is missing.

`lib/schemaPath.test.ts` now walks the import graph from three entry points and
asserts it. It follows STATIC imports only — a dynamic `import()` is precisely
the escape hatch used to reach the data layer from a node view, so `noteImage`
defers its `lib/api` import into the upload handler, which runs on a real paste
long after any schema is built.

The test also asserts that its own walk finds a known importer, because a broken
walk would make every other assertion pass vacuously.

## Vault: PathFinder task blocks

### One block, two hosts — the note and the canvas

The task block renders in a Tiptap node view AND as a canvas block, from one
implementation. Its coupling to Tiptap was always five things — `node.attrs`,
`updateAttributes`, `editor.isEditable`, `selected`, and the wrapper element —
so they are named in `PathfinderBlockHostProps` and passed in rather than
assumed. `PathfinderBlockView` is now a thin adapter over `PathfinderBlock`.

⚠️ **`NodeViewWrapper` is not optional for Tiptap and not usable off it.** It
registers the node view's DOM with ProseMirror, and it reads React context that
only a node view renderer provides — outside one it throws rather than
degrading. That is why the wrapper is a prop and why the canvas passes
`PlainBlockWrapper`. It is a component and not the string `"div"` because the
prop is typed: an intrinsic tag and `NodeViewWrapper` share no type that still
checks the props being passed, and loosening it to `ElementType` gives up the
checking entirely.

A fresh canvas block stores `spec: ""`, not a serialized default. `parseSpec`
turns an empty string into exactly `defaultSpec(view)`, so the canvas needs none
of the spec machinery imported — and cannot drift from it.

The canvas host is lazy for the same reason the note's is, and it is worth
checking after any change: the build should keep `PathfinderBlockView` as its
own chunk (~63 kB) with `CanvasEditor` unchanged. If the canvas chunk suddenly
grows by that much, a static import has crept in and every canvas now carries
the PathFinder data layer.

Wheel and pointer events stop at the block. The canvas pans and zooms on both,
so without that a scroll through a long task list drags the whole board.
### Board columns are editable on ONE axis, and only that one

`spec.statuses` overrides the built-in four, and only for `kanban_status` — the
one board axis whose values are free text on the task. Every other axis has a
closed domain (you cannot invent a priority), so offering to edit its columns
would promise something the model cannot keep. There is a test for that.

Stored **per block**, not globally: a status is not owned by anything, so one
note can track a review pipeline and another a shipping one without either
becoming the definition. Keys are lower-cased, because a key is matched against
`pf_tasks.kanban_status` by exact string equality — a column labelled "Doing"
that does not hold the "doing" tasks reads as an empty board rather than as a
mismatch. All 543 rows in the database are already lower-case.

Removing a column **does not touch the tasks in it**. They keep their status and
surface in the `__other__` bucket, which stays a non-drop-target because
dropping there would have to invent a value. A delete that silently rewrote
every card in the column would be a bulk edit disguised as a layout change.
### The board: dragging within a column writes a GLOBAL order

Cross-column drag writes the axis field; same-column drag reorders. The slot
arithmetic is `insertionIndexFromPointer` / `reorderedIds` in
`@nexus/core/pathfinder` — promoted out of PathFinder rather than copied,
because two copies of a drop rule disagree about the edges (the no-op slots
either side of the dragged card are exactly what one copy gets right and the
other does not) and only one would have had the tests.

⚠️ **`pf_tasks.sort_order` is ONE order per task, not one per view.** It is a
plain `integer` with default 0 — and today 405 of 543 tasks sit at 0, so manual
order is undefined for most of them and ties break by id. A kanban column is a
subset, so reordering inside it necessarily writes into the same order a
manually-sorted list reads. That is inherent to the column rather than to the
implementation, and it is the right meaning: "this task comes before that one"
should hold wherever the two are seen together. `reorderTasks` assigns
`sort_order = index` over precisely the ids passed, so always hand it the
COMPLETE group — a partial list renumbers a few tasks into the middle of
everyone else.

Reorder is offered **only under manual sort**. Under any other key the board
recomputes the order from the data, so the drag would write a value nothing
displays — a gesture that appears to do nothing, which is worse than one that
is visibly refused.

Geometry is read from the DOM at the moment it is needed, never cached at
pointerdown: the board reflows during a drag (a column highlights, the drop
line appears), and a cached rect lands the card in the wrong gap without ever
looking wrong on screen.

### ⚠️ The toolbar renders BY GROUP, so a group nobody lists is invisible

`NoteToolbar` holds several arrays naming which `BlockGroup`s appear where.
Anything whose group is in none of them is never drawn — no error, no warning,
no empty slot. An action can be registered, correctly gated, correctly
implemented, covered by its own tests, and completely unreachable.

That is what happened to card colours: `cardColor` declared
`surfaces: ["toolbar"]` and appeared in no array, so there was no way to change
a callout's or container's colour at all. It was found by the user asking how
to do it, which is the worst way to find it.

`components/groupCoverage.test.ts` now asserts the relationship in both
directions — every toolbar-surfaced group is rendered somewhere, and every
listed group has actions. Adding a group is easy and forgetting to render it is
easy, and both failures are silent.

The same audit found `pathfinder` declaring `["slash", "toolbar"]` while only
the slash half worked; the task blocks are now under Insert as well. `color` is
fine: it is `["bubble"]`, and the bubble menu renders every bubble action
without filtering by group.

### Dragging a task from one block into another

A cross-block drag has no common React parent to route through — the target is a
different node view, possibly in a different pane — so blocks publish themselves
in a module-scope registry (`lib/pathfinderHosts.ts`) keyed by a `data-pf-host`
attribute, and the drop resolves through `elementFromPoint`. Deliberately not
context: context reaches descendants, and two blocks in a note are siblings.

Re-registered on every render, so a drop reads the block's CURRENT filter rather
than the one it had at mount.

**"Inherits the new requirements while forgoing the old ones" needs no clearing
step.** Every inherited field is single-valued, so setting `plan_id` to the
target's plan *is* forgoing the source's.

⚠️ **`movePayload` is `creationPayload` minus `category`, and that one exclusion
is the whole difference.** `category` is the ISA discriminator: re-typing a
`task` to a sparse kind DROPS its planning row — urgency, stage, completion
mode, notes — and the demotion is lossy by construction. Creating a chore in a
chore block is a choice; dragging a planned task into one and silently deleting
its plan is not.

**The subtree comes along, but only its SCOPE** (`scopeOnly`: plan, goal, team).
Moving a branch of work into a project moves the whole branch; it does not
restate every step's status, priority, assignee or due date — those are claims
about an individual piece of work, and inheriting them would mark a dozen
subtasks "doing" or assign them all to whoever the target block is filtered to.
Descendants are patched sequentially, not with `Promise.all`: one connection per
descendant is the shape that wedged Supabase on 2026-08-15.

`descendantIds` is cycle-guarded. `parent_id` has no constraint stopping A→B→A,
and a cycle there would not be a wrong answer — it would be an infinite loop
inside a pointerup handler, which takes the tab with it.

The hovered block is marked with a `data-pf-drop` ATTRIBUTE written straight to
the DOM, not React state: the hovered block is a different tree from the dragged
one, so lifting it would re-render every block in the note sixty times a second.

List rows drag only to LEAVE the block. Re-ordering or re-parenting inside a
list is a different question — a list is a tree, so "dropped on that row" is
ambiguous between "before it" and "inside it" — and answering it by accident
would be worse than not answering it.

### Computed columns: a hand-written parser, never `new Function`

⚠️ A formula lives in the block spec, which lives in the NOTE — and a note can
be shared, co-edited and pasted from elsewhere. `new Function(src)` would be
arbitrary code execution driven by a document another person can edit, in a tab
holding a Supabase session. There is no `eval` or `new Function` anywhere in
Vault; `lib/formula.ts` does not get to be the first. It has no property access,
no globals, and no calls outside a fixed list.

⚠️ **`FUNCTIONS` is a Map, and that is not stylistic.** As an object literal,
`FUNCTIONS["constructor"]` resolves up the PROTOTYPE CHAIN to
`Object.prototype.constructor` — truthy — so `constructor(1)` sailed past the
"unknown function" check. Every inherited member was reachable as a function
name the same way. A test caught it. Field lookup uses `hasOwnProperty` for the
same reason.

**Parse once, evaluate per row.** 200 rows would otherwise be 200 tokenisations
of one string — but the real reason is that a syntax error is then known before
any row is drawn, so the column says "unknown field: estimat" instead of
rendering two hundred blanks. Fields are known at compile time precisely so a
typo is one legible error.

**Division by zero yields null, never Infinity.** An Infinity propagates into
the column sum and turns the footer into "∞", losing every other row's
contribution to one empty estimate. Same for a missing field: null, and
`aggregate` SKIPS nulls rather than counting them as zero — a task with no
estimate has no estimate, and averaging it in as 0 quietly drags every mean
down. The footer shows how many rows contributed so it never implies it measured
the whole column.

An invalid expression is **kept**, not dropped: the column shows an error, which
is recoverable, whereas discarding it loses whatever was being written with no
explanation for the disappearance.

### Sheet formulas reuse the expression parser by rewriting, not extending

A table cell starting with `=` computes, on `lib/formula.ts` — the same
hand-written parser the task blocks use, with no `eval`. That matters more here:
a table lives in a note, and a note can be shared and pasted from elsewhere, so
a formula is a string another person can put in your document.

Ranges are handled by **rewriting the source** before it reaches the parser:
`sum(A1:A3)` → `(A1 + A3)` with A2 empty, `avg` divides by the filled count,
`min`/`max` fold into nested binary calls. So the evaluator stays a pure
expression language with a fixed function list, and spreadsheet semantics stay
out of the module the task blocks also depend on.

⚠️ **An empty cell is dropped from an aggregate, never counted as zero** — the
fourth place this rule appears. Only `count` returns 0, where zero is the honest
answer. An aggregate over an entirely empty range is null.

⚠️ **Cycles.** `A1 = B1` / `B1 = A1` is one keystroke away, and unbounded
recursion inside a ProseMirror plugin is a blank white page, not an error. Two
things the tests forced: the cycle error **propagates** rather than being
swallowed into a null (swallowing flagged only one cell of a symmetric pair, so
the other rendered a bare dash with no explanation), and **a range containing its
own cell is a real cycle** — `A4: =sum(A1:A4)` is exactly how a user writes a
column total.

**References match on word boundaries.** "A1" is a substring of "A12", so a
substring test resolves A1 for a formula mentioning only A12 — and reports a
cycle through a cell nobody referenced.

**An empty cell inside the table reads as null, not an error**; only a reference
outside it is named. Otherwise half of every sheet under construction is red.

**The formula stays the document's content** and the value is a decoration —
replacing the text would mean the document no longer holds the formula, and
every sync, export and older client would see a frozen number. Same reasoning as
folding being decorations. The whole sheet re-evaluates on any doc change: a
note's table is tens of cells, and an incremental recompute is where spreadsheet
bugs live (a stale cell that is right until you delete a row).

Adds no node type and no attribute, so there is no deployment ordering.
### Canvas frame containment is geometric, and folding only hides

A frame has **no children field**, and `lib/canvasFrames.ts` deliberately does
not add one. Membership is derived from geometry every render.

⚠️ **Storing membership means every drag has to maintain it** — drop a block on
a frame, drag it out, resize the frame over it. Each is a place for the stored
answer to disagree with what the user can plainly see, and a block that *looks*
inside a frame but is not in its list is a bug with no visible cause. Deriving
it means the picture is the model.

Containment requires **full** containment, not overlap: a block half in and half
out is not "in" a frame in any sense a user would agree with, and folding would
make half a diagram vanish for no visible reason.

**Folding hides; it never moves.** `folded: true` and nothing else — contained
blocks keep their coordinates, the frame keeps its stored height, only the
rendered height shrinks. Moving or stashing the contents needs an inverse that
restores them exactly, and any bug in that inverse loses work.

Three things its tests forced:

- **Membership must be a function, not a relation.** Frames nest, so the
  innermost wins by area — otherwise a block belongs to both and folding the
  outer then the inner hides it twice.
- ⚠️ **Two coincident frames each contain the other**, so smallest-area-wins is a
  2-cycle. An antisymmetric tie-break (lower id owns higher) makes ownership a
  forest by construction.
- **Hiding is transitive**, and a blanket "un-hide every folded frame" at the end
  resurrects an inner folded frame inside a folded outer one — a stray title bar
  floating in a closed group. Top-level folded frames are simply never added.

**Arrows re-anchor to the closed group** rather than vanishing — an arrow that
disappeared would read as "this connection was deleted". Both ends in the same
folded frame means it is internal, so it goes.

### Canvas text blocks are Tiptap, and `content` changed MEANING not format

A canvas text block was a textarea holding markdown; it is now the full note
editor. The whole difficulty is that a canvas is **one JSON blob** in
`vault_content`, so the block's stored shape is read by older builds.

⚠️ **`content` must stay a readable string.** An older Mac or iPad build renders
it in a textarea *and saves it back* — raw ProseMirror JSON there is data loss on
the next save, not a display glitch. So the block gained fields instead:

| field | what |
|---|---|
| `rich` | the Tiptap document, same JSON form `vault_content` holds |
| `md` | the ORIGINAL markdown, written once at conversion, **never overwritten** |
| `content` | now a plain-text **projection** of `rich` — degraded, not corrupt |

An unknown *field* on a JSON blob is carried or dropped, never fatal — unlike an
unknown ProseMirror *node type*, which blanks a document. Same asymmetry that
made `shareId` an attribute.

**`lib/mdToHtml.ts` is deliberately partial**, and `md` is what makes that a
trade rather than a loss: an unsupported construct arrives as literal text with
the source still on the block. Two bugs its tests caught:

- It emitted `<h5>`/`<h6>`. `FoldableHeading` is configured `levels: [1,2,3,4]`
  and **`levels` is a schema option** — unrecognised tags silently become
  paragraphs, so the heading turns into body text with no error. Levels are
  clamped to `MAX_HEADING`.
- `a * b * c` in prose became italics. Guarding the character *after* the closing
  star does not help — there it is a space and passes. Emphasis may not open or
  close on whitespace, which is the actual markdown rule.

**Two canvas-specific traps.** Key events are stopped at the block: the canvas
listens on its container and Delete removes the *selected block*, so without it
Backspace in a paragraph deletes the block you are typing into. And the editor is
**uncontrolled after mount, keyed by block id** — feeding the projection back in
as `content` is a loop that moves the caret to the end on every keystroke.

### Shared containers: an attribute, not a node type

Any callout, container or toggle can carry a `shareId`, making it the **same
block** in more than one note, editable from either side. Content lives in its
own `vault_content` row, `share:{id}` — the idiom already used for `{id}_annot`
and `{id}_margins`.

⚠️ **`shareId` is an ATTRIBUTE and that is the whole design.** ProseMirror drops
an unknown attribute and *blanks the document* on an unknown node type. A
`sharedBlock` node would have required deploying Mac and iPad before anyone could
create one — and would have wiped notes if that order slipped. As an attribute, a
note holding a shared block opens fine on an older build and merely does not
sync. It also makes **copy-paste the linking mechanism**: the attribute travels
through the HTML clipboard, and the same id in two documents *is* the link. No
registry to fall out of step with the notes. The round-trip test is the
high-value one — a renderHTML/parseHTML mismatch is invisible to `tsc`.

**The blocks stay in each note as well as in the row.** That duplication is the
point: the note remains self-contained, renders offline, exports whole, and a
failed share read degrades to "you see your last copy" rather than a hole. On
open the **row wins**; a missing row is **seeded from the note**, which makes
sharing an existing block a no-op rather than a wipe.

⚠️ **The write loop.** Apply → transaction → save → write back what was just
received. Two independent guards, because either alone has a hole: the apply
path marks its transaction and the save path skips it (precise, but only knows
about transactions this code produced); and every write is gated on the payload
actually differing from what was last seen (covers unmarked transactions).

Three rules with tests named after them: `parseShare` returns **null, never
`[]`**, for an unusable read — `[]` legitimately means "the shared block is
empty", and returning it for a failure would clear every copy and save that. An
**empty block is never seeded** (`block+` cannot be childless, so empty is one
empty paragraph, and seeding from it publishes emptiness). Shares are **keyed by
id, not position** — the same share may appear twice in one note.

**Off under live co-editing.** The Y.Doc is already authoritative for the whole
document; a second mechanism replacing ranges inside it is two writers on one
buffer with no ordering between them.

`useSharedBlocks` lives in `lib/`, not `collab/`: NoteEditor imports `collab/` as
**types only** to keep yjs out of the eager note bundle, and this is a value
import. `schemaPath.test.ts` asserts it rather than trusting the comment.
### ⚠️ A colour round trip cannot be asserted in this repo

**happy-dom's `CSSStyleDeclaration` silently drops any value it cannot parse,
and it cannot parse `oklch()` or `var()`.** Hex, `rgb()` and named colours
survive; measured, with a test pinning it in `extensions/typography.test.ts`.

Tiptap's Color mark serialises to `style="color: …"` and parses back out of
`element.style.color`, so **every one of Vault's colours round-trips to `""` in
tests** while working correctly in every browser that ships oklch — which is all
of them. No production impact, but it is a blind spot in exactly the test
category that is otherwise the highest-value one here.

The direct consequence: **do not store `var(--token, …)` as a mark colour** so
that text colours follow the theme. It is untestable by the same mechanism, and
the failure mode is every coloured span silently losing its colour on reload.

**Text colours are tuned to a lightness band instead** (`TEXT_COLOR_L`, asserted).
A colour mark stores a literal in the document and cannot follow the theme, so
at L≈0.62 it sits ~0.38 from a white page and ~0.48 from the dark theme's
surface — legible against both. The band is asserted so nobody "improves" a
colour back to a light-theme-only value. Documents written before the retune keep
their old literals.

**Fonts are system stacks, never webfonts.** Vault runs in a Tauri WebView, as a
Vercel page and as an iPad PWA: a webfont is either megabytes in every build or a
CDN call the offline story dislikes. `FontFamily` is an **attribute** on the
TextStyle mark, like Color and FontSize, so a note using it opens on an older
build in the default face — a new mark type would not be safe that way.

**The bubble renders every bubble action flat in one row** and is the iPad's only
formatting surface. There is a test capping its length; adding more colours or
faces needs the bubble to group or collapse first.

### The colour scheme is derived, not stored

`lib/theme.ts` turns **six numbers** into every `:root` colour token. A theme
could have been 62 stored token values — that is what "custom colour scheme"
usually means, and it is a trap: every token added to `:root` afterwards is one
every stored theme lacks, so themes rot silently as the app grows. A derived
theme has no such surface.

It only works because the palette is **OKLCH**. Lightness there is perceptual, so
"one step darker" is a subtraction that means the same thing at every hue; the
same arithmetic in hex or HSL gives an uneven ramp whose contrast depends on hue.

⚠️ **No theme can make text unreadable, by construction.** Foregrounds move away
from the surface and the direction flips at `DARK_BELOW = 0.5`. Because that
threshold is the **midpoint** of the range, the far end is never closer than
~0.48 from either side. A user dragging a lightness slider passes through "text
the same colour as the background"; an app that renders that state has lost its
own settings panel. Tests sweep the whole range.

⚠️ **The direction flip is what makes dark mode work rather than merely be
dark.** On a dark surface "raised" must be *lighter* — otherwise every input and
border is darker than a page that is already nearly black, i.e. invisible.

**`MIN_TEXT_DL` is an assertion, not the mechanism.** Making it the mechanism put
the default theme's black body text at a mid grey: 0.34 is the floor of
legibility, nowhere near where body text sits. `TEXT_DL` is a table of distances
that reproduces the existing palette **exactly** at the default — the engine must
be a no-op against the stylesheet it replaces, or shipping it invalidates every
colour judgement made so far. Pinned by a test.

**Two things a theme may not do.** Recolour a semantic accent — a delete button
that is not red because you chose a green scheme is a theme changing what a
control *means*; only their lightness follows the surface. And touch motion,
z-index or shadow geometry, which are not colours and whose change would be a
theme that can break layout.

**130 colour literals still sit outside `:root`** and do not follow a theme —
that is where a dark scheme shows seams. `cssTokens.test.ts` ratchets the count
so it can only fall; naming them is a design decision per colour, not a cleanup.

Stored in **localStorage, per device**. A Mac in a lit room and an iPad in bed
want different schemes, so per-account would be the wrong shape, not a better one.

### What a card's colour means is a choice, and "no value" has no colour

`spec.colorBy` — tag / priority / urgency / assignee — puts a stripe on every
board card and list row. A board already shows status as columns and order as
position; colour is the one free channel left, so what it *says* is worth
choosing rather than spending on decoration.

⚠️ **A task the dimension says nothing about gets NO stripe.** A grey "unset"
colour would read as a real category — "the grey ones" — and the board would
quietly grow a group that does not exist. Absent is not zero, again.

⚠️ **The priority/urgency scale moves in LIGHTNESS as well as hue, and a test
pins the separation.** Red / amber / green at one lightness is the classic
deuteranopia failure: first and last are the same stripe. Moving in L means the
order survives with no colour vision, and the test stops a later "nicer colours"
pass quietly undoing it.

**Assignee hues are derived from the id on the golden angle**, not configured —
a palette is one more thing to maintain, and a new teammate would have no colour
until someone assigned them one. Their lightness is asserted into the same band
the text palette uses, so a stripe reads on both themes.

Three smaller rules: **one stripe per card** (the first tag with a colour, never
a blend — a blend is a fourth colour in no legend); **`assigned_to` is
meaningless when `team_id` is null**, so a personal task gets nothing, and `all`
is the absence of an assignee rather than a person; and **every stripe carries a
title saying what it means**, because a colour cannot be read back into a label.

`lib/cardColor.ts` reaches `@nexus/core/pathfinder`, and `lib/pathfinderBlock.ts`
is on the note schema path — so only the option list and the type are imported
there. `schemaPath.test.ts` covers it.

### Summary figures share the column pipeline, deliberately

A stat card is compile-once → evaluate-per-row → aggregate, the same chain a
computed column runs, reduced to one number. Sharing it buys two things that a
separate implementation would lose:

- **A stat works in list and board view**, where there is nowhere to put a
  column. It needs no column because it is one figure.
- **A stat and a column can never disagree** about what `sum(estimate)` means.
  Two implementations of the same arithmetic drift; this one cannot.

The editor shares the vocabulary for the same reason — one formula language,
not two. `none` is the single difference: a stat IS an aggregate, so a card
carrying it would have no figure to show, and `STAT_AGGS` omits it.

⚠️ **Statistics are over the tasks the block is SHOWING**, not over everything
that matched. That is the honest reading of a figure sitting on a filtered list,
but it means tightening a filter changes every number — so each card states how
many rows contributed rather than implying it measured the whole plan.

`percent` scales its bar against 100, not the card's `max`: a percent card with
`max: 8` would otherwise read 12.5% full at 100%.

### Meters: an empty bar is not zero

A computed column can draw itself as a bar or a ring (`display`, `max`). One
mechanism covers both "custom" and "premade" measures, because a premade one —
`subtasksDone / subtasks * 100` — was always expressible; only the drawing was
missing.

⚠️ **A null value renders as a dash, never as an empty meter.** An empty bar is
indistinguishable from 0%, so a task with no estimate would read as "0% done"
rather than "not measured". This is the same rule `aggregate` follows by
skipping nulls and `coerceField` by returning null for an empty stored value —
three places now, one idea: *absent is not zero*.

**The number stays beside the meter.** A bar is a comparison and cannot say
"130% of target"; the value is clamped for drawing, so replacing the number with
the bar would silently lose the overshoot. Clamped rather than overflowing,
because a bar longer than its track escapes the cell.

**A scale of zero is "no scale", not "full".** It yields null and the cell falls
back to the number, rather than dividing into the Infinity the formula language
already refuses — same for `max: "auto"` when every visible row is null.

⚠️ **Auto scales to what is ON SCREEN**, so filtering the table changes every bar
in it. Occasionally what you want, never what you expect: 100 is the default and
auto is opt-in.

The ring's radius is `100/2π`, so its circumference is exactly 100 units and the
dash array *is* the percentage — no arithmetic to get subtly wrong at the wrap.

### Stored columns: the definition is in the note, the values are in Postgres

A custom column is two halves, and which half holds what is the whole design.
The **definition** — key, label, type — lives in the block spec, in the note.
The **values** live in `vault_task_fields`, keyed `(user_id, task_id, key)`.

That split makes the type a **lens rather than a constraint**: the value column
is `text` for every type, so changing a column from number to text and back
loses nothing, and two notes may legitimately show `budget` as a number and as
free text without either being wrong. A typed column in Postgres would have to
pick a winner and would need a data migration on every type change.

**The key IS the storage key**, so it is normalised the way tags are — a key
differing only by case or spacing would be a second column that looks exactly
like the first, with the values split silently between them. Two consequences
that are easy to get wrong:

- **The collision check must compare NORMALISED names.** `subtasksDone`
  normalises to `subtasksdone`, so checking a normalised key against the raw
  built-in list let a column named "subtasksDone" through — sitting in the
  field list one character from the built-in, with nothing to say which a
  formula meant. `RESERVED_FIELD_KEYS` is the normalised set; a test walks
  every built-in name.
- **Removing a column from a block does not delete its values.** The same key
  is very often a column in another note. Deleting everywhere is a separate,
  explicit act (`deleteTaskFieldEverywhere`), and the × is labelled "hide"
  rather than "delete" for that reason.

**A stored number column is a name a formula reads** — that is why the two
shipped together. `formulaFieldNames(fields)` extends the built-ins with the
block's numeric and check keys, so `budget * 1.25` compiles. Text columns are
deliberately **absent**: binding one would make every formula reading it
silently blank instead of failing with a named error, and renaming a column
must turn a formula into a legible error rather than an empty cell.

⚠️ **An absent value binds as `null`, never 0 or false.** A task nobody has
given a budget has no budget: `sum(budget)` over ten tasks where two have one
must be the sum of two, and `avg` must divide by two. This is the same rule
`aggregate` already implements for nulls, and the reason `coerceField` returns
null for every empty string regardless of type. A cleared cell **deletes** the
row rather than storing `""`, so the cache and the server agree on what "no
value" is — otherwise a formula reads a different number either side of a
reload.

**A missing table is a state of its own.** Before the migration is applied the
block hides its stored columns entirely rather than drawing every task blank:
"unavailable" and "nobody has filled this in" must not look the same. Same
posture as tags, and the same reason `blocking_state` is not seeded.

**`lib/taskFields.ts` is the pure half and `lib/vaultTaskFields.ts` is the
query half**, and the split is not tidiness — `lib/pathfinderBlock.ts` is on the
note SCHEMA path, and a Supabase import there would make "is this note safe to
open?" depend on a configured network client. `lib/schemaPath.test.ts` walks the
import graph and asserts it rather than trusting it.

### The table: column order is the ARRAY order

⚠️ **`parseSpec` must not sort `spec.columns`.** It used to, and that single call
is what made column placement unstorable: a hand-ordered table snapped back to
canonical order on the very next load, so the feature could be built and would
still appear not to work. `strArray` already validates and dedupes while
preserving order, so the stored array *is* the order.

The property the sort was really providing — "toggling a column off and on again
does not move it" — has not been dropped. It moved to `withColumn`, which
inserts at the canonical position **relative to the columns already shown**.
Appending instead would mean one stray double-click silently rearranged the
table. `defaultSpec` still seeds canonically; there are tests for both halves.

`spec.colWeights` are **weights**, not pixels and not percentages. Pixels are
wrong the moment the note changes width or opens on the iPad (same reasoning as
`metaPct`), and stored percentages stop summing to 100 the moment a column is
added or removed — so they would need renormalising on every toggle, and any bug
in that renormalisation is a table that slowly drifts off its container. Weights
normalise at render time. `columnWidths` folds the actions column into the same
total rather than giving it a fixed px width: mixing px and % under
`table-layout: fixed` leaves the browser to reconcile them, which is how a table
ends up wider than its scroll container on one platform only.

`table-layout: fixed` is what makes the `<colgroup>` percentages authoritative —
under `auto` a width is a suggestion and the browser sizes from content, so a
dragged column springs back as soon as a long title arrives. Fixed layout will
not grow a cell to fit, so `th`/`td` need explicit `overflow: hidden;
text-overflow: ellipsis` or text spills across the boundary.

Reorder is **pointer-based, not HTML5 drag-and-drop**: the table lives inside a
ProseMirror node view, where a native `dragstart` competes with the editor's own
drag handling — the same reason `BlockHandle` is hand-rolled. Sorting therefore
happens on pointer-*up* when the press never reached another column; an
additional `onClick` would fire after a reorder and sort by whatever was dropped.

### The list row: opt-out chips, and the title yields LAST

⚠️ **`.pf-meta` is shrinkable and `.pf-list-title` has a floor.** It was the other
way round — `title { flex: 1 1 auto; min-width: 0 }` against `meta { flex: none }`
— so the chips took whatever they wanted and the title absorbed the entire
deficit. In a note-width column that rendered "Living Room" as one letter per
line while the same plan name and the same "Unassigned" sat comfortably beside it
on all 27 rows. The title is the content; it is the last thing that gives way,
and the chips ellipsise first (`.pf-meta > * { min-width: 0 }` is what makes
`text-overflow` actually engage inside a flex row).

The list also honours `spec.columns` now, where it used to render every chip
unconditionally. `LIST_COLUMNS` is deliberately narrower than `PF_COLUMNS` —
`urgency` and `stage` have nowhere to go in a line of text, and a switch that
does nothing is worse than no switch. `tags` stays on its own `showTags` flag
rather than joining `columns`: two switches for one chip is how they end up
disagreeing. The spec is shared across views on purpose, so a table-only column
survives being invisible in the list rather than being dropped.

**Existing blocks change appearance on first load.** `DEFAULT_COLUMNS` is
`done, title, plan, priority, due`, so the assignee and estimate chips go away
until switched back on. That is the intended migration — the complaint was that
the block insisted on showing everything — and the picker is now shown for lists,
not just tables.

`spec.metaPct` is the dragged title/metadata split, **as a percentage**. Not
pixels: a note is 720 px to full-bleed depending on `NoteDocument`'s per-note
width and the same note opens on an iPad, so a pixel width would be right on the
screen it was dragged on and wrong everywhere else — the same reasoning that puts
sketch coordinates in a 1000-unit logical space. 0 means auto. The grip writes a
CSS variable straight to the DOM on pointermove and commits ONE transaction on
release; a transaction per move would be ~60 document rewrites a second, each
waking the note's 400 ms autosave.

On a coarse pointer the grip is a short handle at the TOP of the list, not a
full-height rule. Permanently visible (no hover to reveal it), a full-height
stripe would sit over every row beneath it and swallow taps meant for tasks.

The slash menu offers **three** blocks — *Task list*, *Task board*, *Task table* —
that read and write PathFinder's `pf_tasks` live, from inside a note. They are
**one** ProseMirror node type, `pathfinderBlock`, carrying a `view` attribute.

That is the data-loss rule, not tidiness. An unknown **node type** does not
degrade: `createNodeFromContent` catches ProseMirror's throw, returns an EMPTY
document, and the 400 ms autosave writes that blank over the note. An unknown
**attribute** is dropped in silence, because `Node.fromJSON` iterates the
*type's* declared attributes and never looks for extras. Three node types would
be three deploy-everywhere gates and three chances to blank a note; one means a
fourth view (timeline, gallery) later costs nothing, and switching an existing
block between views is a one-attribute edit. It is still a new node type — deploy
web, Mac and iPad (`npm run ios:vault`) before creating a note containing one.

**The data layer is `packages/nexus-core/src/pathfinder/`, reached through the
`@nexus/core/pathfinder` deep alias** (not the barrel — that pulls in three.js).
It exists because three hand-written copies of the `pf_tasks` read already
existed when it was added, and the newest of them
(`apps/NexusLocal/src/lib/pathfinder/api.ts`) had already dropped the
`pf_task_planning` embed, so every task it renders reads as default urgency and
stage. Three invariants live in application code, not the database, and each
fails silently when another app writes the tables directly:

- **`stage = 'active'` is gated on scheduled calendar minutes.** Only `setStage`
  enforces it. A card dragged to "active" with a raw UPDATE defeats the one rule
  the lifecycle exists for. The board surfaces the refusal instead of swallowing it.
- **A flat patch must be SPLIT across relations** — `urgency`/`stage` live on
  `pf_task_planning`; writing them onto `pf_tasks` does not error, it just does
  nothing.
- **`task_type` is generated and `aggregate_estimate` is trigger-maintained.**

**Team-shared tasks work**, and needed explicit support: every read is broadened
with the same `user_id.eq.…,team_id.in.(…)` `.or()` fragment PathFinder's
`getTeamOrFilter` uses, or a task a teammate shared is simply absent —
indistinguishable from not existing. `isTaskRelevantToMe` is copied verbatim
from PathFinder's `lib/team.ts`: unclaimed (`null`) and everyone-assigned
(`"all"`) team work is *mine*, and only a concrete other uid narrows it. If that
rule drifts, a Vault block and PathFinder's dashboard disagree about whose work
something is. Boards can group by assignee and reassign by drag; the
`__unassigned__` column maps to `null`, never to its own key.

Two rules the node view must keep:

- **Data never touches the document.** Refetches, checkboxes and card drags
  dispatch no transaction; only a CONFIG change calls `updateAttributes`.
  Otherwise every poll wakes the note's autosave — the 2026-08-15 incident's shape.
- **The NODE may only import something that imports nothing heavier than React
  and Tiptap.** `extensions/PathfinderBlock.ts` points at
  `components/PathfinderBlockLazy.tsx`, which dynamic-imports the real view.
  Importing it directly would drag `lib/supabase.ts` (a module-scope
  `createClient`) into the schema graph, so `noteSchemaGuard` — whose job is to
  run when things are broken — would need a configured network client.

One shared store (`lib/pathfinderStore.ts`) backs every block in the app, so N
blocks in a note make one round trip and a tick in the list moves the card on the
board above it. `signedOut`, `loading` and `error` are states distinct from
"ready with zero rows": `pf_tasks` is `auth.uid()`-scoped, so a session-less read
returns an **empty set, not an error**, and rendering that as "All done ✓" is the
same lie as an "Inbox zero" panel that has never run.

### Hierarchy: the tree is built over the MATCHED set

`pf_tasks` is recursive — a task's steps are tasks with steps of their own — and
the list and table render that with indentation, a disclosure triangle and a
`3/12` roll-up. The nesting rules are pure and live in
`packages/nexus-core/src/pathfinder/tree.ts`, tested there.

A filter and a hierarchy disagree by nature: "open tasks" matches a step whose
parent is done. So **every matched task is re-parented to its nearest matched
ancestor**, and a step whose parent was filtered out is promoted to a root rather
than vanishing. Two invariants fall out, and both have tests: every matched task
appears exactly once, and no unmatched task appears — except under `tree: "full"`,
which is the mode that asks for whole subtrees.

Four things that are easy to get wrong here:

- **The counts come from the whole dataset, not the tree.** A row saying "3/12"
  means three of the task's twelve real descendants are done, whatever the filter
  hides. Same choice `aggregate_estimate` makes server-side, for the same reason:
  a roll-up that changes when you change a view is not a roll-up.
- **The flatten is depth-first so the LIMIT is safe.** A prefix of a depth-first
  walk always contains a row's parent; slicing any other order produces an
  indented row whose parent was cut off above it.
- **Both walks are cycle-guarded.** Nothing in `pf_tasks` stops an UPDATE making
  a task its own grandparent, and a hierarchy view is where that first shows up.
  A cycle must render as a truncated branch, not a hung tab.
- **Expand/collapse is React state, never a document attribute.** It is on the
  DATA side of the "data never touches the document" line: persisting it would
  put one undo step and one autosave behind every triangle.

The board ignores `tree` entirely and shows a roll-up chip instead — a card
cannot contain a card, and honouring the axis there would make a list→board
switch silently change which tasks the block contains.

### Vault-only tags: `vault_task_tags`, and the module split that protects the schema

Tags on tasks that exist **only in Vault** — PathFinder never sees them, and on a
team-shared task each person has their own set, which falls out of the table
being keyed `(user_id, task_id, tag)` rather than being a column on `pf_tasks`.
Migration `20260827140000_vault_task_tags.sql`; `user_id` is TEXT with an
`auth.uid()::text` policy and **no anon policy**, matching `vault_tag_colors`.
Colours are shared with note tags, so one word is one colour across Vault.

⚠️ **`lib/taskTags.ts` (pure) and `lib/vaultTaskTags.ts` (queries) are two files
on purpose, and merging them breaks the schema guard.** `lib/pathfinderBlock.ts`
needs `normalizeTagList` and the `TagMode` domain to parse a block's spec, and
that file is part of the note SCHEMA — `noteSchemaGuard` builds the schema before
any editor exists. One module holding both halves puts `lib/supabase.ts`'s
module-scope `createClient` on that path, and it throws `supabaseUrl is required`
wherever Vite's env is absent. This is the `PathfinderBlockLazy` rule again,
one layer down; it was hit and fixed during the hierarchy work.

Two more, both about not lying when the table isn't there yet:

- **A missing `vault_task_tags` must not take the task blocks down with it.** The
  migration is applied by hand and separately from any deploy, so a build running
  before it lands is normal. `loadTaskTags` reports a missing relation as
  `available: false` rather than throwing, and the store catches anything else —
  a naive read inside the snapshot's `Promise.all` would reject the whole thing
  and every block would read "Couldn't load tasks". That is the `pf_reminders`
  incident with the roles reversed.
- **`activeFilterCount`/`isUnfiltered` in `@nexus/core` cannot see Vault's tags.**
  Use `specFilterCount`/`specIsUnfiltered`/`clearedSpec` from
  `lib/pathfinderBlock.ts`, or a tag-filtered block shows no badge, says "No open
  tasks", and offers a Clear button that clears everything except the thing
  actually hiding the rows.

`spec.tags`, `tagMode`, `untaggedOnly`, `tree` and `showTags` are all
**attributes**, which is why they could ship without a deploy-everywhere gate —
an older client drops what it doesn't know and the note is fine. `untaggedOnly`
is a hard gate rather than another AND-ed clause: "untagged AND tagged #reading"
matches nothing, and a filter that can be configured into matching nothing reads
as broken.

The tag filter reaches `runQuery`/`runTreeQuery` as their `extra` predicate,
which runs **before** the limit. Filtering after the cap would let a block render
an empty list while matching rows sat just past the window.

### `vitest.config.ts` REPLACES `vite.config.ts` — repeat the aliases

Vitest prefers `vitest.config.ts` when both exist and does not merge them, so
every `resolve.alias` has to be repeated there. Without them `@nexus/core/*`
falls through to Node resolution, which follows the `node_modules/@nexus/core`
workspace **symlink** — and that points at the primary checkout, not at the tree
the test is running in. A git worktree therefore tests against a different copy
of nexus-core than it compiles against, and the symptom is a resolution error
with no obvious link to the change: `Missing "./pathfinder" specifier in
"@nexus/core" package`. (Vault's `.env` is gitignored and lives only in the
primary checkout too; copy it into a worktree or every test importing
`lib/api.ts` fails with `supabaseUrl is required`.)

## Scheduled server-side work (pg_cron)

Four jobs run in the database, and this is the pattern for anything that must happen
while every device is asleep:

| Job | Every | Function |
|---|---|---|
| `protocol-oura-daily-sync` | daily | `oura-sync` |
| `protocol-bodyscan-sync` | 10 min | `bodyscan-sync` — decodes raw BLE scale captures |
| `nexus-focus-evaluate` | 5 min | `focus-evaluate` — writes `blocking_state` |
| `nexus-learn-evaluate` | ~15 min | `learn-evaluate` — writes `lr_learn_state` |

⚠️ **Mail triage is deliberately NOT on this list.** It runs in n8n on the Mac, so it
stops when the Mac sleeps — the exact failure this table exists to work around. The
rule: *edge functions for what must happen, n8n for what is nice to happen.* Nothing
load-bearing may hang off n8n.

They `net.http_post` the function with the service-role key read from
**Vault** (`vault.decrypted_secrets`), not inlined — rotating the key needs no job edit.
Copy that shape. Function secrets (`SESSION_LOCAL_TZ`, `WIDGET_HABIT_KEY`,
`WIDGET_SESSION_KEY`) are set with `npx supabase secrets set`, separately from repo
secrets used by CI.

`bodyscan-sync` duplicates the BIA calibration constants from
`apps/NexusLocal/src/lib/bodyScan.ts` with only a comment enforcing the match — keep
the `CAL` blocks in sync after any re-calibration.

## Mail triage: n8n on the Mac, Supabase as the bus

`NexusHeader`'s mail panel shows a priority-sorted inbox with a suggested reply per
message. **The header never talks to n8n**, and it is worth being precise about why,
because "just point the panel at the workflow" is the first thing anyone tries.

Vault, PathFinder and Protocol are HTTPS pages served by Vercel. An HTTPS page cannot
fetch `http://localhost:5678` — the browser blocks it as mixed content, and no CORS
header fixes that. The iPad PWA and the iPhone are not even on the same host, so for
them `localhost` is the phone. There is no configuration of n8n that makes a Vercel
page reach it.

So the same shape as everything else here: the machine that *can* do the work does it
on a schedule and writes the result to Postgres; every client just reads.

```
Gmail --> n8n (Mac, Docker) --> local Qwen (Ollama) --> n8n-ingest --> Supabase
                                                                          |
                        NexusHeader / MailPanel <------ reads ------------+
```

This is `focus-evaluate` → `blocking_state` and `learn-evaluate` → `lr_learn_state`
with a different producer. If that framing is familiar, the rest of this section is
mostly bookkeeping.

The pieces:

| Piece | Where | Does |
|---|---|---|
| `mail-triage` | `integrations/n8n/workflows/` | Gmail trigger → persist untriaged → classify → POST verdicts |
| `mail-drain` | `integrations/n8n/workflows/` | every 5 min: classify anything still untriaged |
| `mail-heartbeat` | `integrations/n8n/workflows/` | every 15 min: calls Gmail, records "we looked" |
| `n8n-ingest` | `supabase/functions/n8n-ingest/` | n8n → `mail_messages` (upsert on `user_id,external_id`), applies `mail_rules`, and answers `{"action":"pending"}` with the untriaged ids |
| `n8n-requests` | `supabase/functions/n8n-requests/` | n8n claims/completes rows in `n8n_requests` |
| `mail_messages`, `mail_rules`, `mail_categories`, `n8n_requests` | `supabase/migrations/20260823120000_n8n_mail_bus.sql` | the bus |

The workflows live **in this repo**, not in `~/docker/n8n`. That directory is a
separate, unrelated local repo holding older experiments; nothing here reads it.

### The queue: fetch and classify are separate

`mail-triage` persists every fetched message **before** the model sees it, with no
verdict, on a branch that runs in parallel with classification. Classification used to
happen first, so a slow Ollama or a lid closing mid-batch lost the whole batch —
irrecoverably, because the Gmail trigger's watermark had already moved past it.

**`score IS NULL` is the queue**, and that is not a new state: it is what the column has
always meant, and `MailPanel` already sorts those rows to the top under their own
`untriaged` bucket. `mail-drain` empties it on a schedule, re-fetching each body **from
Gmail by id** — bodies are never stored, which is the whole reason the model is local.

A failed classification leaves the row untriaged for the next pass. Nothing is marked
done that was not done; the cost is that a permanently unparseable message retries
forever, visible as a row that never leaves the top of the panel.

`n8n_requests` is the other direction: the UI cannot reach n8n either, so an action
("sync now", "send this reply", "archive") is a **row n8n polls for**, not a webhook.
That is deliberate — a webhook to a laptop that is asleep is a lost request; a queued
row survives until the Mac is back. Single worker, so a `claimed_at` with no
`finished_at` and no lease column is enough; a row stuck in `claimed` past the longest
plausible workflow is stranded work and needs re-queueing.

### The rule: edge functions for what must happen, n8n for what is nice to happen

n8n runs in Docker on this Mac and stops when the Mac sleeps — precisely the failure
mode the whole NexusLocal design exists to route around (a schedule window opening or
a reward unlocking while every device is asleep is why `focus-evaluate` lives on
pg_cron and not in a `setInterval`). **Nothing load-bearing may hang off n8n.**
Blocking policy, health imports, learn state: pg_cron + edge function. Mail triage,
scraping, "ping me when a flat is listed": n8n, and the system degrades to "stale" not
"broken" when it is down.

If you find yourself moving something into n8n because the workflow editor is more
pleasant, ask what happens to it overnight. That question is the rule.

### Why a local Qwen, and what it costs

Mail bodies never leave the Mac. Triage is Ollama on `localhost`, not a hosted model.
This is the same posture as `usage_intervals`, which has no anon policy at all
precisely because it holds URLs and page titles — mail is strictly more sensitive than
browsing history, and shipping it to a third party to be scored 0–100 is not a trade
worth making for a header panel.

The accepted cost, stated plainly so nobody "fixes" it: **nothing is triaged
overnight.** Mail that arrives while the Mac sleeps sits un-triaged until it wakes.
`mail_messages.score` / `triaged_at` are nullable for exactly this reason, and the
panel sorts `score desc nulls first` so un-triaged mail lands at the *top* of a
triage list rather than being buried at the bottom where `default 0` would put it.

⚠️ **The column is `score`, not `priority`.** It was renamed because
`pf_tasks.priority` means *importance* on a `high|medium|low` domain, so a 0–100
`priority` in the same database would be the same word with the opposite meaning. One
`.order("priority")` survived that rename in the panel's loader and took the whole
feature down: PostgREST rejects an unknown column outright (`42703`), so the query
threw, and the panel showed "Mail is unavailable" with correctly triaged mail sitting
in the table. A column name inside a string is invisible to `tsc` — `MAIL_COLUMNS` is
a pinned constant for this reason, and `loader.test.ts` now pins the query shape too.

### Traps

- **Inside the container, `localhost` is the container.** An HTTP node pointing at
  `http://localhost:11434` reaches n8n's own loopback, not the Mac's. Use
  `http://host.docker.internal:11434`.
- **`OLLAMA_HOST=0.0.0.0` is NOT needed on this machine**, and this entry used to say
  it was. Measured: Ollama listening on `127.0.0.1:11434` only, `OLLAMA_HOST` unset,
  and the container reaching it through `host.docker.internal` regardless — Docker
  Desktop for macOS proxies that name through its own network stack, so the connection
  originates on the host side and arrives on loopback like any other local client. The
  advice is correct for **Docker on Linux**, where the container arrives over a bridge
  IP and a loopback-bound service genuinely is unreachable. Following it here buys
  nothing and publishes an unauthenticated model server to the LAN, which sits badly
  with a design whose entire justification is that mail bodies never leave the machine.
- **`mail_messages` / `n8n_requests` are `auth.uid()`-scoped with no anon policy** —
  unlike the 13 permissive productivity tables (see `SECURITY_RLS_MIGRATION.md`; they
  are a defect being migrated away from, not a convention to copy). Read them with the
  **authenticated** client `supabase`, never `supabasePublic`. Getting this backwards
  returns an **empty set, not an error** — an empty mail panel, indistinguishable from
  a clean inbox. It is the same trap as the conventions list above, with the polarity
  reversed: those tables need the anon client, these need the JWT.
- **Row count is not a freshness signal.** Zero rows in `mail_messages` means "the
  inbox is clean" *or* "n8n has never run", and a panel rendering both as "Inbox
  zero ✓" is lying half the time — the `blocking_state`-seeding mistake wearing a
  different hat. Last-synced comes from the newest `n8n_requests` row with
  `kind = 'mail_sync'` and `status = 'done'`; no such row means *unknown*, and the UI
  must say so.
- **n8n 2.x rejects workflow JSON that 1.x accepted.** Import fails on a missing
  top-level `id`, and on `tags` given as plain strings — 2.x wants tag *objects*. The
  error is unhelpful; check those two before debugging the nodes.
- **The migration is not applied by the code that writes it, and there is no staging
  database.** Both edge functions 500 against a project where the tables do not
  exist, and a deploy does not create them. See `supabase/migrations/APPLY.md`.

### Status, and the one thing with a clock on it

The pipeline is live and verified end to end: a real Gmail message triaged and written
to `mail_messages`, and a row reset to `score IS NULL` picked up by `mail-drain` within
four minutes and re-scored. Ollama 0.31.1 is installed with `qwen2.5:latest`; the Gmail
credential works; all three workflows are active.

⚠️ **The Google OAuth consent screen is still in *Testing*.** Google expires refresh
tokens for unpublished apps on a ~7-day cycle, so the Gmail credential will stop working
and the only symptom will be triage quietly ceasing. Fix once, permanently: Google Auth
Platform → **Audience** → **Publish app**.

### A workflow with `active = 1` is not necessarily running

n8n 2.x versions workflows. A workflow is only live when **`activeVersionId` is set**,
and `n8n import:workflow` clears it — so re-importing a running workflow silently
retires it, and setting `active = 1` by hand does not bring it back. Worse, an active
trigger runs that *published snapshot*, while a manual run uses the live nodes: wiring
credentials with a raw `UPDATE` creates no version, so the trigger keeps running a copy
where the credential id is still `null` and reports `uses invalid credential` while
manual execution works perfectly. Check n8n's startup log (`Currently active
workflows:`), never the `active` column. Full write-up in
`integrations/n8n/README.md`.

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
