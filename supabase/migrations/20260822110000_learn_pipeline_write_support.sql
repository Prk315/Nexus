-- Book-ingestion pipeline write support: the LearnAndRetain pipeline
-- upserts lr_unit on (course_id, code) and writes the multiple_choice_item
-- marker table the lr_ port dropped. Applied live 2026-08-22.
CREATE UNIQUE INDEX IF NOT EXISTS lr_unit_course_code_key ON lr_unit (course_id, code);

CREATE TABLE IF NOT EXISTS lr_multiple_choice_item (
  item_id bigint PRIMARY KEY REFERENCES lr_item(item_id)
);
ALTER TABLE lr_multiple_choice_item ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lr_multiple_choice_item' AND policyname='anon_all') THEN
    CREATE POLICY anon_all ON lr_multiple_choice_item FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
