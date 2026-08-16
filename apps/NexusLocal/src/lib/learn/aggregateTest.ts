/**
 * The "Samlet prøve" collector — LEARN_PLAN.md "Samlet prøve — aggregated
 * unit MCQ test" (pinned 2026-08-16). Pure, derived-only: no authoring, no
 * new content, no network. Walks a unit's newest `UnitContent` and flattens
 * every MCQ-shaped item already living in it into one shuffleable pool.
 *
 * ── Sources, per the pinned charter ──────────────────────────────────────
 *
 * 1. `test.questions` — already `TestQuestion`-shaped, taken as-is.
 * 2. Flashcard `check` MCQs (`flashcards.entry[].check` and
 *    `flashcards.exit[].check`) — both are `FlashcardCheck`-shaped
 *    (`{prompt_md, options}`), structurally identical to `TestQuestion`
 *    minus `id`/`concept_ids`/`lens`, which this collector supplies from the
 *    card itself. `check` is optional per schema (LEARN_PLAN.md: "present
 *    mainly on `apply` cards") — sampled live content confirms `recall` exit
 *    cards routinely carry no `check` at all (unit 2 v3, card `-fc-x1`);
 *    cards without one are simply not a source of an item, not an error.
 * 3. `choice`-type drills. `verified against real content
 *    2026-08-16` — the charter lists "choice-type drills" and "truefalse
 *    drills rendered as two-option MCQs" as two separate bullets, but they
 *    turn out to be **one code path**: a SQL sweep of every
 *    `archetype: "truefalse"` drill in `lr_unit_content` shows 189/196 are
 *    already `answer_type: "choice"` with `choices: ["Sandt", "Falsk"]` (or
 *    the DBMS equivalent) and `answer.value` the correct choice's own text —
 *    exactly the shape `answers.ts`'s `checkChoice` already special-cases
 *    (see that file's header comment). There is no separate "truefalse"
 *    answer shape to branch on. The remaining 7 are archetype-mislabeled
 *    free-response items (`answer_type: "text"` asking "kan den være... kan
 *    den ikke være...", one stray `"numeric"` in the DBMS bank) — not
 *    MCQ-shaped at all, and they fall out of the pool for free because they
 *    aren't `answer_type: "choice"`. So this collector has exactly ONE
 *    drill branch, gated on `answer_type === "choice"`, and it picks up
 *    truefalse drills automatically; no `archetype` check anywhere.
 *
 * ── Correctness resolution for choice drills ─────────────────────────────
 *
 * `answer.value` is observed in two shapes across real content (see
 * `answers.ts`'s header comment, ported here rather than imported since that
 * file's `checkChoice` takes a learner's *selection string*, not a
 * from-scratch index): a number is treated as an index into `choices`; a
 * string is matched (trimmed, exact) against `choices` text. A drill whose
 * shape resolves to neither is skipped, per "skip malformed items rather
 * than throwing".
 *
 * ── Ids ───────────────────────────────────────────────────────────────────
 *
 * `${source}-${originalId}` — deterministic and globally unique (drill/test/
 * flashcard ids already are within a unit). Kept reversible on purpose:
 * `AggregateTestSession`'s grading path strips the prefix back off before
 * calling `logAttempt`, so a choice drill answered here logs under its OWN
 * `drill.id` — the same `item_ref` `Player.tsx`/`ChallengeSession.tsx`/
 * `ReviewSession.tsx` already log that drill under — composing for free with
 * `fetchSolvedDrillIds`-based continuity (layer resume, deck checkmarks)
 * rather than starting a parallel, disconnected attempt history. None of the
 * three source prefixes ("test", "flashcard", "drill") contain a "-",
 * so `id.slice(id.indexOf("-") + 1)` always recovers the original id intact
 * even though drill/flashcard ids themselves are dash-heavy
 * (`la_2_u1-p3-d9`).
 */

import type { Drill, FlashcardCheck, Lens, TestQuestion, TestOption, UnitContent } from "./types";

export type AggregateSource = "test" | "flashcard" | "drill";

/** Structurally a `TestQuestion` (same `{id, prompt_md, options, concept_ids,
 * lens}` shape) plus the source tag — so `TestStep.tsx`'s exported
 * `QuestionCard` (which only ever reads those five fields) renders an
 * `AggregateItem` with zero adapter. */
export interface AggregateItem extends TestQuestion {
  source: AggregateSource;
}

/** Strip the `${source}-` id prefix back off, recovering the original
 * `test.questions`/`flashcards.*`/drill id `logAttempt` should credit. See
 * this file's header comment for why no prefix collides with a "-". */
export function originalItemId(item: Pick<AggregateItem, "id">): string {
  return item.id.slice(item.id.indexOf("-") + 1);
}

/** Mirrors `answers.ts`'s `checkChoice` correctness rule, but resolves an
 * INDEX from scratch (no learner selection yet) rather than checking one.
 * Returns `null` — "skip this drill" — when `choices`/`answer.value` don't
 * resolve to a valid index. */
function choiceCorrectIndex(drill: Pick<Drill, "choices" | "answer">): number | null {
  const choices = drill.choices;
  if (!choices || choices.length < 2) return null;
  const value = drill.answer?.value;
  if (typeof value === "number") {
    return choices[value] !== undefined ? value : null;
  }
  if (typeof value === "string") {
    const idx = choices.findIndex((c) => c.trim() === value.trim());
    return idx === -1 ? null : idx;
  }
  return null;
}

function optionsFromChoiceDrill(drill: Drill, correctIndex: number): TestOption[] {
  return (drill.choices ?? []).map((body_md, i) => ({
    body_md,
    correct: i === correctIndex,
    // solution_md is the drill's one rationale, shared by every option — the
    // same "one why_md for the whole answer" shape `test.questions` doesn't
    // have (there each option carries its own), but it's the only rationale
    // authored content actually stores for a choice drill.
    why_md: drill.solution_md,
  }));
}

function hasCorrectOption(options: TestOption[] | undefined): options is TestOption[] {
  return Array.isArray(options) && options.length >= 2 && options.some((o) => o.correct);
}

function flashcardItem(
  source: "flashcard",
  cardId: string,
  conceptId: string,
  lens: Lens | null,
  check: FlashcardCheck | undefined
): AggregateItem | null {
  if (!check || !hasCorrectOption(check.options)) return null;
  return {
    id: `${source}-${cardId}`,
    prompt_md: check.prompt_md,
    options: check.options,
    concept_ids: [conceptId],
    // A flashcard whose own `lens` is null AND whose anchored theory box (if
    // still findable) has no `perspective` either has no lens to tag —
    // skipped rather than guessing (mirrors Player.tsx's `resolveCardLens`,
    // duplicated inline here since that helper isn't exported and this file
    // must stay a pure, dependency-free collector).
    lens: lens ?? "",
    source,
  };
}

/**
 * Collect every MCQ-form item in a unit's newest content. Deterministic
 * order (test → flashcard entry → flashcard exit → drills, each in their
 * authored order) — `AggregateTestSession` shuffles; this function never
 * does, so its output is stable and testable.
 */
export function collectUnitMcqs(content: UnitContent): AggregateItem[] {
  const items: AggregateItem[] = [];

  for (const q of content.test?.questions ?? []) {
    if (!hasCorrectOption(q.options)) continue;
    items.push({
      id: `test-${q.id}`,
      prompt_md: q.prompt_md,
      options: q.options,
      concept_ids: q.concept_ids ?? [],
      lens: q.lens,
      source: "test",
    });
  }

  const theoryLensByConcept = new Map(
    content.theory.map((box) => [box.concept_id, box.perspective] as const)
  );

  for (const fc of content.flashcards?.entry ?? []) {
    const item = flashcardItem(
      "flashcard",
      fc.id,
      fc.concept_id,
      fc.lens ?? theoryLensByConcept.get(fc.concept_id) ?? null,
      fc.check
    );
    if (item) items.push(item);
  }
  for (const fc of content.flashcards?.exit ?? []) {
    const item = flashcardItem(
      "flashcard",
      fc.id,
      fc.concept_id,
      fc.lens ?? theoryLensByConcept.get(fc.concept_id) ?? null,
      fc.check
    );
    if (item) items.push(item);
  }

  for (const group of content.practice ?? []) {
    for (const drill of group.drills ?? []) {
      if (drill.answer_type !== "choice") continue; // see header comment — covers truefalse natively
      const correctIndex = choiceCorrectIndex(drill);
      if (correctIndex === null) continue;
      items.push({
        id: `drill-${drill.id}`,
        prompt_md: drill.prompt_md,
        options: optionsFromChoiceDrill(drill, correctIndex),
        concept_ids: drill.concept_ids && drill.concept_ids.length > 0 ? drill.concept_ids : group.concept_ids,
        lens: drill.lens,
        source: "drill",
      });
    }
  }

  // Items with no resolvable lens (the flashcard edge case above) are
  // dropped rather than shipped with an empty lens key — a lens chip
  // indexing `LENS[""]` would be undefined and throw in `QuestionCard`.
  return items.filter((it) => it.lens !== "");
}
