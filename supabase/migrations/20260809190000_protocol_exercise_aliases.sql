-- Protocol: user-defined friendly names for imported Garmin exercises. Garmin
-- often leaves exercise_name null and only gives a category (e.g. PULL_UP), so
-- this maps that source key to a name the user picks; strength progress tracks by
-- the friendly name. One row per (user, source_key).
CREATE TABLE IF NOT EXISTS protocol_exercise_aliases (
  user_id      text NOT NULL,
  source_key   text NOT NULL,
  display_name text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source_key)
);
ALTER TABLE protocol_exercise_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_all ON protocol_exercise_aliases;
CREATE POLICY owner_all ON protocol_exercise_aliases FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text) WITH CHECK (user_id = (SELECT auth.uid())::text);
