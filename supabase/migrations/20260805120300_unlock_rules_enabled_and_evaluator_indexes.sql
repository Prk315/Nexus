-- 20260805120300_unlock_rules_enabled_and_evaluator_indexes.sql
--
-- WHAT
--   1. `unlock_rules.enabled boolean NOT NULL DEFAULT true`.
--   2. The three indexes the `focus-evaluate` edge function's queries need.
--
-- WHY (1)
--   The local SQLite table (`time_unlock_rules`) has an `enabled` column and the
--   UI toggles it, but it was never added to the cloud table. Disabling a rule
--   was therefore silently local-only: the row still synced as active and any
--   other device — and the server-side evaluator — kept honouring it. Default
--   `true` so every existing row keeps its current (enabled) behaviour.
--
-- WHY (2)
--   `focus-evaluate` runs on pg_cron and its three hot queries are:
--     - today's completed entries:   time_entries  WHERE user_id = $1 AND start_time >= $2 AND start_time < $3
--     - active schedule windows:     focus_blocks  WHERE user_id = $1 AND enabled
--     - live reward rules:           unlock_rules  WHERE user_id = $1 AND enabled
--
-- ORDER
--   The ALTER MUST run before `unlock_rules_user_id_enabled_idx` — the index
--   references the column the ALTER adds. Both live in this file, in that order,
--   so the dependency cannot be broken by applying files out of order or
--   re-running one in isolation. This file is otherwise independent of the other
--   three in this batch.
--
-- NOTES FOR THE EVALUATOR (work unit 8)
--   - `time_entries.start_time` is `text`, not `timestamptz`, and
--     `time_entries.user_id` is nullable with no default. The
--     `(user_id, start_time)` btree only helps if the evaluator writes range
--     predicates over the ISO-8601 text ordering
--     (`start_time >= '2026-08-05' AND start_time < '2026-08-06'`). A
--     `LIKE '2026-08-05%'` or a `substring(...)` predicate will not use it.
--     Rows with a NULL `user_id` are not matched by `user_id = 'default'`.
--   - `unlock_rules` carries a live CHECK enforcing exactly one of
--     `process_name` / `domain` is non-null. Adding `enabled` does not touch it,
--     but a writer that sends both fields gets a constraint violation, not a
--     silently-ignored null.
--
-- RLS POSTURE
--   Unchanged. `unlock_rules` already has RLS enabled with a permissive
--   anon-role policy; adding a column does not affect it, and the posture stays
--   deliberately permissive until ecosystem auth reaches these tables.

-- 1. The missing column. Must precede the index below.
ALTER TABLE public.unlock_rules
    ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.unlock_rules.enabled IS
    'Mirrors the local SQLite column the UI toggles. Absent from the cloud table until 2026-08-05, which made disabling a rule silently local-only.';

-- 2. Evaluator indexes.
CREATE INDEX IF NOT EXISTS time_entries_user_id_start_time_idx
    ON public.time_entries (user_id, start_time);

CREATE INDEX IF NOT EXISTS focus_blocks_user_id_enabled_idx
    ON public.focus_blocks (user_id, enabled);

CREATE INDEX IF NOT EXISTS unlock_rules_user_id_enabled_idx
    ON public.unlock_rules (user_id, enabled);
