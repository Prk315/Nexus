-- Protocol: capture sleep latency (time to fall asleep). Oura returns `latency`
-- in seconds on each sleep period; we store it as minutes, matching the other
-- protocol_sleep *_min columns. Sleep-onset time is derived in the app as
-- bedtime_start + sleep_latency_min.
ALTER TABLE protocol_sleep ADD COLUMN IF NOT EXISTS sleep_latency_min integer;
