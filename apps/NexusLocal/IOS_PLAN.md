# Nexus Local — iOS Container App Plan

> Status: **Phase A + B done** (container scaffolded, first widget builds for
> iOS — `xcodebuild -target NexusLocalWidgets` → BUILD SUCCEEDED). Remaining:
> full app build + device install (needs your Xcode signing), then Phases C–E.
> Grounded in the TimeTracker + PathFinder iOS precedents in this repo.
>
> **Your one-time device step:** `Secrets.swift` is already created locally
> (gitignored, publishable key). Open Xcode signing on both targets (team
> G9D6JYJSLT) and run `npx tauri ios dev` from `apps/NexusLocal` — first build
> cross-compiles Rust for iOS (10–20 min). Then add the "Today" widget to your
> home screen.

## The goal, and the math that motivates it

The free Apple Developer tier allows **3 sideloaded apps installed at once** on a
device (and 10 app-IDs registered per rolling 7-day window). Today
`PHONE_APPS = (timetracker, pathfinder)` — 2 of 3 slots gone, with Protocol,
Vault, and Stonks all wanting on too.

Key insight: **the 3-app limit counts installed *apps*, not app-IDs.** One
container app can embed many app-extensions (each its own app-ID). So:

| Approach | Installed apps (limit 3) | App-IDs (limit 10 / 7d) |
|---|---|---|
| Today: TimeTracker + PathFinder apps | 2 | ~5 (2 apps + 3 extensions) |
| **Nexus Local container** carrying *all* extensions | **1** | main + widgets + SafariBlocker ≈ 3 |

**End state:** Nexus Local is the *only* native app on the phone. It carries every
widget, the Safari content blocker, and Live Activities. Protocol / PathFinder /
TimeTracker UIs are the Vercel PWAs (they cost 0 slots). That frees 2 slots and
removes the weekly re-sign burden for all but one app.

## Architecture

The iOS container is **not a grid execution node** like the Mac — iOS can't run
the Garmin venv or edit `/etc/hosts`. Its job is to be the *bundle* that ships
the extensions. The extensions read straight from Supabase; the host app is
nearly vestigial (a status/settings screen).

```
Nexus Local.app (iOS container, 1 install slot)
├── Host app (thin Tauri shell — status + Secrets/user config screen)
├── Widgets extension            ← WidgetKit, reads Supabase REST directly
│     PathFinder Today / Habits / Systems / Goals / Tasks
│     TimeTracker timer glance
│     Protocol (sleep/readiness) — future
├── Safari content blocker ext   ← needs App Group (later phase)
└── Live Activities (in widget ext target) ← ActivityKit (later phase)
```

**Data pattern (widgets):** copy PathFinder's — each widget is a `TimelineProvider`
that fetches `https://…supabase.co/rest/v1/<table>?select=…&user_id=eq.default`
with the anon key from a gitignored `Secrets.swift`, and refreshes on a 15-min
`.atEnd` timeline. No App Group, no Rust↔Swift bridge, works with the app closed.
This is why we start with widgets: **highest value, lowest machinery.**

## Layout to create

Bundle-ID convention (matches the repo): `com.bastianthomsen.nexuslocal`.

| Target | Type | Bundle ID | Deploy | Notes |
|---|---|---|---|---|
| `nexus-local_iOS` | application | `com.bastianthomsen.nexuslocal` | 14.0 | thin host |
| `nexus-local_Widgets` | app-extension | `…nexuslocal.widgets` | 16.0 | WidgetKit; all widgets + (later) Live Activity |
| `nexus-local_SafariBlocker` | app-extension | `…nexuslocal.SafariBlocker` | 14.0 | **later phase** |

App Group (only when the Safari blocker / Live Activities land):
`group.com.bastianthomsen.nexuslocal`. Widgets don't need it.
Development team everywhere: `G9D6JYJSLT`.

## Phased build

**Phase A — Container boots on the phone.** `tauri ios init` for NexusLocal,
set `bundle.iOS.developmentTeam = G9D6JYJSLT` + `identifier`, pin
`ENABLE_USER_SCRIPT_SANDBOXING: NO` in `project.yml`, guard any desktop-only Rust
(`tray`, grid runtime) behind `#[cfg(not(mobile))]` / no-op on iOS, confirm
`writable_root()` uses `$HOME/Documents`. Thin React status screen.
*Verifiable:* app installs, launches, stays open (no sandbox crash).
*You drive:* Xcode signing + device trust + `npx tauri ios dev`.

**Phase B — First widget (the milestone you picked).** Add the
`nexus-local_Widgets` extension target to `project.yml` (embed: true). Port
PathFinder's `SupabaseClient.swift` + `WidgetModels/Theme/NotConnectedView` +
**one** widget (proposal: a "Today" glance — primary goal + task counts from
`pf_daily_primary_goal` / `pf_tasks`). Add `Secrets.swift.template`; you copy to
`Secrets.swift` with the anon key. `WidgetBundle` with the single widget.
*Verifiable:* widget appears in the gallery, shows live Supabase data on-device.

**Phase C — Port the rest of the widgets.** Bring over PathFinder's remaining
widgets + a TimeTracker timer glance into the one extension. Pure REST, additive.

**Phase D — Safari content blocker.** Add the `SafariBlocker` extension + the App
Group + entitlements; port TimeTracker's `ContentBlockerBridge` / handler; feed
rules from `blocked_sites`. This is the iOS half of the blocking module.

**Phase E — Live Activities.** ActivityKit timer Live Activity in the widget
target (iOS 16.2+), driven by `active_sessions`.

## What only you can do (per IOS_MIGRATION.md)

- Xcode → Settings → Accounts signed in; team `G9D6JYJSLT` selected on each target.
- `npx tauri ios dev` (first build 10–20 min; Keychain "Always Allow" ×2).
- On-device: trust the developer profile (Settings → VPN & Device Management).
- Re-sign every ~7 days — hand this to SideStore auto-refresh (already set up).

## Free-tier & signing gotchas (already-known landmines)

- Bundle IDs globally unique → the `com.bastianthomsen.*` namespace.
- `ENABLE_USER_SCRIPT_SANDBOXING: NO` on **every** target (Tauri pre-build script).
- iOS container root is read-only → only write under `Documents/` (`writable_root()`).
- Tauri IPC keys camelCase on iOS (only relevant if the host app calls Rust).
- `Secrets.swift` gitignored; ship a `Secrets.swift.template` like PathFinder.
- `tauri ios init` overwrites `project.yml` → re-apply extension target blocks after.
- Watch the Cargo.toml `tray-icon` feature reversion hook (documented in IOS_MIGRATION.md).

## `ios-build.sh` integration

Add `nexuslocal` to `resolve_app()` and to `PHONE_APPS`. Interim this makes 3
installed apps (at the ceiling); the end state drops `timetracker` + `pathfinder`
from `PHONE_APPS` once their extensions live in Nexus Local.

## Open decisions to confirm before coding

1. **First widget content** — "Today" glance (PathFinder primary goal + tasks), or
   a different one (Habits? TimeTracker timer?).
2. **Host-app scope** — bare status screen, or also a Secrets/user-id setup UI?
3. **Should the iOS app heartbeat as a grid node** (presence only, no execution),
   so the dashboard shows the phone as online? Optional, low cost.
4. **Migration timing** — keep TimeTracker/PathFinder apps installed alongside
   during bring-up (temporarily 3 apps), then retire them?
