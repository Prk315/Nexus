-- Weekly activity goals that drive the dashboard's Workout & Running scores:
-- how many strength sessions per week, and how many running km per week. One row
-- per user, owner-only RLS. Both nullable — an unset goal leaves that domain on
-- its old heuristic score.
create table if not exists public.protocol_activity_goals (
  user_id text primary key,
  strength_sessions_per_week numeric,
  running_km_per_week numeric,
  updated_at timestamptz not null default now()
);

alter table public.protocol_activity_goals enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'protocol_activity_goals'
      and policyname = 'owner_all'
  ) then
    create policy owner_all on public.protocol_activity_goals
      for all
      using (user_id = ((select auth.uid()))::text)
      with check (user_id = ((select auth.uid()))::text);
  end if;
end $$;
