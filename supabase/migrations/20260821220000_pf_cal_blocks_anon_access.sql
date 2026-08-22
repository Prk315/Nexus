-- 20260821220000_pf_cal_blocks_anon_access.sql
--
-- WHAT
--   Anon SELECT + INSERT on pf_cal_blocks and pf_recurring_cal_blocks, both
--   pinned to the calendar owner's uid.
--
-- WHY
--   Discovered 2026-08-21 while building the shared-header clock dropdown:
--   these two tables only ever had `owner_all` (auth.uid()), yet Nexus Local's
--   timetracker talks to them with the session-less anon client. Consequence:
--   the meal-session calendar log, gap-chip logging and suggestion accepts
--   (Phase A/B of DAY_COVERAGE_ROADMAP.md) have NEVER landed a row, and the
--   coverage panel's "planned" band always read empty. Verified against live
--   pg_policies + row inspection (100 rows, all owned by the uuid below, zero
--   meal-session rows).
--
--   SELECT matches the widget_anon_read precedent already on pf_tasks (task
--   titles are comparable exposure to block titles). INSERT is new ground but
--   WITH CHECK pins user_id to the owner, so the anon role can only file rows
--   into the owner's calendar — same blast radius as the already-anon-open
--   meal_sessions/blocked_sites tables. UPDATE/DELETE stay authed-only.
--   Decided with the user 2026-08-21, alongside the anon-key-out effort that
--   removes the key from the public repo (shrinking who "anon" is in practice).
--
-- ORDER
--   Standalone. Apply before shipping the Nexus Local fix that re-keys its
--   calendar access to this uid (frontend change, same day).

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'pf_cal_blocks' and policyname = 'widget_anon_read'
  ) then
    create policy widget_anon_read on public.pf_cal_blocks
      for select to anon
      using (user_id = 'a33625c2-4dd2-44fa-b2e5-4d455eeac59d');
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'pf_recurring_cal_blocks' and policyname = 'widget_anon_read'
  ) then
    create policy widget_anon_read on public.pf_recurring_cal_blocks
      for select to anon
      using (user_id = 'a33625c2-4dd2-44fa-b2e5-4d455eeac59d');
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'pf_cal_blocks' and policyname = 'coverage_anon_insert'
  ) then
    create policy coverage_anon_insert on public.pf_cal_blocks
      for insert to anon
      with check (user_id = 'a33625c2-4dd2-44fa-b2e5-4d455eeac59d');
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'pf_recurring_cal_blocks' and policyname = 'coverage_anon_insert'
  ) then
    create policy coverage_anon_insert on public.pf_recurring_cal_blocks
      for insert to anon
      with check (user_id = 'a33625c2-4dd2-44fa-b2e5-4d455eeac59d');
  end if;
end $$;
