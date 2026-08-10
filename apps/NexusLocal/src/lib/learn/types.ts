/**
 * Types for the Learn feature — mirrors two sources of truth:
 *
 *  - The unit content JSON schema (v1) documented in
 *    `apps/NexusLocal/LEARN_PLAN.md` ("Unit content JSON schema (v1)").
 *  - The `lr_` Postgres schema in
 *    `supabase/migrations/20260806190000_learn_lr_schema.sql`.
 *
 * A live unit (`lr_unit_content` for unit_id=2, LA 1 · U1) was sampled to
 * verify this shape — two things the LEARN_PLAN.md schema sample doesn't show:
 *
 *  1. `UnitContent.excluded_concepts?: string[]` — an authoring escape hatch
 *     for the "every concept appears" invariant, present (as `[]`) on the
 *     sampled unit but absent from the plan's JSON sample.
 *  2. `Drill.verify_py?: string` — the sympy script used at authoring time to
 *     machine-verify `answer` before the draft was stored (invariant #2 in
 *     LEARN_PLAN.md). Shipped in the content but never evaluated client-side.
 *
 * Also worth flagging for `answers.ts`/`Player.tsx`: for `answer_type:
 * "choice"` drills, the sampled `answer.value` is the full text of the
 * correct choice (matched against `choices`), not a numeric index — despite
 * LEARN_PLAN.md's api.ts row describing "choice (index)". `answers.ts`
 * handles both shapes; see its header comment.
 */

// --- The three perspectives (tre-perspektiver.md) --------------------------

export type Lens = "row" | "matrix" | "column";

// Attempt grade, 0–3. Matches `lr_attempt_log.grade`'s comment:
// 0 don't-know | 1 hard | 2 normal | 3 easy.
export type Grade = 0 | 1 | 2 | 3;

// --- Unit content JSON (v1) -------------------------------------------------

export type TheoryKind = "definition" | "theorem" | "remark";

export interface TheoryBox {
  concept_id: string;
  kind: TheoryKind;
  title: string;
  statement_md: string;
  perspective: Lens | null;
  translations?: Partial<Record<Lens, string>>;
  connect_md?: string;
}

export type Archetype = "computational" | "translate" | "truefalse" | "conceptual" | "tiles";

export type AnswerType = "numeric" | "vector" | "matrix" | "choice" | "text" | "tiles";

export interface DrillAnswer {
  // numeric -> number; vector -> number[]; matrix -> number[][];
  // choice -> the correct choice's text (observed) — see header comment;
  // text -> a reference string (self-graded, never machine-compared);
  // tiles (mode "build") -> `sequence`, the ordered correct tile ids.
  value?: number | string | number[] | number[][];
  // tiles (mode "build") only — ordered tile ids forming the correct answer.
  // Absent for mode "select": correctness there comes from each tile's own
  // `correct` flag (LEARN_PLAN.md "Tile drills (schema v1.1 addition)").
  sequence?: string[];
}

// --- Tile drills (schema v1.1 addition) -------------------------------------
// Duolingo-style tap exercises. `mode: "select"` — tap all-and-only the
// correct tiles (unordered, per-tile `correct` flag). `mode: "build"` — tap
// tiles in order to assemble an expression; `tiles` includes ≥2 distractors
// not present in `answer.sequence`.

export type TileMode = "select" | "build";

export interface Tile {
  id: string;
  md: string;
  // Present (true/false) for mode "select" tiles; absent for mode "build"
  // tiles, whose correctness is determined solely by position in
  // `answer.sequence`, not a per-tile flag.
  correct?: boolean;
}

export interface Drill {
  id: string;
  prompt_md: string;
  lens: Lens;
  answer_type: AnswerType;
  // Required for every answer_type except "tiles" mode "select", where the
  // schema sample omits `answer` entirely (correctness lives on the tiles
  // themselves). Always present (with `.sequence`) for "tiles" mode "build".
  answer?: DrillAnswer;
  choices?: string[];
  // Present only for `answer_type: "tiles"` drills.
  mode?: TileMode;
  tiles?: Tile[];
  hints?: string[];
  solution_md?: string;
  difficulty?: number;
  // Authored content carries per-drill concept tags in addition to the
  // practice group's; unused by the Player today (grading credits the
  // group's concept_ids) but part of the stored shape.
  concept_ids?: string[];
  // Authoring-time sympy verification script. Not evaluated client-side.
  verify_py?: string;
}

export interface MasterDemoStep {
  what: string;
  why: string;
  how: string;
}

export interface MasterDemo {
  prompt_md: string;
  steps: MasterDemoStep[];
}

export interface PracticeGroup {
  archetype: Archetype;
  concept_ids: string[];
  master_demo?: MasterDemo;
  drills: Drill[];
}

export interface TestOption {
  body_md: string;
  correct: boolean;
  why_md?: string;
}

export interface TestQuestion {
  id: string;
  prompt_md: string;
  options: TestOption[];
  concept_ids: string[];
  lens: Lens;
}

export interface TestSection {
  unlock_ratio: number;
  questions: TestQuestion[];
}

export interface UnitContent {
  schema_version: 1;
  unit_code: string;
  title: string;
  est_minutes: number;
  intro_md: string;
  lens_note_md: string;
  theory: TheoryBox[];
  practice: PracticeGroup[];
  test: TestSection;
  // Present (as `[]`) on sampled content; absent from LEARN_PLAN.md's sample.
  excluded_concepts?: string[];
}

// --- Derived layered flow (LEARN_PLAN.md "Layered unit flow", 2026-08-10) ----
//
// Client-side only: `layers.deriveLayers(content)` produces these from the
// v1 content above. Nothing DB-side changes — no `layers` column, no new
// authored field (an authored override may come later).

export interface UnitLayer {
  /** 0-based position in `UnitFlow.layers`; the stepper renders `index + 1`. */
  index: number;
  /** This layer's theory boxes, in the unit's original theory order. */
  theory: TheoryBox[];
  /**
   * The practice group this layer is built around — its `master_demo` is the
   * layer's worked example and its `drills` are the layer's practice. `null`
   * only in the degenerate theory-only layer (a unit whose practice is all
   * `tiles` groups, or has none at all).
   */
  group: PracticeGroup | null;
  /** `group?.drills ?? []`, hoisted so callers don't null-check twice. */
  drills: Drill[];
}

export interface UnitFlow {
  layers: UnitLayer[];
  /** The `archetype: "tiles"` groups — the closing rapid round. May be empty. */
  finalRound: PracticeGroup[];
  /** Every final-round drill, flattened in group order. */
  finalDrills: Drill[];
  test: TestSection;
  /**
   * Drills across layers AND the final round — the denominator of the test's
   * `unlock_ratio`, which stays a whole-unit gate regardless of the split.
   */
  totalDrills: number;
}

// --- DB row types ------------------------------------------------------------
// Mirror supabase/migrations/20260806190000_learn_lr_schema.sql.

export type ContentStatus = "draft" | "approved" | "live";

export interface LrUnit {
  unit_id: number;
  course_id: number | null;
  idx: number;
  code: string;
  title: string | null;
  sections: string[] | null;
}

export type UnitProgressStatus = "locked" | "in_progress" | "mastered";

export interface LrUnitProgress {
  user_id: string;
  unit_id: number;
  status: UnitProgressStatus;
  mastered_at: string | null;
  updated_at: string;
}

export interface LrUnitContentRow {
  unit_id: number;
  version: number;
  status: ContentStatus;
  content: UnitContent;
  authored_by: string | null;
  notes: string | null;
  created_at: string;
}

// `lens_counts` keys are always a subset of `Lens`; values default to absent
// (treated as 0), not 0 — matches the DB default `'{}'::jsonb`.
export type LensCounts = Partial<Record<Lens, number>>;

export interface LrMemoryState {
  user_id: string;
  concept_id: string;
  value_alpha: number;
  value_beta: number;
  heat: number;
  lens_counts: LensCounts;
  last_reviewed: string;
  last_decayed: string;
}

export interface LrAttemptLog {
  a_id?: number;
  user_id: string;
  item_ref: string;
  lens: Lens | null;
  grade: Grade;
  at?: string;
}

// Server-computed verdict row (blocking_state pattern). A missing row means
// "never computed" — never "nothing due". See `api.fetchLearnState`.
//
// Shape pinned by LEARN_PLAN.md's "Phase 3 — lr_learn_state contract":
// `due_concepts` / `frontier_units` are jsonb arrays of *objects*, not bare
// id arrays — written only by the `learn-evaluate` edge function.

export interface DueConcept {
  concept_id: string;
  unit_id: number;
  priority: number;
  least_seen_lens: Lens | null;
}

export interface FrontierUnit {
  unit_id: number;
  code: string;
  status: "in_progress" | "available";
}

export interface LrLearnState {
  user_id: string;
  // Sorted by priority desc, capped at 30 (server-side). Absent/empty is a
  // legitimate "nothing due" reading ONLY when this row exists at all — see
  // `api.fetchLearnState`'s null-row semantics.
  due_concepts: DueConcept[] | null;
  frontier_units: FrontierUnit[] | null;
  streak_days: number | null;
  last_session_date: string | null;
  computed_at: string | null;
}

// Composite row `api.fetchPath()` returns per unit — the path spine display.
export interface PathUnit {
  unit: LrUnit;
  // Defaults to "locked" when no lr_unit_progress row exists for this unit.
  progress: UnitProgressStatus;
  // True if any lr_unit_content row (draft/approved/live) exists for this unit.
  hasContent: boolean;
  // Status of the best available content row (live > approved > draft), or
  // null when hasContent is false.
  contentStatus: ContentStatus | null;
}

// --- Infinite exercises (LEARN_PLAN.md "Infinite exercises", pinned
// 2026-08-10) — mirrors the ported problem-bank row and its feedback log. ---

// `lr_item` — the ported exam/book problem bank (authoring grounding +
// Infinite-exercises pool). Not every column is used by Infinite exercises
// (`difficulty` here is the *authoring* difficulty, separate from the
// learner's own self-reported `LrItemFeedback.difficulty`).
export interface LrItem {
  item_id: number;
  slug: string | null;
  title: string | null;
  year: number | null;
  difficulty: number | null;
  format: string | null; // written | multiple_choice | flashcard | programming | example
  prompt: string | null;
  source_ref: string | null;
}

// Mirrors supabase/migrations/20260810170000_learn_item_feedback.sql.
// Append-only: one row per graded item per session, never updated in place.
// Either broken flag excludes the item from this user's future Infinite
// exercises shuffles (`api.fetchExercisePool`'s exclusion join).
export interface LrItemFeedback {
  fb_id?: number;
  user_id: string;
  item_id: number;
  difficulty: number | null; // 1 let | 2 mellem | 3 svær
  understood: boolean | null;
  exercise_broken: boolean;
  solution_broken: boolean; // broken or vague
  note: string | null;
  at?: string;
}
