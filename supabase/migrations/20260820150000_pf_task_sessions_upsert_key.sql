-- Make the session occurrence key upsertable.
--
-- `pf_task_sessions_occurrence_key` was created PARTIAL (`where cal_block_id is
-- not null`), which reads sensibly but breaks the only write path that uses it:
-- PostgREST issues `on_conflict=task_id,cal_block_id`, and Postgres cannot infer
-- a partial index from a bare column list. Ticking a scheduled block off failed
-- with "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification".
--
-- This is the same trap CLAUDE.md records for garmin-import's
-- `(user_id, external_id)` index, and the fix is the same: drop the WHERE.
-- Nothing is lost by doing so — Postgres treats NULLs as distinct in a unique
-- index by default, so freehand sessions (no calendar block) remain
-- unconstrained and a task can still have many of them.

drop index if exists public.pf_task_sessions_occurrence_key;

create unique index if not exists pf_task_sessions_occurrence_key
  on public.pf_task_sessions(task_id, cal_block_id);
