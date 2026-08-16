# focus-evaluate

Collapses every blocking rule into **one materialized verdict row per user**, on
a schedule, so that blocking keeps working while every device is asleep.

```
blocking_state(user_id text pk, effective_domains jsonb, effective_processes jsonb,
               reasons jsonb, today_minutes integer, computed_at timestamptz)
```

## Why this exists

Nexus Local is sideloaded via SideStore on a free Apple developer account. That
means no `BGTaskScheduler`, no silent push, and no background execution beyond
`bluetooth-central`. A `setInterval` in the WebView dies the moment the app
backgrounds — so any policy computed on the phone stops being computed as soon
as the phone is in a pocket, which is exactly when blocking needs to hold.

So the phone does not decide. It reads.

`focus-evaluate` runs on pg_cron every 5 minutes, resolves schedule windows,
reward unlocks and `focus_only` modes, and writes the answer. Every client —
the iPhone widget's `TimelineProvider`, the Mac grid node, the app UI — reads
`blocking_state` and acts on it. None of them re-derive it.

This is the same split as the Vellafit bridge
(`apps/Protocol/supabase/functions/bodyscan-sync`): the device dumps raw facts,
the server does the thinking on a schedule.

## What it reads

| Table | Columns |
|---|---|
| `blocked_sites` | `user_id, domain, enabled` |
| `blocked_apps` | `user_id, display_name, process_name, block_mode, enabled` |
| `focus_blocks` | `user_id, name, start_time, end_time, days_of_week, color, enabled` |
| `schedule_block_apps` | `block_id, process_name` |
| `schedule_block_sites` | `block_id, domain` |
| `unlock_rules` | `user_id, process_name, domain, required_minutes, enabled` |
| `meal_sessions` | `user_id, meal, started_at, ends_at` — only rows with `ends_at > now` |
| `meal_unlock_targets` | `user_id, meal, domain, process_name` |
| `time_entries` | `duration_seconds` — today's completed entries only |
| `active_sessions` | `paused_at` — to decide `focus_only` |

## The rules

Ported from `tick()` in
`apps/TimeTrackerApp/src-tauri/src/blocker/mod.rs`, which remains the authority.

- **`today_minutes`** — `SUM(duration_seconds) / 60` (integer division) over
  `time_entries` starting today *in local time* with `end_time IS NOT NULL`.
  An in-flight session contributes nothing until it is stopped.
- **Permanent blocks** — an enabled `blocked_sites` / `blocked_apps` row blocks
  its target. `block_mode = 'focus_only'` on an app means blocked **only while a
  timer is currently running** (an `active_sessions` row with a null
  `paused_at`) — the inverse of what the name suggests to most readers.
- **Schedule windows** — a focus block is active when today's ISO weekday
  (1=Mon…7=Sun) appears in `days_of_week` **and** local time is inside
  `[start_time, end_time)`. **Overnight windows wrap**: when
  `start_time > end_time`, active means `now >= start || now < end`. Schedule
  blocking applies regardless of any global permanent-block toggle.
- **Unlock rules** — an enabled rule whose `required_minutes <= today_minutes`
  **removes** its target from the effective sets, overriding both permanent and
  schedule blocking. Nothing is deducted: it is a daily threshold, not a
  balance, and it resets at local midnight purely because `today_minutes` is
  date-scoped.
- **`reasons`** — a per-target explanation for the UI. **Display only, never
  load-bearing.** Blocked targets with an unmet unlock rule also carry
  `unlock_required_minutes` / `today_minutes` so the UI can render "38 / 60 min"
  without a second query.

### Two ported behaviours worth knowing about

**The weekday tested is that of _today_, not of the day an overnight window
opened.** A 22:00–06:00 block scheduled Mondays only is *not* active at 01:00 on
Tuesday. That is what the original does; it is pinned by a test so nobody
"fixes" it into an unannounced behaviour change.

**There is no server-side global blocker toggle.** `tick()` gates permanent
blocks on `app_blocker::is_blocker_on()`, a local SQLite setting with no
Supabase equivalent. Permanent blocks are therefore treated as unconditionally
on here: per-row `enabled` already carries per-target enablement, and the
device-level opt-in now lives in NexusLocal's `config.rs` (`blocking_enabled`),
gating *enforcement on the client* rather than *computation on the server*.

## Timezone

**Hardcoded to `Europe/Copenhagen`.**

This is a single-user personal system and saying so plainly beats pretending
otherwise. There is no per-user timezone column, and inventing one would be a
schema fiction with exactly one row in it.

It matters because `focus_blocks.start_time`/`end_time` are local `"HH:MM"` and
`time_entries.start_time` is a naive local timestamp string with no offset
(TimeTracker's SQLite legacy — all 260 live rows look like
`2026-07-02T18:44:30.059`). The function runs in UTC. Comparing those local
strings against UTC shifts every window by 1h in winter and 2h in summer, and
moves the "today" boundary for reward unlocks. That is a real off-by-hours bug,
not a theoretical one.

The approach: resolve *now* into a local calendar date and a local minute-of-day
**exactly once** via `Intl.DateTimeFormat` with an explicit zone, then do every
comparison in that local space. Entries are never converted — their date prefix
is matched against the local date string.

To change the zone, edit `TIMEZONE` in `logic.ts`. It is the only place it
appears.

Two details that are easy to get wrong and are covered by tests:

- `hourCycle: "h23"`, not `hour12: false` — the latter renders midnight as `"24"`
  under some ICU builds, which puts the minute-of-day at 1440 and makes every
  normal window read as already-ended for the first hour of the day.
- **`time_entries.start_time` holds two formats**, and `entryLocalDate` handles
  both:
  - *naive local, no offset* — `2026-07-02T18:44:30.059`. TimeTracker's SQLite
    era; all 260 rows live today. Some legacy rows use a space separator
    instead of `T`.
  - *RFC3339 UTC with an offset* — `2026-08-05T22:30:00+00:00`. What
    `now_rfc3339()` in NexusLocal's `timetracker/mod.rs` produces, which is what
    new writes use.

  Treating the second kind as naive is a real off-by-hours bug: a 00:30-local
  session stores as `…T22:30:00+00:00` and would land on the previous local day,
  so `today_minutes` reads low and unlocks never fire. Offset-bearing strings are
  parsed as instants and projected into the zone; everything else is already
  local and its date prefix is taken verbatim.

### Why the query is a range, not a `LIKE`

The `(user_id, start_time)` btree from work unit 1 only helps range comparisons
over ISO-8601 text ordering — `LIKE '2026-08-05%'` cannot use it. So the query
uses `>= '<yesterday>' AND < '<tomorrow+1>'` with **whole-date bounds**, which is
also separator-agnostic (a legacy `2026-08-05 18:44` row sorts inside day-granular
bounds whether the separator is a space, 0x20, or `T`, 0x54).

Because two timestamp formats coexist, no single SQL predicate can select exactly
one local day. The widened ±1-day range is a cheap superset; `entryLocalDate`
then decides membership exactly, in TypeScript.

Rows with a NULL `user_id` are included for the default user — the 252 legacy
TimeTracker rows carry NULL and belong to `'default'`, and `user_id = 'default'`
alone would not match them.

## Guarantees

- **Idempotent** — upserts on `user_id`. Two back-to-back runs produce identical
  *policy* columns (`effective_domains`, `effective_processes`, `reasons`,
  `today_minutes`); `computed_at` necessarily moves.
- **Clobber-safe** — the only table written is `blocking_state`, and it touches
  no column it does not own. Same posture as `bodyscan-sync`.

  "Sole writer" is a **convention, not an enforced constraint**: `blocking_state`
  carries the project-wide permissive anon RLS policy (`USING (true) WITH CHECK
  (true)`), so any client holding the anon key *can* write it. Nothing detects a
  client that does, and such a client would be a second source of truth that
  disagrees the moment the device sleeps. Tightening this to
  `for select to anon` + `for all to service_role` is the right move whenever the
  productivity stack's RLS posture is revisited — it is deliberately left
  matching its siblings for now rather than diverging one table.
- **Fails loudly** — every query error aborts with a 500 **before any write**.
  An empty `effective_domains` because a query errored is indistinguishable from
  "nothing is blocked", and the failure mode is that blocking silently switches
  off. A partial state is never written; the previous verdict stands. Stale
  blocking beats absent blocking.

  Concretely: `unlock_rules.enabled` is selected explicitly rather than via
  `select("*")` plus a default, so a missing column is a loud 400 instead of a
  silent "every rule is active" that hands out every unlock. Likewise a 404 from
  `schedule_block_apps` / `schedule_block_sites` aborts rather than evaluating
  every focus block as blocking nothing.

## Layout

| File | Role |
|---|---|
| `index.ts` | `Deno.serve` handler — I/O, validation, the write |
| `logic.ts` | all pure decision logic, plus the timezone decision |
| `index_test.ts` | Deno tests |

The split exists so the tests can import the logic without `Deno.serve` binding
a port at module scope and hanging the test run.

## Deploy

```bash
supabase functions deploy focus-evaluate --project-ref efxmzsdisaymtpebaxlp
```

Deploy **before** applying the migration, otherwise every cron tick 404s until
you do.

## Schedule

`supabase/migrations/20260805160000_focus_evaluate.sql` registers the pg_cron
job `nexus-focus-evaluate` at `*/5 * * * *`. **That is all it does** — the
tables and columns belong to work unit 1 and must be applied first:

| File | Provides |
|---|---|
| `20260805120000_blocking_state.sql` | the table this writes |
| `20260805120200_schedule_block_targets.sql` | `schedule_block_apps` / `schedule_block_sites` |
| `20260805120300_unlock_rules_enabled_and_evaluator_indexes.sql` | `unlock_rules.enabled` + the evaluator indexes |

The migration asserts both preconditions (`blocking_state` exists,
`unlock_rules.enabled` exists) and raises a named exception rather than
registering a job that would fail silently every 5 minutes.

Apply per `supabase/migrations/README.md`:

```bash
supabase link --project-ref efxmzsdisaymtpebaxlp
supabase db push
```

Rollback: `select cron.unschedule('nexus-focus-evaluate');`

Check the job and its history:

```sql
select jobid, jobname, schedule, active from cron.job where jobname = 'nexus-focus-evaluate';
select status, return_message, start_time from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'nexus-focus-evaluate')
 order by start_time desc limit 5;
```

## Invoke manually

The computed state comes back as JSON, so it can be inspected without reading
the table:

```bash
curl -sS -X POST \
  "https://efxmzsdisaymtpebaxlp.supabase.co/functions/v1/focus-evaluate" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' | jq
```

Response:

```json
{
  "ok": true,
  "timezone": "Europe/Copenhagen",
  "computed_at": "2026-08-05T14:05:00.000Z",
  "local": { "date": "2026-08-05", "minutes": 965 },
  "states": [
    {
      "user_id": "default",
      "effective_domains": ["youtube.com"],
      "effective_processes": [],
      "reasons": {
        "youtube.com": { "blocked": true, "source": "focus_block", "block_name": "Deep work" },
        "reddit.com": { "blocked": false, "source": "unlock_rule", "required_minutes": 60, "today_minutes": 72 }
      },
      "today_minutes": 72,
      "computed_at": "2026-08-05T14:05:00.000Z"
    }
  ]
}
```

A failure returns `{"error": ..., "detail": ..., "wrote": false}` with a 500.

## Test

```bash
deno test supabase/functions/focus-evaluate/index_test.ts
deno check supabase/functions/focus-evaluate/index.ts
```

Coverage includes a normal window; an overnight window at 23:00, 01:00 and
12:00; window boundary inclusivity; a non-matching weekday; the
`"11,2".includes("1")` substring trap; an unlock at exactly the threshold and one
minute under; `focus_only` with and without a running session; the overnight
weekday quirk; and the DST-sensitive timezone resolution.

## Consumer

`apps/NexusLocal/src-tauri/src/timetracker/blocking_state.rs` — the `tt_blocking_state`
Tauri command. It is read-only, and it returns an **error** rather than an empty
state when no row exists, so a caller cannot read "never computed" as
"nothing blocked".

`blocking_state` is deliberately not seeded, so this error is expected on a fresh
install until the first cron tick (≤5 minutes). It means *no verdict yet*; per
the schema's guidance, clients should block nothing until a verdict exists, and
UI should render "not computed yet" rather than "nothing blocked".
