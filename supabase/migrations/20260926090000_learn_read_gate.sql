-- The read-gate: a concept must have been READ in its book before the daily
-- lesson serves it as new material — which, composed with the existing
-- evidence gate on review, yields the lifecycle READ -> PRACTICED -> RETAINED
-- (only read-and-practiced concepts ever enter spaced repetition).
--
-- Two ways a material maps reading position onto the concept graph's chapters:
--   unit_label = 'chapters'  -> position IS the chapter (floor)
--   chapter_pages jsonb      -> {"1":[38,51],...} page ranges (KF's PDF TOC map);
--                               read chapter = highest chapter whose end <= position
-- chapter_prefix names WHICH book inside an lr_course the material is
-- (course 7 mixes DM/MLSU/OPT topic prefixes — same convention as
-- lr_course_enrollment.chapter_prefix).

alter table lr_materials add column if not exists chapter_prefix text;
alter table lr_materials add column if not exists chapter_pages jsonb;
