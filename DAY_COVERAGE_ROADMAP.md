# Day Coverage Roadmap

Where the day-coverage work goes after the 2026-08-16 foundation. The goal in
one sentence: **every hour of the day is either measured, imported, or one tap
away from being logged — and the number that says so can be trusted.**

## What exists today (the foundation)

- `DayCoveragePanel` in Nexus Local: 24 h timeline of sleep (`protocol_sleep`
  bed/rise via its `widget_anon_read` anon policy), screen
  (`tt_usage_intervals` reading the local JSONL), planned (`pf_cal_blocks` +
  recurring), with an unaccounted-gaps list ≥ 30 min.
- Meal sessions log themselves into `pf_cal_blocks`, so they already count.
- Privacy rule in force everywhere below: **raw usage data never leaves the
  Mac.** Remote data is read *next to* it, not the other way around.

## Phase A — close the loop (quick wins) ✅ shipped 2026-08-16

All three landed: gap chips (A1), honesty checks + `coverage.ts` extraction
(A2), and the Garmin band end-to-end (A3 — migration applied, `garmin-import`
v8 deployed, anon policies live, and the first real run synced with a correct
`started_at` the same evening). Decision 1 was answered **yes** (workout start
times exposed to anon, matching the sleep precedent).

### A1. One-tap gap logging

The gap list becomes the logging surface: each gap row gets category chips
(shared `CATEGORIES` constant — see the Phase E note) plus a free-text option.
Tapping inserts a `pf_cal_blocks` row with the gap's times, the category as
title (and its PathFinder color), then refreshes — the gap disappears.

- Files: `DayCoveragePanel.tsx` only. Insert pattern identical to
  `MealsPanel`'s calendar log.
- Detail that matters: round gap edges to 5 min for the calendar row (a block
  "13:07–14:53" is measurement noise pretending to be precision), but keep the
  panel's own math on raw edges.
- Verify: tap a chip → row visible in PathFinder Week view → gap gone.

### A2. Honesty checks

Flag contradictions instead of silently overlapping:

- screen interval inside the sleep window → "screen during sleep 23:40–00:05";
- a planned block whose interior is > 50 % screen time, when the block's
  category implies offline (skip for blocks titled/categorised as work).

Pure client-side span intersection in `DayCoveragePanel.tsx`; render as amber
footnotes, never subtract from coverage (the point is trust, not punishment).

- Verify: unit-testable helpers (`intersect(spans, spans)`) — put them in a
  `coverage.ts` module with plain functions so they can be tested without
  React; move the existing `union/clip/gapsIn` there too.

### A3. Garmin workouts as a fourth band — schema first

**Blocker found 2026-08-16:** neither `protocol_workout_sessions` nor
`protocol_running_sessions` stores a start *time* — only a date and
`duration_min`. Garmin's payload has `startTimeLocal`; `garmin-import`
currently drops it. Order of work:

1. Migration: `ADD COLUMN IF NOT EXISTS started_at timestamptz` to both
   tables. Nullable — historical rows stay NULL and simply don't render as
   bands (date-only rows cannot be placed on a timeline honestly).
2. `garmin-import` edge function: map `startTimeLocal`/`startTimeGMT` →
   `started_at` for workouts and runs. Keep the vendored bridge copies
   (`apps/NexusLocal/modules/garmin/` and `apps/Protocol/garmin_bridge/`)
   identical if the bridge needs to emit the field, and `cp` to
   `~/.nexuslocal/modules/garmin/` after editing.
3. RLS: add `widget_anon_read`-style policies (same shape as
   `protocol_sleep`'s, same hardcoded owner uid) so the panel's anon client
   can read the two tables. ⚠️ **Decision needed** — this makes workout
   start times world-readable (public repo, committed anon key). It matches
   the existing sleep-times exposure, but say yes deliberately.
4. Panel: fetch sessions for the day where `started_at` is not null, render
   as a "Training" band (emerald), and count toward coverage. Old data can be
   backfilled by re-running a Garmin sync once the import maps the field
   (idempotent on `(user_id, external_id)`).

- Verify: after the next Garmin sync, a workout appears as a band at the
  right time and its gap is gone; a pre-migration row changes nothing.

## Phase B — history and suggestions ✅ shipped 2026-08-16

Both landed: `tt_usage_spans_range` (one call, 30 days, shared `app_intervals`
helper with the single-day command), `history.ts` (batched range queries +
the deterministic gap detector), the 30-day strip, and suggestion cards with
accept→`pf_recurring_cal_blocks` / dismiss→localStorage. Implemented by
subagents from written specs; two spec deviations accepted as correct
(range-scoped recurring rules need per-day start/end bounds; the empty-day
Rust test asserts count, not emptiness, because a live machine has real data).

### B1. Coverage history strip

A 30-day heatmap of coverage % under the timeline (same visual language as
`WeekStrip`).

- Rust: `tt_usage_spans_range(days: u32)` returning per-day app spans in one
  call (30 × `tt_usage_intervals` invokes is silly). Reuses `usage::read_day`.
- JS: two batched Supabase queries (sleep + cal blocks for the 30-day range,
  plus Garmin sessions after A3), then per-day coverage via the `coverage.ts`
  helpers. Cache per-day results in component state — past days are immutable,
  so recompute only today.
- Judged against full days for past dates; today shown but marked partial,
  exactly like `WeekStrip`.

### B2. Pattern-based suggestions

With B1's plumbing, detection is a fold over 7–14 days of gap lists: a gap
whose midpoint lands within ±30 min on ≥ 3 of the last 7 days (weekday-aware)
becomes a suggestion card — "12:00–12:30 is usually unaccounted. Recurring
'Lunch' block?" Accept inserts a `pf_recurring_cal_blocks` row (0=Sun weekday
numbering — PathFinder's, not ISO); dismiss remembers in `localStorage` keyed
by (start-bucket, end-bucket, weekday-set) so it never nags twice.

- Deliberately no ML, no server: the heuristic is inspectable and the data is
  already client-side.
- Verify: seed a week of synthetic gap history through the pure helpers in
  tests; the suggestion fires on 3/7 and not on 2/7.

## Phase C — plan vs. reality in PathFinder ✅ shipped 2026-08-17

Shipped: the JSONL reader (entry type, parser, path resolution, `read_day`)
lives in `packages/nexus-core/crate/src/usage_store.rs` with NexusLocal
re-exporting it (public surface unchanged, 169 tests still green); PathFinder's
revived Rust side exposes `pf_usage_spans`; the span math moved to
`packages/nexus-core/src/coverage.ts` behind a `@nexus/core/coverage` deep
alias (deliberately NOT the three.js-heavy barrel); and Week view gained an
off-by-default "Actual" toggle rendering sleep/screen/training behind the
blocks with the grid's own minute→pixel mapping. Desktop only — the toggle
lives in the desktop header; mobile is untouched.

Render the actual day faintly behind the planned blocks in PathFinder's Week
view: sleep band + screen spans as a background layer per day column.

- The privacy-preserving route: PathFinder runs on the same Mac, so its own
  Rust side reads the JSONL directly. Extract the JSONL reading/parsing from
  `apps/NexusLocal/src-tauri/src/usage.rs` into
  `packages/nexus-core/crate` (that crate exists precisely for shared Rust),
  then both apps depend on it. PathFinder gains one command:
  `pf_usage_spans(date)`.
- PathFinder's Rust is currently dead code — this revives it deliberately.
  Note in the file header that the frontend calls it again.
- Frontend: an opacity-0.15 layer in the day column behind blocks; a small
  "actual" toggle in the Week header so the calendar stays readable when you
  don't care.
- Sleep + Garmin come from Supabase (PathFinder already has the client); no
  new policies needed beyond A3's.
- Verify: same day rendered in both apps shows the same spans; a browser-only
  `vite` run (no Tauri bridge) degrades to plan-only without erroring.

## Phase D — iPhone coverage widget

A TimelineProvider showing today's coverage % and the biggest open gap.

- ⚠️ **Decision needed first, and it's the real content of this phase:** the
  screen component of coverage exists only on the Mac. Options:
  1. **Widget shows sleep + planned + Garmin only** (label it "logged
     coverage"). No privacy change at all. Ship this first.
  2. The Mac daemon publishes a **coarse daily aggregate** — `(user_id, date,
     screen_seconds, span_list_without_labels)`? No: even unlabeled span
     times reveal presence patterns. If anything is published, it is
     `screen_seconds` per day and nothing else, into a table with
     `usage_intervals`-grade RLS (auth-only reads, writes via a scoped-key
     edge function following the existing `usage-ingest` pattern). Gap *times*
     stay local forever.
- Widget work follows the established Pattern C: `TimelineProvider` in
  `gen/apple/NexusLocalWidgets/`, Supabase reads via `SupabaseClient.swift`,
  secrets generated in CI. Remember the SideStore caveats: no App Group, so
  no shared state with the app — the widget fetches for itself.
- Verify on-device via the KeychainDebug panel patterns; expect the usual
  free-tier re-sign friction.

## Phase E — categories, the unifying layer ✅ shipped 2026-08-21

Shipped in two commits. Part 1 (Nexus Local + schema): `coverage_categories`
(seeded from the constant, now in nexus-core behind `@nexus/core/categories`)
+ `app_category_map` applied live; `category` column on both cal-block tables,
stamped by gap chips / suggestion accepts / meal sessions; pure
`categoryTotals()` attribution in nexus-core (screen-beats-plan, per-category
union, sleep excluded; 9 vitest cases — the repo's first vitest suite);
`CategoryBreakdown` panel with daily totals, Monday-week (Europe/Copenhagen)
budgets on `weekly_target_min`, and the app→category mapping UI (decision:
map syncs via Supabase). Bonus: meal cards show Protocol's planned meal —
read-only, since the only anon write path for `logged` is the widget-key edge
function. Part 2 (PathFinder): category picker on block create/edit (category
color defaults the block color unless explicitly overridden; emoji prefix on
labels; update calls patch `category` only when passed so older Dashboard
call sites can't wipe it), plus two user-requested Week-view changes outside
the original roadmap: the grid is now a scrollable full 00:00–24:00 day
(fixing pre-existing last-hour clipping bugs), and sleep renders as an
always-on band split at midnight so bed/rise times read directly off the
grid. The blocker tie-in (unlock rules per category) remains deliberately
unbuilt.

- Schema: `coverage_categories(id, name, color, sort)` seeded with the same
  list Phase A's chips use (**this is why A1 must draw chips from a shared
  constant — those strings become rows here, no remapping**), plus
  `app_category_map(process_name → category)` and a nullable `category` column
  on `pf_cal_blocks` / `pf_recurring_cal_blocks` (title-prefix matching as
  fallback for old rows).
- Panel: per-category daily totals (screen spans → via app map; planned/
  Garmin blocks → via their category); a "time budget" config per category
  with a weekly target and a small budget-vs-actual bar.
- The blocker tie-in (unlock rules per category rather than per app) is a
  separate later decision — note it, don't build it here.
- App→category mapping lives in Supabase (it's config, not usage data) — app
  *names* are less sensitive than intervals, but it still widens what's
  world-readable under the current RLS posture; if that feels wrong, keep the
  map in `~/.nexuslocalrc` instead and lose cross-device sync. Decide at
  build time.

## Sequencing and effort

| Phase | Items | Depends on | Rough size |
|---|---|---|---|
| A | one-tap logging, honesty checks, Garmin band | — (A3 needs migration + import edit) | 1–2 sessions |
| B | history strip, suggestions | A (helpers in `coverage.ts`), A3 for accurate history | 1–2 sessions |
| C | PathFinder overlay | nexus-core crate extraction | 1–2 sessions |
| D | iPhone widget | decision on screen aggregates; ship option 1 regardless | 1 session + device testing |
| E | categories + budgets | A1's shared category list | 2–3 sessions |

## Open decisions (answer before the phase that needs them)

1. **A3:** OK to expose workout/run start times to the anon role (matches the
   existing sleep exposure)? If no: Garmin band waits for real auth in the
   panel, or for the RLS migration in `SECURITY_RLS_MIGRATION.md`.
2. **D:** publish per-day `screen_seconds` (one number, nothing else) to
   Supabase for the widget, or keep the widget to logged-coverage only?
3. **E:** category list itself (proposal: Deep work, Training, Reading,
   Social, Errands, Meals, Rest) and whether the app→category map syncs
   (Supabase) or stays local (`~/.nexuslocalrc`).
