-- 20260805120100_pomodoro_config.sql
--
-- WHAT
--   Adds `pomodoro_config` — durable pomodoro settings, one row per user.
--
-- WHY
--   TimeTracker kept these in a Redux slice with no persistence call, so every
--   duration reset to its default on launch. The phase machine itself stays in
--   TypeScript (a 1s interval is a WebView concern); what the server owns is the
--   config, so a duration set on the phone survives a relaunch and is the same
--   on the Mac.
--
-- ORDER
--   Standalone. No dependency on the other files in this batch.
--
-- UPSERT TARGET
--   Primary key `(user_id)`. PostgREST writers must send `on_conflict=user_id`.
--
-- RLS POSTURE
--   Deliberately permissive: RLS enabled with a single anon-role policy
--   `USING (true) WITH CHECK (true)`, matching every existing table in the
--   productivity stack. Tightening to `auth.uid()` now would break every
--   existing client — they all write `user_id = 'default'` with the anon key and
--   no JWT.

CREATE TABLE IF NOT EXISTS public.pomodoro_config (
    user_id            text        PRIMARY KEY DEFAULT 'default',
    enabled            boolean     NOT NULL DEFAULT false,
    work_minutes       integer     NOT NULL DEFAULT 25,
    break_minutes      integer     NOT NULL DEFAULT 5,
    long_break_minutes integer     NOT NULL DEFAULT 15,
    sessions_per_cycle integer     NOT NULL DEFAULT 4,
    updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pomodoro_config IS
    'Durable pomodoro settings. The phase machine runs client-side; only the config is persisted here.';

ALTER TABLE public.pomodoro_config ENABLE ROW LEVEL SECURITY;

-- Postgres has no CREATE POLICY IF NOT EXISTS; drop-then-create keeps the file
-- re-runnable.
DROP POLICY IF EXISTS "anon full access" ON public.pomodoro_config;
CREATE POLICY "anon full access" ON public.pomodoro_config
    FOR ALL TO anon
    USING (true)
    WITH CHECK (true);

-- Seed the 'default' row so a first read returns the documented defaults rather
-- than an empty set the client has to invent values for.
INSERT INTO public.pomodoro_config (user_id)
VALUES ('default')
ON CONFLICT (user_id) DO NOTHING;
