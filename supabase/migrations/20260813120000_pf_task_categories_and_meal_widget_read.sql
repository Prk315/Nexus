-- Quick-task categories on pf_tasks, and anon read for the meal widget.
--
-- 1) `pf_tasks.category` — NULL means a regular project task (everything that
--    exists today keeps meaning what it meant). 'reminder' | 'chore' |
--    'shopping' are the new lightweight kinds surfaced by Nexus Local and the
--    home-screen quick-task widget. A CHECK keeps typos out; NULL stays legal
--    so the column is purely additive.
--
-- 2) widget_anon_read on protocol_meal_plan_entries + protocol_foods — the
--    iOS meal widget reads with the anon key (free-tier sideload: no App
--    Group, no JWT — same story as the existing policies on pf_tasks /
--    protocol_habits / protocol_sleep). SELECT only, pinned to the owner's
--    uid; writes still go exclusively through the meal-log edge function.
--    protocol_meals already has a public read policy (meals_shared_read), so
--    only entries and foods need opening. Foods are only readable where
--    user_id matches the owner — rows contributed by other users stay hidden
--    to anon, so a widget entry referencing one falls back to a generic label.

alter table public.pf_tasks
  add column if not exists category text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pf_tasks_category_check'
  ) then
    alter table public.pf_tasks
      add constraint pf_tasks_category_check
      check (category is null or category in ('reminder', 'chore', 'shopping'));
  end if;
end $$;

-- Same owner uid as every existing widget_anon_read policy.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'protocol_meal_plan_entries' and policyname = 'widget_anon_read'
  ) then
    create policy widget_anon_read on public.protocol_meal_plan_entries
      for select to anon
      using (user_id = 'a33625c2-4dd2-44fa-b2e5-4d455eeac59d');
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'protocol_foods' and policyname = 'widget_anon_read'
  ) then
    create policy widget_anon_read on public.protocol_foods
      for select to anon
      using (user_id = 'a33625c2-4dd2-44fa-b2e5-4d455eeac59d');
  end if;
end $$;
