-- Daily lesson system for the Learn (lr_) module — LEARN_PLAN.md
-- "Dagens lektion — daily course-oriented lessons (pinned, 2026-09-09)".
--
-- Two additive tables. Nothing is dropped or altered, so this is safe to apply
-- in any order relative to a deploy (CLAUDE.md: additive changes are unordered,
-- REMOVALS are strictly ordered — there are none here).
--
-- ── Why an enrollment table at all ──────────────────────────────────────────
-- `lr_course` holds every book we have ever ingested (10 courses today). Which
-- of them the learner is actually TAKING this term is a different fact, it
-- changes every four months, and it is nowhere in the schema. Without it a
-- "daily lesson" can only walk the graph from the start of some book — which is
-- exactly the thing that makes a study tool feel unrelated to the course you
-- are sitting in on Tuesday.
--
-- So enrollment carries the two things the selector cannot derive:
--
--   1. WHERE THE COURSE IS. `term_start` + `week1_chapter` + `chapters_per_week`
--      give a chapter ceiling for today; `chapter_override` wins when the real
--      pace diverges (it always eventually does). The ceiling is what stops the
--      lesson handing over chapter 9 material in teaching week 2 — a pure DAG
--      frontier has no notion of "the course has not been there yet".
--   2. WHEN THE COURSE HAPPENS. `lecture_dow` / `exercise_dow` decide the day's
--      PHASE — prime before the lecture, consolidate after it, maintain in
--      between. This is derivable from teaching rhythm and must not be a
--      user-set preference: "should today be new material or review?" has a
--      correct answer that depends on the calendar, not on mood.
--
-- ⚠️ `lecture_dow` / `exercise_dow` are **0 = Sunday**, matching
-- `pf_recurring_cal_blocks` (CLAUDE.md: PathFinder's weekday numbering is
-- explicitly NOT ISO 1–7). Two conventions live one function apart in this
-- database already; using the wrong one shifts every lesson a day.
--
-- `plan_id` points at `pf_plans.id` and is deliberately NOT a foreign key —
-- same posture as `pf_task_sessions.cal_block_id`. It is a soft join used to
-- read graded events (assignments, quizzes) for urgency weighting; a course
-- with no PathFinder plan simply gets no urgency boost rather than failing to
-- enroll.

CREATE TABLE IF NOT EXISTS lr_course_enrollment (
  user_id           text    NOT NULL DEFAULT 'default',
  c_id              bigint  NOT NULL REFERENCES lr_course(c_id) ON DELETE CASCADE,
  -- What the learner calls it ("REX"), which is rarely the book's title.
  label             text    NOT NULL,
  -- Soft join to pf_plans.id. NULL = no graded-event urgency for this course.
  plan_id           bigint,
  -- How this course's chapters are encoded in lr_topic.title ('PR' → "PR 2.4").
  chapter_prefix    text    NOT NULL,
  -- Monday of teaching week 1.
  term_start        date    NOT NULL,
  week1_chapter     integer NOT NULL DEFAULT 1,
  chapters_per_week numeric NOT NULL DEFAULT 1,
  -- Manual truth beats the pacing model whenever it is set.
  chapter_override  integer,
  -- 0 = Sunday … 6 = Saturday. NULL = unknown, course contributes no phase.
  lecture_dow       integer,
  exercise_dow      integer,
  -- Relative share of the daily card budget before urgency weighting.
  weight            numeric NOT NULL DEFAULT 1,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, c_id)
);

-- ── The daily row ──────────────────────────────────────────────────────────
-- One row per (user, day), written ONLY by the `learn-daily` edge function.
--
-- It is stored rather than computed on open for three reasons, and the first is
-- the load-bearing one:
--
--   1. The lesson must be THE SAME lesson at 08:00 and at 20:00. A selector run
--      client-side re-rolls on every mount — heat has decayed, an attempt has
--      landed — so "dagens lektion" would silently become a different set of
--      cards halfway through, and a half-finished session could never be
--      resumed. Stability is the product.
--   2. No client derives the lesson, for the same reason no client derives
--      blocking policy (CLAUDE.md, productivity stack): a phone, a Mac and a
--      widget reading the same row cannot disagree about what today is.
--   3. `courses` records WHY the day looks like this (phase, chapter window,
--      the graded event that pulled a course up), so the panel can explain
--      itself. A daily system that cannot say why today is REX-heavy is a black
--      box, and a black box gets ignored after a week.
--
-- ⚠️ BLOCKING_STATE PATTERN — deliberately NOT seeded. A missing row means "no
-- lesson has ever been computed", which is a different fact from "computed, and
-- there is nothing to do today". Seeding an empty lesson would collapse the two
-- and hand every client a fresh-looking `generated_at` over an empty card list,
-- i.e. "du er færdig ✓" on a day the generator never ran. Same rule as
-- `blocking_state` and `lr_learn_state`: missing/stale is UNKNOWN, and the
-- panel must say so.
--
-- Per-card progress is NOT stored here. Each graded card appends to
-- `lr_attempt_log` with `item_ref = 'daily:<date>:<concept_id>:<kind>'`, and
-- "how far am I today" is derived by counting those. Two reasons: mutating a
-- jsonb array from a client is a read-modify-write race between the Mac and the
-- phone, and `learn-evaluate` already computes the streak from attempt DAYS —
-- so finishing a daily lesson feeds the existing streak with no new code.
CREATE TABLE IF NOT EXISTS lr_daily_lesson (
  user_id        text    NOT NULL DEFAULT 'default',
  lesson_date    date    NOT NULL,
  status         text    NOT NULL DEFAULT 'ready',
  minutes_target integer NOT NULL DEFAULT 12,
  -- Ordered card list; each card carries its concept, course and kind.
  cards          jsonb   NOT NULL DEFAULT '[]'::jsonb,
  -- Per-course rationale: phase, chapter window, quota, urgency reason.
  courses        jsonb   NOT NULL DEFAULT '[]'::jsonb,
  generated_at   timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  PRIMARY KEY (user_id, lesson_date)
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lr_daily_lesson_status_chk'
  ) THEN
    ALTER TABLE lr_daily_lesson ADD CONSTRAINT lr_daily_lesson_status_chk
      CHECK (status IN ('ready', 'in_progress', 'done'));
  END IF;
END $$;

-- The panel's only query is "my newest lessons, newest first".
CREATE INDEX IF NOT EXISTS lr_daily_lesson_user_date_idx
  ON lr_daily_lesson (user_id, lesson_date DESC);

-- Resolving a concept to its course happens once per selector run, per course.
CREATE INDEX IF NOT EXISTS lr_concept_topic_idx ON lr_concept (t_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Permissive anon policies, matching the rest of the `lr_` port (LEARN_PLAN.md
-- "Architecture": user_id text default 'default', anon policies, upgradeable via
-- the ecosystem auth playbook). This is the same known posture as the thirteen
-- productivity/grid tables in SECURITY_RLS_MIGRATION.md, NOT a new decision —
-- these two tables join that migration when it runs, they do not get a bespoke
-- policy now. The Learn page renders outside AuthGate and reads with the anon
-- client, so an owner-scoped policy here would return an empty set rather than
-- an error, i.e. a silently blank lesson.
ALTER TABLE lr_course_enrollment ENABLE ROW LEVEL SECURITY;
ALTER TABLE lr_daily_lesson      ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='lr_course_enrollment' AND policyname='anon_all') THEN
    CREATE POLICY anon_all ON lr_course_enrollment FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='lr_daily_lesson' AND policyname='anon_all') THEN
    CREATE POLICY anon_all ON lr_daily_lesson FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
