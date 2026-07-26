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
| Protocol       | Health & fitness tracker (added 2026-05-01)       | —         |

Shared library at `packages/nexus-core/` (TS + Rust mirror) provides `NexusClient`, hooks (`useNexusRegistration`, `useConnectedApps`), and shared UI (`NexusHeader`, `LifeBar`, `AgentBar`, `CalendarSidebar`, `AppGraph3D`, `Chart2D/3D`, `WorkflowViewer`).

Repo bootstrapped on **2026-04-16**; serious monorepo work began 2026-04-22.

---

## 2026-07-24 (Friday) — automated run

**Status:** No new commits since 2026-05-04. Head remains `3014799` (~11.5 weeks quiet).
**Working tree:** unchanged from the 07-21 run — the same five TimeTracker blocking-sync files remain modified but uncommitted, now three days older (~2.5 weeks since this diff first appeared on 07-08).

- `apps/TimeTrackerApp/src-tauri/src/sync/blocking.rs` (+9/-…), `apps/TimeTrackerApp/src-tauri/src/sync/supabase.rs` (+6), `apps/TimeTrackerApp/src/lib/tauriApi.ts` (+14), `apps/TimeTrackerApp/src/store/slices/syncSlice.ts` (+21), `apps/TimeTrackerApp/src/pages/TimeKeeperPage.tsx` (−150 net) — identical diffs to the 07-21 entry: Supabase on-conflict idempotency for blocked sites/apps (409 treated as already-synced), `syncBlockingBidirectional()` wired into `runSync` with follow-up `fetch*` dispatches, blocker UI sections converted to read-only "managed from Supabase" displays.
- Untracked: `apps/.claude/`, `apps/TimeTrackerApp/.claude/`, `apps/Vault/Vault/.Rhistory`, `apps/Vault/Vault/.__wtest` — unchanged.

**Notes:** Ninth consecutive run flagging the same complete, low-risk TimeTracker blocking-sync feature sitting uncommitted. Recommendation unchanged: commit it (and this brief) in the next working session so both stop aging in the working tree.

---

## 2026-07-21 (Tuesday) — automated run

**Status:** No new commits since 2026-05-04. Head remains `3014799` (~11 weeks quiet).
**Working tree:** unchanged from the 07-18 run — the same five TimeTracker blocking-sync files remain modified but uncommitted, now three days older (~3 weeks since this diff first appeared on 07-08).

- `apps/TimeTrackerApp/src-tauri/src/sync/blocking.rs` (+9/-…), `apps/TimeTrackerApp/src-tauri/src/sync/supabase.rs` (+6), `apps/TimeTrackerApp/src/lib/tauriApi.ts` (+14), `apps/TimeTrackerApp/src/store/slices/syncSlice.ts` (+21), `apps/TimeTrackerApp/src/pages/TimeKeeperPage.tsx` (-150 net) — identical diffs to the 07-18 entry: Supabase on-conflict idempotency for blocked sites/apps, `syncBlockingBidirectional()` wired into `runSync`, blocker UI sections converted to read-only "managed from Supabase" displays.
- Untracked: `apps/.claude/`, `apps/TimeTrackerApp/.claude/`, `apps/Vault/Vault/.Rhistory`, `apps/Vault/Vault/.__wtest` — unchanged.
- Note: `PROJECT_BRIEF.md` itself now carries ~190 lines of uncommitted growth from successive automated runs — worth committing alongside the TimeTracker feature so both stop aging in the working tree.

**Notes:** Eighth consecutive run flagging the same complete, low-risk TimeTracker blocking-sync feature sitting uncommitted. Recommendation unchanged: commit it (and this brief) in the next working session.

---

## 2026-07-18 (Saturday) — automated run

**Status:** No new commits since 2026-05-04. Head remains `3014799`.
**Working tree:** unchanged from the 07-16 run — the same five TimeTracker blocking-sync files remain modified but uncommitted, now seven days older (going on eleven weeks since last commit, ~2.5 weeks since this specific diff first appeared).

- `apps/TimeTrackerApp/src-tauri/src/sync/blocking.rs`, `apps/TimeTrackerApp/src-tauri/src/sync/supabase.rs`, `apps/TimeTrackerApp/src/lib/tauriApi.ts`, `apps/TimeTrackerApp/src/store/slices/syncSlice.ts`, `apps/TimeTrackerApp/src/pages/TimeKeeperPage.tsx` — identical diffs to the 07-16 entry (Supabase on-conflict idempotency for blocked sites/apps, `syncBlockingBidirectional()` wired into `runSync`, blocker UI sections converted to read-only "managed from Supabase" displays).
- Untracked: `apps/.claude/`, `apps/TimeTrackerApp/.claude/`, `apps/Vault/Vault/.Rhistory`, `apps/Vault/Vault/.__wtest` — unchanged.

**Notes:** Same TimeTracker blocking-sync feature, still uncommitted. This is now the seventh consecutive automated run flagging it — the feature reads as complete and low-risk (idempotency fix + sync wiring + UI simplification), so continued sitting looks more like an oversight than deliberate holdback. Recommend committing it in the next working session.

---

## 2026-07-16 (Thursday) — automated run

**Status:** No new commits since 2026-05-04. Head remains `3014799`.
**Working tree:** unchanged from the 07-11 run — the same five TimeTracker blocking-sync files remain modified but uncommitted, now five days older (going on two weeks total).

- `apps/TimeTrackerApp/src-tauri/src/sync/blocking.rs`, `apps/TimeTrackerApp/src-tauri/src/sync/supabase.rs`, `apps/TimeTrackerApp/src/lib/tauriApi.ts`, `apps/TimeTrackerApp/src/store/slices/syncSlice.ts`, `apps/TimeTrackerApp/src/pages/TimeKeeperPage.tsx` — identical diffs to the 07-11 entry (Supabase on-conflict idempotency for blocked sites/apps, `syncBlockingBidirectional()` wired into `runSync`, blocker UI sections converted to read-only "managed from Supabase" displays).
- Untracked: `apps/.claude/settings.local.json`, `apps/TimeTrackerApp/.claude/settings.local.json`, `apps/Vault/Vault/.Rhistory`, `apps/Vault/Vault/.__wtest` — unchanged.

**Notes:** The TimeTracker blocking-sync feature described on 07-08 is still sitting uncommitted, now going on two weeks. It remains a complete, coherent feature — the longer it sits, the more likely it drifts out of sync with any other TimeTracker changes made elsewhere. Worth committing.

---

## 2026-07-11 (Saturday) — automated run

**Status:** No new commits since 2026-05-04. Head remains `3014799`.
**Working tree:** unchanged from the 07-08 run — the same five TimeTracker blocking-sync files remain modified but uncommitted, now three days older.

- `apps/TimeTrackerApp/src-tauri/src/sync/blocking.rs`, `apps/TimeTrackerApp/src-tauri/src/sync/supabase.rs`, `apps/TimeTrackerApp/src/lib/tauriApi.ts`, `apps/TimeTrackerApp/src/store/slices/syncSlice.ts`, `apps/TimeTrackerApp/src/pages/TimeKeeperPage.tsx` — identical diffs to the 07-08 entry (Supabase on-conflict idempotency for blocked sites/apps, `syncBlockingBidirectional()` wired into `runSync`, blocker UI sections converted to read-only "managed from Supabase" displays).
- Untracked: `apps/.claude/settings.local.json`, `apps/TimeTrackerApp/.claude/settings.local.json`, `apps/Vault/Vault/.Rhistory`, `apps/Vault/Vault/.__wtest` — unchanged.

**Notes:** The TimeTracker blocking-sync feature described on 07-08 is still sitting uncommitted, now going on a week. It's a complete, coherent feature (backend idempotency fix + frontend read-only UI + sync wiring) — worth committing rather than letting it age further.

---

## 2026-07-08 (Wednesday) — automated run

**Status:** No new commits since 2026-05-04. Head remains `3014799`.
**Working tree:** meaningfully changed since the last run — the single lingering `supabase.rs` idempotency fix has grown into a real TimeTracker blocking-sync feature.

- `apps/TimeTrackerApp/src-tauri/src/sync/blocking.rs` (M, +5/-4) — `push_blocked_sites`/`push_blocked_apps` now add `?on_conflict=user_id,domain` / `?on_conflict=user_id,process_name` to their PostgREST URLs and treat HTTP 409 as a successful (already-synced) push instead of an error, mirroring the time-entries fix.
- `apps/TimeTrackerApp/src-tauri/src/sync/supabase.rs` (M, +5/-1) — same on-conflict idempotency fix as prior runs, now bundled with the above rather than sitting alone.
- `apps/TimeTrackerApp/src/lib/tauriApi.ts` (M, +14) — adds `syncBlockingBidirectional()` binding + `BlockingSyncSummary` type (sites/apps/blocks/rules pushed & pulled, plus errors).
- `apps/TimeTrackerApp/src/store/slices/syncSlice.ts` (M, +21/-2) — `runSync` thunk now also calls `syncBlockingBidirectional()` and re-dispatches `fetchBlockerState`/`fetchBlockedSites`/`fetchScheduleBlocks`/`fetchUnlockRules` afterward so the UI reflects pulled changes; combined push/pull counts and errors are merged into the returned `SyncResult`.
- `apps/TimeTrackerApp/src/pages/TimeKeeperPage.tsx` (M, +37/-127, net simplification) — `AppBlockerSection` and `SiteBlockerSection` lose their local add/remove/toggle UI (picker modal, add-site input, per-item toggles) and become read-only status displays ("Blocked apps/sites are managed from Supabase"); the iOS-only gating (`IS_IOS` checks, Safari Content Blocker copy) is also removed so both sections render unconditionally on all platforms.
- Untracked: `apps/.claude/`, `apps/TimeTrackerApp/.claude/` (per-app Claude Code config), `apps/Vault/Vault/.__wtest`, `apps/Vault/Vault/.Rhistory` — all carried over unchanged.

**Notes:** First real movement in ~9 weeks of quiet runs. The direction is clear even without a commit message: TimeTracker's app/site blocker config is being centralized in Supabase as the source of truth, with local UI becoming a read-only mirror kept in sync via the new bidirectional blocking sync (matching the pattern already used for time entries). This is a meaningful, multi-file change — worth committing soon rather than letting it accumulate further uncommitted.

---

## 2026-07-06 (Monday) — automated run

**Status:** No new commits since 2026-05-04. Head remains `3014799`.
**Working tree:** unchanged from the last five runs — one uncommitted source change plus the same untracked config/scratch files.

- `apps/TimeTrackerApp/src-tauri/src/sync/supabase.rs` (M, +5/-1) — same `?on_conflict=device_id,start_time,task_name` idempotency fix for the PostgREST push URL, still uncommitted (now over a week).
- Untracked: `apps/.claude/`, `apps/TimeTrackerApp/.claude/` (per-app Claude Code config), `apps/Vault/Vault/.__wtest`, `apps/Vault/Vault/.Rhistory` — all carried over unchanged.

**Notes:** Fifth consecutive quiet run, repo has now been quiet ~9 weeks. The TimeTracker sync-idempotency fix is still the one actionable item sitting uncommitted — small and low-risk, worth just committing at this point.

---

## 2026-07-05 (Sunday) — automated run

**Status:** No new commits since 2026-05-04. Head remains `3014799`.
**Working tree:** unchanged from yesterday — one uncommitted source change plus untracked config dirs and scratch files.

- `apps/TimeTrackerApp/src-tauri/src/sync/supabase.rs` (M, +5/-1) — same `?on_conflict=device_id,start_time,task_name` idempotency fix for the PostgREST push URL, still uncommitted (now at least 5 days).
- Untracked: `apps/.claude/`, `apps/TimeTrackerApp/.claude/` (per-app Claude Code config), `apps/Vault/Vault/.__wtest`, `apps/Vault/Vault/.Rhistory` — all carried over unchanged.

**Notes:** Fourth consecutive quiet run, repo has now been quiet ~9 weeks. The TimeTracker sync-idempotency fix remains the one actionable item — small, low-risk, and still just sitting uncommitted.

---

## 2026-07-04 (Saturday) — automated run

**Status:** No new commits since 2026-05-04. Head remains `3014799`.
**Working tree:** unchanged from the last two runs — one uncommitted source change plus untracked config dirs, now with an extra stray file.

- `apps/TimeTrackerApp/src-tauri/src/sync/supabase.rs` (M, +6/-2) — same `?on_conflict=device_id,start_time,task_name` idempotency fix for the PostgREST push URL, still uncommitted.
- Untracked: `apps/.claude/`, `apps/TimeTrackerApp/.claude/` (per-app Claude Code config), `apps/Vault/Vault/.__wtest` (carried over), plus a newly-appeared `apps/Vault/Vault/.Rhistory` scratch file.

**Notes:** Third consecutive quiet run. The TimeTracker sync-idempotency fix is a small, low-risk change (6 lines) sitting uncommitted for at least 4 days now — still flagging it as worth committing.

---

## 2026-07-02 (Thursday) — automated run

**Status:** No new commits since 2026-05-04. Head remains `3014799`.
**Working tree:** unchanged from yesterday — one uncommitted source change plus the usual untracked config dirs.

- `apps/TimeTrackerApp/src-tauri/src/sync/supabase.rs` (M, +5/-1) — the same `?on_conflict=device_id,start_time,task_name` idempotency fix for the PostgREST push URL, still uncommitted. Prevents re-pushed time entries from throwing `23505` / HTTP 409.
- Untracked: `apps/.claude/`, `apps/TimeTrackerApp/.claude/` (per-app Claude Code config), and the stray `apps/Vault/Vault/.__wtest` scratch file — carried over unchanged.

**Notes:** Another quiet day, no movement since yesterday. The TimeTracker sync-idempotency fix is still pending a commit — flagging again so it doesn't get lost.

---

## 2026-07-01 (Wednesday) — automated run

**Status:** Still no new commits since 2026-05-04. Head remains `3014799`.
**Working tree:** one uncommitted source change plus the usual untracked config dirs.

- `apps/TimeTrackerApp/src-tauri/src/sync/supabase.rs` (M, +5/-1) — adds `?on_conflict=device_id,start_time,task_name` to the PostgREST push URL so re-pushing already-synced time entries upserts on the natural unique key instead of throwing `23505` / HTTP 409. Without it, PostgREST defaulted the conflict target to the primary key (`id`) and the real unique-constraint violation surfaced as an error. Not yet committed.
- Untracked: `apps/.claude/`, `apps/TimeTrackerApp/.claude/` (per-app Claude Code config), stray `apps/Vault/Vault/.__wtest` scratch file — unchanged from yesterday.

**Notes:** Quiet day. The one pending edit is a targeted sync-idempotency fix for TimeTracker's Supabase push path; worth committing so re-syncs stop erroring.

---

## 2026-06-30 (Tuesday) — automated run

**Status:** No new commits since 2026-05-04. Repo has been quiet for ~8 weeks.
**Working tree:** untracked only — `apps/.claude/`, `apps/TimeTrackerApp/.claude/` (per-app Claude Code config dirs) and a stray `apps/Vault/Vault/.__wtest` scratch file. Nothing staged, no source changes pending.

**Notes:** Catch-up run — the brief had stalled at 2026-04-25 while a heavy two-week build sprint (PDF tooling, iOS widgets, PathFinder dashboard, the new Protocol app) landed underneath it. Entries for 04-25 → 05-04 reconstructed below from git history. Current head is `3014799` (2026-05-04).

---

## 2026-05-04 (Monday) — TimeTracker iOS widgets + Nexus schema graph

`3014799 feat: TimeTracker iOS widget Supabase integration, Nexus SchemaGraph2D, PieFloatingWidget` — 22 files, +2003/-220.

Wired TimeTracker's iOS WidgetKit widgets to pull live data through Supabase, added a `SchemaGraph2D` view to Nexus (visualizing the data model), and a `PieFloatingWidget`. Last commit on record.

---

## 2026-05-01 (Thursday) — Protocol app added, PathFinder widget redesign

Two commits but a large surface area (114 files, +6231/-792).

| Commit  | Scope                                                                       |
|---------|-----------------------------------------------------------------------------|
| e501713 | feat(protocol): add **Protocol** app — health & fitness tracker (new 6th app) |
| c9e9fc1 | refactor(pathfinder/widgets): overhaul all widgets to clean light aesthetic |

**Themes:** Ecosystem grew to six apps with **Protocol** (health & fitness). PathFinder's widget suite got a visual refresh toward a clean light aesthetic.

---

## 2026-04-29 (Tuesday) — PathFinder dashboard + iOS widgets blitz

16 commits, 100 files, +13342/-1744 — the second-biggest day on record.

**PathFinder dashboard / planning:**
- Habit stacks, schedule entries and habits surfaced on the dashboard; pipeline sync fixes; new pages (`be85caa`).
- Collapsible habits strip + per-stack collapse toggle (`43482a9`).
- Time estimates on primary/secondary daily goals, time-budget summary, and goal estimates folded into the header pie chart (`2eb521c`, `f19ff8a`, `1a1cb6a`); goal done-state lifted so the pie updates on completion (`51fad8e`).
- Cal block ↔ task correlation + sub-projects (`0611f5a`); training recurrence support, Schedules panel removed, virtual recurring IDs resolved before Supabase toggle (`7415f93`, `24f96a8`).
- WidgetKit widget system + GoalHub iOS layout (`aeb5a1b`).

**Vault:**
- SQL canvas cells + PDF touch UX (`beebe1f`); canvas build mode, ink mode, pinch-zoom anchor fix (`125cc72`); mark/text-highlight tool with word-snap and line grouping (`4896406`); iPad capabilities + Python-unavailable messaging (`dc67fcd`).

**TimeTracker:** Live Activities, WidgetKit widgets, quick session add (`20a2099`); widget + Live Activity sync on resume (`ed38689`).

---

## 2026-04-27 (Sunday) — Vault graph polish

`9a9db5c feat(vault): custom canvas link renderers with arrow heads for 2D graph views` — 3 files, +74/-16. Single quiet commit.

---

## 2026-04-26 (Saturday) — iOS Safari content blocker

4 commits (14 files, +527/-82) finishing the TimeTracker Safari Content Blocker on the iOS 26 SDK: extension build fixes, App Group entitlement, ObjC selector fix, bundled `blockerList.json`, and the Focus tab shown on iOS for site blocking (`4c380d1`, `cbf0ea2`, `a49ec12`, `345c6b4`).

---

## 2026-04-25 (Friday) — Vault PDF tooling + PathFinder iOS port (heavy day)

The morning automated run logged "no commits," but the day turned into the single largest on record: **29 commits, 154 files, +14204/-4015**.

**Vault — Notability-grade PDF tooling:**
- 3D graph + PDF viewer unblocked, gotchas documented (`6e32eb5`); pages actually render on pdfjs v5 (`480523f`).
- iOS/iPad support for Xcode deployment + iOS PDF-crash/drag-region fixes (`70428b8`, `60e55bf`); merged PR #1 (`c9de1f5`).
- Phase 2 PDF: pressure ink, search, lasso actions, export; pinch-zoom/fit-to-width and annotation font scaling fixes (`a2d9b32`, `3814cef`, `ac25e65`, `7788b36`); iPad Canvas support (`45488b6`).

**PathFinder — iOS port:**
- Tauri config, safe-area CSS, mobile bottom nav (`44d3ae9`); `NSLocalNetworkUsageDescription` for dev server (`33505fb`); full mobile UI overhaul for iPhone (`67f39ce`).

**TimeTracker:** Safari Content Blocker scaffold + PathFinder Week-modal refactor (`32c5d1d`) plus a chain of xcodegen/Info.plist/FFI build fixes.

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
