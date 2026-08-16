-- 20260816130000_workout_started_at_and_coverage_read.sql
--
-- WHAT — two things for the Day Coverage roadmap, Phase A3:
--
-- 1) started_at timestamptz on protocol_workout_sessions +
--    protocol_running_sessions. Both tables carried only a date and a
--    duration, which cannot be placed on a timeline. Garmin has always sent
--    startTimeLocal (the bridge emits it as `start_time`; garmin-import used
--    it in the composite dedupe key and then dropped it). The updated
--    garmin-import converts it Copenhagen-local → UTC and stores it here.
--    Nullable on purpose: historical rows stay NULL and simply don't render
--    as timeline bands; a re-sync backfills them (idempotent on
--    (user_id, external_id)).
--
-- 2) widget_anon_read on both tables — DayCoveragePanel reads them with the
--    anon key (same story as protocol_sleep / protocol_meal_plan_entries:
--    free-tier sideload, no JWT in the reader). SELECT only, pinned to the
--    owner's uid. This makes workout start times world-readable in principle
--    (public repo, committed anon key) — decided deliberately 2026-08-16,
--    matching the existing exposure of sleep bed/rise times.
--
-- ORDER
--   Apply BEFORE deploying the updated garmin-import (which writes the new
--   column) and before shipping the panel that reads it. Forward-only,
--   re-runnable.

ALTER TABLE public.protocol_workout_sessions
    ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.protocol_running_sessions
    ADD COLUMN IF NOT EXISTS started_at timestamptz;

COMMENT ON COLUMN public.protocol_workout_sessions.started_at IS
    'Activity start as an instant (Garmin startTimeLocal, converted Europe/Copenhagen → UTC by garmin-import). NULL on rows imported before 2026-08-16; a Garmin re-sync backfills.';
COMMENT ON COLUMN public.protocol_running_sessions.started_at IS
    'See protocol_workout_sessions.started_at.';

-- Same owner uid as every existing widget_anon_read policy.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'protocol_workout_sessions' and policyname = 'widget_anon_read'
  ) then
    create policy widget_anon_read on public.protocol_workout_sessions
      for select to anon
      using (user_id = 'a33625c2-4dd2-44fa-b2e5-4d455eeac59d');
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'protocol_running_sessions' and policyname = 'widget_anon_read'
  ) then
    create policy widget_anon_read on public.protocol_running_sessions
      for select to anon
      using (user_id = 'a33625c2-4dd2-44fa-b2e5-4d455eeac59d');
  end if;
end $$;
