# Nexus Local — open items

Known-unfixed things, with enough context to act without re-deriving them.
Architecture and conventions live in the repo root `CLAUDE.md`; this is only the
list of what is still wrong. Delete entries as they are fixed.

Shipped state as of **v0.12.0** (2026-08-06): the productivity stack (session
recording, pomodoro, focus schedules, blocking management, time-unlock rewards) is
merged and released. `focus-evaluate` is deployed and scheduled on pg_cron every 5
minutes; `blocking_state` carries a live verdict; the Mac grid node enforces it.

**State as of 2026-08-10.** Mac enforcement, usage tracking and the Garmin
import all run continuously; see the root `README.md` and `CLAUDE.md`. The
security work is deferred deliberately — `SECURITY_RLS_MIGRATION.md`.

**Mac enforcement went continual on 2026-08-07** — see "Mac enforcement" in the root
`CLAUDE.md`. Until then it had never actually run: `blocking_enabled` shipped `false`,
was reachable only by hand-editing `~/.nexuslocalrc`, was frozen at startup, and
nothing kept the app alive across a reboot.

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
- **TimeTracker's hosts block is IPv4-only, so it does not block Chrome.** It writes
  `127.0.0.1 <domain>` and no `::1`, which overrides the A lookup while AAAA still
  resolves to the real site — and Chrome prefers IPv6. NexusLocal's `build_block`
  writes both families (fixed 2026-08-07); TimeTracker's
  `src-tauri/src/blocker/hosts.rs:25` has not been touched. Its markers coexist with ours in `/etc/hosts`, so the domains it
  duplicates (`disney.com`, `hbo.com`) are covered by our block anyway — but anything
  only in TimeTracker's list is effectively unblocked in Chrome.
- **TimeTracker's blocking sync has three structural defects**: nothing resets
  `synced = 0` on a local edit, so a row pushes exactly once ever; deletes have no
  tombstones, so the next pull resurrects them; and the last-write-wins guard compares
  a space-separated local timestamp against a `T`-separated UTC one, so remote always
  wins by lexical accident rather than by design. Copy that schema, not that algorithm.

## 4b. Protocol still duplicates Garmin activities until it is redeployed

Fixed in code (PR #60): Protocol's importer now derives its `id` from Garmin's
`activityId` with the same SHA-256 derivation as `garmin-import`, and sets
`external_id`. **But Protocol has not been redeployed**, so the Garmin button on
its workout dashboard still writes `crypto.randomUUID()` and still duplicates.
Use Nexus Local's *Sync to Protocol* until then.

⚠️ **The two `stableId` implementations must stay byte-identical** —
`apps/Protocol/src/lib/importers/garmin.ts` and
`supabase/functions/garmin-import/index.ts`. Nothing tests that they agree. If
they diverge, each writer inserts its own copy of every activity and the
duplicates come straight back. A shared fixture would be the durable fix.

## 4c. `garmin-import` must be deployed with `--no-verify-jwt`

The Nexus Local WebView calls it with `X-Garmin-Key` and no `Authorization`
header. With the platform JWT check on, Supabase's gateway 401s *before* the
function runs, and the UI shows a bare "import failed (401)" that looks exactly
like a bad scoped key. The flag is a deploy-time setting and lives nowhere in the
repo, so a plain `supabase functions deploy` silently re-breaks it. Noted at the
top of the function too.

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

`README.md` was refreshed on 2026-08-10 (it previously listed neither Protocol
nor NexusLocal and described SQLite as the backend).
`AUTOUPDATE.md` named only one of the three version locations; `IOS_MIGRATION.md`
still claims iOS site blocking doesn't work and that the Dashboard tab is hidden on
iOS — both untrue since commits `4c380d1` / `cbf0ea2`. `PROJECT_BRIEF.md` predates the
entire NexusLocal era. `README.md` mentions neither Protocol nor NexusLocal.

## 8. Fixed 2026-08-09/10, listed so the pattern is visible

- **The installed daemon could not find `garmin_bridge.py`.** Path resolution had
  an env override, a `#[cfg(debug_assertions)]` dev path, and a walk-up from the
  executable — but the release daemon runs from
  `/Applications/Nexus Local.app/Contents/MacOS/`, which has no `modules/` above
  it, and the bundle carries no copy. Garmin worked under `tauri dev` and was
  broken on every installed build. Now looks in
  `~/.nexuslocal/modules/garmin/` first. **After editing the bridge, copy it
  there or nothing picks it up.**
- **NexusLocal's vendored bridge was a stale 274-line fork** of Protocol's
  345-line one, missing `exercise_sets` — so strength sync could not work through
  the grid at all. Both copies are now identical; keep them that way.
- **Blocking was IPv4-only, so it did not block Chrome.** A `127.0.0.1` entry
  overrides the A lookup while AAAA still resolves to the real site. `ping` asks
  for IPv4 and reports `127.0.0.1`, which is why it looked fine —
  `dscacheutil -q host -a name <domain>` is the honest check. NexusLocal now
  emits `::1` too; **TimeTracker's `blocker/hosts.rs:25` still does not**.
- **`AppConfig::load()` deleted config fields it did not know about**, because it
  persists on read and `fs::write` truncates. A `#[serde(flatten)] extra` map now
  round-trips unknown keys, and `save()` is write-temp-then-rename.
