-- Infinite exercises: structured render layer over the ported item bank.
-- The raw lr_item prompts are marker/LLM extractions: one row per exam
-- sub-part, with the parent problem's introduction duplicated into each
-- prompt and stray HTML (<sup>…</sup>) from the PDF conversion. This table
-- holds the cleaned, structured form; lr_item stays untouched as the source
-- of truth. Rows are written by the enrichment pass; the app falls back to
-- lr_item.prompt when a row is missing.
CREATE TABLE IF NOT EXISTS lr_item_render (
  item_id     bigint PRIMARY KEY REFERENCES lr_item(item_id),
  group_key   text NOT NULL,       -- shared by sub-parts of one exam problem
  part_label  text,                -- "(b)" · null for single-part problems
  intro_md    text,                -- the problem's shared setup (may be null)
  task_md     text NOT NULL,       -- the actual ask for THIS sub-part
  context_md  text,                -- trailing application/aside notes
  solution_md text,                -- cleaned solution (KaTeX, no raw HTML)
  cleaned_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lr_item_render_group_idx ON lr_item_render (group_key);

DO $$
BEGIN
  EXECUTE 'ALTER TABLE lr_item_render ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'lr_item_render' AND policyname = 'anon_all'
  ) THEN
    EXECUTE 'CREATE POLICY anon_all ON lr_item_render FOR ALL USING (true) WITH CHECK (true)';
  END IF;
END $$;
