# Learn — Linear Algebra learning module for Nexus Local

*Top-level plan, authored 2026-08-06. This document is the grounding spec for all
agents working on the Learn feature. Read it fully before touching anything.*

## Product vision

Nexus Local becomes the production frontend for the LearnAndRetain concept-graph
learning system (`/Users/bastianthomsen/Repositories/LearnAndRetain`). Think
**Brilliant, not Duolingo**: hand-crafted (AI-drafted → machine-verified →
human-curated) learning units walked along a linearized path, not infinite
generated drills.

- **Lead course:** KU LinAlgDat (Linear Algebra), oriented toward the 6-question
  oral exam described in `/Users/bastianthomsen/Repositories/LinAlgContext/dispositioner.md`.
- **Platform:** Mac panel first (dev iteration), **phone primary** (Nexus Local is
  the one native iOS app). Design thumb-first.
- **Content language: Danish**, using the course's own notation (see the notation
  table in `dispositioner.md` — `col A`, `null A`, `rank A`, `P_{B←C}`, etc.).

### The pedagogical core: three perspectives

`/Users/bastianthomsen/Repositories/LinAlgContext/tre-perspektiver.md` defines the
signature mechanic. Every linear-algebra fact can be read through three lenses:

| Lens key | Name | What it sees |
|---|---|---|
| `row` | Rækkebilledet | equations = planes; solutions = intersections |
| `matrix` | Matrixformen | the computing machine; RREF, rank, pivots |
| `column` | Søjlebilledet | b ∈ col A; linear combinations; span |

Learning = building multiple mathematical "senses" for the same object. So:

1. Theory boxes and drills carry a `perspective` tag.
2. A dedicated drill archetype **`translate`**: given a fact in one lens, express
   it in another ("rank A = 2 — hvad siger det om søjlerne?").
3. Lens coverage is a mastery dimension: `lr_memory_state.lens_counts` tracks per-
   lens exposure per concept; the review selector prefers the least-seen lens.
   A concept is not "well practised" until exercised through ≥ 2 perspectives.

## Architecture

- **Backend:** the NEXUS Supabase project (`efxmzsdisaymtpebaxlp`), tables
  prefixed `lr_`, `user_id text default 'default'`, RLS enabled with permissive
  anon policies (same posture as the productivity stack; upgradeable via the
  ecosystem auth playbook).
- **Source being migrated:** the "Learn and retain" Supabase project
  (`vfxrxlhwdymdktfzzqqp`). The Python pipeline in the LearnAndRetain repo remains
  the offline authoring/ingest toolchain and will be repointed via env vars later.
- **App surface:** `apps/NexusLocal/src/lib/learn/` — follows the timetracker
  panel conventions: registry entry per panel, rendered **outside `AuthGate`**,
  Supabase access via an anon-keyed client (the `supabasePublic` pattern in
  `src/lib/supabase.ts`).
- **Server-side brain (Phase 3):** pg_cron + edge function `learn-evaluate`
  computing heat decay and one verdict row `lr_learn_state` (due queue, frontier,
  streak) — the `blocking_state` pattern: a **missing row means "never computed",
  never "nothing due"**; clients keep last known state.
- **Memory model:** client-side TS port of the α/β/heat update from
  `LearnAndRetain/pipeline/memory/` for instant grading feedback; decay is
  server-side only.

## Data model (`lr_` tables)

See `supabase/migrations/20260806190000_learn_lr_schema.sql` for the DDL. Summary:

- `lr_course`, `lr_topic`, `lr_concept`, `lr_concept_prereq` — the concept DAG
  (ported 1:1 from source; concept slugs like `la-3-2-1-basis`).
- `lr_unit` (28 LA units, `idx` = path order), `lr_unit_concept` — the linearized
  path. `lr_unit_progress` (locked | in_progress | mastered).
- `lr_item`, `lr_written_item`, `lr_mcq_option`, `lr_qmatrix` — the ported
  problem bank (past exams + book). Used as **authoring grounding and optional
  capstones**, not as the primary drill source.
- `lr_unit_content` — **the crown**: versioned JSONB per unit,
  `status ∈ draft | approved | live`. The app renders only `live` (falls back to
  highest approved). Humans flip status; agents only ever write `draft`.
- `lr_memory_state` (+ `lens_counts jsonb`), `lr_attempt_log` (text `item_ref`,
  `lens`), `lr_learn_state` (verdict row).
- View `lr_retained_concept` = concepts of mastered units (single source of truth
  for what has graduated into the retention space).

## Unit content JSON schema (v1)

```jsonc
{
  "schema_version": 1,
  "unit_code": "la_2_u1",
  "title": "…",
  "est_minutes": 90,
  "intro_md": "Motivation + where this sits in the exam arc. Markdown + KaTeX ($…$, $$…$$).",
  "lens_note_md": "How the three perspectives show up in this unit.",
  "theory": [
    {
      "concept_id": "la-…",             // MUST cover every concept in lr_unit_concept
      "kind": "definition | theorem | remark",
      "title": "Definition 1.8 — rank",
      "statement_md": "Faithful to the book; cite numbers (Theorem 2.9 etc.)",
      "perspective": "matrix",           // primary lens, nullable
      "translations": {                  // optional per-lens re-readings
        "row": "…md…", "column": "…md…"
      },
      "connect_md": "Connective prose to neighbours"
    }
  ],
  "practice": [
    {
      "archetype": "computational | translate | truefalse | conceptual",
      "concept_ids": ["la-…"],
      "master_demo": {
        "prompt_md": "…",
        "steps": [ { "what": "the move", "why": "the principle", "how": "the concrete execution" } ]
      },
      "drills": [
        {
          "id": "la_2_u1-p1-d1",         // globally unique, stable
          "prompt_md": "…",
          "lens": "column",
          "answer_type": "numeric | vector | matrix | choice | text",
          "answer": { "value": … },       // exact; machine-verified before draft is submitted
          "choices": ["…"],               // for answer_type choice
          "hints": ["nudge", "bigger nudge"],
          "solution_md": "Full worked solution",
          "difficulty": 1
        }
      ]
    }
  ],
  "test": {
    "unlock_ratio": 0.66,                 // fraction of drills solved to unlock
    "questions": [
      {
        "id": "la_2_u1-t1",
        "prompt_md": "…",
        "options": [ { "body_md": "…", "correct": true, "why_md": "distractor rationale" } ],
        "concept_ids": ["la-…"], "lens": "row"
      }
    ]
  }
}
```

### Tile drills (schema v1.1 addition)

A drill may have `answer_type: "tiles"` — Duolingo-style tap exercises with
mathematical expressions as tiles. Two modes:

```jsonc
{
  "id": "la_2_u1-p4-d1",
  "prompt_md": "Tap på alle udtryk der er lig $\\det A$ for $A = \\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$",
  "lens": "matrix",
  "answer_type": "tiles",
  "mode": "select",              // tap all correct tiles (unordered)
  "tiles": [
    { "id": "t1", "md": "$-2$", "correct": true },
    { "id": "t2", "md": "$ad - bc$", "correct": true },
    { "id": "t3", "md": "$2$", "correct": false }
  ],
  "hints": ["…", "…"], "solution_md": "…", "difficulty": 1
}
// mode "build": tap tiles IN ORDER to assemble an expression/derivation;
// "tiles" includes distractors, "answer": { "sequence": ["t3","t1","t4"] }.
```

Rules: 4–8 tiles; ≥2 plausible distractors (in build mode distractors = tiles not
in the sequence); every tile's correct/incorrect classification must be
machine-verifiable where computational (sympy) and is checked by the verifier;
tile `md` is markdown+KaTeX, kept SHORT (fits a thumb-sized chip). Practice
groups whose drills are all tiles use `archetype: "tiles"` and may omit
`master_demo`. Tile drills count toward the test `unlock_ratio` like any drill.

### Flashcard decks (schema v1.2 addition)

A unit may carry `flashcards`: two decks of formal-statement cards, anchored
1:1 to the unit's theory boxes.

**Placement (corrected 2026-08-12) — separate path nodes, not Player steps.**
Decks were first built as steps inside the unit Player (`entry` as the FIRST
step before layer 1, `exit` after the rapid round before the Test); that
placement was wrong and has been removed — the unit-mode Player flow is back
to `layers → rapid round → test`, byte-identical to before flashcards
existed. Decks are now their own compact path nodes on `PathPanel`'s spine,
bracketing the unit's row: the **entry** node ("Kend sætningerne") renders
immediately BEFORE the unit row, the **exit** node ("Sig og anvend dem")
immediately AFTER it — see `PathPanel.tsx`'s `DeckNode`. Unlock rules live on
the node, not the unit flow: entry is tappable whenever the unit itself is
available/in_progress/mastered (same threshold `UnitRow` uses to open the
Player at all); exit is tappable only once the unit is **mastered** — it
tests application AFTER the module. Both nodes still render before that
threshold (dim, non-tappable), previewing what's ahead the way a locked
future unit row does, rather than staying hidden like a proof reward. A unit
whose newest content has no `flashcards` key (or an empty entry/exit array)
gets no deck node at all, independently per deck.

Tapping a deck node opens `Player.tsx`'s lightweight `deckSession` mode — a
single deck (understand: statement shown + explained, flip, self-grade, then
an understanding-check MCQ for entry; recall + apply for exit — front shows
only the name, the learner states it from memory and self-grades against the
full statement, apply cards ask which statement justifies a given step),
rendered fullscreen with the unit title + KLADDE badge but no Stepper, no
test, no graduation ceremony. `FlashcardStep`'s own "N/M cards graded"
completion screen is the whole "done" moment — its advance button closes the
Player directly. Grading is unchanged: `applyGrade` + `logAttempt` +
one-hop blame propagation, exactly as below, weights 0.7 entry / 1.0 exit.
Node completion (the ✓ swap) reads the same `lr_attempt_log`-backed
continuity signal (`fetchSolvedDrillIds`) the deck session itself resumes
from, fetched once per `PathPanel` load across every deck in the course.

```jsonc
"flashcards": {
  "entry": [ {
    "id": "la_1_u1-fc-e1", "concept_id": "la-…",
    "lens": "matrix" | null,               // inherit the theory box's perspective
    "front_md": "Sætning 2.1.10 — regneregler for matrixprodukt",
    "back_md": "…the FULL formal statement, quoted faithfully from the box…",
    "note_md": "one-line 'why this matters / how to remember it'",
    "check": {                              // entry: understanding-check MCQ
      "prompt_md": "…", "options": [{ "body_md": "…", "correct": true, "why_md": "…" }]
    }
  } ],
  "exit": [ {
    "id": "la_1_u1-fc-x1", "concept_id": "…", "lens": …,
    "kind": "recall" | "apply",
    "front_md": "recall: the NAME only · apply: a concrete situation/step",
    "back_md": "recall: the full statement · apply: the answer + which statement and why",
    "check": { … }                          // apply cards: the application MCQ
  } ]
}
```

Rules: every entry card's `back_md` statement must match its theory box's
`statement_md` in substance (verifier compares); one entry card per formal
statement (definition/theorem — remarks only if load-bearing); exit deck =
one recall card per entry card + 1–3 apply cards per unit; ids stable; grading
feeds the memory model — entry decks at weight 0.7, exit decks at weight 1.0
(recall-from-memory is the strongest evidence), lens from the card. Units
without `flashcards` flow exactly as before (fully backward compatible).

**Invariants (enforced by the review gate, inherited from LearnAndRetain):**
1. Every concept in the unit appears in ≥ 1 theory box AND ≥ 1 drill/test item.
2. Every computational answer is machine-verified (sympy) before a draft is stored.
3. Unverified/proof content is labelled as guidance, never presented as fact.
4. Every unit exercises ≥ 2 lenses; each unit contains ≥ 1 `translate` drill.
5. KaTeX: never place math inside code fences (KaTeX auto-render skips `pre`/`code`).

## Phases

- **Phase 0 — Foundation** *(in progress)*: `lr_` schema in NEXUS + data port from
  the source project + verification.
- **Phase 1 — Content authoring**: Opus agents draft `lr_unit_content` for the six
  exam arcs (grounded in `dispositioner.md`, `tre-perspektiver.md`, `opgaver.md`,
  the book extracts in the LearnAndRetain item bank); sympy verification gate;
  adversarial invariant review; human curation flips draft → approved → live.
- **Phase 2 — App**: `src/lib/learn/` in NexusLocal — path spine UI, module
  player (Theory → Practice → Test), grading + α/β update, graduation, review
  session mode. Sonnet implements; Opus owns UI architecture decisions.
- **Phase 3 — Server brain**: `learn-evaluate` edge function + pg_cron (decay,
  `lr_learn_state`), secrets via Vault pattern.
- **Phase 4 — Phone**: IPA rebuild via SideStore pipeline; streak/due widget
  reading `lr_learn_state` (read-only Pattern C).

## Phase 2 — App architecture (pinned)

All code lives in `apps/NexusLocal/src/lib/learn/`. Mount = one `<LearnPanels />`
line in `App.tsx` below `<TimeTrackerPanels />`; everything else registers in the
learn barrel (`index.tsx`), never in `App.tsx`.

**Files & ownership (one agent per slice, no cross-edits):**

| File | What |
|---|---|
| `types.ts` | UnitContent/TheoryBox/PracticeGroup/Drill/TestQuestion (mirror the JSON schema above), DB row types (`LrUnit`, `LrUnitProgress`, `LrMemoryState`, `LrLearnState`), `Lens`, `Grade` (0–3). |
| `api.ts` | All Supabase access via `supabasePublic` (`user_id='default'`). `fetchPath()` (units + progress + which units have content, one round trip each), `fetchUnitContent(unitId)` (prefer status live > approved > draft, then highest version; return status so the UI can badge drafts), `logAttempt`, `upsertMemory`, `setUnitProgress`, `fetchLearnState` (missing row = "no verdict yet", NEVER "nothing due"). |
| `memory.ts` | Faithful TS port of the α/β/heat update, grade weights and thresholds (stable/eligible/mastered) from `/Users/bastianthomsen/Repositories/LearnAndRetain/pipeline/memory/` (read the Python — don't invent constants). Plus `lens_counts` increment. Graduation seeding per `pipeline/modules/progress.py`. |
| `answers.ts` | Pure answer checking per `answer_type`: numeric (int/decimal/fraction `a/b`), vector (`1, -2, 3`), matrix (rows separated by `;` or newline), choice (index), text (self-graded). Tolerant of whitespace; exact rational comparison where possible. |
| `Markdown.tsx` | `react-markdown` + `remark-math` + `rehype-katex` (+ `remark-gfm`) wrapper, KaTeX CSS imported once. Content is Danish markdown with `$…$`/`$$…$$`. |
| `PathPanel.tsx` | The spine (see DESIGN.md). Units grouped by chapter, status per unit: `locked` / `available` / `in_progress` / `mastered` / `no content`. Unlock rule: unit is available if the previous idx is mastered OR it already has progress; personal software → a subtle "øv alligevel" override opens any unit with content. Click → Player overlay. |
| `Player.tsx` | Fullscreen overlay (`fixed inset-0`, own scroll). Stepper Theory → Practice → Test. Theory: one card per box, perspective tag chip, expandable `translations` per lens. Practice: per group, master demo with progressive `{what/why/how}` step reveal, then drills — prompt, typed answer input per `answer_type`, check, 2-stage hints, solution reveal, then grade buttons (0–3) → `memory.applyGrade` + `logAttempt` (lens-tagged). Test: locked until `unlock_ratio` of drills solved; MCQ with per-option `why_md` shown after answering; pass ≥ 75 % → graduate unit (`setUnitProgress('mastered')` + heat seeding). Draft badge ("KLADDE") when content status ≠ live. |
| `ReviewPanel.tsx` | Compact section: streak + due count from `lr_learn_state` (or "ingen dom endnu" when the row is missing), and a review session that drills concepts from mastered units, preferring each concept's least-seen lens. |
| `DESIGN.md` | Written by the Opus design agent BEFORE UI slices build: design tokens, layout per screen, motion notes. Bold, dark, matches the `#0a0a0f` / indigo→fuchsia gradient language of `App.tsx`. Phone-primary: single narrow column, thumb-reach actions at the bottom of the Player. |
| `index.tsx` | Barrel: `export function LearnPanels()` rendering PathPanel + ReviewPanel sections. One entry per line. |

**Deps:** add `katex`, `react-markdown`, `remark-math`, `rehype-katex`, `remark-gfm`
to `apps/NexusLocal/package.json`; `npm install` from repo root.

**Verification floor:** `npx tsc --noEmit` and `npx vite build` inside
`apps/NexusLocal` must pass. A terminal cannot prove the WebView renders
(CLAUDE.md) — visual check is a human step at the end.

## Layered unit flow (pinned, 2026-08-10)

Units are consumed as interleaved LAYERS, not Theory→Practice→Test blocks:

```
Layer 1: theory chunk → master demo (example) → drills
Layer 2: theory chunk → master demo → drills
  …
Final practice: rapid tap-round (the archetype:"tiles" groups, whole-unit mix)
Test  →  graduate iff pass (≥75 %)
```

Layers are **derived client-side** from existing content (no re-authoring, no
schema change): walk `practice[]` in order (excluding `tiles` groups); each
group's layer takes the not-yet-assigned theory boxes whose `concept_id` ∈ the
group's `concept_ids`, in theory order. Unassigned theory boxes attach to the
layer nearest their position in theory order (append to last if trailing). All
`tiles` groups form the final-practice round. Degenerate cases: one practice
group → one layer (old flow); no tiles groups → no final round. Test unlock
ratio still counts across ALL drills. An authored `layers` field may override
the derivation later; the derivation is the v1 mechanism.

## Phase 3 — `lr_learn_state` contract (pinned)

Written only by the `learn-evaluate` edge function (service role), every 15 min
via pg_cron. Shape:

```jsonc
{
  "user_id": "default",
  "due_concepts": [        // sorted by priority desc, capped at 30
    { "concept_id": "la-…", "unit_id": 9, "priority": 0.87,
      "least_seen_lens": "row" | "matrix" | "column" | null }
  ],
  "frontier_units": [      // the units to work on next, path order
    { "unit_id": 9, "code": "LA 3 · U1", "status": "in_progress" | "available" }
  ],
  "streak_days": 4,        // consecutive local days (Europe/Copenhagen) with ≥1 attempt
  "last_session_date": "2026-08-07",
  "computed_at": "…"
}
```

Semantics: due = retained concepts (`lr_retained_concept`) whose decayed heat or
competence sits below the review thresholds, priority per LearnAndRetain's
selector (retention-weighted, from the ported Python constants). Heat decay is
applied to `lr_memory_state` by the same function (`last_decayed` bookkeeping).
Consumers (ReviewPanel, LearnWidget) treat a missing row as "no verdict yet" and
a stale `computed_at` as last-known-state — never as "nothing due".

## Infinite exercises (pinned, 2026-08-10)

A shuffle-practice mode over the ported exam/book item bank, separate from the
unit path. Pool: `lr_item` (course LA, `format='written'`) joined to
`lr_written_item` where a solution exists (401 LA items live), minus items the user
has flagged broken.

Session flow (fullscreen, Player-like): item prompt (+ source: title/year/
source_ref) → learner works it on paper → "Vis løsning" reveal → feedback bar,
all fields optional except difficulty+understood:
- difficulty: 1 (let) / 2 (mellem) / 3 (svær)
- understood: yes/no
- flags: exercise broken · solution broken/vague (either flag excludes the item
  from future shuffles for this user)
→ next item. Shuffle prefers least-attempted, then random.

Memory coupling: completing an item logs `lr_attempt_log` (item_ref = slug) and
applies the α/β/heat update to the item's `lr_qmatrix` concepts, weighted by
q-matrix weight (its documented purpose: spreading practice credit). Grade map:
not understood → 0; understood at svær/mellem/let → 1/2/3.

Feedback lands in `lr_item_feedback` (append-only log; migration
`20260810*_learn_item_feedback.sql`).

## Proof side-paths (pinned, 2026-08-10 — pilot: LA 2 · U1)

Optional proof units branch off the linearized path: when a module is
**mastered**, its proof unit (if one exists) unlocks as a side node. Never
blocks the main spine; completing one writes `lr_proof_progress`, NOT
`lr_unit_progress` (no effect on `lr_retained_concept`). Concept credit flows
only through normal drill grading.

Tables: `lr_proof_unit` (proof_id, parent_unit_id, code `la_2_u1-proofs`,
title) · `lr_proof_content` (versioned JSONB, draft→live, same curation gate)
· `lr_proof_progress` (available | in_progress | completed; "locked" is
derived client-side from parent mastery).

**Content is `UnitContent`-shaped** (same schema v1.1 — the Player renders it):
- theory: one box per proved statement (the theorem/lemma, cited by number)
  plus a "Forudsætninger" remark box naming exactly what the proof may use.
- practice: ONE group per proof: `master_demo` = the complete proof as
  {what/why/how} steps (what = the move, why = why it's legal/what it buys,
  how = the concrete manipulation); drills = ≥1 build-mode tiles drill
  ("saml beviset" — proof steps as tiles in order, ≥2 distractor steps that
  are plausible-but-illegal moves) + ≥1 self-graded text drill ("skriv hele
  beviset selv", full proof in solution_md) + optionally short identity
  drills. Tag concept_ids from the parent unit.
- test: 2–4 MCQ about the proof's *structure* (which step uses which
  assumption; where would the proof break if …), unlock_ratio as usual.
- techniques named explicitly in intro_md (direkte bevis, modstrid,
  induktion, entydighedsargument …) — the exam asks "hvordan ville du bevise",
  and naming the technique is half the answer.

## Lynudfordring — timed challenge (pinned, 2026-08-10)

15-minute arcade session: 3 rounds × 5:00 countdown, auto-advance, skip
allowed (0 points). Round composition by answer form:
R1 "Hurtige svar" = numeric/vector/matrix/computational-choice ·
R2 "Byg & saml" = tiles only · R3 "Dom" = truefalse/conceptual choice.
No `text` drills. No hints/solutions during rounds; the end screen lists every
drill with correctness, the correct answer, and full solution_md for review.

Pool (unscoped, Learn-page card): difficulty ≤ 2 drills from units whose
progress is mastered/in_progress/available (the unlocked region); if that
yields < 24 eligible drills, widen to all units with content — unchanged.

Pool (chapter-scoped checkpoint — fixed 2026-08-11, was leaking later-chapter
material): starts as the scoped chapter's own drills only. A chapter-scoped
pool must NEVER contain drills from a chapter LATER in path order
(`lr_unit.idx`) than the scoped one — a checkpoint cannot quiz unseen
material. If the chapter alone yields < 24 eligible drills, widen BACKWARDS
only: prepend the nearest EARLIER chapter's drills, one chapter at a time,
until the threshold is met or the start of the course is reached. Never widen
forward, even if the pool stays under 24 after exhausting every earlier
chapter (e.g. LA 1, whose only earlier chapter LA 0 has no content yet, stays
at its own ~12 drills). If the pool is still thin after backward widening,
shrink the session instead of forward-widening: each round's queue caps at
`min(10, max(3, floor(totalPoolSize / 3)))` rather than a flat 10. If a round
TYPE (R1/R2/R3) has zero eligible drills after scoping, that round is dropped
entirely — not started-then-skipped — so a 2-round or 1-round challenge is
correct behaviour; round numbering and the breather/end screens reflect the
reduced round count, never a hardcoded "/3" or an empty round summary.

Per round: shuffled queue of up to 10 drills (fewer when the pool triggered
the shrink above), round ends at 0:00 or queue exhaustion; 15 s breather
screen between rounds with the round score.

Scoring: base = 100 × difficulty; speed bonus up to +50 by remaining fraction
of a 30 s per-drill par; streak multiplier +10 % per consecutive correct,
capped at ×2. Wrong = 0 points.

Memory coupling is HALF-WEIGHT: attempts log to `lr_attempt_log`
(item_ref = drill id, lens tagged), and applyGrade runs with weight 0.5 —
correct → grade 2, wrong → grade 1 (never 0: a timed miss is weak evidence).

Runs persist to `lr_challenge_run` (migration `20260810*_learn_challenge.sql`):
score, correct/total, per-round breakdown jsonb, duration. Entry card on the
Learn page shows the personal best.

## Eksamensværksted — how-to-solve-exam-problems (pinned, 2026-08-10 — pilot: LA 2)

A chapter-end side node (with the Lynudfordring checkpoint): teaches how to
solve AND present exam-level problems for maximum points, on REAL past-exam
items from the chapter, then the learner rebuilds the solutions with blocks.

Storage: the lr_proof_* trio with `kind='workshop'` (migration
`20260810230000_learn_side_unit_kind.sql`). parent_unit_id = the chapter's
LAST unit; unlock = ≥1 unit of the chapter mastered (chapter-level, unlike
proofs' per-unit rule). Content is UnitContent-shaped; Player renders it with
a VÆRKSTED chip.

Content conventions:
- Problem selection: real exam items (year IS NOT NULL / prøve-slugs)
  strongly linked via lr_qmatrix to the chapter's units' concepts; grounded in
  lr_item_render (intro/task) + the recorded solution.
- theory: 2-3 remark boxes on strategy — the chapter's problem-type patterns,
  the max-points answer anatomy (opstilling → metode → udregning → konklusion
  med kontrol), what the examiner scores, common point-losers.
- practice: ONE group per exam problem: master_demo = the full max-points
  solution as {what/why/how} where why ALSO says what the step earns
  point-wise; drills = ≥1 build-tiles "byg besvarelsen" (solution outline
  steps as tiles in exam-presentation order, ≥2 distractors that lose points:
  skipped justification, wrong order, missing control), short typed drills for
  the computational cores, choice drills on "hvilken formulering scorer
  højest". solution_md cites the item slug it came from.
- test: 2-4 MCQ on presentation strategy.

## DBMS course (pinned, 2026-08-11 — Section 1 approved)

Second course (`lr_course.c_id = 3`, DIS), built INCREMENTALLY: linearize
globally, materialize + author one section at a time. Full recon + proposal in
the session files; user approved: Section 1 as proposed · four lenses · English
content · parallel graph fixes.

**Four lenses (frozen — authored by us, the course's choices outrank the
textbook's):** `nl` (natural language) · `rc` (relational calculus — the
course chose RC over the book's Datalog) · `ra` (relational algebra) · `sql`.
The exams are a translation chain (RC→RA→SQL forward, "describe in NL"
backward, both separately scored). EVERY query-oriented unit must fabricate
exercises across the lenses it has introduced: ≥1 forward AND ≥1 backward
translate drill. Lens keys are per-course data — the app resolves lens
label/colour via a course-aware registry, `Lens` is no longer a hardcoded LA
union. LA keeps `row·matrix·column` untouched.

**Section 1 (`dbms_s1`, 5 units, ~385 min, Garcia-Molina ch. 2):** relational
model → SQL DDL → RA I (σ, π, ρ, set ops) → RA II (products, joins,
composition; RC preview via ex2-e6) → constraints-as-algebra. Unit rows:
course_id 3, unit_id 101–105, idx 0–4, codes "DIS 2 · U1"…"DIS 2 · U5"
(chapter prefix "DIS 2" must parse via chapterOf). Concept lists per
proposal.json. Content: English, schema v1.1, exam-grounded (each unit's
named grounding problems from the dbms-* item bank), SQL/RA/RC in fenced code
blocks (NOT KaTeX — matches the ingested corpus convention), SQL drill answers
verified by EXECUTION against sqlite where applicable.

**Parallel graph fixes:** retitle the 46 space-split titles (audit.json list);
flip the 7 reversed §5.4 edges; author a new RC topic under c_id 3 (~8–10
concepts: TRC/DRC, free/bound variables, quantifiers, safety, RANF, RC↔RA
equivalence) spliced after ch. 2 — Section 1 is unaffected; RC unit content
itself arrives with Section 2.

**App course support:** fetchPath and all path surfaces filter by course; a
course switcher on the Learn page; the DBMS path ends in a "more to come"
horizon (built sections only — no ghost units); per-course lens registry as
above. Challenge/review/exercise pools stay course-scoped by slug/unit
conventions.

## DAG-v2 review brain (pinned, 2026-08-11)

The prerequisite edges go live (they were dormant since Phase 3):

1. **Importance** = PageRank over the REVERSED edge graph per course, stored in
   `lr_concept.importance` (migration `20260811130000`), backfilled by script;
   re-run after graph edits (RC splice included).
2. **learn-evaluate v2**: priority = (λ·retention-deficit + (1−λ)·competence-
   deficit) × importance — λ ported EXACTLY from LearnAndRetain selector.py.
   Prereq-gating: if a due concept has a retained prerequisite that is itself
   below `stable`, the prerequisite outranks it and the dependent's due entry
   gains `"blocked_by": ["<concept_id>", …]`. Contract addition to
   `lr_learn_state.due_concepts` — consumers must tolerate the extra field
   (they already do: it's additive jsonb).
3. **Blame propagation** (client): on grade 0/1, `applyGrade`'s path pushes
   fractional blame (weight 0.3 × the triggering update's weight) onto the
   graded concept's DIRECT prerequisites whose state is below `stable` —
   ported from the gated implementation in LearnAndRetain pipeline/memory
   (cite constants). Never recursive (one hop), never on grades 2/3, and
   never on tile/challenge half-weight paths' prereqs-of-prereqs.
   Verified against the Python reference on fixed sample states before wiring.

## Socratic dialogue nodes (pinned, 2026-08-15 — pilot: units 2, 3, 9)

A per-module PATH NODE (below the exit deck), unlocking when the unit is
MASTERED. A chat-style dialogue: a main question is posed → the learner writes
a free-text explanation → the system either advances, poses an authored
sub-question (a facet was missed), redirects via an authored misconception
probe, or asks for another attempt — per the judge's classification.

**Storage**: the lr_proof_* trio with `kind='socratic'` (content is a DIALOGUE
SCRIPT, not UnitContent — the app routes kind='socratic' to SocraticSession,
never the Player). Curation gate (draft→live) and KLADDE badge as usual.

**Script schema v1**:
```jsonc
{
  "schema_version": 1, "code": "la_1_u1-socratic", "title": "…",
  "est_minutes": 20,
  "questions": [ {
    "id": "q1", "concept_ids": ["la-…"], "lens": "matrix" | null,
    "prompt_md": "the main Socratic question (why/how, never bare recall)",
    "target_md": "what a solid answer contains — shown to the learner after the exchange, and the judge's rubric",
    "facets": [ { "id": "f1", "desc_md": "one element of a complete answer" } ],
    "misconceptions": [ { "id": "m1", "desc_md": "a common wrong belief",
                          "probe_md": "authored redirect question for it" } ],
    "subquestions": [ { "id": "s1", "targets_facet": "f1",
                        "prompt_md": "deeper probe when f1 is missing" } ],
    "retry_md": "authored 'prøv igen — mere i denne retning' nudge",
    "max_followups": 2
  } ]
}
```

**Runtime judge** (`socratic-judge` edge function → Claude `claude-opus-5`,
structured JSON): input = the question's rubric material + the learner's
answer (+ short exchange history); output = { verdict: solid|partial|off,
facets_hit: [ids], misconception: id|null, coach_md: ONE short sentence }.
The judge CLASSIFIES ONLY — every question the learner sees is authored.
Branching (app-side, deterministic): solid → next question (grade 3) ·
partial → subquestion for the first missing facet · off + misconception →
its probe · off otherwise → retry_md; after max_followups move on (grade 2 if
recovered, 1 if not). Grades feed applyGrade at weight 1.0 on concept_ids.

**Fail-open**: judge unavailable (no ANTHROPIC_API_KEY secret, network, 503)
→ RUBRIC MODE, same script: facets reveal as a tap-checklist after answering;
branching becomes deterministic from the learner's own taps. The node never
breaks; the LLM upgrades it.

## Samlet prøve — aggregated unit MCQ test (pinned, 2026-08-16)

A per-unit PATH NODE (after the Socratic node), available when the unit is
MASTERED. Derived entirely from existing content — no authoring: collect every
MCQ-form item in the unit's newest content into one shuffled assessment:
- `test.questions` (options + why_md)
- flashcard `check` MCQs (entry understanding-checks and exit apply-checks)
- `choice`-type drills (choices + answer; solution_md as the rationale)
- `truefalse` drills rendered as two-option MCQs
Each item keeps its concept_ids/lens and a `source` tag (test | flashcard |
drill). One pass, no hints, rationale revealed after each answer (why_md /
solution_md). Grading: logAttempt per item + applyGrade at weight 0.8
(correct → 2, wrong → 1).

END REPORT — the point of the node: score overall + breakdowns by
CONCEPT (weakest first, with titles), LENS, and SOURCE type, each as
fraction bars per DESIGN tokens. Persist nothing new — the attempt log and
memory state already capture it.

Also pinned: ⚡ chapter checkpoints are suppressed for chapters whose scoped
drill pool is empty (LA 0); eksamensværksteder scale to every chapter with
mastered units (LA 1/3/4 now; parent_unit_id = the chapter's last lr_unit row).

## Conventions that bite (from CLAUDE.md — enforced)

- camelCase IPC args from JS; snake_case in Rust.
- New panels register in a registry file, one line per panel; nothing in `App.tsx`.
- Everything outside `AuthGate`; anon-key Supabase client.
- `/bin/ls`, `/bin/cat` in scripts (aliases are broken).
- Migrations: forward-only, `IF NOT EXISTS`-guarded, in `supabase/migrations/`.
