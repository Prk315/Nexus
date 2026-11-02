-- 20261028120000_pomodoro_run_state.sql
--
-- WHAT
--   Adds the live pomodoro run to `pomodoro_config`: which phase is running,
--   how many focus blocks are done, and either the deadline (clock running) or
--   the seconds left (clock held).
--
-- WHY
--   The phase machine used to live in the WebView's memory, so a reload, a
--   closed window or a second device started the cycle over — and breaks were
--   billed as work, because nothing paused the session at a phase boundary.
--   Rust now drives the cycle (`apps/NexusLocal/src-tauri/src/timetracker/pomodoro.rs`)
--   and needs somewhere durable to keep it.
--
-- ORDER
--   Requires `20260805120100_pomodoro_config.sql`. Purely additive: deployed
--   code reads `select=*` and ignores columns it does not know.
--
-- CONCURRENCY
--   `run_rev` is a compare-and-swap counter. Every run write is a PATCH filtered
--   on `run_rev=eq.<read value>` that bumps it, so when the Mac and the phone
--   both see a deadline pass, exactly one of them applies the transition (and
--   pauses or resumes the session); the other matches zero rows and re-reads.
--
-- INVARIANT
--   `run_phase IS NULL` means no run. Otherwise exactly one of `run_ends_at`
--   (armed) and `run_held_seconds` (held) is set. Not a CHECK constraint on
--   purpose — a reader that meets a broken row treats it as "no run" rather
--   than failing, and a constraint would turn a client bug into a write error
--   the widget cannot surface.
--
-- RLS POSTURE
--   Unchanged: the table's existing anon "full access" policy covers the new
--   columns. See `SECURITY_RLS_MIGRATION.md`.

ALTER TABLE public.pomodoro_config
    ADD COLUMN IF NOT EXISTS run_phase        text,
    ADD COLUMN IF NOT EXISTS run_completed    integer     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS run_ends_at      timestamptz,
    ADD COLUMN IF NOT EXISTS run_held_seconds integer,
    ADD COLUMN IF NOT EXISTS run_rev          bigint      NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.pomodoro_config.run_phase IS
    'work | break | long_break, or NULL when no pomodoro is running.';
COMMENT ON COLUMN public.pomodoro_config.run_rev IS
    'Compare-and-swap counter: every run write filters on the value it read and increments it.';
