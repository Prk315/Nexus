-- Protocol: allow decimals in manually-logged workout exercises. sets/reps/
-- duration_min were integer, so a decimal entry (e.g. partial reps or 12.5 min)
-- was rejected by Postgres ("invalid input syntax for type integer"). weight_kg
-- was already numeric. int -> numeric is lossless.
ALTER TABLE protocol_exercises
  ALTER COLUMN sets TYPE numeric USING sets::numeric,
  ALTER COLUMN reps TYPE numeric USING reps::numeric,
  ALTER COLUMN duration_min TYPE numeric USING duration_min::numeric;
