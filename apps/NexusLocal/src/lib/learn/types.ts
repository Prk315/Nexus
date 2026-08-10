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

// --- Proof side-paths (LEARN_PLAN.md "Proof side-paths (pinned, 2026-08-10 —
// pilot: LA 2 · U1)"). Optional content that branches off a mastered unit as
// a side node — never blocks the main spine. Completing one writes
// `lr_proof_progress`, NEVER `lr_unit_progress`: no effect on
// `lr_retained_concept`. Concept credit flows only through normal drill
// grading (same `handleGrade` path the Player already uses for units), so
// these tables carry zero memory/heat fields of their own. Mirrors
// `supabase/migrations/20260806190000_learn_lr_schema.sql`'s `lr_unit` /
// `lr_unit_progress` / `lr_unit_content` triad 1:1, verified against the live
// schema 2026-08-10 (no migration file for these three tables exists in this
// repo yet — the pilot's DDL was applied directly).

// `kind` distinguishes the two side-unit flavours sharing this trio (LEARN_PLAN.md
// "Eksamensværksted" — migration `20260810230000_learn_side_unit_kind.sql`):
// 'proof' = the original per-unit proof side node (∴), unlocks on its own
// `parent_unit_id` mastering. 'workshop' = a chapter-end exam-workshop node (§),
// whose `parent_unit_id` is the chapter's LAST unit and which unlocks once ≥1 unit
// of that chapter is mastered — the checkpoint's own chapter-mastery rule, not a
// per-unit one. DB default is 'proof' so every pre-existing row stays a proof.
export type ProofUnitKind = "proof" | "workshop";

export interface LrProofUnit {
  proof_id: number;
  parent_unit_id: number;
  code: string;
  title: string | null;
  kind: ProofUnitKind;
}

// "locked" is never stored — it is derived client-side from parent-unit
// mastery (LEARN_PLAN.md). The DB's own default is "available": a proof
// becomes available the instant its parent masters, not on some later grant.
export type ProofProgressStatus = "available" | "in_progress" | "completed";

export interface LrProofProgress {
  user_id: string;
  proof_id: number;
  status: ProofProgressStatus;
  completed_at: string | null;
  updated_at: string;
}

// Content is `UnitContent`-shaped (same schema v1.1) — the Player renders it
// through the identical layer/practice/test machinery it uses for units.
export interface LrProofContentRow {
  proof_id: number;
  version: number;
  status: ContentStatus;
  content: UnitContent;
  authored_by: string | null;
  notes: string | null;
  created_at: string;
}

// Composite row `api.fetchProofUnits()` returns per proof unit — mirrors
// `PathUnit`'s shape/defaulting exactly, just keyed by proof_id instead of
// unit_id.
export interface ProofUnitEntry {
  proofUnit: LrProofUnit;
  // Defaults to "available" when no lr_proof_progress row exists.
  progress: ProofProgressStatus;
  hasContent: boolean;
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

// Mirrors supabase/migrations/20260810190000_learn_item_render.sql. Written
// by an offline enrichment pass, one row per `lr_item.item_id`; `lr_item`
// stays the source of truth and the app falls back to its raw `prompt` when
// a row is missing for that item (see api.fetchExercisePool's grouping).
export interface LrItemRenderRow {
  item_id: number;
  // Shared by every sub-part of one exam/book problem — the grouping key for
  // `api.fetchExercisePool`'s ProblemGroup[].
  group_key: string;
  // "(b)" · null for single-part problems.
  part_label: string | null;
  intro_md: string | null;
  task_md: string;
  context_md: string | null;
  solution_md: string | null;
  cleaned_at?: string;
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

// --- Lynudfordring — timed challenge (LEARN_PLAN.md "Lynudfordring — timed
// challenge", pinned 2026-08-10). Mirrors
// supabase/migrations/20260810220000_learn_challenge.sql. A 15-minute, 3-round
// arcade session drawn from unit content (not a separate content pool) — see
// `api.fetchChallengePool` / `ChallengeSession.tsx`. ---------------------------

/** One round's tally, nested inside `lr_challenge_run.rounds` (jsonb). */
export interface ChallengeRoundSummary {
  round: number;
  label: string;
  score: number;
  correct: number;
  total: number;
}

/**
 * The full `lr_challenge_run.rounds` jsonb payload. `scope` is a 2026-08-10
 * pilot addition (chapter checkpoint nodes on the path, piloted at LA 2's end)
 * — deliberately folded into this existing jsonb column rather than a new
 * migration/column: `null` for the unscoped Learn-page card's whole-course
 * session, a chapter label (`"LA 2"`, matching `PathPanel`'s `chapterOf()`
 * derivation of `lr_unit.code`) for a chapter checkpoint run. `api.
 * fetchChallengeBest(scope)` filters client-side on this field — see that
 * function's doc comment for why (no schema change means no indexed jsonb
 * path to query server-side).
 */
export interface ChallengeRoundsPayload {
  scope: string | null;
  rounds: ChallengeRoundSummary[];
}

export interface LrChallengeRun {
  run_id?: number;
  user_id: string;
  score: number;
  correct: number;
  total: number;
  best_streak: number | null;
  duration_secs: number | null;
  rounds: ChallengeRoundsPayload | null;
  at?: string;
}
