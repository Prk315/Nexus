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

// --- Lenses ("perspectives" for LA, tre-perspektiver.md) -------------------
//
// A lens key is per-course data, not a hardcoded LA union — LEARN_PLAN.md
// "DBMS course (pinned)": "Lens keys are per-course data — the app resolves
// lens label/colour via a course-aware registry, `Lens` is no longer a
// hardcoded LA union." LA's own three lenses are "row" | "matrix" | "column";
// DBMS's four are "nl" | "rc" | "ra" | "sql". Label/colour/order for whichever
// set is active live in `courses.ts`'s `CourseDef.lenses`, resolved through
// `CourseContext.useCourse()` — never a `Record<Lens, …>` literal keyed off
// this type again (that was the pre-multi-course shape; see `courses.ts`'s
// header comment for why).
export type Lens = string;

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
  // Optional (schema v1.2 addition, LEARN_PLAN.md "Flashcard decks") — absent
  // entirely on every unit authored before this addition, so a unit without
  // it must flow exactly as before (Player.tsx's step-sequence derivation
  // checks `content.flashcards?.entry.length` / `.exit.length`, never assumes
  // the key exists).
  flashcards?: FlashcardDecks;
}

// --- Flashcard decks (schema v1.2 addition, LEARN_PLAN.md "Flashcard decks
// (schema v1.2 addition)") -----------------------------------------------
//
// Two decks of formal-statement cards, anchored 1:1 to the unit's theory
// boxes. Placement in the Player flow (`Player.tsx`'s `buildSteps`, not this
// file): `entry` deck = the module's FIRST step, before layer 1 (statement
// shown + explained, flip, self-grade, then an understanding-check MCQ);
// `exit` deck = after the rapid round, before the Test (recall + apply: front
// shows only the name, the learner states it from memory and self-grades
// against the full statement; apply cards ask which statement justifies a
// given step). Grading feeds the memory model at deck-specific weights
// (entry 0.7, exit 1.0 — recall-from-memory is the strongest evidence), lens
// resolved from the card (`lens` itself, or — when null — the anchored
// theory box's own `perspective`, per the LEARN_PLAN.md sample's comment).

/** A flashcard's understanding/application check — structurally identical to
 * `TestQuestion`'s own `{prompt_md, options}` shape (LEARN_PLAN.md's sample),
 * so it reuses `TestOption` rather than inventing a parallel option type. */
export interface FlashcardCheck {
  prompt_md: string;
  options: TestOption[];
}

export interface EntryFlashcard {
  id: string;
  concept_id: string;
  /** Inherits the anchored theory box's `perspective` when null — resolved by
   * the Player (`resolveCardLens` in Player.tsx), never duplicated here. */
  lens: Lens | null;
  front_md: string;
  /** The FULL formal statement, quoted faithfully from the theory box. */
  back_md: string;
  /** One-line "why this matters / how to remember it". */
  note_md?: string;
  /** Understanding-check MCQ — appears after the learner self-grades. */
  check?: FlashcardCheck;
}

export type FlashcardKind = "recall" | "apply";

export interface ExitFlashcard {
  id: string;
  concept_id: string;
  lens: Lens | null;
  kind: FlashcardKind;
  /** recall: the statement's NAME only · apply: a concrete situation/step. */
  front_md: string;
  /** recall: the full statement · apply: the answer + which statement and why. */
  back_md: string;
  /** The application MCQ — present mainly on `apply` cards. */
  check?: FlashcardCheck;
}

/** Either deck's card shape — both carry `{id, concept_id, lens, front_md,
 * back_md, check?}`; `player/FlashcardStep.tsx` is generic over this union
 * and narrows on `deckKind`/`"kind" in card` only where the two differ
 * (`note_md` vs. `kind`). */
export type Flashcard = EntryFlashcard | ExitFlashcard;

export interface FlashcardDecks {
  entry: EntryFlashcard[];
  exit: ExitFlashcard[];
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

// `kind` distinguishes the side-unit flavours sharing this trio (LEARN_PLAN.md
// "Eksamensværksted" — migration `20260810230000_learn_side_unit_kind.sql`):
// 'proof' = the original per-unit proof side node (∴), unlocks on its own
// `parent_unit_id` mastering. 'workshop' = a chapter-end exam-workshop node (§),
// whose `parent_unit_id` is the chapter's LAST unit and which unlocks once ≥1 unit
// of that chapter is mastered — the checkpoint's own chapter-mastery rule, not a
// per-unit one. 'socratic' (LEARN_PLAN.md "Socratic dialogue nodes", pinned
// 2026-08-15) = a per-unit chat-style dialogue node (?), same per-unit
// `parent_unit_id` mastery gate as 'proof', but its `lr_proof_content.content`
// is SocraticScript-shaped, NOT UnitContent-shaped — the app routes it to
// `SocraticSession.tsx`, never `Player.tsx`. The `kind` column itself carries no
// CHECK constraint (migration above is a bare `ALTER TABLE ... ADD COLUMN`), so
// no schema migration was needed to add this value. DB default is 'proof' so
// every pre-existing row stays a proof.
export type ProofUnitKind = "proof" | "workshop" | "socratic";

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

// --- Socratic dialogue nodes (LEARN_PLAN.md "Socratic dialogue nodes (pinned,
// 2026-08-15 — pilot: units 2, 3, 9)"). Storage is the same `lr_proof_*` trio
// as proofs/workshops, `kind: "socratic"` — but the content JSONB is
// SCRIPT-shaped, not `UnitContent`-shaped, so it gets its own type tree and its
// own DB-row/fetch types rather than reusing `LrProofContentRow`. The app
// routes `kind: "socratic"` straight to `SocraticSession.tsx`; `Player.tsx`
// never sees this shape. ------------------------------------------------------

/** One element of a complete answer — the judge's rubric AND the fail-open
 * rubric-mode tap-checklist read the same `facets[]` array. */
export interface SocraticFacet {
  id: string;
  desc_md: string;
}

/** A common wrong belief, with its own authored redirect question. The judge
 * classifies which one (if any) the learner's answer matches; rubric mode
 * (no judge) never attempts this classification — see `SocraticSession.tsx`. */
export interface SocraticMisconception {
  id: string;
  desc_md: string;
  probe_md: string;
}

/** A deeper, authored probe fired when `targets_facet` was missing from the
 * learner's answer (judged: per `facets_hit`; rubric mode: per the learner's
 * own taps) — both branches pick "the first missing facet, in authored
 * order" and look up its subquestion here. */
export interface SocraticSubquestion {
  id: string;
  targets_facet: string;
  prompt_md: string;
}

export interface SocraticQuestion {
  id: string;
  concept_ids: string[];
  lens: Lens | null;
  /** The main Socratic question — why/how, never bare recall. */
  prompt_md: string;
  /** What a solid answer contains — revealed to the learner after the
   * exchange resolves, AND the judge's own rubric material. */
  target_md: string;
  facets: SocraticFacet[];
  misconceptions: SocraticMisconception[];
  subquestions: SocraticSubquestion[];
  /** Authored "prøv igen — mere i denne retning" nudge — the deterministic
   * fallback whenever there is no more specific authored redirect (an "off"
   * verdict with no matched misconception, or rubric mode with zero facets
   * tapped, or a "partial"/some-facets-tapped case whose missing facet has no
   * authored subquestion). */
  retry_md: string;
  max_followups: number;
}

export interface SocraticScript {
  schema_version: 1;
  code: string;
  title: string;
  est_minutes: number;
  questions: SocraticQuestion[];
}

/** Mirrors `LrProofContentRow` exactly (same `lr_proof_content` table, same
 * draft→approved→live curation gate, same `bestContentRow` resolution in
 * api.ts) — the only difference is `content`'s shape. */
export interface LrSocraticContentRow {
  proof_id: number;
  version: number;
  status: ContentStatus;
  content: SocraticScript;
  authored_by: string | null;
  notes: string | null;
  created_at: string;
}

/**
 * One exchange turn passed as judge history — `{prompt_md, answer}` for
 * every earlier round of the *current* main question only (LEARN_PLAN.md:
 * "input = ... the learner's answer (+ short exchange history)"). Built by
 * `SocraticSession.tsx` from its own transcript; never persisted.
 */
export interface SocraticExchangeTurn {
  prompt_md: string;
  answer: string;
}

export type JudgeVerdict = "solid" | "partial" | "off";

/**
 * The `socratic-judge` edge function's response shape (LEARN_PLAN.md: "output
 * = { verdict: solid|partial|off, facets_hit: [ids], misconception: id|null,
 * coach_md: ONE short sentence }"). `api.judgeAnswer` returns this or `null`
 * — null on ANY failure (network, non-2xx, malformed JSON, an unrecognised
 * `verdict`), which is what triggers rubric mode for that exchange.
 */
export interface JudgeResult {
  verdict: JudgeVerdict;
  facets_hit: string[];
  misconception: string | null;
  coach_md: string;
}

// --- Generalprøve (LEARN_PLAN.md "Generalprøve — the final canvas node",
// pinned 2026-08-17 — P1 slice). Mirrors the live `lr_disposition` table
// (verified against information_schema 2026-08-18); `lr_rehearsal_run` exists
// too but is unused until P2. --------------------------------------------

/** One ordered beat of a disposition. ALL-optional on purpose: the DATA
 * agent authors `content` jsonb in parallel with this slice, so the renderer
 * must tolerate any shape and never throw (same posture as
 * `LrItemRenderRow`'s fallback contract). Two spellings are live for two of
 * the fields — the planned `idx`/`statements` and the authored
 * `order`/`statement_titles` (sampled from the six `la-disp-*` rows,
 * 2026-08-18); consumers read both, preferring the planned name. */
export interface DispositionBeat {
  idx?: number;
  /** Authored spelling of `idx` (live rows carry this one). */
  order?: number;
  title?: string;
  concept_ids?: string[];
  statements?: string[];
  /** Authored spelling of `statements` (live rows carry this one). */
  statement_titles?: string[];
  notes_md?: string;
  /** Suggested minutes for this beat — present on live rows. */
  minutes?: number;
}

export interface DispositionContent {
  beats?: DispositionBeat[];
  intro_md?: string;
  [k: string]: unknown;
}

export interface LrDisposition {
  disposition_id: number; // bigint, NOT NULL
  course_id: number; // bigint, NOT NULL
  code: string; // text, NOT NULL
  title: string; // text, NOT NULL
  status: ContentStatus; // text NOT NULL DEFAULT 'draft' → draft|approved|live
  content: DispositionContent; // jsonb, NOT NULL
  authored_by: string | null;
  notes: string | null;
  created_at: string; // timestamptz NOT NULL DEFAULT now()
}

/** One `lr_concept_prereq` edge with both endpoints inside one course —
 * `prereqId` must be presented before `conceptId` (see
 * `api.fetchPrereqEdges`). */
export interface PrereqEdge {
  prereqId: string;
  conceptId: string;
}

// --- Sprint — bucketed fast-feedback exam training (LEARN_PLAN.md "Sprint —
// bucketed fast-feedback exam training", pinned 2026-08-18 — DBMS pilot).
// Mirrors `lr_sprint_drill` (migration `20260818120000_learn_sprint_drills.sql`)
// and the OPUS content brief's §B schemas. Deliberately a FLAT optional-field
// shape (mirrors `Drill`'s own `answer_type`-keyed flat interface above)
// rather than a discriminated union — `format` is a sibling COLUMN, not a tag
// inside `content`, so a caller branches on `drill.format` and reads whichever
// fields that format populates; the others are simply absent. -------------

export type SprintFormat = "mcq" | "truefalse" | "blank" | "tiles" | "why";

export type SprintAcceptMode = "exact" | "set" | "numeric";

export interface SprintDrillContent {
  v: 1;
  /** Every format except `truefalse` (which uses `statement_md` instead —
   * §B.2's "no `prompt_md` — `statement_md` replaces it"). */
  prompt_md?: string;
  /** `truefalse` only. */
  statement_md?: string;
  lens: Lens | null;
  concept_ids: string[];
  difficulty: number;
  why_md: string;
  how_md: string;
  tip_md: string;

  // mcq / why
  choices?: string[];
  answer_idx?: number;
  /** `why` only — the given correct result the learner justifies. */
  given_md?: string;

  // truefalse
  answer?: boolean;

  // blank
  accept?: string[];
  accept_mode?: SprintAcceptMode;
  placeholder?: string;

  // tiles
  mode?: TileMode;
  tiles?: Tile[];
  /** `tiles` mode "build" only. */
  sequence?: string[];
}

export interface LrSprintDrill {
  drill_id: number;
  course_id: number;
  bucket: string;
  code: string;
  source_slug: string | null;
  format: SprintFormat;
  content: SprintDrillContent;
  status: ContentStatus;
}

/** One row of `lr_sprint_bucket_stats(course_id, user_id)` — see
 * `api.fetchSprintBuckets`. `accuracy` is `null` iff `attempts = 0` (never
 * `0`, which would misread as "0% accuracy" — see the RPC's own comment). */
export interface SprintBucketStat {
  bucket: string;
  drills: number;
  attempts: number;
  correct: number;
  accuracy: number | null;
  last_at: string | null;
}
