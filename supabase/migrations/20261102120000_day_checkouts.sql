-- 20261102120000_day_checkouts.sql
--
-- WHAT
--   Adds `day_checkouts` — "finish day": one press unblocks everything for the
--   rest of the local day.
--
-- WHY
--   Meal sessions are a 30-minute valve over a target list. Once the day's
--   work is done there is nothing left to protect, and re-opening sites one
--   meal at a time stops making sense. A checkout frees every blocked domain
--   and process until the local day ends, then everything re-locks on its own.
--
--   As with every blocking rule, NO CLIENT derives policy from these rows.
--   `focus-evaluate` reads them and empties `blocking_state`'s effective sets
--   while today's checkout exists; clients just keep reading that row.
--
-- THE END OF THE DAY IS THE SERVER'S
--   There is no `ends_at` column on purpose. A client-written end would be one
--   devtools call from "until next Tuesday". The evaluator treats a checkout as
--   active only while its `local_date` equals today's date in the evaluator's
--   own timezone, so it lapses at local midnight on the server's clock.
--   `local_date` defaults server-side for the same reason meal_sessions' does.
--   The timezone literal must match TIMEZONE in
--   supabase/functions/focus-evaluate/logic.ts.
--
-- ORDER
--   Apply BEFORE deploying the focus-evaluate that reads it: the function
--   selects this table with fail-loudly semantics, so a missing table aborts
--   every run and the verdict goes stale (still blocked — the safe direction —
--   but frozen).
--
-- RLS POSTURE
--   Anon `USING (true)`, matching the rest of the productivity stack
--   (`meal_sessions`, `blocked_sites`, …). Tighten together with the rest per
--   SECURITY_RLS_MIGRATION.md, not before.

CREATE TABLE IF NOT EXISTS public.day_checkouts (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    text        NOT NULL DEFAULT 'default',
    started_at timestamptz NOT NULL DEFAULT now(),
    local_date date        NOT NULL DEFAULT ((now() AT TIME ZONE 'Europe/Copenhagen')::date),
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.day_checkouts IS
    'One row per "finish day" press. While a row for today''s local date exists, focus-evaluate blocks nothing; it lapses at local midnight. Read only by focus-evaluate.';

-- One checkout per day. Deleting the row (the app's Undo) re-blocks, which is
-- the safe direction, so the cap is about a clean state rather than a loophole.
CREATE UNIQUE INDEX IF NOT EXISTS day_checkouts_once_per_day
    ON public.day_checkouts (user_id, local_date);

ALTER TABLE public.day_checkouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon full access" ON public.day_checkouts;
CREATE POLICY "anon full access" ON public.day_checkouts
    FOR ALL TO anon
    USING (true)
    WITH CHECK (true);
