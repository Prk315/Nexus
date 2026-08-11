-- DAG-v2: per-concept importance = PageRank on the REVERSED prerequisite
-- graph (foundations score high), computed per course by the importance
-- backfill script and used by learn-evaluate v2's priority formula.
ALTER TABLE lr_concept ADD COLUMN IF NOT EXISTS importance double precision;
