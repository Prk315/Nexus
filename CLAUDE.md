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
│   ├── PathFinder/      # Life planning — goals, projects, tasks
│   ├── TimeTrackerApp/  # Time tracking & focus sessions
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
| Nexus IPC      | 1430      |

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
- SQLite databases are managed via `tauri-plugin-sql` with inline migrations in each app's `lib.rs`. Nexus uses `nexus.db`; other apps use their own DB files.
- The `launch_app` Tauri command in Nexus handles `.app` bundles, `.sh` scripts, and raw binary paths.

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

## Supabase: Shared Cloud Backend

All apps that need cloud persistence use the single **NEXUS** Supabase project
(`efxmzsdisaymtpebaxlp`, region `eu-north-1`). Tables are namespaced by app
prefix to avoid collisions.

| App prefix | Tables |
|------------|--------|
| *(none)*   | `time_entries`, `active_sessions`, `blocked_sites`, `blocked_apps`, `focus_blocks`, `unlock_rules` (TimeTracker) |
| `pf_`      | 45 tables — goals, plans, tasks, systems, calendar, pipelines, habits, games, … (PathFinder) |
| `vault_`   | `vault_nodes`, `vault_edges`, `vault_tag_colors`, `vault_content`, `vault_journals` + Storage bucket `vault-assets` (Vault) |

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

## Adding a New App to the Ecosystem

1. Scaffold with `npm create tauri-app` inside `apps/<AppName>/`.
2. Add `"@nexus/core": "*"` to the app's `package.json` dependencies.
3. Add `"@nexus/core": path.resolve(__dirname, "../../packages/nexus-core/src/index.ts")` to `vite.config.ts` resolve aliases (adjust depth for Vault-style nesting).
4. Add a `@source` directive pointing at `packages/nexus-core/src` in the app's Tailwind CSS entry.
5. Call `useNexusRegistration("AppName")` in the root component.
6. Render `<NexusHeader appName="AppName" />` at the top of the app layout.
7. Add the workspace path to root `package.json` `workspaces` array and a `dev:<appname>` script.
8. Add the app's `src-tauri` to the root `Cargo.toml` workspace members.
