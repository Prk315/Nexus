-- Synced blocks: Protocol items scheduled and completed from PathFinder.
--
-- Protocol OWNS each item, its date, its time and whether it is done.
-- PathFinder renders these rows as blocks on its calendar and writes back to
-- them; it keeps no copy. One copy of every fact is what makes "the progress
-- between applications is synced" true by construction rather than by a
-- reconciliation job that can fall behind.
--
-- Every change here is ADDITIVE and nullable, so it is safe against deployed
-- code in any order (see "schema REMOVALS are strictly ordered" in CLAUDE.md):
-- an older Protocol build simply ignores the new columns.
--
-- Time-of-day columns are `time`, matching `protocol_habits.scheduled_time`,
-- and weekday arrays use HABITS' convention — Monday = 0 … Sunday = 6, null =
-- every day — NOT pf_recurring_cal_blocks' 0 = Sunday. The stack columns
-- mirror the habit columns exactly so one expansion rule serves both.

-- ── Dated items: a time of day on the existing row ───────────────────────────

alter table public.protocol_workout_sessions
  add column if not exists start_time time;

alter table public.protocol_running_sessions
  add column if not exists start_time   time,
  add column if not exists duration_min integer;

-- Per entry, but written per SLOT: a meal block is every entry sharing
-- (date, slot), and moving it rewrites all of them. NULL means "the slot's
-- default time", which the client supplies — absent is not a time.
alter table public.protocol_meal_plan_entries
  add column if not exists start_time time;

-- ── Recurring items: the STACK is the schedulable unit ───────────────────────
--
-- A morning routine is a habit stack; "Morning With Breakfast" is a supplement
-- stack. Scheduling the stack — not each habit or pill — is what puts one
-- block on the calendar with its parts ticked inside it.

alter table public.protocol_habit_stacks
  add column if not exists scheduled_time time,
  add column if not exists duration_min   integer,
  add column if not exists repeat_days    integer[];

alter table public.protocol_supplement_stacks
  add column if not exists scheduled_time time,
  add column if not exists duration_min   integer,
  add column if not exists repeat_days    integer[];

-- A weekday outside 0..6 would silently never match; refuse it instead.
-- NOT VALID + VALIDATE keeps the lock short; every existing row is NULL.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'protocol_habit_stacks_repeat_days_range') then
    alter table public.protocol_habit_stacks
      add constraint protocol_habit_stacks_repeat_days_range
      check (repeat_days is null or repeat_days <@ array[0,1,2,3,4,5,6]) not valid;
    alter table public.protocol_habit_stacks validate constraint protocol_habit_stacks_repeat_days_range;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'protocol_supplement_stacks_repeat_days_range') then
    alter table public.protocol_supplement_stacks
      add constraint protocol_supplement_stacks_repeat_days_range
      check (repeat_days is null or repeat_days <@ array[0,1,2,3,4,5,6]) not valid;
    alter table public.protocol_supplement_stacks validate constraint protocol_supplement_stacks_repeat_days_range;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'protocol_running_sessions_duration_positive') then
    alter table public.protocol_running_sessions
      add constraint protocol_running_sessions_duration_positive
      check (duration_min is null or duration_min > 0) not valid;
    alter table public.protocol_running_sessions validate constraint protocol_running_sessions_duration_positive;
  end if;
end $$;

-- Range reads by date for the calendar. Workouts and runs already filter by
-- user + date in Protocol; the meal planner reads by user + date too.
create index if not exists protocol_workout_sessions_user_date_idx
  on public.protocol_workout_sessions (user_id, scheduled_date);
create index if not exists protocol_running_sessions_user_date_idx
  on public.protocol_running_sessions (user_id, date);
create index if not exists protocol_meal_plan_entries_user_date_idx
  on public.protocol_meal_plan_entries (user_id, date);
create index if not exists protocol_habit_completions_user_date_idx
  on public.protocol_habit_completions (user_id, date);
