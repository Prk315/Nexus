-- One call that tells an agent what you are actually working on.
--
-- ─── The problem ─────────────────────────────────────────────────────────────
-- Planning happens in PathFinder and Vault, where it is pleasant. Work happens
-- in a terminal, where an agent starts with no idea what any of it is for. To
-- find out today it would have to discover the relevant tables among 51 `pf_`
-- ones, learn that tasks are an ISA hierarchy needing a `pf_task_planning`
-- embed, and then read 349 open rows to find the nine that matter. That is tens
-- of thousands of tokens spent before the first useful thought.
--
-- ─── Facts, never judgements ─────────────────────────────────────────────────
-- ⚠️ The obvious next step is to also compute "what is due", "what is next",
-- "what is overdue on its cadence". DO NOT. Those rules live in exactly one
-- place each — `lib/systems.ts` (the due rule), `lib/nextUp.ts` (the ranking),
-- `lib/taskTree.ts` (roll-ups, coverage, the gate) — and CLAUDE.md records why:
-- the due rule was previously written out three times and the copies already
-- disagreed about monthly and about unknown frequencies. A SQL fourth copy
-- would be worse than those three, because `npm test` cannot reach it.
--
-- So everything below is either stored directly or is arithmetic nobody
-- disputes (a count; `due_date < today`). `pf_systems` rows are returned RAW —
-- frequency, interval_days, last_done — so a caller that holds the real rule can
-- apply it, and a caller that does not is not handed a guess.
--
-- ─── Why a function and not a view ───────────────────────────────────────────
-- Views cannot take parameters, and the caller that needs this most has no
-- identity: the Supabase MCP connects as service-role, where `auth.uid()` is
-- NULL (verified). A view scoped to auth.uid() would return an empty brief to
-- precisely the client this exists for, and an unscoped one would mix a
-- teammate's shared rows into "your" brief without saying so.
--
-- `p_user_id` therefore scopes explicitly, and SECURITY INVOKER makes that safe
-- rather than a hole: for a signed-in caller RLS still gates every underlying
-- table, so the parameter can only ever NARROW what they could already read.
-- For service-role it is the only scoping there is, which is the point.
--
-- APPLIED 2026-08-27 to efxmzsdisaymtpebaxlp.

create or replace function pf_agent_brief(p_user_id text default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with me as (
  select coalesce(p_user_id, (select auth.uid())::text) as uid,
         -- ⚠️ pf_tasks.due_date is TEXT, not date (verified: 174 values, all
         -- 'YYYY-MM-DD', but the column carries no constraint). Compared as
         -- text against text: ISO-8601 dates sort lexicographically in date
         -- order, so this is exact for every well-formed value — and a
         -- malformed one sorts oddly instead of raising, which a `::date` cast
         -- would do, taking the whole brief down with it.
         to_char(current_date, 'YYYY-MM-DD')       as today,
         to_char(current_date + 14, 'YYYY-MM-DD')  as horizon
),
-- "Mine" is owned-or-assigned, not merely owned: a task on a shared plan that
-- has been assigned to me is my work even though its user_id names the owner.
mine as (
  select t.*, pl.urgency, pl.stage, pl.completion_mode, pl.notes
  from pf_tasks t
  left join pf_task_planning pl on pl.task_id = t.id
  cross join me
  where t.done = false
    and (t.user_id = me.uid or t.assigned_to = me.uid)
)
select jsonb_build_object(
  'generated_at', now(),
  'user_id', (select uid from me),

  -- Cheap orientation. 349 open tasks must never be listed; counted, they say
  -- the one thing a list would have said and cost nothing.
  'counts', (
    select jsonb_build_object(
      'open_tasks',      count(*),
      'open_root_tasks', count(*) filter (where parent_id is null),
      'active',          count(*) filter (where stage = 'active'),
      'overdue',         count(*) filter (where due_date ~ '^\d{4}-\d{2}-\d{2}$'
                                          and due_date < (select today from me))
    ) from mine
  ),

  'goals', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', g.id, 'title', g.title, 'status', g.status,
      'deadline', g.deadline, 'priority', g.priority,
      -- From the existing view rather than recomputed: it already encodes the
      -- direct-goal-beats-inherited precedence, and a second count here would
      -- be a second answer.
      'tasks', g.task_count, 'done', g.done_count
    ) order by g.priority nulls last, g.id)
    from pf_goals_with_counts g cross join me
    where g.user_id = me.uid
  ), '[]'::jsonb),

  -- The nine. This is the part an agent actually needs.
  'active', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'title', m.title, 'urgency', m.urgency, 'priority', m.priority,
      'due', m.due_date, 'estimate_min', m.time_estimate,
      -- Trigger-maintained: the real total including children. Never recompute.
      'rollup_min', m.aggregate_estimate,
      'kanban', m.kanban_status,
      'goal', (select title from pf_goals where id = m.goal_id),
      'plan', (select title from pf_plans where id = m.plan_id),
      'notes', m.notes
    ) order by m.priority nulls last, m.due_date nulls last, m.id)
    from (select * from mine where stage = 'active' order by id limit 25) m
  ), '[]'::jsonb),

  -- Overdue and imminent, excluding anything already listed above so the two
  -- lists never pay for the same task twice.
  'due_soon', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'title', m.title, 'due', m.due_date,
      'urgency', m.urgency, 'stage', m.stage, 'priority', m.priority
    ) order by m.due_date, m.id)
    from (
      select * from mine
      -- Shape-checked rather than trusted: a value that is not an ISO date
      -- cannot be placed on this timeline honestly, so it is left out of the
      -- list rather than mis-sorted into it.
      where due_date ~ '^\d{4}-\d{2}-\d{2}$'
        and due_date <= (select horizon from me)
        and coalesce(stage, '') <> 'active'
      order by due_date limit 25
    ) m
  ), '[]'::jsonb),

  -- Only plans with open work. An empty plan is a filing decision, not context.
  'plans', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'title', p.title, 'status', p.status,
      'deadline', p.deadline, 'open_tasks', c.n
    ) order by c.n desc, p.id)
    from pf_plans p
    cross join me
    join lateral (select count(*) as n from mine where plan_id = p.id) c on c.n > 0
    where p.user_id = me.uid
  ), '[]'::jsonb),

  -- RAW, deliberately: `frequency`/`interval_days`/`last_done` are the inputs to
  -- the one due rule in lib/systems.ts. Returning "is it due" here would be the
  -- fourth copy of that rule. See the header.
  'systems', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'title', s.title, 'frequency', s.frequency,
      'interval_days', s.interval_days, 'days_of_week', s.days_of_week,
      'last_done', s.last_done, 'streak', s.streak_count
    ) order by s.id)
    from pf_systems s cross join me
    where s.user_id = me.uid
  ), '[]'::jsonb)
)
$$;

comment on function pf_agent_brief(text) is
  'Compact "what am I working on" snapshot for terminal agents. Facts only — '
  'no due/next/overdue-cadence judgements, which live in lib/systems.ts, '
  'lib/nextUp.ts and lib/taskTree.ts and must not be duplicated here. '
  'Pass p_user_id when calling as service-role (auth.uid() is NULL there).';
