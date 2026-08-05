-- focus-evaluate: the materialized blocking verdict + its pg_cron schedule.
--
-- WHAT THIS ADDS
--   1. `blocking_state` — one row per user holding the computed verdict.
--   2. `unlock_rules.enabled` — see the note below; unit 8 owns this column.
--   3. cron job `nexus-focus-evaluate`, every 5 minutes.
--
-- ORDER OF OPERATIONS
--   The cron job at the bottom POSTs to the `focus-evaluate` edge function.
--   Deploy the function FIRST, otherwise every tick 404s until you do:
--
--     supabase functions deploy focus-evaluate --project-ref efxmzsdisaymtpebaxlp
--
--   It also needs `schedule_block_apps` / `schedule_block_sites` (work unit 1).
--   Without them the function fails loudly rather than writing a partial state,
--   so applying this early is safe — it just means the job errors until unit 1
--   lands.
--
-- UPSERT CONSTRAINT
--   `focus-evaluate` upserts with `on_conflict=user_id`. `user_id` is the
--   PRIMARY KEY here, so PostgREST's default would work, but the function names
--   it explicitly — per supabase/migrations/README.md, a mismatch here surfaces
--   as an opaque HTTP 409 rather than a useful error.
--
-- WHY THIS MIGRATION TOUCHES `unlock_rules`
--   The live table has no `enabled` column, but the blocker logic being ported
--   (apps/TimeTrackerApp/src-tauri/src/blocker/mod.rs::tick) checks
--   `rule.enabled` before granting an unlock. The edge function selects the
--   column explicitly so its absence is a loud 400 rather than a silent
--   "every rule is active". Work unit 1's scope is the two schedule join
--   tables, so unit 8 adds this.

-- ── blocking_state ───────────────────────────────────────────────────────────
-- Written only by the `focus-evaluate` edge function; read by every client
-- (iPhone widget, Mac grid node, app UI). Clients never re-derive it.
create table if not exists public.blocking_state (
  user_id text primary key default 'default'
);

-- Added column-by-column so this converges no matter which migration created
-- the table first.
alter table public.blocking_state
  add column if not exists effective_domains   jsonb       not null default '[]'::jsonb,
  add column if not exists effective_processes jsonb       not null default '[]'::jsonb,
  add column if not exists reasons             jsonb       not null default '{}'::jsonb,
  add column if not exists today_minutes       integer     not null default 0,
  add column if not exists computed_at         timestamptz not null default now();

comment on table public.blocking_state is
  'Materialized blocking verdict, computed every 5 minutes by the focus-evaluate edge function. One row per user. Do not write from clients.';
comment on column public.blocking_state.reasons is
  'Per-target explanation for the UI. Display only — never load-bearing.';

alter table public.blocking_state enable row level security;

-- Matches the existing productivity tables (blocked_sites, focus_blocks, …).
-- Tighten to auth.uid() when ecosystem auth reaches these tables, not before.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'blocking_state'
      and policyname = 'anon full access'
  ) then
    create policy "anon full access" on public.blocking_state
      for all using (true) with check (true);
  end if;
end $$;

-- ── unlock_rules.enabled ─────────────────────────────────────────────────────
-- Default true so existing rows keep behaving exactly as they do today (the
-- pre-column code path treated every rule as active).
alter table public.unlock_rules
  add column if not exists enabled boolean not null default true;

-- ── pg_cron schedule ─────────────────────────────────────────────────────────
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop the job before recreating so re-running this file doesn't
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
