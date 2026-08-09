-- Make importing the same Garmin activity twice impossible at the database
-- level, rather than relying on every writer to behave.
--
-- # The bug this closes
--
-- `protocol_running_sessions` and `protocol_workout_sessions` are unique on `id`
-- alone, and Protocol's importer mints `crypto.randomUUID()` on every sync. So
-- syncing the same week twice inserted every activity twice, with nothing to
-- stop it — which is exactly how a duplicate "Strength 2026-08-01" ended up in
-- this database.
--
-- `garmin-import` derives its `id` deterministically from Garmin's activity id,
-- which fixes it for that path. This constraint fixes it for *every* path: a
-- second insert of the same external activity now fails loudly instead of
-- silently duplicating.
--
-- # Why NOT a partial index
--
-- The obvious `where external_id is not null` breaks upserts: PostgREST's
-- `on_conflict` cannot infer a partial index (ON CONFLICT needs the predicate
-- spelled out, which it does not send), so every import fails with "no unique
-- or exclusion constraint matching the ON CONFLICT specification".
--
-- It is also unnecessary. Postgres treats NULLs as DISTINCT in a unique index,
-- so a plain UNIQUE (user_id, external_id) already permits any number of
-- manual rows with a NULL external_id — two hand-entered "Strength" workouts
-- on one day stay perfectly legal.
--
-- # Why exercise sets are deliberately excluded
--
-- Duplicate-looking rows in `protocol_exercise_sets` are REAL: three sets of
-- 10 reps at 60 kg on the same day is three rows that differ in nothing a
-- constraint could see. Garmin gives sets no stable per-set id, so they are
-- deduped by replacing the whole date range on import instead.

alter table protocol_running_sessions
  add column if not exists external_id text;
alter table protocol_workout_sessions
  add column if not exists external_id text;

comment on column protocol_running_sessions.external_id is
  'Garmin activityId (or other source id). NULL for manual entries. Unique per user when set.';
comment on column protocol_workout_sessions.external_id is
  'Garmin activityId (or other source id). NULL for manual entries. Unique per user when set.';

create unique index if not exists protocol_running_sessions_external
  on protocol_running_sessions (user_id, external_id);

create unique index if not exists protocol_workout_sessions_external
  on protocol_workout_sessions (user_id, external_id);
