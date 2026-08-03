-- Server-side aggregation of task_count/done_count for goals and plans.
--
-- Replaces the client-side fan-out in api.ts (getGoals: goals→plans→tasks = 3
-- round-trips; getPlans: plans→tasks = 2, shipping every task row just to count
-- it) with a single select from an aggregating view.
--
-- security_invoker=on so the views run under the CALLER's RLS on the underlying
-- pf_* tables (user_id = auth.uid()) — each user sees only their own rows.
-- Additive + reversible: `drop view pf_goals_with_counts, pf_plans_with_counts;`
--
-- Applied to the NEXUS project (efxmzsdisaymtpebaxlp) on 2026-08-03 via MCP.
-- Recorded here because PathFinder's schema is otherwise managed out-of-repo;
-- this file documents the change so the PR is reproducible.

create or replace view public.pf_goals_with_counts
with (security_invoker = on) as
select
  g.id, g.user_id, g.group_id, g.title, g.description, g.deadline,
  g.status, g.priority, g.created_at,
  gg.name  as group_name,
  gg.color as group_color,
  coalesce(count(t.id), 0)::int                       as task_count,
  coalesce(count(t.id) filter (where t.done), 0)::int as done_count
from public.pf_goals g
left join public.pf_goal_groups gg on gg.id = g.group_id
left join public.pf_plans p        on p.goal_id = g.id
left join public.pf_tasks t        on t.plan_id = p.id
group by g.id, gg.id;

create or replace view public.pf_plans_with_counts
with (security_invoker = on) as
select
  p.id, p.user_id, p.goal_id, p.lifestyle_area_id, p.title, p.description,
  p.deadline, p.status, p.tags, p.is_course, p.is_lifestyle, p.purpose,
  p.problem, p.solution, p.created_at, p.is_schedule, p.parent_id,
  coalesce(count(t.id), 0)::int                       as task_count,
  coalesce(count(t.id) filter (where t.done), 0)::int as done_count
from public.pf_plans p
left join public.pf_tasks t on t.plan_id = p.id
group by p.id;
