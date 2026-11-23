# CLAUDE.md — Nexus Local

Loaded automatically when working under this directory. Cross-cutting rules
(Supabase removal ordering, RLS posture, iOS deployment, environment gotchas)
live in the root `CLAUDE.md`.

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

**The root enforcer removes the dialog — and the loophole it was.** A password
per *change* made every re-lock optional: Cancel at the end of a meal unblock kept
the sites open. `hosts_enforcer.rs` installs (one password, from the Enforcement
panel) a system LaunchDaemon running a root copy of the binary as
`--hosts-enforcer` every 30s; it reads `blocking_state` itself and writes
`/etc/hosts` directly. While it is installed the daemon writes no hosts entries and
`clear` is refused. It takes no input from the user on purpose — a user-writable
hand-off file would be a passwordless unblock. **There is no Remove button**: the
app can only request removal (`/Users/Shared/NexusLocal/…-removal-request`), and
the enforcer uninstalls itself 24 h after it *first saw* the request, recorded in a
root-owned file so the request can't be backdated; it keeps blocking meanwhile, and
withdrawing restarts the clock. `sudo launchctl bootout system/…hosts` still works —
the bar is "not one click", not "impossible".
Because root now writes from an anon-writable table, `normalize_domain` admits only
RFC 1123 hostnames and the Supabase API host is never blocked. The helper is a
*copy*: an app update needs a Reinstall (the panel flags the version skew). Its
last run is in `/Library/Application Support/NexusLocal/hosts-enforcer.last`; its
log is `/Library/Logs/nexus-local-hosts.log`.

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

