# Handoff: folding TimeTracker's productivity features into Nexus Local

State as of 2026-08-05. Written so this survives a session ending.

## Design (settled, approved)

Blocking must be **autonomous on the iPhone with Supabase as ground truth**. A sideloaded
free-tier iOS app gets no BGTaskScheduler and no silent push (verified: zero grep hits
repo-wide). A `setInterval` in the WebView dies when the app backgrounds — not autonomy.

So: **server computes → widget process refreshes → Safari enforces.**

```
focus_blocks + schedule_block_{apps,sites} + unlock_rules + blocked_{sites,apps} + time_entries
        │
        ▼  focus-evaluate edge function, pg_cron every 5 min   ← the brain
   blocking_state(user_id, effective_domains, effective_processes, reasons, today_minutes, computed_at)
        │
        ├── iPhone: FocusBlockerWidget TimelineProvider → App Group → WKContentRuleListStore → Safari
        └── Mac:    modules/blocking.rs → /etc/hosts + process kill
```

**No client re-derives policy.** That is the invariant. Same shape as the Vellafit
bridge (`bodyscan-sync`): device does the cheap thing, server thinks on a schedule.

## Landed

- **main `bf11ea7`** — foundation. `src-tauri/src/timetracker/` (Rest client + 5 stub
  submodules, all commands pre-registered in `lib.rs`), `src/lib/timetracker/index.tsx`
  barrel (mounted in App.tsx/main.tsx), `project.yml` widget target gets WebKit +
  SafariServices, `supabase/migrations/` conventions.

- **PR #7** unit 1 — schema migrations (SQL only, **not applied**)
- **PR #8** unit 9 — restored `nexus-local_SafariBlocker` extension target. App-ID budget now 3/10.
- **PR #9** unit 5 — blocking management UI
- **PR #10** unit 3 — timer panel
- **PR #11** unit 8 — `focus-evaluate` evaluator + Rust read side
- **PR #12** unit 2 — session recording. Adds a compare-and-swap on the row `id` for every
  mutation: `active_sessions` is keyed by `user_id` alone, so between read and write another
  device can stop that session and start a different one under the same key.

## Not done

- **units 4, 6, 7, 10, 11, 12** — paused mid-work, stopped to save resources.
  Worktrees + branches intact under `.claude/worktrees/agent-<id>`; resume with
  SendMessage rather than restarting:

  | unit | agent id | what |
  |---|---|---|
  | 4  | a52c4c1d0a29834af | pomodoro (Rust config + TS phase machine) |
  | 6  | ab3b91681f1d7a641 | focus schedules |
  | 7  | a442207bf11537222 | rewards |
  | 10 | aac8c44f03db2a31e | FocusBlockerWidget — **the autonomy mechanism**; reported "all three gates pass" before stopping |
  | 11 | ab6a44ceb195c6cca | session widget + AppIntent + session-toggle edge fn |
  | 12 | a2265df2f905413b1 | Mac enforcement parity |

## Open issues found by workers

1. **`unlock_rules.enabled` has no writer.** TimeTracker's `sync/blocking.rs` omits it
   from push and pull, so a rule disabled on the desktop still grants server-side — and
   a granted unlock strips its target from the effective sets. **Fails in the unsafe
   direction: the phone unblocks what the desktop considers locked.** Owner: unit 7's
   `rewards.rs`. Not yet fixed.

2. **`time_entries.start_time` holds two formats** — naive local strings (TimeTracker
   SQLite era) and RFC3339-with-offset (new writes). A 00:30-local session stores as
   `T22:30+00:00` and lands on the previous local day → `today_minutes` reads low and
   unlocks never fire. Handled in unit 8's `entryLocalDate()`; anything else parsing
   those columns must do the same.

3. **App Group may not survive SideStore re-signing.** Commit `bbf60f1` recorded
   `ctr:NIL` on-device. The whole Safari-enforcement chain depends on it.
   **User action: open Nexus Local on the phone, read the `ctr:` value in the
   KeychainDebug panel.** If NIL, on-phone blocking degrades to "refreshes when you open
   the app" until a paid Apple Developer account; unit 12's Mac enforcement carries it.

4. **Never seed a `blocking_state` row.** A missing row means "no verdict computed yet",
   which is different from "computed, nothing blocked". Seeding zeros would make
   "blocking silently switched off" look identical to "nothing qualifies right now".
   Every consumer treats a missing row as unknown.

## Environment gotchas (cost several agents real time)

- `npm run dev:nexuslocal` is bare `vite` — opens no Tauri window. Use `npx tauri dev`.
- xcodebuild config is lowercase `debug`, not `Debug`.
- A fresh worktree can't link the app until `gen/apple/NexusLocalWidgets/Secrets.swift`
  is copied in (gitignored).
- `gh` and `xcodegen` live in `/opt/homebrew/bin/`, not on PATH.
- The `code-review` skill is **unavailable** in worker context (`disable-model-invocation`).
- **Resource caps applied this session:** `~/.cargo/config.toml` has `jobs = 2` (12
  parallel worktree builds drove load to 163 on 8 cores). `cargo clean` on the main repo
  freed 22.4 GB after the disk hit 100%. **Still to do: set a shared `CARGO_TARGET_DIR`**
  before any future batch — it serializes builds via cargo's lock and stops each worktree
  hoarding ~2 GB. Held off mid-flight because switching forces a full rebuild.

## Release sequence (after PRs merge)

1. Apply migrations (`supabase/migrations/APPLY.md`), deploy `focus-evaluate`, schedule
   pg_cron. Nothing has been applied or deployed yet.
2. Set `WIDGET_SESSION_KEY` repo + function secret (unit 11).
3. Bump version in **all three** places in lockstep: `tauri.conf.json`, `Cargo.toml`,
   `gen/apple/project.yml` (`CFBundleShortVersionString` **and** `CFBundleVersion`).
   Drift here is a documented bug — the untracked Info.plist already sits at 0.10.0.
4. `git tag nexuslocal-v0.12.0 && git push origin nexuslocal-v0.12.0`
5. SideStore update tap → enable Settings → Safari → Extensions → Content Blockers.
