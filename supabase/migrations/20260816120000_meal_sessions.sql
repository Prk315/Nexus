-- 20260816120000_meal_sessions.sql
--
-- WHAT
--   Adds the two tables behind meal sessions — a 30-minute, user-initiated
--   unblock of specific sites/apps at breakfast, lunch and dinner:
--
--     meal_unlock_targets  which domains/processes each meal opens (config)
--     meal_sessions        one row per activation (the event log)
--
-- WHY
--   The block lists are deliberately one-way in the app (no delete, no off
--   switch), which also removes the legitimate "I'm eating, let me watch
--   something" case. A meal session is the sanctioned valve: bounded to 30
--   minutes, capped at one activation per meal per local day, and scoped to an
--   explicit target list rather than "everything".
--
--   As with every other blocking rule, NO CLIENT derives policy from these rows.
--   The `focus-evaluate` edge function reads them on its pg_cron pass (and on
--   the poke the app sends at activation) and removes active meal targets from
--   `blocking_state.effective_domains` / `effective_processes`. Clients keep
--   reading that one row and act.
--
-- ORDER
--   Standalone — no dependency on other migration files. But it MUST be applied
--   BEFORE the updated `focus-evaluate` is deployed: the function selects these
--   tables with fail-loudly semantics, so a missing table aborts every run and
--   the verdict goes stale (still blocked — the safe direction — but frozen).
--
-- ONCE PER DAY
--   Enforced by a unique index on (user_id, meal, local_date), not by the UI.
--   Re-activation is the obvious loophole in a 30-minute valve; a UI-only guard
--   is one devtools call away from being no guard at all. `local_date` defaults
--   server-side to the Copenhagen calendar date so the client cannot shift the
--   day boundary. The timezone literal must match TIMEZONE in
--   supabase/functions/focus-evaluate/logic.ts.
--
-- RLS POSTURE
--   Deliberately permissive: anon-role `USING (true) WITH CHECK (true)`,
--   matching every table in the productivity stack (`blocked_sites`,
--   `blocking_state`, …). These rows hold meal names and domains, not URLs or
--   titles — nothing like `usage_intervals`. Tighten together with the rest of
--   the stack per SECURITY_RLS_MIGRATION.md, not before.

CREATE TABLE IF NOT EXISTS public.meal_unlock_targets (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      text        NOT NULL DEFAULT 'default',
    meal         text        NOT NULL,
    -- Exactly one of domain / process_name per row (unlike unlock_rules, which
    -- tolerates both): the UI renders targets as single chips, and a two-target
    -- row would need to be half-deleted.
    domain       text,
    process_name text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT meal_unlock_targets_meal_check
        CHECK (meal IN ('breakfast', 'lunch', 'dinner')),
    CONSTRAINT meal_unlock_targets_one_target
        CHECK ((domain IS NULL) <> (process_name IS NULL))
);

COMMENT ON TABLE public.meal_unlock_targets IS
    'Which blocked domains/processes each meal session opens. Read only by the focus-evaluate edge function; clients must not derive policy from it.';

CREATE TABLE IF NOT EXISTS public.meal_sessions (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    text        NOT NULL DEFAULT 'default',
    meal       text        NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    -- Set by the client to started_at + 30 min. The duration is app policy, not
    -- schema policy — the column keeps the evaluator free of a hardcoded 30.
    ends_at    timestamptz NOT NULL,
    -- The local calendar day the activation belongs to, for the once-per-day
    -- cap. Server-side default so the client cannot move the day boundary.
    -- Keep the zone in sync with TIMEZONE in focus-evaluate/logic.ts.
    local_date date        NOT NULL DEFAULT ((now() AT TIME ZONE 'Europe/Copenhagen')::date),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT meal_sessions_meal_check
        CHECK (meal IN ('breakfast', 'lunch', 'dinner'))
);

COMMENT ON TABLE public.meal_sessions IS
    'One row per meal-session activation. A meal''s targets are unblocked while started_at <= now < ends_at. Unique per (user_id, meal, local_date) — one activation per meal per local day, enforced here rather than in the UI.';

-- The once-per-day cap. A UNIQUE INDEX rather than a table constraint so the
-- file stays re-runnable (`IF NOT EXISTS` — constraints have no such form on
-- ADD CONSTRAINT in older Postgres).
CREATE UNIQUE INDEX IF NOT EXISTS meal_sessions_once_per_day
    ON public.meal_sessions (user_id, meal, local_date);

-- focus-evaluate fetches only potentially-active rows: `ends_at > now()`.
CREATE INDEX IF NOT EXISTS meal_sessions_ends_at_idx
    ON public.meal_sessions (ends_at);

ALTER TABLE public.meal_unlock_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_sessions       ENABLE ROW LEVEL SECURITY;

-- Postgres has no CREATE POLICY IF NOT EXISTS; drop-then-create keeps the file
-- re-runnable.
DROP POLICY IF EXISTS "anon full access" ON public.meal_unlock_targets;
CREATE POLICY "anon full access" ON public.meal_unlock_targets
    FOR ALL TO anon
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "anon full access" ON public.meal_sessions;
CREATE POLICY "anon full access" ON public.meal_sessions
    FOR ALL TO anon
    USING (true)
    WITH CHECK (true);
