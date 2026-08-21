-- 20260821120000_coverage_categories.sql
--
-- Phase E of DAY_COVERAGE_ROADMAP.md: the shared category vocabulary.
--
--   coverage_categories  one row per category; seeded from the CATEGORIES
--                        constant in nexus-core (names MUST match it verbatim —
--                        calendar rows created by gap chips use these strings
--                        as titles, and title-prefix matching is the fallback
--                        for pre-E rows). weekly_target_min NULL = no budget.
--   app_category_map     process_name -> category name. Config, not usage data:
--                        app *names* are deliberately synced (decided
--                        2026-08-21); intervals still never leave the Mac.
--
-- pf_cal_blocks.category is TEXT with no FK: categories are matched by name
-- (same looseness as title-prefix fallback), and a FK would block future
-- custom categories. NOT the same thing as pf_tasks.category (quick-task
-- kinds: reminder/chore/shopping) — do not unify.
--
-- RLS: permissive anon, matching the productivity stack (blocked_sites, ...).
-- Tighten with the rest per SECURITY_RLS_MIGRATION.md, not before.

CREATE TABLE IF NOT EXISTS public.coverage_categories (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           text        NOT NULL DEFAULT 'default',
    name              text        NOT NULL,
    color             text        NOT NULL,
    emoji             text,
    sort              integer     NOT NULL DEFAULT 0,
    weekly_target_min integer,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT coverage_categories_unique UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS public.app_category_map (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      text        NOT NULL DEFAULT 'default',
    process_name text        NOT NULL,
    category     text        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_category_map_unique UNIQUE (user_id, process_name)
);

ALTER TABLE public.pf_cal_blocks           ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.pf_recurring_cal_blocks ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE public.coverage_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_category_map    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon full access" ON public.coverage_categories;
CREATE POLICY "anon full access" ON public.coverage_categories
    FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon full access" ON public.app_category_map;
CREATE POLICY "anon full access" ON public.app_category_map
    FOR ALL TO anon USING (true) WITH CHECK (true);

-- Seed from the CATEGORIES constant. ON CONFLICT keeps the file re-runnable
-- and preserves user-edited budgets/colors on re-apply.
INSERT INTO public.coverage_categories (user_id, name, color, emoji, sort) VALUES
  ('default', 'Deep work', 'blue',    '🎯', 0),
  ('default', 'Training',  'green',   '🏋️', 1),
  ('default', 'Reading',   'violet',  '📖', 2),
  ('default', 'Social',    'pink',    '👥', 3),
  ('default', 'Errands',   'orange',  '🚗', 4),
  ('default', 'Meals',     'emerald', '🍽️', 5),
  ('default', 'Rest',      'teal',    '🌙', 6)
ON CONFLICT (user_id, name) DO NOTHING;
