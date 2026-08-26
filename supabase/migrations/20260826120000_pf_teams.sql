-- PathFinder Teams: shared task/plan scoping via team membership.
--
-- Additive only — the existing owner_all / widget_anon_read / coverage_anon_insert
-- policies on pf_* tables are left untouched; team policies are OR'd alongside them.
--
-- Key trap this design routes around: pf_task_subtype_owner() (BEFORE trigger,
-- 20260820130000_pf_task_isa_hierarchy.sql) overwrites NEW.user_id on every
-- subtype row with the parent task's owner. A teammate's write therefore lands
-- with user_id = owner != auth.uid(), so team WITH CHECKs on subtype tables must
-- go via the parent task's team, never via user_id.

-- ── 1+2. Core tables ─────────────────────────────────────────────────────────

create table if not exists pf_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by text not null default 'default',
  created_at timestamptz default now()
);

create table if not exists pf_team_members (
  team_id uuid not null references pf_teams(id) on delete cascade,
  user_id text not null,
  created_at timestamptz default now(),
  primary key (team_id, user_id)
);

-- ── 3. Membership helper ─────────────────────────────────────────────────────
-- SECURITY DEFINER so team policies can consult pf_team_members without
-- recursing into pf_team_members' own RLS.

create or replace function pf_is_team_member(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from pf_team_members m
    where m.team_id = tid
      and m.user_id = (select auth.uid())::text
  );
$$;

-- ── 4. RLS on the team tables ────────────────────────────────────────────────

alter table pf_teams enable row level security;
alter table pf_team_members enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'pf_teams' and policyname = 'teams_select') then
    create policy teams_select on pf_teams for select to authenticated
      using (created_by = (select auth.uid())::text or pf_is_team_member(id));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'pf_teams' and policyname = 'teams_insert') then
    create policy teams_insert on pf_teams for insert to authenticated
      with check (created_by = (select auth.uid())::text);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'pf_team_members' and policyname = 'members_select') then
    create policy members_select on pf_team_members for select to authenticated
      using (user_id = (select auth.uid())::text or pf_is_team_member(team_id));
  end if;

  -- Insert yourself into a team you created, or (as an existing member) add members.
  -- Invites proper come later.
  if not exists (select 1 from pg_policies where tablename = 'pf_team_members' and policyname = 'members_insert') then
    create policy members_insert on pf_team_members for insert to authenticated
      with check (
        (user_id = (select auth.uid())::text
          and exists (select 1 from pf_teams t
                      where t.id = team_id
                        and t.created_by = (select auth.uid())::text))
        or pf_is_team_member(team_id)
      );
  end if;
end $$;

-- ── 5. team_id on pf_tasks / pf_plans ────────────────────────────────────────

alter table pf_tasks add column if not exists team_id uuid references pf_teams(id) on delete set null;
alter table pf_plans add column if not exists team_id uuid references pf_teams(id) on delete set null;

create index if not exists pf_tasks_team_id_idx on pf_tasks (team_id) where team_id is not null;
create index if not exists pf_plans_team_id_idx on pf_plans (team_id) where team_id is not null;

-- ── 6. assigned_to on pf_tasks ───────────────────────────────────────────────
-- null = unassigned, 'all' = everyone on the team, else a member user id (uuid text).

alter table pf_tasks add column if not exists assigned_to text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pf_tasks_assigned_to_check'
      and conrelid = 'pf_tasks'::regclass
  ) then
    alter table pf_tasks add constraint pf_tasks_assigned_to_check
      check (assigned_to is null or assigned_to = 'all' or length(assigned_to) > 10);
  end if;
end $$;

-- ── 7. Additive team policies on the pf_* work tables ────────────────────────

do $$
begin
  -- Full access to team-scoped tasks/plans for members.
  if not exists (select 1 from pg_policies where tablename = 'pf_tasks' and policyname = 'team_all') then
    create policy team_all on pf_tasks for all to authenticated
      using (team_id is not null and pf_is_team_member(team_id))
      with check (team_id is not null and pf_is_team_member(team_id));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'pf_plans' and policyname = 'team_all') then
    create policy team_all on pf_plans for all to authenticated
      using (team_id is not null and pf_is_team_member(team_id))
      with check (team_id is not null and pf_is_team_member(team_id));
  end if;

  -- Subtype tables + sessions: access follows the PARENT task's team.
  -- (pf_task_subtype_owner() forces user_id = parent owner, so user_id-based
  -- checks would reject every teammate write.)
  if not exists (select 1 from pg_policies where tablename = 'pf_task_planning' and policyname = 'team_all') then
    create policy team_all on pf_task_planning for all to authenticated
      using (exists (select 1 from pf_tasks t where t.id = task_id and t.team_id is not null and pf_is_team_member(t.team_id)))
      with check (exists (select 1 from pf_tasks t where t.id = task_id and t.team_id is not null and pf_is_team_member(t.team_id)));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'pf_task_reminders' and policyname = 'team_all') then
    create policy team_all on pf_task_reminders for all to authenticated
      using (exists (select 1 from pf_tasks t where t.id = task_id and t.team_id is not null and pf_is_team_member(t.team_id)))
      with check (exists (select 1 from pf_tasks t where t.id = task_id and t.team_id is not null and pf_is_team_member(t.team_id)));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'pf_task_chores' and policyname = 'team_all') then
    create policy team_all on pf_task_chores for all to authenticated
      using (exists (select 1 from pf_tasks t where t.id = task_id and t.team_id is not null and pf_is_team_member(t.team_id)))
      with check (exists (select 1 from pf_tasks t where t.id = task_id and t.team_id is not null and pf_is_team_member(t.team_id)));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'pf_task_shopping' and policyname = 'team_all') then
    create policy team_all on pf_task_shopping for all to authenticated
      using (exists (select 1 from pf_tasks t where t.id = task_id and t.team_id is not null and pf_is_team_member(t.team_id)))
      with check (exists (select 1 from pf_tasks t where t.id = task_id and t.team_id is not null and pf_is_team_member(t.team_id)));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'pf_task_sessions' and policyname = 'team_all') then
    create policy team_all on pf_task_sessions for all to authenticated
      using (exists (select 1 from pf_tasks t where t.id = task_id and t.team_id is not null and pf_is_team_member(t.team_id)))
      with check (exists (select 1 from pf_tasks t where t.id = task_id and t.team_id is not null and pf_is_team_member(t.team_id)));
  end if;

  -- Calendar blocks: teammates may SEE blocks on team tasks (combined
  -- "scheduled minutes" gate needs them) but writes stay owner-only.
  if not exists (select 1 from pg_policies where tablename = 'pf_cal_blocks' and policyname = 'team_select') then
    create policy team_select on pf_cal_blocks for select to authenticated
      using (exists (select 1 from pf_tasks t where t.id = task_id and t.team_id is not null and pf_is_team_member(t.team_id)));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'pf_recurring_cal_blocks' and policyname = 'team_select') then
    create policy team_select on pf_recurring_cal_blocks for select to authenticated
      using (exists (select 1 from pf_tasks t where t.id = task_id and t.team_id is not null and pf_is_team_member(t.team_id)));
  end if;
end $$;

-- ── 8. pf_plans_with_counts: expose team_id ──────────────────────────────────
-- OR REPLACE requires appending, so team_id goes last. security_invoker stays on
-- (without it the view would bypass pf_plans/pf_tasks RLS).

create or replace view pf_plans_with_counts
with (security_invoker = on) as
select p.id,
       p.user_id,
       p.goal_id,
       p.lifestyle_area_id,
       p.title,
       p.description,
       p.deadline,
       p.status,
       p.tags,
       p.is_course,
       p.is_lifestyle,
       p.purpose,
       p.problem,
       p.solution,
       p.created_at,
       p.is_schedule,
       p.parent_id,
       coalesce(count(t.id), 0::bigint)::integer as task_count,
       coalesce(count(t.id) filter (where t.done), 0::bigint)::integer as done_count,
       p.team_id
from pf_plans p
left join pf_tasks t on t.plan_id = p.id
group by p.id;

-- ── 9. Seed: one team, every real auth user a member (idempotent) ────────────

insert into pf_teams (name, created_by)
select 'Team', 'a33625c2-4dd2-44fa-b2e5-4d455eeac59d'
where not exists (
  select 1 from pf_teams
  where name = 'Team' and created_by = 'a33625c2-4dd2-44fa-b2e5-4d455eeac59d'
);

insert into pf_team_members (team_id, user_id)
select t.id, u.uid
from pf_teams t
cross join (values
  ('a33625c2-4dd2-44fa-b2e5-4d455eeac59d'),
  ('870ca14b-2a8a-4634-9c08-2eb2d67207b0')
) as u(uid)
where t.name = 'Team' and t.created_by = 'a33625c2-4dd2-44fa-b2e5-4d455eeac59d'
on conflict do nothing;
