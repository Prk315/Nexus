-- Richer Oura sleep data for the dedicated SleepChart: daily_sleep contributors
-- (Oura's own 0–100 subscores) and the sleep_time endpoint's ideal-bedtime
-- recommendation. Written by oura-sync; read via SleepEntry (select *).
alter table public.protocol_sleep
  add column if not exists contributor_deep_sleep integer,
  add column if not exists contributor_efficiency integer,
  add column if not exists contributor_latency integer,
  add column if not exists contributor_rem_sleep integer,
  add column if not exists contributor_restfulness integer,
  add column if not exists contributor_timing integer,
  add column if not exists contributor_total_sleep integer,
  -- sleep_time: optimal bedtime window as seconds from midnight (may be negative
  -- = before midnight), plus Oura's recommendation / status enums.
  add column if not exists optimal_bedtime_start integer,
  add column if not exists optimal_bedtime_end integer,
  add column if not exists bedtime_recommendation text,
  add column if not exists sleep_time_status text;
