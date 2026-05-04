# Nexus App Stack — Project Brief

A daily-updated progress log for the Nexus ecosystem (Tauri 2 + React 19 monorepo).
Newest entries first. Each entry captures commits, scope, and the why behind the day's work.

---

## Project Overview

**Nexus** is a personal "life OS" — a suite of interconnected desktop (and now mobile) apps:

| App            | Role                                              | Vite port |
|----------------|---------------------------------------------------|-----------|
| nexus          | Hub & launcher (IPC server :1430, 3D graph view) | 1420      |
| PathFinder     | Life planning — goals, projects, tasks            | 1421      |
| Vault          | (nested at `apps/Vault/Vault/`)                   | 1422      |
| TimeTrackerApp | Time tracking & focus sessions                    | 1423      |
| Stonks         | Financial tracking & portfolio                    | 1424      |

Shared library at `packages/nexus-core/` (TS + Rust mirror) provides `NexusClient`, hooks (`useNexusRegistration`, `useConnectedApps`), and shared UI (`NexusHeader`, `LifeBar`, `AgentBar`, `CalendarSidebar`, `AppGraph3D`, `Chart2D/3D`, `WorkflowViewer`).

Repo bootstrapped on **2026-04-16**; serious monorepo work began 2026-04-22.

---

## 2026-04-25 (Saturday)

**Status:** No new commits today as of automated run.
**Working tree:**
- `package-lock.json` modified (~7k inserts / ~2.8k deletes — likely a fresh `npm install` after yesterday's TimeTrackerApp absorption / iOS dependency churn).
- Untracked: `apps/TimeTrackerApp/.claude/` (per-app Claude Code config dir).

**Notes:** Quiet day so far — yesterday closed out a heavy iOS deployment push, so this looks like dependency settling. Nothing to flag.

---

## 2026-04-24 (Friday) — iOS deployment push

Six commits, the bulk of the week's mobile work. Got TimeTrackerApp running on a physical iPhone under the free Apple Developer tier and shipped multi-device timer sync via Supabase.

| Commit  | Scope                                                                                      | Δ              |
|---------|--------------------------------------------------------------------------------------------|----------------|
| 126be32 | feat(ios): iOS 26 beta SQLite fix, Supabase blocking sync, content blocker scaffold        | 18f / +8762/-130 |
| 0f65b99 | fix(ios): timer IPC camelCase + SQLite CHECK constraint workaround                         | 5f / +193/-114 |
| c29f73c | feat(ios): responsive Dashboard layout + multi-device active timer sync via Supabase       | 11f / +659/-48 |
| 78d345d | fix: Adopted variant carries RemoteSession payload; conflict banner above `isActive` guard | 3f / +48/-41   |
| 366331d | feat(ios): merge iOS responsive layout with conflict banner in DashboardPage               | 1f / +154/-545 |
| a726465 | feat(ios): deploy TimeTrackerApp to physical iPhone under free tier                        | 5f / +132/-11  |

**Themes / lessons baked into `CLAUDE.md`:**
- Bundle IDs need a personal namespace on free tier (`com.bastianthomsen.<appname>`).
- `ENABLE_USER_SCRIPT_SANDBOXING = NO` must be pinned in `gen/apple/project.yml`.
- iOS sandbox blocks writes to container root → `writable_root()` helper routes through `Documents/`.
- Tauri 2 `invoke()` keys must be camelCase (silently works on macOS, hard-fails on iOS).
- iOS 26.x beta SQLite hates `UNIQUE` / `CHECK` in `CREATE TABLE IF NOT EXISTS` — drop, enforce at app layer, swallow per-statement migration errors.
- Free-tier certs expire ~7 days; re-run `tauri ios dev` to refresh.

**Outcome:** TimeTrackerApp is the first app in the ecosystem on a real iPhone. Multi-device sync via Supabase landed with a conflict banner UX for adopted remote sessions. iOS migration walkthrough lives at `apps/TimeTrackerApp/IOS_MIGRATION.md`.

---

## 2026-04-23 (Thursday) — TimeTrackerApp absorbed, monorepo stabilized

| Commit  | Scope                                                       |
|---------|-------------------------------------------------------------|
| b4f7425 | feat: absorb TimeTrackerApp into monorepo                   |
| e870b2b | fix: add Tailwind to Vault, fix layout, upgrade Stonks → R19|
| 17dc7e0 | fix(ui): repair Tailwind scanning, CalendarSidebar portal, alias paths |
| b723e86 | fix: add error boundaries, tailwind source scanning, nexus-core git tracking |
| ff1bd1e | feat: wire nexus-core as shared workspace package across all apps |
| 5bf0ca1 | chore: restructure into monorepo                            |

**Themes:** Big restructure day. Shared nexus-core wired into every app. Tailwind v4 `@source` directives added to fix unstyled `NexusHeader` rendering. Stonks upgraded to React 19 to match parity (mismatched React versions ⇒ blank white screens).

---

## 2026-04-22 (Wednesday) — Hub UI + nexus-core component blitz

20+ commits — mostly building out the Nexus hub UI and iterating on shared components in nexus-core.

**Hub features added:**
- Nexus IPC server on `:1430` (axum) with `/health`, `/register`, `/unregister/:id`, `/apps`.
- Connected apps grid in main UI; Nexus self-registers (later removed — hub shouldn't appear in its own grid).
- Stable name-based registration IDs to prevent duplicates.
- Shared `NexusHeader` swap-in across apps.

**nexus-core components shipped/iterated:**
- `LifeBar` (with countdowns, day-hours fix, expanded variant, Memento Mori header).
- `AgentBar` (double-spacebar trigger, sidebar, expanded view).
- `CalendarSidebar` (wired to clock + calendar icons).
- `WorkflowViewer` (added to main page, resized to small top-left card).
- `Chart2D`, `Chart3D`, `AppGridButton`.

**Fixes:** axum 0.8 path param syntax (`:id` → `{id}`), IPv6 localhost fix.

---

## 2026-04-16 (Wednesday) — Repo bootstrap

`1893bab feat: initial commit` — repo created.

(Gap from 2026-04-16 → 2026-04-22; first real ecosystem work began the 22nd.)

---

## How this brief is maintained

Generated by a scheduled task (`project-breif`) that runs against this repo. Each run appends a new dated section at the top with the day's commits, file-change summary, and any notable themes pulled from commit messages and `CLAUDE.md`. If the day is quiet (no commits), the entry still records working-tree state.
