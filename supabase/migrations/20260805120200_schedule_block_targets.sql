-- 20260805120200_schedule_block_targets.sql
--
-- WHAT
--   Adds `schedule_block_apps` and `schedule_block_sites` — the payload of a
--   focus block: which processes and which domains that block blocks.
--
-- WHY
--   This is the important gap in the TimeTracker port. In TimeTracker these two
--   tables exist only in local SQLite (`focus_schedule_blocks` +
--   `schedule_block_apps` / `schedule_block_sites`) and never reach the cloud;
--   only the parent `focus_blocks` row syncs. So a synced focus block says
--   *when* to block but not *what*, and the `focus-evaluate` edge function has
--   nothing to act on. These tables are what make a schedule created on the
--   phone mean something to the server-side evaluator.
--
-- ORDER
--   Requires `focus_blocks` to exist (it does — live since the TimeTracker era).
--   Otherwise standalone; no dependency on the other files in this batch.
--
-- NO user_id COLUMN — DELIBERATE
--   The repo-wide convention is `user_id text default 'default'` on root-level
--   tables. These are not root-level: they are child rows of a focus block.
--   Ownership comes through `block_id` -> `focus_blocks.user_id`, and
--   `ON DELETE CASCADE` means deleting a block takes its payload with it.
--   Duplicating `user_id` here would create a second source of truth that can
--   drift from the parent. The evaluator joins through `focus_blocks` to scope
--   by user.
--
-- UPSERT TARGETS
--   `schedule_block_apps`  -> UNIQUE (block_id, process_name)
--   `schedule_block_sites` -> UNIQUE (block_id, domain)
--   PostgREST writers MUST send `on_conflict=block_id,process_name` (resp.
--   `on_conflict=block_id,domain`). PostgREST defaults `on_conflict` to the
--   primary key, which here is the surrogate `id` — a client that omits it
--   never merges and the real unique violation surfaces as an opaque HTTP 409.
--
-- RLS POSTURE
--   Deliberately permissive: RLS enabled with a single anon-role policy
--   `USING (true) WITH CHECK (true)`, matching every existing table in the
--   productivity stack. Tightening to `auth.uid()` now would break every
--   existing client.

CREATE TABLE IF NOT EXISTS public.schedule_block_apps (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    block_id     uuid        NOT NULL REFERENCES public.focus_blocks(id) ON DELETE CASCADE,
    -- macOS process name, matching `blocked_apps.process_name`.
    process_name text        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (block_id, process_name)
);

CREATE TABLE IF NOT EXISTS public.schedule_block_sites (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    block_id   uuid        NOT NULL REFERENCES public.focus_blocks(id) ON DELETE CASCADE,
    -- Bare domain, matching `blocked_sites.domain` (e.g. "youtube.com").
    domain     text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (block_id, domain)
);

COMMENT ON TABLE public.schedule_block_apps IS
    'Processes blocked by a focus block. Child of focus_blocks; no user_id — ownership comes through block_id.';
COMMENT ON TABLE public.schedule_block_sites IS
    'Domains blocked by a focus block. Child of focus_blocks; no user_id — ownership comes through block_id.';

-- The evaluator's access path is "for each enabled block, fetch its payload".
-- The UNIQUE constraints' indexes are (block_id, …) and would serve a lookup by
-- block_id alone, but a dedicated narrow index keeps that plan cheap as the
-- tables grow and makes the intent explicit.
CREATE INDEX IF NOT EXISTS schedule_block_apps_block_id_idx
    ON public.schedule_block_apps (block_id);
CREATE INDEX IF NOT EXISTS schedule_block_sites_block_id_idx
    ON public.schedule_block_sites (block_id);

ALTER TABLE public.schedule_block_apps  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_block_sites ENABLE ROW LEVEL SECURITY;

-- Postgres has no CREATE POLICY IF NOT EXISTS; drop-then-create keeps the file
-- re-runnable.
DROP POLICY IF EXISTS "anon full access" ON public.schedule_block_apps;
CREATE POLICY "anon full access" ON public.schedule_block_apps
    FOR ALL TO anon
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "anon full access" ON public.schedule_block_sites;
CREATE POLICY "anon full access" ON public.schedule_block_sites
    FOR ALL TO anon
    USING (true)
    WITH CHECK (true);
