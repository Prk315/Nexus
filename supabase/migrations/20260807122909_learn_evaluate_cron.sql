-- Schedule the learn-evaluate edge function on pg_cron, following the exact
-- net.http_post + vault.decrypted_secrets pattern used by nexus-focus-evaluate
-- and protocol-bodyscan-sync (see CLAUDE.md, "Scheduled server-side work").
--
-- learn-evaluate computes lr_learn_state (due concepts, frontier units,
-- streak) plus lazy heat decay on lr_memory_state for retained concepts.
-- See apps/NexusLocal/LEARN_PLAN.md, "Phase 3 — lr_learn_state contract".
--
-- Idempotent: unschedule-if-exists, then (re)schedule.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'nexus-learn-evaluate') then
    perform cron.unschedule('nexus-learn-evaluate');
  end if;
end $$;

select cron.schedule(
  'nexus-learn-evaluate',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://efxmzsdisaymtpebaxlp.supabase.co/functions/v1/learn-evaluate',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
