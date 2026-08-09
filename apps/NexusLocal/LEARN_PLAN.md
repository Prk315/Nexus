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

## Conventions that bite (from CLAUDE.md — enforced)

- camelCase IPC args from JS; snake_case in Rust.
- New panels register in a registry file, one line per panel; nothing in `App.tsx`.
- Everything outside `AuthGate`; anon-key Supabase client.
- `/bin/ls`, `/bin/cat` in scripts (aliases are broken).
- Migrations: forward-only, `IF NOT EXISTS`-guarded, in `supabase/migrations/`.
