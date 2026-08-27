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
keystroke then autosaves that blank, and `vault_content` keeps no history. Web,
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
## Vault: PathFinder task blocks

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
