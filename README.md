# Nexus Ecosystem

A personal life operating system — a suite of interconnected apps built with
Tauri 2 (Rust) + React 19 / TypeScript, coordinating through a shared Supabase
project.

> **Before changing any Supabase policy, read [`SECURITY_RLS_MIGRATION.md`](./SECURITY_RLS_MIGRATION.md).**
> Thirteen tables are still world-writable via the committed anon key, and the
> fix has to be done in a specific order — a mismatched JWT returns an empty set
> rather than an error, so a half-finished migration fails silently.

## Apps

| App | Description |
|-----|-------------|
| [Nexus](./apps/nexus) | Central hub & launcher. Runs the IPC server (port 1430) and visualises the ecosystem in 3D. |
| [NexusLocal](./apps/NexusLocal) | The macOS background grid node **and the only native iOS app**. Enforces site/app blocking, tracks foreground usage, bridges Garmin, and carries every widget and extension. |
| [Protocol](./apps/Protocol) | Health — sleep, body composition, training. Sources from Oura, Garmin and a Vellafit BLE scale. |
| [PathFinder](./apps/PathFinder) | Life planning — goals, projects, tasks, courses, habits. |
| [Vault](./apps/Vault/Vault) | Graph-based knowledge management with rich editing. *(source is one level deeper — intentional)* |
| [TimeTrackerApp](./apps/TimeTrackerApp) | Time tracking and focus sessions. Largely superseded by NexusLocal's productivity stack. |
| [Stonks](./apps/Stonks) | Financial tracking and portfolio management. |

## Packages

| Package | Description |
|---------|-------------|
| [nexus-core](./packages/nexus-core) | Shared library — IPC client SDK, shared auth (`useNexusAuth`), UI components, and a Rust mirror of the shared types. |

## Tech stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4
- **Desktop/mobile:** Tauri 2 (Rust)
- **Data:** one shared Supabase project (Postgres + RLS + Edge Functions +
  pg_cron). Some apps retain legacy SQLite that is no longer the source of truth.
- **Local IPC:** HTTP on port 1430 — app discovery only, not data

## Getting started

```bash
npm install                 # must be run from the repo root

npm run dev:nexus
npm run dev:pathfinder
npm run dev:vault
npm run dev:timetracker
npm run dev:stonks

# NexusLocal is a Tauri app — the npm script is bare `vite` and opens no window:
cd apps/NexusLocal && npx tauri dev
```

## Architecture

Two coordination layers, and the second is the one that matters.

**IPC (port 1430)** is presence only: each app registers with the Nexus hub on
startup so the launcher can show what is running.

**Supabase is the actual backbone.** Apps read and write the same Postgres
project directly; work that must happen while every device is asleep runs as an
Edge Function on pg_cron. NexusLocal adds a *grid*: a command queue
(`nexus_local_commands`) that lets a browser app ask the Mac to do something it
cannot do itself — run the Garmin bridge, edit `/etc/hosts`, kill a process.

```
                    Supabase (Postgres + RLS + Edge Functions + pg_cron)
                    /         |          |           |            \
             Protocol   PathFinder    Vault      Stonks      NexusLocal
                                                              /       \
                                                     macOS daemon   iOS app
                                                    (grid node,     (widgets,
                                                     enforcement)    Safari blocker)

             Nexus (IPC hub :1430) ← presence/registration only
```

Scheduled server-side work: `oura-sync` (daily), `bodyscan-sync` (10 min),
`focus-evaluate` (5 min, computes the blocking verdict), `learn-evaluate`
(15 min).

## Where the real documentation lives

- [`CLAUDE.md`](./CLAUDE.md) — the working guide. Architecture, the conventions
  that fail silently, and the environment gotchas. Start here.
- [`SECURITY_RLS_MIGRATION.md`](./SECURITY_RLS_MIGRATION.md) — the outstanding
  security work and why the obvious fixes are wrong.
- [`apps/NexusLocal/OPEN_ITEMS.md`](./apps/NexusLocal/OPEN_ITEMS.md) — known
  broken things, with enough context to act without re-deriving them.
- [`apps/NexusLocal/IOS_PLAN.md`](./apps/NexusLocal/IOS_PLAN.md) — the iOS
  delivery story, including why App Groups survive an Xcode-direct install and
  die under SideStore.
