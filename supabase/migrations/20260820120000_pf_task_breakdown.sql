-- PathFinder: tasks become a planned, broken-down, scheduled unit of work.
--
-- Three stages of the task lifecycle, and the columns each one needs:
--
--   1. REFINE   — specify the work. `urgency` joins `priority` (which has always
--                 been the *importance* axis) to give an Eisenhower pair, and
--                 `parent_id` lets a task recurse into subtasks that each carry
--                 their own done-state, estimate and due date.
--   2. SCHEDULE — commit calendar time. This needs no new table: pf_cal_blocks
--                 already carries `task_id`, and a task may have many blocks, so
--                 "3h of a 6h task is scheduled" falls out of summing them.
--                 `pf_recurring_cal_blocks.task_id` is added so a subtask can be
--                 committed as a repeating series ("Mon/Wed/Fri 07:00–08:00").
--   3. MEASURE  — `completion_mode` decides what "done" means. 'binary' is the
--                 existing checkbox. 'sessions' counts logged work sessions
--                 against `target_count` (this is what makes a *recurring*
--                 subtask completable — it is never done in one sitting).
--                 'time' measures logged minutes against `time_estimate`.
--                 `pf_task_sessions` is the ledger for both.
--
-- Everything here is additive. Existing rows keep their exact meaning: a task
-- with no parent, no sessions and completion_mode 'binary' behaves precisely as
-- it did before this migration.

-- ── 1. pf_tasks: specificity ────────────────────────────────────────────────

alter table public.pf_tasks
  add column if not exists parent_id       bigint,
  add column if not exists urgency         text not null default 'medium',
  add column if not exists stage           text not null default 'refine',
  add column if not exists completion_mode text not null default 'binary',
  add column if not exists target_count    integer,
  add column if not exists notes           text;

do $$
begin
  -- Self-reference: deleting a parent takes its whole subtree with it. A subtask
  -- has no meaning without the task it decomposes.
  if not exists (select 1 from pg_constraint where conname = 'pf_tasks_parent_id_fkey') then
    alter table public.pf_tasks
      add constraint pf_tasks_parent_id_fkey
      foreign key (parent_id) references public.pf_tasks(id) on delete cascade;
  end if;

  -- Same three-level domain as `priority`, so the two axes stay symmetric and a
  -- 3x3 matrix lens can render them without special-casing either side.
  if not exists (select 1 from pg_constraint where conname = 'pf_tasks_urgency_check') then
    alter table public.pf_tasks
      add constraint pf_tasks_urgency_check
      check (urgency in ('high', 'medium', 'low'));
  end if;

  -- The lifecycle gate. 'active' is only reachable once calendar time exists —
  -- enforced in the API layer (setTaskStage), not here, because the predicate
  -- spans three tables and a trigger doing that on every task write would make
  -- unrelated bulk updates expensive. The CHECK keeps typos out of the domain.
  if not exists (select 1 from pg_constraint where conname = 'pf_tasks_stage_check') then
    alter table public.pf_tasks
      add constraint pf_tasks_stage_check
      check (stage in ('refine', 'schedule', 'active', 'done'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pf_tasks_completion_mode_check') then
    alter table public.pf_tasks
      add constraint pf_tasks_completion_mode_check
      check (completion_mode in ('binary', 'sessions', 'time'));
  end if;
end $$;

create index if not exists pf_tasks_parent_id_idx  on public.pf_tasks(parent_id);
create index if not exists pf_tasks_user_stage_idx on public.pf_tasks(user_id, stage);

-- A parent cycle would hang the recursive tree renderer in the browser, and the
-- depth cap keeps that recursion bounded. Cheap: only fires when parent_id is set.
create or replace function public.pf_tasks_guard_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cur   bigint;
  depth integer := 0;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'pf_tasks: a task cannot be its own parent (id %)', new.id;
  end if;

  cur := new.parent_id;
  while cur is not null loop
    depth := depth + 1;
    if depth > 20 then
      raise exception 'pf_tasks: breakdown deeper than 20 levels (task %)', new.id;
    end if;
    if cur = new.id then
      raise exception 'pf_tasks: parent cycle detected at task %', new.id;
    end if;
    select parent_id into cur from public.pf_tasks where id = cur;
  end loop;

  return new;
end $$;

drop trigger if exists pf_tasks_guard_parent_trg on public.pf_tasks;
create trigger pf_tasks_guard_parent_trg
  before insert or update of parent_id, id on public.pf_tasks
  for each row execute function public.pf_tasks_guard_parent();

-- ── 2. Scheduling: link calendar time to tasks ──────────────────────────────
--
-- pf_cal_blocks.task_id predates this migration as a bare `integer` with no FK.
-- Widen it to match pf_tasks.id and constrain it. ON DELETE SET NULL, not
-- CASCADE: a past block is a record of time actually spent, and deleting the
-- task should not rewrite that history. The API deletes *future* blocks for a
-- deleted task explicitly (see deleteTask in api.ts) so the calendar doesn't
-- keep orphaned commitments.

alter table public.pf_cal_blocks
  alter column task_id type bigint;

alter table public.pf_recurring_cal_blocks
  add column if not exists task_id bigint;

do $$
begin
  -- Null out any dangling links before constraining, so validation cannot fail.
  update public.pf_cal_blocks b
     set task_id = null
   where b.task_id is not null
     and not exists (select 1 from public.pf_tasks t where t.id = b.task_id);

  if not exists (select 1 from pg_constraint where conname = 'pf_cal_blocks_task_id_fkey') then
    alter table public.pf_cal_blocks
      add constraint pf_cal_blocks_task_id_fkey
      foreign key (task_id) references public.pf_tasks(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pf_recurring_cal_blocks_task_id_fkey') then
    alter table public.pf_recurring_cal_blocks
      add constraint pf_recurring_cal_blocks_task_id_fkey
      foreign key (task_id) references public.pf_tasks(id) on delete set null;
  end if;
end $$;

create index if not exists pf_cal_blocks_task_id_idx
  on public.pf_cal_blocks(task_id) where task_id is not null;
create index if not exists pf_recurring_cal_blocks_task_id_idx
  on public.pf_recurring_cal_blocks(task_id) where task_id is not null;

-- ── 3. Measurement: the work-session ledger ─────────────────────────────────
--
-- One row per chunk of work actually done on a task. `cal_block_id` is nullable
-- and *not* a foreign key on purpose: a session can be logged against a virtual
-- occurrence of a recurring block, whose id is a client-derived negative number
-- (recurring_id * 100000 + dayOffset — the same scheme getCalBlocks uses), and
-- no row with that id exists. Storing it still lets the UI tick a specific
-- occurrence off and have it stay ticked.

create table if not exists public.pf_task_sessions (
  id           bigint generated by default as identity primary key,
  user_id      text   not null default 'default',
  task_id      bigint not null references public.pf_tasks(id) on delete cascade,
  date         text   not null,
  minutes      integer not null default 0,
  cal_block_id bigint,
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists pf_task_sessions_task_idx      on public.pf_task_sessions(task_id);
create index if not exists pf_task_sessions_user_date_idx on public.pf_task_sessions(user_id, date);

-- One session per (task, occurrence) so ticking an occurrence twice is a no-op
-- rather than double-counting progress. Partial: freehand sessions with no block
-- carry NULL and stay unconstrained (and NULLs are distinct anyway).
create unique index if not exists pf_task_sessions_occurrence_key
  on public.pf_task_sessions(task_id, cal_block_id) where cal_block_id is not null;

alter table public.pf_task_sessions enable row level security;

-- Mirrors pf_tasks' owner_all exactly — same auth.uid() posture, no anon policy.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'pf_task_sessions' and policyname = 'owner_all'
  ) then
    create policy owner_all on public.pf_task_sessions
      for all
      using (user_id = (select (auth.uid())::text))
      with check (user_id = (select (auth.uid())::text));
  end if;
end $$;

-- ── 4. Backfill stage honestly ──────────────────────────────────────────────
--
-- Nothing read `stage` before this migration, so no behaviour can regress here.
-- The mapping reflects what each task already is, which is more useful than
-- flattening everything to one value:
--   done                        -> 'done'
--   has committed calendar time -> 'active'   (it is already workable)
--   has a due date only         -> 'schedule' (specified, not yet committed)
--   neither                     -> 'refine'   (still needs thinking through)

update public.pf_tasks t set stage =
  case
    when t.done then 'done'
    when exists (select 1 from public.pf_cal_blocks b where b.task_id = t.id) then 'active'
    when t.due_date is not null then 'schedule'
    else 'refine'
  end;
