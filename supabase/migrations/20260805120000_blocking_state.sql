-- 20260805120000_blocking_state.sql
--
-- WHAT
--   Adds `blocking_state` — the materialized blocking verdict, one row per user.
--
-- WHY
--   Nexus Local is a sideloaded free-tier iOS app: no BGTaskScheduler, no silent
--   push, no background execution beyond `bluetooth-central`. The only things
--   that run with the app closed are widget TimelineProviders, edge functions
--   invoked with a scoped secret, and pg_cron. So no client may derive blocking
--   policy — a schedule window can open and a reward can unlock while every
--   device is asleep. Instead the `focus-evaluate` edge function (work unit 8)
--   runs on pg_cron and collapses `focus_blocks` + `schedule_block_apps` +
--   `schedule_block_sites` + `unlock_rules` + `blocked_sites` + `blocked_apps` +
--   today's `time_entries` into this single row. Every client — the iPhone
--   widget, the Mac grid node, the app UI — reads it and acts. None re-derive it.
--
-- ORDER
--   Standalone. No dependency on the other files in this batch. `focus-evaluate`
--   is deployed separately (`supabase functions deploy`) and its pg_cron
--   schedule is not created here.
--
-- UPSERT TARGET
--   Primary key `(user_id)`. PostgREST writers must send
--   `on_conflict=user_id`; the default (also the PK here) happens to match, but
--   state it explicitly so a later composite key change surfaces as a code
--   change rather than an opaque HTTP 409.
--
-- RLS POSTURE
--   Deliberately permissive: RLS enabled with a single anon-role policy
--   `USING (true) WITH CHECK (true)`, matching every existing table in the
--   productivity stack (`time_entries`, `blocked_sites`, `focus_blocks`, …).
--   Tightening to `auth.uid()` now would break every existing client, all of
--   which write `user_id = 'default'` with the anon key and no JWT. Tighten when
--   ecosystem auth reaches these tables — not before.

CREATE TABLE IF NOT EXISTS public.blocking_state (
    user_id             text        PRIMARY KEY DEFAULT 'default',
    -- Domains blocked right now. jsonb array of strings, e.g. ["youtube.com"].
    effective_domains   jsonb       NOT NULL DEFAULT '[]'::jsonb,
    -- macOS process names blocked right now, e.g. ["Slack","Discord"].
    effective_processes jsonb       NOT NULL DEFAULT '[]'::jsonb,
    -- Per-target explanation for the UI. DISPLAY ONLY — never read for logic.
    -- Shape (object keyed by domain or process name):
    --   {"youtube.com": {"blocked": true,  "source": "focus_block",
    --                    "block_name": "Deep work"},
    --    "reddit.com":  {"blocked": false, "source": "unlock_rule",
    --                    "required_minutes": 60, "today_minutes": 72}}
    reasons             jsonb       NOT NULL DEFAULT '{}'::jsonb,
    -- Minutes of completed time entries today, so clients can render reward
    -- progress without recomputing it (and disagreeing with each other).
    today_minutes       integer     NOT NULL DEFAULT 0,
    computed_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.blocking_state IS
    'Materialized blocking verdict, one row per user. Written only by the focus-evaluate edge function on pg_cron; read by every client. Clients must not re-derive policy.';
COMMENT ON COLUMN public.blocking_state.reasons IS
    'Per-target explanation for the UI. Display only — never branch on this.';

ALTER TABLE public.blocking_state ENABLE ROW LEVEL SECURITY;

-- Postgres has no CREATE POLICY IF NOT EXISTS; drop-then-create keeps the file
-- re-runnable.
DROP POLICY IF EXISTS "anon full access" ON public.blocking_state;
CREATE POLICY "anon full access" ON public.blocking_state
    FOR ALL TO anon
    USING (true)
    WITH CHECK (true);

-- NO SEED ROW — deliberate. `focus-evaluate` creates the row on its first run.
-- A missing row means "no verdict has ever been computed", which is genuinely
-- different from "computed, nothing is blocked"; seeding zeros here would
-- collapse the two and hand clients a `computed_at` that looks fresh for the
-- first few minutes after the migration lands. Clients must treat a missing row
-- as "no verdict yet" and block nothing.
