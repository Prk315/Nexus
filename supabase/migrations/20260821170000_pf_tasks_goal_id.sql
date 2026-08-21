-- A task can point at a goal directly.
--
-- PathFinder modelled goal -> plan -> task, and that chain is empty in practice:
-- of 162 root project tasks only 48 carry a plan, and of 15 plans **zero** carry
-- a goal_id. So no task in the vault could reach a goal, which is why every goal
-- sat at 0% — pf_goals_with_counts joins through plans, so it counted nothing.
-- The bars could never move. That was a data-linkage gap, not a rendering bug.
--
-- Rather than demand two levels of bookkeeping before a goal shows any progress,
-- a task may now name its goal directly. Plans keep working exactly as before —
-- a task inside a plan that has a goal still counts toward it — so this widens
-- the model without invalidating the part of it that was being used.
--
-- Precedence: a direct goal_id WINS over the one inherited via plan. It is the
-- more specific statement, and resolving it this way also stops a task being
-- counted twice by a goal it reaches through both routes.

alter table public.pf_tasks
  add column if not exists goal_id bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pf_tasks_goal_id_fkey') then
    alter table public.pf_tasks
      add constraint pf_tasks_goal_id_fkey
      foreign key (goal_id) references public.pf_goals(id) on delete set null;
  end if;
end $$;

-- ON DELETE SET NULL, not CASCADE: deleting a goal must not delete the work that
-- was aimed at it. The task simply stops pointing anywhere.

create index if not exists pf_tasks_goal_id_idx
  on public.pf_tasks(goal_id) where goal_id is not null;

comment on column public.pf_tasks.goal_id is
  'Direct link to a goal, bypassing the plan level. Takes precedence over the goal reached via plan_id. NULL means "inherit from the plan, if any".';

-- ── Counts follow both routes ───────────────────────────────────────────────
--
-- security_invoker stays ON. Without it the view runs as its owner and silently
-- bypasses the base tables' RLS, which for a view over pf_tasks would publish
-- every user's task titles.
--
-- Only ROOT tasks count (parent_id is null). Counting steps too would mean
-- breaking a task into five pieces quietly inflates its goal's denominator from
-- 1 to 6 — the same bug that made the dashboard's open-task pill grow the more
-- carefully you planned. Partial progress within a task is already expressed by
-- aggregate_estimate and the breakdown roll-up.
--
-- Quick tasks (reminder/chore/shopping) are excluded: they are standing lists
-- captured on the phone, not work aimed at a goal.

create or replace view public.pf_goals_with_counts
with (security_invoker = on) as
  select g.id,
         g.user_id,
         g.group_id,
         g.title,
         g.description,
         g.deadline,
         g.status,
         g.priority,
         g.created_at,
         gg.name  as group_name,
         gg.color as group_color,
         coalesce(count(t.id), 0)::integer                          as task_count,
         coalesce(count(t.id) filter (where t.done), 0)::integer    as done_count
    from public.pf_goals g
    left join public.pf_goal_groups gg on gg.id = g.group_id
    left join public.pf_tasks t
           on t.parent_id is null
          and t.category is null
          and (
                t.goal_id = g.id
                or (
                     -- Only when the task has no direct goal, so a task that
                     -- reaches this goal both ways is still counted once.
                     t.goal_id is null
                     and exists (
                       select 1 from public.pf_plans p
                        where p.id = t.plan_id and p.goal_id = g.id
                     )
                   )
              )
   group by g.id, gg.id;
