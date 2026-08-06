# Nexus Local — open items

Known-unfixed things, with enough context to act without re-deriving them.
Architecture and conventions live in the repo root `CLAUDE.md`; this is only the
list of what is still wrong. Delete entries as they are fixed.

Shipped state as of **v0.12.0** (2026-08-06): the productivity stack (session
recording, pomodoro, focus schedules, blocking management, time-unlock rewards) is
merged and released. `focus-evaluate` is deployed and scheduled on pg_cron every 5
minutes; `blocking_state` carries a live verdict; the Mac grid node enforces it.

---

## 1. On-phone Safari blocking is inert on the SideStore path

`ctr:NIL`, `alt:0 []` — the App Group does not survive on-device re-signing, so the
widget cannot hand compiled rules to the blocker extension. Full detail and the two
routes out (Xcode-direct install via `ios-build.sh`, or a paid developer account) are
in `IOS_PLAN.md`. Mac enforcement covers it meanwhile.

## 2. `SessionBridge` never lands the session in the keychain

`kc grp:… sess:no` while `probe:OK`. The keychain access group resolves and
round-trips, so this is a code bug, not a provisioning limit. Until it is fixed
widgets fall back to the anon key (reads still work, scoped by `Secrets.userID`).
Note `KeychainSession.load()` deliberately omits `kSecAttrAccessGroup` so the search
spans every entitled group — and the **iOS Simulator ignores access groups entirely**,
so a passing simulator test proves nothing about the device.

## 3. `ContentBlockerBridge.swift` still hardcodes the App Group

Unit 9's handler and unit 10's widget both resolve it at runtime via
`AppGroup.identifier`; the app-side bridge does not. Harmless today (the group
resolves nowhere), but it will diverge the moment item 1 is fixed.

## 4. Cross-writer hazards with TimeTrackerApp

Both apps write the same Supabase tables and neither knows about the other.

- **Two timestamp formats in one `text` column.** `TimeTrackerApp/db/timer.rs` writes
  `Local::now()` with no offset on every `start_timer`; Nexus Local writes RFC3339
  UTC. Misparsing one as the other shifts durations by the whole UTC offset and can
  clamp a session to a **0-second entry**. `session-toggle` handles both via
  `SESSION_LOCAL_TZ`; anything new that parses these columns must too.
- **Stopping a session from the widget does not stop a desktop timer.** The desktop
  reads the deleted cloud row as `RemoteGone`, re-reads local SQLite where the session
  still runs, and on stop pushes an entry sharing the natural key
  (`device_id,start_time,task_name`) with `merge-duplicates` — silently overwriting.
- **TimeTracker's blocking sync has three structural defects**: nothing resets
  `synced = 0` on a local edit, so a row pushes exactly once ever; deletes have no
  tombstones, so the next pull resurrects them; and the last-write-wins guard compares
  a space-separated local timestamp against a `T`-separated UTC one, so remote always
  wins by lexical accident rather than by design. Copy that schema, not that algorithm.

## 5. `today_minutes` is read twice

Unit 8's `BlockingState` struct omits `today_minutes` even though the column exists,
so `RewardsPanel` backfills that one field with a second query against the same row.
**Delete the backfill once the struct grows the field**, or the two reads will drift.

## 6. Dead weight in TimeTrackerApp

`db/goals.rs`, `commands/goal_commands.rs`, `db/templates.rs`,
`commands/template_commands.rs`, `goalsSlice.ts`, `templatesSlice.ts` are unreachable —
unregistered modules, unregistered reducers, no UI. `tauriApi.startFromTemplate`
invokes `start_from_template`, which does not exist anywhere in the Rust source.

## 7. Docs that were stale (fixed 2026-08-06, listed so the pattern is visible)

`AUTOUPDATE.md` named only one of the three version locations; `IOS_MIGRATION.md`
still claims iOS site blocking doesn't work and that the Dashboard tab is hidden on
iOS — both untrue since commits `4c380d1` / `cbf0ea2`. `PROJECT_BRIEF.md` predates the
entire NexusLocal era. `README.md` mentions neither Protocol nor NexusLocal.
