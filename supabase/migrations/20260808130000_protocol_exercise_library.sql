-- Protocol: exercise library — a shared reference set of ~870 exercises with the
-- muscles they train (from the public-domain free-exercise-db). Read by everyone;
-- powers a searchable exercise picker in the routine designer. Prescribed
-- exercises additionally store the muscles of the picked exercise.

CREATE TABLE IF NOT EXISTS protocol_exercise_library (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  category          text,
  equipment         text,
  force             text,
  level             text,
  mechanic          text,
  primary_muscles   text[] NOT NULL DEFAULT '{}',
  secondary_muscles text[] NOT NULL DEFAULT '{}',
  instructions      text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS protocol_exercise_library_name_idx ON protocol_exercise_library (lower(name));
ALTER TABLE protocol_exercise_library ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_read ON protocol_exercise_library;
CREATE POLICY anon_read ON protocol_exercise_library FOR SELECT TO public USING (true);

-- Prescribed exercises remember the muscles of the library exercise they came
-- from (null when free-typed), enabling a "muscles trained" summary per routine.
ALTER TABLE protocol_routine_exercises ADD COLUMN IF NOT EXISTS primary_muscles text[];
ALTER TABLE protocol_routine_exercises ADD COLUMN IF NOT EXISTS secondary_muscles text[];
