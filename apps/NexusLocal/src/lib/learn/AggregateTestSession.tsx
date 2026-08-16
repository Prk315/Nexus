/**
 * "Samlet prøve" — LEARN_PLAN.md "Samlet prøve — aggregated unit MCQ test"
 * (pinned 2026-08-16). A per-unit fullscreen overlay, opened from
 * `PathPanel.tsx`'s `AggregateTestNode` once a unit is MASTERED and its
 * derived item pool (`aggregateTest.collectUnitMcqs`) has ≥5 items. One
 * shuffled pass over every MCQ-shaped item already living in the unit's
 * content — no authoring, no new content, no new tables. Persists nothing
 * beyond the normal `lr_attempt_log` row + `lr_memory_state` update per item
 * (the charter's own words: "Persist nothing new — the attempt log and
 * memory state already capture it"), so unlike `ChallengeSession.tsx` there
 * is no end-of-session submit and no risk of losing anything by closing
 * early — every answer is already graded the moment it's given.
 *
 * Reuses `TestStep.tsx`'s exported `QuestionCard` verbatim for the
 * option-rendering + staggered rationale reveal (why_md / solution_md, both
 * folded into `AggregateItem.options[].why_md` by the collector) — this file
 * owns only the shuffle, the progress dock, the grading side effects, and
 * the end-of-run breakdown report.
 */

import { useEffect, useMemo, useState } from "react";
import { fetchMemoryStates, fetchUnitContent, logAttempt, upsertMemory } from "./api";
import { applyGrade, defaultMemoryState } from "./memory";
import { collectUnitMcqs, originalItemId, type AggregateItem } from "./aggregateTest";
import type { Grade } from "./types";
import { QuestionCard } from "./player/TestStep";
import { CARD, DOCK_SHELL, DOCK_STACK, MAIN_SHELL, PLAYER_STYLE, READING_COL, useLensTokens } from "./player/tokens";

// LEARN_PLAN.md: "Grading: logAttempt per item + applyGrade at weight 0.8
// (correct → 2, wrong → 1)". Below the productivity-stack's normal 1.0 (a
// re-test of already-mastered material is confirmatory practice, not fresh
// acquisition) but above Lynudfordring's 0.5 half-weight (this is untimed,
// unhinted, one deliberate answer per item — stronger evidence than a
// 30-second speed round).
const AGGREGATE_WEIGHT = 0.8;

/** Fisher–Yates on a copy — never mutates its input. Same local pattern
 * `ChallengeSession.tsx` / `ExerciseSession.tsx` each keep their own copy of. */
function shuffle<T>(items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Fire-and-forget grading side effects for one answered item — must never
 * be awaited by the caller (mirrors `ChallengeSession.tsx`'s `gradeDrill`).
 * Credits EVERY concept in `item.concept_ids`, the same "credit every
 * concept the item's own group covers" convention `fetchReviewQueue` /
 * `applyChallengeMemory` both use. `item_ref` is the ORIGINAL drill/test/
 * flashcard id (`originalItemId`, stripping the collector's `${source}-`
 * prefix) so this composes with the same attempt history Player/Review/
 * Challenge already write, rather than starting a parallel one. No blame
 * propagation here — the pinned charter specifies only logAttempt +
 * applyGrade for this feature, unlike Player/Challenge's grading paths.
 */
function gradeItem(item: AggregateItem, correct: boolean) {
  const grade: Grade = correct ? 2 : 1; // never 0 — see LEARN_PLAN.md's grade map
  const itemRef = originalItemId(item);
  logAttempt({ itemRef, lens: item.lens, grade }).catch((e) =>
    console.error("[learn] aggregate test logAttempt failed", e)
  );
  applyAggregateMemory(item.concept_ids, item.lens, grade).catch((e) =>
    console.error("[learn] aggregate test applyGrade failed", e)
  );
}

async function applyAggregateMemory(conceptIds: string[], lens: string, grade: Grade): Promise<void> {
  if (conceptIds.length === 0) return;
  const states = await fetchMemoryStates(conceptIds);
  const now = new Date();
  await Promise.all(
    conceptIds.map((id) => {
      // "default" is a placeholder — `upsertMemory` always overwrites
      // `user_id` via `nodeUserId()` on upsert, same shortcut
      // `ChallengeSession.tsx`'s `applyChallengeMemory` already takes.
      const existing = states[id] ?? defaultMemoryState("default", id);
      const updated = applyGrade(existing, grade, lens, now, AGGREGATE_WEIGHT);
      return upsertMemory(updated);
    })
  );
}

interface Bucket {
  key: string;
  label: string;
  correct: number;
  total: number;
}

function addToBucket(map: Map<string, Bucket>, key: string, label: string, correct: boolean): void {
  const b = map.get(key) ?? { key, label, correct: 0, total: 0 };
  b.total += 1;
  if (correct) b.correct += 1;
  map.set(key, b);
}

/** Weakest first (lowest correct/total ratio), ties broken by MORE evidence
 * first (higher total) — a 1/2 concept and a 4/8 concept are equally
 * "weak" by ratio, but the 4/8 reading is the one worth surfacing first. */
function sortWeakestFirst(buckets: Bucket[]): Bucket[] {
  return buckets.sort((a, b) => {
    const ra = a.correct / a.total;
    const rb = b.correct / b.total;
    if (ra !== rb) return ra - rb;
    return b.total - a.total;
  });
}

function isCorrect(item: AggregateItem, selections: Record<string, number>): boolean {
  const sel = selections[item.id];
  return sel !== undefined && item.options[sel]?.correct === true;
}

const SOURCE_LABEL: Record<AggregateItem["source"], string> = {
  test: "Test questions",
  flashcard: "Flashcards",
  drill: "Drills",
};

type Phase = "loading" | "quiz" | "end" | "empty" | "error";

export function AggregateTestSession({ unitId, onClose }: { unitId: number; onClose: () => void }) {
  const LENS = useLensTokens();
  const [phase, setPhase] = useState<Phase>("loading");
  const [unitTitle, setUnitTitle] = useState<string>("");
  const [conceptTitles, setConceptTitles] = useState<Map<string, string>>(new Map());
  const [items, setItems] = useState<AggregateItem[]>([]);
  const [qIdx, setQIdx] = useState(0);
  const [selections, setSelections] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const row = await fetchUnitContent(unitId);
        const content = row?.content;
        if (!content) {
          if (!cancelled) setPhase("empty");
          return;
        }
        const collected = collectUnitMcqs(content);
        if (collected.length === 0) {
          if (!cancelled) setPhase("empty");
          return;
        }
        if (cancelled) return;
        setUnitTitle(content.title || content.unit_code);
        setConceptTitles(new Map(content.theory.map((box) => [box.concept_id, box.title])));
        setItems(shuffle(collected));
        setPhase("quiz");
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId]);

  const total = items.length;
  const current = items[qIdx];

  function handleSelect(i: number) {
    if (!current || selections[current.id] !== undefined) return;
    setSelections((s) => ({ ...s, [current.id]: i }));
    gradeItem(current, current.options[i]?.correct === true);
  }

  const score = useMemo(() => items.filter((it) => isCorrect(it, selections)).length, [items, selections]);

  const conceptBreakdown = useMemo(() => {
    const map = new Map<string, Bucket>();
    for (const item of items) {
      const correct = isCorrect(item, selections);
      const ids = item.concept_ids.length > 0 ? item.concept_ids : [];
      for (const cid of ids) {
        addToBucket(map, cid, conceptTitles.get(cid) ?? cid, correct);
      }
    }
    return sortWeakestFirst(Array.from(map.values()));
  }, [items, selections, conceptTitles]);

  const lensBreakdown = useMemo(() => {
    const map = new Map<string, Bucket>();
    for (const item of items) {
      addToBucket(map, item.lens, LENS[item.lens]?.label ?? item.lens, isCorrect(item, selections));
    }
    return sortWeakestFirst(Array.from(map.values()));
  }, [items, selections, LENS]);

  const sourceBreakdown = useMemo(() => {
    const map = new Map<string, Bucket>();
    for (const item of items) {
      addToBucket(map, item.source, SOURCE_LABEL[item.source], isCorrect(item, selections));
    }
    return sortWeakestFirst(Array.from(map.values()));
  }, [items, selections]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col animate-[learn-overlay_.22s_ease-out] bg-[#F6F5F1]/97 backdrop-blur-xl text-[#1A1A24]">
      <style>{PLAYER_STYLE}</style>

      <header className="shrink-0 border-b border-black/[0.08] px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-8">
        <div className={READING_COL}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[#6E6E78] active:bg-black/[0.05]"
            >
              ✕
            </button>
            <span className="truncate text-[13px] font-medium text-[#1A1A24]/85">
              Samlet prøve{unitTitle ? ` · ${unitTitle}` : ""}
            </span>
          </div>
          {phase === "quiz" && total > 0 && (
            <div className="mt-2 text-[11px] text-[#6E6E78]">
              {qIdx + 1} / {total}
            </div>
          )}
        </div>
      </header>

      {phase === "loading" && (
        <main className="flex min-h-0 flex-1 items-center justify-center px-4 text-[12px] text-[#6E6E78]">
          Loading…
        </main>
      )}

      {(phase === "empty" || phase === "error") && (
        <main className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-[12px] text-[#6E6E78]">
          {phase === "error" ? "Could not load this unit's content." : "Nothing to test here yet."}
        </main>
      )}

      {phase === "quiz" && current && (
        <>
          <main className={`${MAIN_SHELL} pb-40`}>
            <div className={READING_COL}>
              <QuestionCard question={current} selected={selections[current.id] ?? null} onSelect={handleSelect} />
            </div>
          </main>
          <footer className={DOCK_SHELL}>
            <div className={DOCK_STACK}>
              <button
                type="button"
                onClick={() => (qIdx + 1 >= total ? setPhase("end") : setQIdx((n) => n + 1))}
                disabled={selections[current.id] === undefined}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985] disabled:opacity-40"
              >
                {qIdx + 1 === total ? "See results" : "Next question"}
              </button>
            </div>
          </footer>
        </>
      )}

      {phase === "end" && (
        <>
          <main className={`${MAIN_SHELL} pb-40`}>
            <div className={READING_COL}>
              <div className="mt-4 flex flex-col items-center text-center md:mt-8">
                <div className="bg-gradient-to-r from-indigo-600 to-fuchsia-600 bg-clip-text font-mono text-5xl font-semibold tabular-nums text-transparent md:text-6xl">
                  {score} / {total}
                </div>
                <div className="mt-1 text-[11px] uppercase tracking-wide text-[#6E6E78]">
                  {total > 0 ? `${Math.round((score / total) * 100)}% correct` : ""}
                </div>
              </div>

              <BreakdownSection title="By concept" buckets={conceptBreakdown} />
              <BreakdownSection title="By lens" buckets={lensBreakdown} />
              <BreakdownSection title="By source" buckets={sourceBreakdown} />
            </div>
          </main>
          <footer className={DOCK_SHELL}>
            <div className={DOCK_STACK}>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
              >
                Done
              </button>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}

function BreakdownSection({ title, buckets }: { title: string; buckets: Bucket[] }) {
  if (buckets.length === 0) return null;
  return (
    <div className="mt-6 md:mt-8">
      <h3 className="text-[11px] uppercase tracking-[0.14em] text-[#6E6E78]">{title}</h3>
      <div className={`mt-2 flex flex-col gap-3 ${CARD} p-3 md:p-5`}>
        {buckets.map((b) => (
          <FractionBar key={b.key} label={b.label} correct={b.correct} total={b.total} />
        ))}
      </div>
    </div>
  );
}

function FractionBar({ label, correct, total }: { label: string; correct: number; total: number }) {
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className="min-w-0 flex-1 truncate text-[#1A1A24]/80">{label}</span>
        <span className="shrink-0 font-mono tabular-nums text-[#6E6E78]">
          {correct}/{total}
        </span>
      </div>
      <div className="h-[6px] w-full overflow-hidden rounded-full bg-black/[0.07]">
        <span
          className="block h-full rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
