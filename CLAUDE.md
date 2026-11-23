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
- SQLite databases are managed via `tauri-plugin-sql` with inline migrations in each app's `lib.rs`. Nexus uses `nexus.db`; most other apps use their own DB files. **Exception:** PathFinder migrated to Supabase on 2026-04-25 — see `apps/PathFinder/CLAUDE.md`.
- The `launch_app` Tauri command in Nexus handles `.app` bundles, `.sh` scripts, and raw binary paths.

## Per-app detail lives next to the app

Each app's internals — its traps, data model and design decisions — are in a
nested `CLAUDE.md` that Claude Code loads on its own when work touches that
directory. They were split out of this file on 2026-11-23 because it had grown
to ~40k tokens loaded into every session regardless of which app was in play.

| File | Covers |
|---|---|
| `apps/PathFinder/CLAUDE.md` | Supabase data layer, ISA task model, goals, Systems recurrence, scheduling gate, sessions |
| `apps/NexusLocal/CLAUDE.md` | grid node vs iOS bridge, `blocking_state`, Mac enforcement + daemon + root hosts enforcer, usage tracking, Garmin, widget writes, SideStore delivery, releasing |
| `apps/Vault/Vault/CLAUDE.md` | data layer, Tiptap note editor + schema guard, co-editing, history, code cells, PathFinder task blocks, canvas, theming |
| `integrations/n8n/CLAUDE.md` | mail triage: n8n on the Mac, Supabase as the bus |

**If a task crosses apps, read the other app's file before editing its code.**
A nested file only loads once something under its directory is read, so a
change made to Vault from a PathFinder-focused session starts without Vault's rules.

Two mail rules that bite from outside `integrations/` (the panel is in nexus-core):
`mail_messages`/`n8n_requests` are `auth.uid()`-scoped — read them with the
authenticated `supabase` client, never `supabasePublic` (wrong client = empty set,
not an error); and the column is `score`, not `priority`.

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
