# CLAUDE.md — PathFinder

Loaded automatically when working under this directory. Cross-cutting rules
(Supabase removal ordering, RLS posture, iOS deployment, environment gotchas)
live in the root `CLAUDE.md`.

## PathFinder: Supabase Backend

PathFinder migrated from local SQLite (via `tauri-plugin-sql`) to **Supabase** as the primary data store on 2026-04-25 (commit `efa8a64`). All `pf_*` tables live in the NEXUS Supabase project (`efxmzsdisaymtpebaxlp`).

**Setup** (per developer, per machine):

1. Copy `apps/PathFinder/.env.example` → `apps/PathFinder/.env`.
2. Fill in `VITE_SUPABASE_ANON_KEY` from Supabase dashboard → Project Settings → API. The legacy anon (JWT) key and the new `sb_publishable_*` key both work.
3. `.env` is gitignored — never commit it.

**Current sync model — read this before assuming anything:**

- Every CRUD call in `src/lib/api/` goes directly to Supabase. No local cache, no offline support — if the network drops, every operation throws.
- **Auth is live.** Rows are scoped to `auth.uid()` (see "RLS posture" below). This
  paragraph used to say auth was disabled with a hardcoded `USER_ID = "default"`;
  that stopped being true and the stale claim was misleading sessions until 2026-11-23.
- No realtime subscriptions — multi-device awareness only on refresh (the Week's
  Protocol items and reminders also reload on window focus).
- Last-writer-wins on concurrent edits; no conflict detection.
- The Rust SQLite plumbing (`src-tauri/src/{db,commands}.rs`) is **dead code** — left in tree for now but no longer called from the frontend.

**PathFinder data layer** (`apps/PathFinder/src/lib/`):
- `supabase.ts` — creates the shared client from `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` env vars.
- `api/` — **a directory, not a file.** Every data function calls Supabase
  directly. Split into twelve domain modules (`tasks`, `calendar`, `daily`,
  `courses`, `training`, `week`, `goals`, `plans`, `systems`, `notes`, `games`,
  `misc`) plus `_shared.ts`, which holds the client, `err`/`num`, **every row
  mapper**, and the `TASK_SELECT` constants. `api/index.ts` re-exports the lot,
  so every `from "../lib/api"` still resolves and no call site changed.

  It was one 3,142-line file until 2026-08-21. Keeping the mappers and
  `TASK_SELECT` together is the point: a `pf_tasks` read that omits the
  `pf_task_planning` embed does not fail, it silently yields default urgency and
  stage — and that mistake was sitting in four separate places because the file
  was too big for anyone to see the others.

**Pure logic lives outside components, and is tested.** `taskTree.ts` (breakdown
roll-ups, coverage, the gate), `systems.ts` (the one due-rule), `nextUp.ts` (the
"work on now" ranking) and `coverage.ts` are React-free on purpose. `npm test`
in `apps/PathFinder` runs vitest over `src/**/*.test.ts` — 78 cases, each drawn
from a bug that actually happened rather than for coverage. Add to these before
touching the rules they encode.

**Page components live in `components/dashboard/` and `components/week/`.**
`Dashboard.tsx` (382 lines) and `Week.tsx` (880) are now state + layout only.
Watch for the trap that splitting them exposed: constants declared *between*
components get swept into whichever neighbour precedes them, so anything shared
belongs in that folder's `_shared.ts`.

Required `.env` file at `apps/PathFinder/.env` (gitignored):
```
VITE_SUPABASE_URL=https://efxmzsdisaymtpebaxlp.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from Supabase dashboard>
```

⚠️ **RLS posture — this section was stale and is corrected here.** It used to say
every `pf_` table carried a permissive `anon` policy (`USING (true)`) pending some
future auth work. **PathFinder's auth is live.** `pf_tasks` and its neighbours are
scoped to `auth.uid()` for the `authenticated` role, which is why `api.ts` reads them
with the session client and why `apps/NexusLocal/src/lib/pathfinder/api.ts` says
"`supabase`, not `supabasePublic`" at the top.

This mattered in practice: correct code comments asserting owner-scoping were being
"corrected" against this paragraph. The tables still carrying `USING (true)` are the
thirteen productivity/grid ones — `time_entries`, `blocked_sites`, `focus_blocks` and
company — enumerated in `SECURITY_RLS_MIGRATION.md`. Those are the defect. The `pf_`
tables are not.

The exception worth knowing is `pf_cal_blocks`, which additionally carries an anon
read policy so the iOS widgets can render a day without a JWT.

**Computed fields**: `pf_goals_with_counts` and `pf_plans_with_counts` are
Postgres views (both `security_invoker = on` — without it a view bypasses the
base table's RLS and would publish every user's task titles). Streaks and
`recent_dates` are still resolved client-side.

**Recurring calendar blocks**: `pf_recurring_cal_blocks` stores the rules;
`getCalBlocks()` expands them into virtual `CalBlock` entries client-side
(stable negative IDs derived from `recurring_id × 100 000 + dayOffset`).

**`user_id` convention**: all root-level tables carry `user_id TEXT DEFAULT
'default'`. When Supabase Auth is added, replace `'default'` with
`auth.uid()` and update RLS policies accordingly.

### PathFinder tasks are an ISA hierarchy, not one wide table

`pf_tasks` is a **supertype**. Each kind of task has its own subtype table, and
they are deliberately unequal in size — this is the whole point, so do not
"simplify" it back into nullable columns on `pf_tasks`:

| discriminator | subtype table | columns |
|---|---|---|
| `task` | `pf_task_planning` | urgency, stage, completion_mode, target_count, notes |
| `reminder` | `pf_task_reminders` | remind_at, lead_minutes |
| `chore` | `pf_task_chores` | area, rotation_days |
| `shopping` | `pf_task_shopping` | quantity, store |

`task_type` is a **generated column** (`coalesce(category, 'task')`), so it can
never drift from the `category` that existing writers — the `task-quick` edge
function, the iOS widgets, Nexus Local — already set. Nothing had to change to
adopt it.

What belongs where is a modelling call: `priority`, `due_date` and
`time_estimate` stay on the supertype because they mean something for a chore
("medium, 15 min, by Friday"). `stage` and `completion_mode` do not — a reminder
has no lifecycle to gate and nothing to measure.

Specialization is **disjoint** (a trigger refuses a subtype row whose supertype
has the wrong `task_type`) and **total for `task`** (a trigger materialises the
planning row, and drops it if the task is re-typed to a sparse kind — demotion is
lossy by construction). Read tasks with the embed `*, pf_task_planning(*)`:
PostgREST returns an object for a full task and **`null`** for the sparse kinds,
which is exactly the ISA shape. `api.ts` `splitPatch` routes a flat patch to the
right relation so callers never have to know; `taskTree.ts` `applyTaskPatch` is
its client-side mirror for optimistic updates — spreading a patch containing
`urgency` straight onto a task sets a dead property, and the matrix pad appears
frozen until the refetch lands.

### Goals are reached from the task, not only through plans

`pf_tasks.goal_id` points at a goal directly. The original model was goal → plan
→ task only, and that chain went **unused**: of 162 root project tasks 48 carried
a plan, and of 15 plans **zero** carried a `goal_id`. No task could reach a goal,
so `pf_goals_with_counts` — which joins through plans — counted nothing and every
goal sat permanently at 0%. The bars could never move. If a goal reads 0%, check
the linkage before suspecting the renderer.

A **direct** goal beats the one inherited via plan. It is the more specific
statement, and preferring it is what stops a task that reaches a goal both ways
being counted twice. The view and `mapTaskWithContext` implement the same
precedence deliberately — if they diverge, the header and the board disagree.

Only **root, non-quick** tasks count toward a goal. Counting steps would mean
breaking a task into five pieces inflates its goal's denominator from 1 to 6 —
the same class of bug that made the dashboard's open-task pill grow the more
carefully you planned. `ON DELETE SET NULL`, never CASCADE: deleting a goal must
not delete the work aimed at it.

⚠️ `pf_tasks` now reaches `pf_goals` **two ways**, so PostgREST refuses an
ambiguous embed — `TASK_SELECT_CTX` disambiguates with
`pf_goals!pf_tasks_goal_id_fkey`.

### One recurrence engine: Systems, with two kinds of cadence

`pf_systems.frequency` accepts `daily` / `weekly` / `monthly` — **calendar**
recurrence, due-ness follows the date — and `interval` (+ `interval_days`) —
**since-completion** recurrence, due-ness follows `last_done` and the schedule
floats with behaviour. Wash the clothes on Friday instead of Tuesday and the next
one moves with you; `weekly` cannot express that, which is why chores promote
into an interval system rather than growing a second engine on `pf_tasks`.

The due rule lives **only** in `lib/systems.ts`. It was previously written out
three times (QuickPanels, Week, `getTodayFocus`) and the copies already disagreed
about monthly and about unknown frequencies. A CHECK constraint enforces the
pairing so an `interval` system cannot exist without a positive `interval_days`
(which would read as due forever) and a calendar frequency cannot carry one.

**Three more traps in the task model:**

- **`aggregate_estimate` is trigger-maintained; never write it.** `time_estimate`
  is what a task claims for *itself*, and stops being true the moment it is
  broken down. The trigger keeps `aggregate_estimate` = sum of children's
  aggregates (or own estimate for a leaf) up the whole ancestor chain, so
  `select *` gives every consumer the real total. `taskTree.ts`'s
  `rollupEstimate` mirrors that rule **exactly** — an unset estimate contributes
  0, not a guessed default. If the two rules diverge the number visibly jumps on
  refresh.
- **The scheduling gate lives in `api.ts` `setTaskStage`, not in the database.**
  A task cannot reach `stage = 'active'` without calendar minutes behind it. The
  predicate spans three tables, so a trigger evaluating it on every task write
  would tax unrelated bulk updates (reorder writes one row per task). That means
  it is only enforced through that one function — add new stage writers there.
- **Partial scheduling needs no new table.** A task may have many
  `pf_cal_blocks` rows, and `pf_recurring_cal_blocks` now carries `task_id` too,
  so "4h of a 6h task is committed" is just a sum. Recurring series are counted
  by *occurrence* over a bounded 365-day horizon — an open-ended series would
  otherwise contribute infinite scheduled time.
- **`pf_task_sessions.cal_block_id` is not a foreign key, and its unique index
  is not partial.** Ticking a *recurring* occurrence off stores the occurrence's
  **virtual negative id** (`-(recurring_id × 100 000 + dayOffset)`), for which no
  row exists — that is what stops one Wednesday's tick marking the whole series.
  The `(task_id, cal_block_id)` index was first written partial (`where
  cal_block_id is not null`) and the upsert failed outright: PostgREST cannot
  infer a partial index for `on_conflict`. Same trap as garmin-import's
  `(user_id, external_id)`, same fix — drop the WHERE. NULLs are distinct anyway,
  so freehand sessions stay unconstrained.

**Working a task** happens on the calendar surfaces, not in the planner: a block
with a `task_id` renders a tick in Week and Dashboard, and ticking it logs a
session. That is the only thing that advances `sessions`- and `time`-mode
completion, so a recurring step that is never ticked never finishes no matter how
often it is scheduled.

### Synced blocks: Protocol items on PathFinder's calendar

Trainings, runs, meals, supplement stacks and routines (habit stacks) are
scheduled, ticked, moved and deleted from PathFinder's Week and Dashboard —
and **Protocol owns every one of them**: the item, its date, its time and
whether it is done. PathFinder keeps no copy. `@nexus/core/protocol`
(`packages/nexus-core/src/protocol/`) projects Protocol rows into
`SyncedItem`s and writes straight back to those rows, so "ticked here, ticked
there" is not a feature to maintain — there is one tick. Migration
`20261123120000_protocol_synced_schedule.sql` added the time columns (all
additive).

- **They are a `syn` kind in the time grid, never `pf_cal_blocks`.** Task
  sessions, missed-block marks, Stats adherence and the scheduling gate all
  key on cal-block ids; a Protocol item pretending to be one would trip every
  one of them.
- **The STACK is the schedulable unit** for routines and supplements
  (`scheduled_time`/`duration_min`/`repeat_days` on `protocol_{habit,supplement}_stacks`,
  mirroring `protocol_habits`). A routine with no stack time falls back to its
  earliest habit's time; with neither it is unscheduled and draws nothing.
  Recurring items can change time but not day — Protocol has no per-occurrence
  override, so "move Tuesday's" would silently move all of them.
- ⚠️ **Protocol weekdays are Monday = 0**, PathFinder's recurring blocks are
  Sunday = 0. `protocolWeekday()` is the Protocol one.
- ⚠️ **`external_id IS NULL` does not mean "planned".** ~165 `Synced from Oura`
  and ~120 Strava rows have none. `recordedBy()` marks importer rows, which
  cannot be moved, deleted or un-done from PathFinder — the importer would put
  them back (oura-sync deletes and re-inserts its window). Its markers are
  asserted equal to `garmin-import/match.ts`'s `isImportedRow`.
- **Each domain loads atomically and fails visibly.** Habits without their
  completions would render every routine as untouched; a failed domain shows
  a banner instead of an empty day.
- `pf_training_*` and `pf_daily_habits` are PathFinder's own earlier models of
  the same things, effectively unused (4 sessions, last April; 0 habits). They
  are superseded by this, not yet removed — removals are strictly ordered.

### Reminders on the calendar

Timed reminders (`pf_task_reminders.remind_at`) render in Week and the
Dashboard day calendar as a `rem` kind — the same seam as `syn`, and for the
same reason: they are not `pf_cal_blocks`. Unlike synced blocks they are
PathFinder's own data, so they go through `lib/api` (`getRemindersInRange`,
`saveTaskSubtype`, `toggleTask`), not `@nexus/core/protocol`.

- **A reminder is a point, drawn as a marker** `REMINDER_MARKER_MIN` tall so it
  can be seen and clicked; it claims no duration.
- **Colour comes from `reminderStatus`**, the same rule as the sidebar badge, so
  "soon" there is amber here.
- **Ranges are local days** (`localDayBounds`): comparing the timestamptz against
  bare dates would use UTC days and put a 00:30 reminder on the day before.
- **No double rendering:** a reminder with a time on its due date is dropped
  from that day's all-day task chips.
- "Clear time" keeps the reminder and takes it off the calendar; it stays in the
  Reminders panel.
