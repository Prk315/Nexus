-- The primary task in a breakdown carries an aggregate time estimate.
--
-- `time_estimate` is what a task claims *for itself*. Once a task is broken down
-- that number stops being the truth: a 6h parent with four 2h steps is 8h of
-- work, and every consumer that reads `time_estimate` would under-count it.
--
-- `aggregate_estimate` is the rolled-up total, maintained by trigger:
--
--     leaf   -> coalesce(time_estimate, 0)
--     parent -> sum(children.aggregate_estimate)
--
-- It lives on the supertype rather than in pf_task_planning because the callers
-- that need it most read pf_tasks directly and know nothing about the
-- hierarchy — the Dashboard's day math, the Week overlay, the iOS widgets. A
-- maintained column means `select *` keeps working everywhere with no query
-- changes; a recursive view would have required touching all of them.
--
-- A parent's own `time_estimate` is deliberately left alone rather than
-- overwritten. It stays as the original standalone guess, which is worth keeping
-- next to the roll-up — the gap between "I thought this was 6h" and "the steps
-- add up to 8h" is exactly the information that makes an estimate improve.

alter table public.pf_tasks
  add column if not exists aggregate_estimate integer not null default 0;

comment on column public.pf_tasks.aggregate_estimate is
  'Rolled-up minutes: sum of children''s aggregates, or own time_estimate for a leaf. Maintained by pf_tasks_recompute_aggregate_trg — do not write directly.';

-- Recomputes one task and walks up its ancestors, stopping as soon as a value is
-- already correct. That early exit is what keeps the walk cheap and, more
-- importantly, what guarantees termination: an unchanged row issues no UPDATE,
-- so the trigger cannot re-enter itself. (The parent chain is acyclic — enforced
-- by pf_tasks_guard_parent — and capped at 20 deep.)
create or replace function public.pf_task_recompute_aggregate(p_task_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cur      bigint := p_task_id;
  computed integer;
  existing integer;
  parent   bigint;
  guard    integer := 0;
begin
  while cur is not null loop
    guard := guard + 1;
    exit when guard > 25;

    select
      case
        when exists (select 1 from public.pf_tasks c where c.parent_id = cur)
          then (select coalesce(sum(c.aggregate_estimate), 0)
                  from public.pf_tasks c where c.parent_id = cur)
        else coalesce((select t.time_estimate from public.pf_tasks t where t.id = cur), 0)
      end
    into computed;

    select t.aggregate_estimate, t.parent_id
      into existing, parent
      from public.pf_tasks t where t.id = cur;

    exit when existing is null;              -- row vanished mid-walk
    exit when existing = computed;           -- already correct: nothing above can change

    update public.pf_tasks set aggregate_estimate = computed where id = cur;
    cur := parent;
  end loop;
end $$;

create or replace function public.pf_tasks_aggregate_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- The row is gone; only its former parent's total needs revisiting.
    if old.parent_id is not null then
      perform public.pf_task_recompute_aggregate(old.parent_id);
    end if;
    return old;
  end if;

  perform public.pf_task_recompute_aggregate(new.id);

  -- Re-parenting changes two chains, not one.
  if tg_op = 'UPDATE' and old.parent_id is distinct from new.parent_id
     and old.parent_id is not null then
    perform public.pf_task_recompute_aggregate(old.parent_id);
  end if;

  return new;
end $$;

drop trigger if exists pf_tasks_aggregate_trg on public.pf_tasks;
create trigger pf_tasks_aggregate_trg
  after insert or delete or update of time_estimate, parent_id on public.pf_tasks
  for each row execute function public.pf_tasks_aggregate_trg();

-- ── Backfill, deepest first ─────────────────────────────────────────────────
-- Computing leaves before their parents means each level sums children that are
-- already correct, so one pass is enough.
do $$
declare
  rec record;
begin
  for rec in
    with recursive depth_of as (
      select id, parent_id, 0 as depth from public.pf_tasks where parent_id is null
      union all
      select t.id, t.parent_id, d.depth + 1
        from public.pf_tasks t join depth_of d on t.parent_id = d.id
    )
    select id from depth_of order by depth desc
  loop
    perform public.pf_task_recompute_aggregate(rec.id);
  end loop;
end $$;
