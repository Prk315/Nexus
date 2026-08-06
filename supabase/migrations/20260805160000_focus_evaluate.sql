-- 20260805160000_focus_evaluate.sql
--
-- WHAT
--   Schedules the `focus-evaluate` edge function on pg_cron, every 5 minutes,
--   as job `nexus-focus-evaluate`.
--
-- WHY
--   `focus-evaluate` collapses focus_blocks + schedule_block_apps +
--   schedule_block_sites + unlock_rules + blocked_sites + blocked_apps +
--   today's time_entries into the single `blocking_state` row. Nexus Local is a
--   sideloaded free-tier iOS app — no BGTaskScheduler, no silent push — so a
--   schedule window opening at 09:00 or a reward unlocking at 60 tracked
--   minutes has to be decided somewhere that is awake. pg_cron is that
--   somewhere.
--
-- ORDER — THIS FILE RUNS LAST
--   1. Apply the work-unit-1 schema first. This file depends on all of it:
--        20260805120000_blocking_state.sql                        (the table written)
--        20260805120200_schedule_block_targets.sql                (the tables read)
--        20260805120300_unlock_rules_enabled_and_evaluator_indexes.sql
--                                                                 (unlock_rules.enabled)
--      This file creates NONE of those — unit 1 owns them. It only schedules.
--   2. Deploy the function BEFORE applying this file, or every tick 404s until
--      you do:
--        supabase functions deploy focus-evaluate --project-ref efxmzsdisaymtpebaxlp
--
--   Applying this early is safe but noisy: the function fails loudly rather than
--   writing a partial state, so the job simply errors each tick until its
--   dependencies exist. It never writes an empty verdict, which would read as
--   "nothing is blocked" and silently switch blocking off.
--
-- ROLLBACK
--   select cron.unschedule('nexus-focus-evaluate');

-- ── Preconditions ────────────────────────────────────────────────────────────
-- pg_cron and pg_net are already installed on this project (jobs 1 and 2,
-- `protocol-oura-daily-sync` and `protocol-bodyscan-sync`, use `cron.job` and
-- `net.http_post`). Deliberately NOT `create extension if not exists` here: if
-- either were somehow absent, that would install it into the default schema and
-- `net.http_post` would then resolve to nothing while the migration reported
-- success. Assert instead, so a missing extension is a loud failure rather than
-- a silently dead cron job.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron is not installed — enable it in Dashboard > Database > Extensions before applying this migration';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'pg_net is not installed — enable it in Dashboard > Database > Extensions before applying this migration';
  end if;
end $$;

-- Fail early and legibly if unit 1's schema has not been applied yet, rather
-- than letting the job 404 every 5 minutes with nobody watching.
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'blocking_state'
  ) then
    raise exception 'blocking_state does not exist — apply 20260805120000_blocking_state.sql first';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'unlock_rules' and column_name = 'enabled'
  ) then
    raise exception 'unlock_rules.enabled does not exist — apply 20260805120300_unlock_rules_enabled_and_evaluator_indexes.sql first';
  end if;
end $$;

-- ── Schedule ─────────────────────────────────────────────────────────────────
-- Idempotent: drop the job before recreating so re-running this file cannot
-- leave two schedules racing each other.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'nexus-focus-evaluate') then
    perform cron.unschedule('nexus-focus-evaluate');
  end if;
end $$;

-- Every 5 minutes. Same shape as `protocol-bodyscan-sync` (jobid 2): the
-- service-role key is read from Vault rather than inlined, so rotating it does
-- not require editing the job.
select cron.schedule(
  'nexus-focus-evaluate',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://efxmzsdisaymtpebaxlp.supabase.co/functions/v1/focus-evaluate',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
    ),
    body := '{}'::jsonb
  );
  $cron$
);
