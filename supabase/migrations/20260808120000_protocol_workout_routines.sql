-- Protocol: training-program designer. A WorkoutPlan (program) holds routines
-- (training days like "Push A"); each routine holds prescribed exercises with
-- target sets/reps/rest/weight/RPE. Logging reuses protocol_workout_sessions +
-- protocol_exercises (per-exercise actuals); a session links back to its routine.

CREATE TABLE IF NOT EXISTS protocol_workout_routines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,
  plan_id     uuid,                 -- nullable: a routine can be standalone
  name        text NOT NULL,
  day_label   text,                 -- e.g. "Day 1", "Push A"
  sort_order  integer NOT NULL DEFAULT 0,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE protocol_workout_routines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_all ON protocol_workout_routines;
CREATE POLICY owner_all ON protocol_workout_routines FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text) WITH CHECK (user_id = (SELECT auth.uid())::text);

CREATE TABLE IF NOT EXISTS protocol_routine_exercises (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text NOT NULL,
  routine_id       uuid NOT NULL REFERENCES protocol_workout_routines(id) ON DELETE CASCADE,
  name             text NOT NULL,
  target_sets      integer,
  target_reps      text,            -- text so ranges like "8-12" are allowed
  rest_sec         integer,         -- restitution between sets
  target_weight_kg numeric,
  target_rpe       numeric,
  tempo            text,
  sort_order       integer NOT NULL DEFAULT 0,
  notes            text
);
CREATE INDEX IF NOT EXISTS protocol_routine_exercises_routine_idx ON protocol_routine_exercises (routine_id);
ALTER TABLE protocol_routine_exercises ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_all ON protocol_routine_exercises;
CREATE POLICY owner_all ON protocol_routine_exercises FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text) WITH CHECK (user_id = (SELECT auth.uid())::text);

-- Link a logged session back to the routine it came from (nullable).
ALTER TABLE protocol_workout_sessions ADD COLUMN IF NOT EXISTS routine_id uuid;
