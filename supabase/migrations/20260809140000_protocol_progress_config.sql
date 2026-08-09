-- Protocol: per-activity progress-tracking config for the Workouts progress cards.
-- One row per (user, activity) holding which biomarkers to chart, which specific
-- exercises' weight/1RM to track (strength) and which run metrics to track
-- (running). Moved here from localStorage so the config syncs across devices.

CREATE TABLE IF NOT EXISTS protocol_progress_config (
  user_id      text NOT NULL,
  activity     text NOT NULL,               -- 'running' | 'strength'
  biomarkers   text[] NOT NULL DEFAULT '{}',
  exercises    text[] NOT NULL DEFAULT '{}',
  run_metrics  text[] NOT NULL DEFAULT '{}',
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, activity)
);
ALTER TABLE protocol_progress_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_all ON protocol_progress_config;
CREATE POLICY owner_all ON protocol_progress_config FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text) WITH CHECK (user_id = (SELECT auth.uid())::text);
