-- PathFinder tasks become an ISA hierarchy: one supertype, four subtypes.
--
-- The previous migration hung every planning attribute off pf_tasks. That makes
-- a shopping-list item carry `completion_mode`, `target_count` and `stage` — six
-- columns of lifecycle machinery on a row that means "buy milk". This migration
-- splits the relation properly.
--
--   pf_tasks (supertype)  — what EVERY kind of task has:
--     identity, title, done, plan, parent, sort order, priority, due date,
--     time estimate, kanban status, and the `task_type` discriminator.
--
--     ├── pf_task_planning   (task_type = 'task')     ← the heavy subtype
--     │     urgency, stage, completion_mode, target_count, notes
--     ├── pf_task_reminders  (task_type = 'reminder') ← sparse
--     │     remind_at, lead_minutes
--     ├── pf_task_chores     (task_type = 'chore')    ← sparse
--     │     area, rotation_days
--     └── pf_task_shopping   (task_type = 'shopping') ← sparse
--           quantity, store
--
-- Which attributes belong on the supertype is a modelling call, not a
-- convenience one: `priority`, `due_date` and `time_estimate` stay on the base
-- because they are genuinely meaningful for a chore ("medium, 15 min, by
-- Friday") as much as for a project task. `stage` and `completion_mode` do not —
-- a reminder has no lifecycle to gate and nothing to measure — so they move down
-- into the planning subtype and a reminder simply has no row there.
--
-- `parent_id` stays on the supertype. Recursion is a structural relationship
-- between tasks-as-such, and a shopping list with sub-items is legitimate; the
-- deep recursive breakdowns will in practice only appear under 'task', but
-- nothing needs to forbid the others.
--
-- Specialization is DISJOINT (the discriminator picks exactly one subtype, and a
-- trigger refuses a subtype row whose parent has the wrong type) and TOTAL for
-- 'task' (a trigger creates the planning row automatically), so the planning
-- embed is never missing for a full task.

-- ── 1. The discriminator ────────────────────────────────────────────────────
--
-- `category` has always been the type tag: NULL meant "a real project task", and
-- the three named values meant the lightweight kinds. `task_type` promotes that
-- to an explicit, non-null discriminator — and does it as a GENERATED column so
-- it can never drift from `category`. Every existing writer (the task-quick edge
-- function, the iOS widgets, Nexus Local) keeps writing `category` and needs no
-- change at all.

alter table public.pf_tasks
  add column if not exists task_type text
  generated always as (coalesce(category, 'task')) stored;

create index if not exists pf_tasks_user_type_idx on public.pf_tasks(user_id, task_type);

-- ── 2. The planning subtype ─────────────────────────────────────────────────

create table if not exists public.pf_task_planning (
  task_id         bigint primary key references public.pf_tasks(id) on delete cascade,
  user_id         text    not null default 'default',
  -- The urgency axis, complementing pf_tasks.priority (which is importance).
  urgency         text    not null default 'medium',
  -- The lifecycle gate: 'active' is only reachable once calendar time exists.
  stage           text    not null default 'refine',
  -- What "complete" means. 'sessions' is what makes a *recurring* step
  -- completable — it is never done in one sitting.
  completion_mode text    not null default 'binary',
  target_count    integer,
  notes           text,
  constraint pf_task_planning_urgency_check
    check (urgency in ('high', 'medium', 'low')),
  constraint pf_task_planning_stage_check
    check (stage in ('refine', 'schedule', 'active', 'done')),
  constraint pf_task_planning_mode_check
    check (completion_mode in ('binary', 'sessions', 'time'))
);

create index if not exists pf_task_planning_user_stage_idx
  on public.pf_task_planning(user_id, stage);

-- ── 3. The sparse subtypes ──────────────────────────────────────────────────
--
-- Two and three columns each. That sparseness is the point: a reminder is a
-- title, a date and a bell, and modelling it as a full task with eleven unused
-- planning columns is what this migration exists to undo.

create table if not exists public.pf_task_reminders (
  task_id      bigint primary key references public.pf_tasks(id) on delete cascade,
  user_id      text not null default 'default',
  -- When to fire. Distinct from pf_tasks.due_date: a reminder for a deadline is
  -- typically set to nag *before* the thing is actually due.
  remind_at    timestamptz,
  lead_minutes integer
);

create table if not exists public.pf_task_chores (
  task_id       bigint primary key references public.pf_tasks(id) on delete cascade,
  user_id       text not null default 'default',
  -- Where in the home it happens ('kitchen', 'bathroom', …). Free text: this is
  -- a personal chore list, not a facilities-management system.
  area          text,
  -- How often it comes round again, in days. NULL = one-off.
  rotation_days integer
);

create table if not exists public.pf_task_shopping (
  task_id  bigint primary key references public.pf_tasks(id) on delete cascade,
  user_id  text not null default 'default',
  quantity text,
  store    text
);

-- ── 4. Disjointness ─────────────────────────────────────────────────────────
--
-- A subtype row may only attach to a supertype row of the matching type. Without
-- this the hierarchy is a suggestion, and 'buy milk' quietly acquires a lifecycle.

create or replace function public.pf_task_subtype_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actual   text;
  expected text := tg_argv[0];
begin
  select task_type into actual from public.pf_tasks where id = new.task_id;
  if actual is null then
    raise exception 'pf_tasks row % does not exist', new.task_id;
  end if;
  if actual <> expected then
    raise exception
      'task % is of type %, so it cannot have a % row',
      new.task_id, actual, tg_table_name;
  end if;
  return new;
end $$;

drop trigger if exists pf_task_planning_guard_trg   on public.pf_task_planning;
drop trigger if exists pf_task_reminders_guard_trg  on public.pf_task_reminders;
drop trigger if exists pf_task_chores_guard_trg     on public.pf_task_chores;
drop trigger if exists pf_task_shopping_guard_trg   on public.pf_task_shopping;

create trigger pf_task_planning_guard_trg
  before insert or update of task_id on public.pf_task_planning
  for each row execute function public.pf_task_subtype_guard('task');
create trigger pf_task_reminders_guard_trg
  before insert or update of task_id on public.pf_task_reminders
  for each row execute function public.pf_task_subtype_guard('reminder');
create trigger pf_task_chores_guard_trg
  before insert or update of task_id on public.pf_task_chores
  for each row execute function public.pf_task_subtype_guard('chore');
create trigger pf_task_shopping_guard_trg
  before insert or update of task_id on public.pf_task_shopping
  for each row execute function public.pf_task_subtype_guard('shopping');

-- ── 5. Totality for 'task' ──────────────────────────────────────────────────
--
-- Every full task gets its planning row automatically, so no caller has to
-- remember to create one and the planning embed is never unexpectedly null.
-- Re-typing a task reconciles: promoting to 'task' creates the row, demoting to
-- a sparse kind drops it. Demotion is lossy by construction — the attributes
-- being dropped have no meaning on the target type — so it is deliberately only
-- reachable by explicitly changing `category`.

create or replace function public.pf_tasks_sync_subtype()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.task_type = 'task' then
    insert into public.pf_task_planning (task_id, user_id)
    values (new.id, new.user_id)
    on conflict (task_id) do nothing;
  else
    delete from public.pf_task_planning where task_id = new.id;
  end if;
  return null;
end $$;

drop trigger if exists pf_tasks_sync_subtype_trg on public.pf_tasks;
create trigger pf_tasks_sync_subtype_trg
  after insert or update of category on public.pf_tasks
  for each row execute function public.pf_tasks_sync_subtype();

-- ── 6. Move the data down, then narrow the supertype ────────────────────────

insert into public.pf_task_planning (task_id, user_id, urgency, stage, completion_mode, target_count, notes)
select t.id, t.user_id,
       coalesce(t.urgency, 'medium'),
       coalesce(t.stage, 'refine'),
       coalesce(t.completion_mode, 'binary'),
       t.target_count,
       t.notes
from public.pf_tasks t
where t.task_type = 'task'
on conflict (task_id) do nothing;

-- The sparse kinds keep only what the supertype carries. Nothing is lost: these
-- rows never had planning attributes set to anything but the defaults.
alter table public.pf_tasks
  drop constraint if exists pf_tasks_urgency_check,
  drop constraint if exists pf_tasks_stage_check,
  drop constraint if exists pf_tasks_completion_mode_check;

drop index if exists public.pf_tasks_user_stage_idx;

alter table public.pf_tasks
  drop column if exists urgency,
  drop column if exists stage,
  drop column if exists completion_mode,
  drop column if exists target_count,
  drop column if exists notes;

-- ── 7. RLS — every subtype mirrors the supertype ────────────────────────────

alter table public.pf_task_planning  enable row level security;
alter table public.pf_task_reminders enable row level security;
alter table public.pf_task_chores    enable row level security;
alter table public.pf_task_shopping  enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'pf_task_planning', 'pf_task_reminders', 'pf_task_chores', 'pf_task_shopping'
  ] loop
    if not exists (
      select 1 from pg_policies where tablename = tbl and policyname = 'owner_all'
    ) then
      execute format(
        'create policy owner_all on public.%I for all
           using (user_id = (select (auth.uid())::text))
           with check (user_id = (select (auth.uid())::text))', tbl);
    end if;

    -- pf_tasks carries a widget_anon_read policy for the sideloaded iOS widgets
    -- (no App Group, no JWT — see CLAUDE.md). The planning subtype needs the same
    -- opening or a widget reading a task's stage silently gets an empty set,
    -- which is indistinguishable from "no data".
    if tbl = 'pf_task_planning' and not exists (
      select 1 from pg_policies where tablename = tbl and policyname = 'widget_anon_read'
    ) then
      execute format(
        'create policy widget_anon_read on public.%I for select to anon
           using (user_id = ''a33625c2-4dd2-44fa-b2e5-4d455eeac59d'')', tbl);
    end if;
  end loop;
end $$;

-- ── 8. Keep user_id honest on the subtypes ──────────────────────────────────
--
-- The subtype's user_id must match its supertype's or RLS on the two disagrees:
-- the task would be visible while its planning row is not, and the task would
-- read as un-planned rather than as an error.

create or replace function public.pf_task_subtype_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select user_id into new.user_id from public.pf_tasks where id = new.task_id;
  return new;
end $$;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'pf_task_planning', 'pf_task_reminders', 'pf_task_chores', 'pf_task_shopping'
  ] loop
    execute format('drop trigger if exists %I on public.%I', tbl || '_owner_trg', tbl);
    execute format(
      'create trigger %I before insert or update of task_id, user_id on public.%I
         for each row execute function public.pf_task_subtype_owner()',
      tbl || '_owner_trg', tbl);
  end loop;
end $$;
