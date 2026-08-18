/**
 * Sprint — bucketed fast-feedback exam training (LEARN_PLAN.md "Sprint —
 * bucketed fast-feedback exam training", pinned 2026-08-18 — DBMS pilot; UI
 * brief `/Users/bastianthomsen/.claude/jobs/065a5f2e/tmp/sprint/brief.md`
 * §D.3–D.7). One bucket at a time, one drill at a time, instant verdict.
 * WRONG shows the bucket's `how_md` recipe + `why_md` before the next drill
 * ("that pause IS the teaching moment" — LEARN_PLAN.md). THREE CORRECT IN A
 * ROW advances to the next bucket. Bucket order (never-practiced first, then
 * lowest accuracy) is computed ONCE at session start from
 * `api.fetchSprintBuckets` and never re-sorted mid-session (§D.4) — a bucket
 * just cleared would otherwise jump back to the front the instant its
 * accuracy dipped.
 *
 * Deliberately NOT `Player.tsx`, NOT `DrillCard.tsx`, carries no
 * Workspace/Kladde math writer — Sprint's whole premise is that no notation
 * is typed, so checking is the four trivial comparisons in `answers.ts`
 * (`checkTilesBuild`/`checkTilesSelect`) plus this file's own `checkBlank`
 * (accept-list matching per §B.3, never parsed math — `answers.ts`'s
 * fraction/vector/matrix grammar is not used here). Same shell as
 * `ChallengeSession.tsx`: `player/tokens.tsx`'s literals, `PLAYER_STYLE`
 * injected once at the top of the overlay.
 *
 * No timer, no score, no run persistence, no end screen, no close
 * confirmation — every attempt is already logged the instant it resolves
 * (§D.7's fire-and-forget grading), so leaving costs nothing.
 */

import { useEffect, useRef, useState } from "react";
import {
  applyBlamePropagation,
  fetchMemoryStates,
  fetchSprintAttemptIndex,
  fetchSprintBuckets,
  fetchSprintDrills,
  logAttempt,
  upsertMemory,
} from "./api";
import { applyGrade, defaultMemoryState } from "./memory";
import { checkTilesBuild, checkTilesSelect } from "./answers";
import type { Grade, Lens, LrSprintDrill, SprintDrillContent } from "./types";
import { Markdown } from "./Markdown";
import { useCourse } from "./CourseContext";
import { TileDrill } from "./player/TileDrill";
import {
  ANSWER_COL,
  CARD,
  DOCK_SHELL,
  DOCK_STACK,
  FEEDBACK,
  MAIN_SHELL,
  PLAYER_STYLE,
  READING_COL,
  useLensTokens,
  useSolidBar,
} from "./player/tokens";

const SPRINT_WEIGHT = 0.5;
const CORRECT_FLASH_MS = 550; // faster than Lynudfordring's 650ms — pace is the product
const BUCKET_CLEARED_MS = 2000;
const STREAK_TARGET = 3;

// ── Ordering (UI brief §D.4/§D.5) ───────────────────────────────────────────

interface BucketQueue {
  bucket: string;
  drills: LrSprintDrill[];
}

/** Fisher–Yates on a copy — never mutates its input. Same pattern
 * `ChallengeSession.tsx` uses for its own round shuffles. */
function shuffle<T>(items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Never-practiced first (stable among fresh buckets), then lowest accuracy,
 * then least-practised — the exact §D.4 formula, computed once at session
 * start and never re-run afterward. */
function orderBuckets<T extends { bucket: string; drills: number; attempts: number; accuracy: number | null }>(
  rows: T[]
): T[] {
  return rows
    .filter((r) => r.drills > 0)
    .slice()
    .sort((a, b) => {
      const an = a.attempts === 0;
      const bn = b.attempts === 0;
      if (an !== bn) return an ? -1 : 1;
      if (an && bn) return a.bucket.localeCompare(b.bucket);
      const aa = a.accuracy ?? 1;
      const ba = b.accuracy ?? 1;
      if (aa !== ba) return aa - ba;
      return a.attempts - b.attempts;
    });
}

/** Within-bucket drill order (§D.5): never-attempted first (shuffled), then
 * by last-attempted ascending (least recently seen), then by attempt count
 * ascending. */
function orderDrillsInBucket(
  drills: LrSprintDrill[],
  attemptIndex: Map<string, { n: number; lastAt: string }>
): LrSprintDrill[] {
  const never = shuffle(drills.filter((d) => !attemptIndex.has(d.code)));
  const seen = drills
    .filter((d) => attemptIndex.has(d.code))
    .slice()
    .sort((a, b) => {
      const ia = attemptIndex.get(a.code)!;
      const ib = attemptIndex.get(b.code)!;
      const la = new Date(ia.lastAt).getTime();
      const lb = new Date(ib.lastAt).getTime();
      if (la !== lb) return la - lb;
      return ia.n - ib.n;
    });
  return [...never, ...seen];
}

// ── Blank matching (§B.3 — accept-list matching, never parsed math) ────────

/** trim, lowercase, collapse internal whitespace, strip surrounding
 * `{}`/`()`/quotes/a trailing `.` — applied to BOTH the learner's input and
 * every `accept` entry before comparing, per §B.3. */
function normalizeBlank(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^[{("']+/, "").replace(/[)}"'.]+$/, "");
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** "set" mode tokenizer: splits on commas/whitespace, and further splits a
 * single run of letters/digits with no separators (e.g. "KL", "KELW") into
 * individual characters — what makes `KL`, `LK`, `{K, L}` and `K,L` all
 * equivalent for an attribute-set answer (§B.3). Returns tokens SORTED so
 * two equal sets compare equal element-wise. */
function tokenizeSet(raw: string): string[] {
  const norm = normalizeBlank(raw);
  if (norm === "") return [];
  let parts = norm.split(/[,\s]+/).filter(Boolean);
  if (parts.length === 1 && parts[0].length > 1 && /^[a-z0-9]+$/i.test(parts[0])) {
    parts = parts[0].split("");
  }
  return parts.sort();
}

function checkBlank(userInput: string, content: SprintDrillContent): boolean {
  const accept = content.accept ?? [];
  if (accept.length === 0 || userInput.trim() === "") return false;
  const mode = content.accept_mode ?? "exact";

  if (mode === "numeric") {
    const userNum = parseFloat(normalizeBlank(userInput));
    if (Number.isNaN(userNum)) return false;
    return accept.some((a) => {
      const n = parseFloat(normalizeBlank(a));
      return !Number.isNaN(n) && n === userNum;
    });
  }

  if (mode === "set") {
    const userTokens = tokenizeSet(userInput);
    if (userTokens.length === 0) return false;
    return accept.some((a) => {
      const aTokens = tokenizeSet(a);
      return aTokens.length === userTokens.length && aTokens.every((t, i) => t === userTokens[i]);
    });
  }

  const norm = normalizeBlank(userInput);
  return accept.some((a) => normalizeBlank(a) === norm);
}

// ── Grading (§D.7 — mirrors ChallengeSession.gradeDrill precisely) ─────────

async function applySprintMemory(conceptIds: string[], lens: Lens | null, grade: Grade): Promise<void> {
  const states = await fetchMemoryStates(conceptIds);
  const now = new Date();
  await Promise.all(
    conceptIds.map((id) => {
      // "default" here is a bootstrap placeholder only — `upsertMemory`
      // always overwrites `user_id` with the real `nodeUserId()` before
      // persisting (api.ts), same precedent as `ChallengeSession`'s own
      // `applyChallengeMemory`.
      const existing = states[id] ?? defaultMemoryState("default", id);
      return upsertMemory(applyGrade(existing, grade, lens, now, SPRINT_WEIGHT));
    })
  );
}

/** Fire-and-forget grading side effects — never awaited by the caller, so a
 * slow round trip is never visible between two taps (§D.7, point 4). */
function gradeSprintDrill(drill: LrSprintDrill, correct: boolean) {
  const c = drill.content;
  const grade: Grade = correct ? 2 : 1; // never 0 — a fast-format miss is weak evidence

  // ALWAYS fires, even with no concepts — this row is what drives bucket
  // ordering (§D.7, point 2). `itemRef` is `drill.code`, NOT `drill_id` and
  // NOT `source_slug` — the bucket-stats RPC joins on `a.item_ref = d.code`.
  logAttempt({ itemRef: drill.code, lens: c.lens ?? null, grade }).catch((e) =>
    console.error("[learn] sprint logAttempt failed", e)
  );

  if (c.concept_ids.length > 0) {
    applySprintMemory(c.concept_ids, c.lens ?? null, grade).catch((e) =>
      console.error("[learn] sprint applyGrade failed", e)
    );
    applyBlamePropagation(c.concept_ids, grade, SPRINT_WEIGHT).catch((e) =>
      console.error("[learn] sprint blame propagation failed", e)
    );
  }
}

// ── The correct answer, in the drill's own idiom (teach sheet, item 1) ─────

function correctAnswerNode(drill: LrSprintDrill) {
  const c = drill.content;
  switch (drill.format) {
    case "mcq":
    case "why":
      return <Markdown className="inline">{c.choices?.[c.answer_idx ?? 0] ?? ""}</Markdown>;
    case "truefalse":
      return <span>{c.answer ? "True" : "False"}</span>;
    case "blank":
      return <span className="font-mono">{c.accept?.[0] ?? ""}</span>;
    case "tiles": {
      const byId = new Map((c.tiles ?? []).map((t) => [t.id, t.md]));
      if ((c.mode ?? "build") === "build") {
        return <span>{(c.sequence ?? []).map((id) => byId.get(id) ?? id).join(" → ")}</span>;
      }
      return <span>{(c.tiles ?? []).filter((t) => t.correct).map((t) => t.md).join(", ")}</span>;
    }
    default:
      return null;
  }
}

// ── Session ──────────────────────────────────────────────────────────────

type Phase = "loading" | "error" | "empty" | "drill" | "cleared";

export function SprintSession({ onClose }: { onClose: () => void }) {
  const { course } = useCourse();
  const LENS = useLensTokens();
  const SOLID_BAR = useSolidBar();

  const [phase, setPhase] = useState<Phase>("loading");
  const [queues, setQueues] = useState<BucketQueue[]>([]);
  const [bucketIdx, setBucketIdx] = useState(0);
  const [servedCount, setServedCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [tally, setTally] = useState({ drills: 0, correct: 0 });

  // Controlled answer-surface state — one shared slot, since exactly one
  // format is live per drill.
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [pickedBool, setPickedBool] = useState<boolean | null>(null);
  const [blankInput, setBlankInput] = useState("");
  const [tileSelection, setTileSelection] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  const [result, setResult] = useState<boolean | null>(null);
  const [teachOpen, setTeachOpen] = useState(false);

  const resolveTimerRef = useRef<number | null>(null);
  const clearedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    // Sprint codes are namespaced `spr-<courseKey>-...` in the live table —
    // see api.ts's `fetchSprintAttemptIndex` deviation note (the UI brief's
    // own `dbms-sp-` prefix example doesn't match what the content pipeline
    // actually inserted).
    const codePrefix = `spr-${course.key}`;
    Promise.all([
      fetchSprintBuckets(course.courseId),
      fetchSprintDrills(course.courseId),
      fetchSprintAttemptIndex(codePrefix),
    ])
      .then(([stats, drills, attemptIndex]) => {
        if (!alive) return;
        const byBucket = new Map<string, LrSprintDrill[]>();
        for (const d of drills) {
          const list = byBucket.get(d.bucket);
          if (list) list.push(d);
          else byBucket.set(d.bucket, [d]);
        }
        const ordered = orderBuckets(stats)
          .map((s) => ({ bucket: s.bucket, drills: orderDrillsInBucket(byBucket.get(s.bucket) ?? [], attemptIndex) }))
          .filter((q) => q.drills.length > 0);
        setQueues(ordered);
        setPhase(ordered.length === 0 ? "empty" : "drill");
      })
      .catch((e) => {
        console.error("[learn] sprint pool load failed", e);
        if (alive) setPhase("error");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (resolveTimerRef.current !== null) window.clearTimeout(resolveTimerRef.current);
      if (clearedTimerRef.current !== null) window.clearTimeout(clearedTimerRef.current);
    },
    []
  );

  const currentBucketEntry = queues[bucketIdx] ?? null;
  const currentQueue = currentBucketEntry?.drills ?? [];
  const currentDrill = currentQueue.length > 0 ? currentQueue[servedCount % currentQueue.length] : null;
  const content = currentDrill?.content;

  function resetAnswerState() {
    setSelectedIdx(null);
    setPickedBool(null);
    setBlankInput("");
    setTileSelection([]);
    setChecked(false);
    setResult(null);
    setTeachOpen(false);
  }

  function advanceDrill() {
    setServedCount((c) => c + 1);
    resetAnswerState();
  }

  function advanceBucket() {
    setBucketIdx((b) => (b + 1) % queues.length);
    setServedCount(0);
    setStreak(0);
    setPhase("drill");
    resetAnswerState();
  }

  function resolveDrill(correct: boolean) {
    if (!currentDrill || checked) return;
    setChecked(true);
    setResult(correct);
    gradeSprintDrill(currentDrill, correct);
    setTally((t) => ({ drills: t.drills + 1, correct: t.correct + (correct ? 1 : 0) }));

    resolveTimerRef.current = window.setTimeout(() => {
      if (correct) {
        const next = streak + 1;
        setStreak(next);
        if (next >= STREAK_TARGET) {
          setPhase("cleared");
        } else {
          advanceDrill();
        }
      } else {
        setStreak(0);
        setTeachOpen(true);
      }
    }, CORRECT_FLASH_MS);
  }

  // Bucket-cleared interstitial auto-advances, but is also tappable.
  useEffect(() => {
    if (phase !== "cleared") return;
    clearedTimerRef.current = window.setTimeout(advanceBucket, BUCKET_CLEARED_MS);
    return () => {
      if (clearedTimerRef.current !== null) window.clearTimeout(clearedTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function handleChoiceTap(idx: number) {
    if (!content || checked) return;
    setSelectedIdx(idx);
    resolveDrill(idx === content.answer_idx);
  }

  function handleTrueFalseTap(value: boolean) {
    if (!content || checked) return;
    setPickedBool(value);
    resolveDrill(value === content.answer);
  }

  function handleBlankCheck() {
    if (!content || checked || blankInput.trim() === "") return;
    resolveDrill(checkBlank(blankInput, content));
  }

  function handleTilesCheck() {
    if (!content || checked || tileSelection.length === 0) return;
    const mode = content.mode ?? "build";
    const ok =
      mode === "build"
        ? checkTilesBuild(tileSelection, content.sequence ?? [])
        : checkTilesSelect(tileSelection, content.tiles ?? []);
    resolveDrill(ok);
  }

  const nextBucketLabel = queues.length > 0 ? queues[(bucketIdx + 1) % queues.length].bucket : "";
  const lensToken = content?.lens ? LENS[content.lens] : null;

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
            {currentBucketEntry &&
              (lensToken ? (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide ${lensToken.chip}`}>
                  <span className={`h-1 w-1 rounded-full ${lensToken.dot}`} />
                  {currentBucketEntry.bucket}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium tracking-wide text-[#1A1A24]/70">
                  {currentBucketEntry.bucket}
                </span>
              ))}
            {currentDrill?.status === "draft" && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide ${FEEDBACK.draft}`}>KLADDE</span>
            )}
            <span className="ml-auto flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`h-2 w-2 rounded-full ${
                    i < streak ? "animate-[learn-chip-rise_.35s_ease-out] bg-gradient-to-r from-indigo-500 to-fuchsia-600" : "bg-black/15"
                  }`}
                />
              ))}
            </span>
          </div>
        </div>
      </header>

      {phase === "loading" && (
        <main className="flex min-h-0 flex-1 items-center justify-center px-4">
          <p className="text-[13px] text-[#6E6E78]">Loading…</p>
        </main>
      )}

      {phase === "error" && (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-[13px] text-[#1A1A24]/70">Couldn't load the sprint pool.</p>
          <p className="max-w-[240px] text-[11px] leading-relaxed text-[#6E6E78]/80">
            Check the connection and reopen Sprint.
          </p>
        </main>
      )}

      {phase === "empty" && (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <h2 className="text-xl font-semibold text-[#1A1A24]">No sprint drills yet</h2>
          <p className="max-w-[280px] text-[13px] leading-relaxed text-[#6E6E78]">
            Every bucket is empty right now — check back once content lands.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 rounded-xl bg-black/[0.05] px-6 py-3 text-[14px] font-medium text-[#1A1A24]/80 active:bg-black/[0.08]"
          >
            Close
          </button>
        </main>
      )}

      {phase === "cleared" && currentBucketEntry && (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <span className="text-[22px]">✓</span>
          <h2 className="text-xl font-semibold text-[#1A1A24]">{currentBucketEntry.bucket} cleared</h2>
          <p className="text-[13px] text-[#6E6E78]">3 in a row</p>
          <p className="mt-1 font-mono text-[13px] tabular-nums text-[#6E6E78]/70">
            {tally.drills} drills · {tally.correct} correct
          </p>
          <button
            type="button"
            onClick={advanceBucket}
            className="mt-3 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-6 py-3 text-[14px] font-semibold text-white transition-transform active:scale-[0.985]"
          >
            Next: {nextBucketLabel} →
          </button>
        </main>
      )}

      {phase === "drill" && currentDrill && content && (
        <main className={`${MAIN_SHELL} pb-40`}>
          <div className={READING_COL}>
            <div
              className={`relative overflow-hidden ${CARD} p-3 transition-shadow duration-150 md:p-8 ${
                checked ? (result ? "ring-2 ring-emerald-400/70" : "ring-2 ring-red-400/70") : ""
              }`}
            >
              {content.lens && <div className={`absolute inset-x-0 top-0 h-[2px] ${SOLID_BAR[content.lens]}`} />}

              <Markdown className="mt-1 text-[15px] leading-relaxed text-[#1A1A24]/85 md:mt-2 md:text-[16.5px]">
                {content.statement_md ?? content.prompt_md ?? ""}
              </Markdown>

              <div className={`mt-3 md:mt-6 ${ANSWER_COL}`}>
                {currentDrill.format === "mcq" && (
                  <div className="flex flex-col gap-2">
                    {(content.choices ?? []).map((choice, idx) => (
                      <ChoiceButton
                        key={idx}
                        choice={choice}
                        checked={checked}
                        isSelected={selectedIdx === idx}
                        isAnswer={idx === content.answer_idx}
                        onTap={() => handleChoiceTap(idx)}
                      />
                    ))}
                  </div>
                )}

                {currentDrill.format === "why" && (
                  <div className="flex flex-col gap-3">
                    <div className="rounded-xl bg-black/[0.03] px-3 py-2.5 text-[13px] ring-1 ring-black/10">
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-[#6E6E78]/70">Given</p>
                      <Markdown className="text-[13px] text-[#1A1A24]/85">{content.given_md ?? ""}</Markdown>
                    </div>
                    <div className="flex flex-col gap-2">
                      {(content.choices ?? []).map((choice, idx) => (
                        <ChoiceButton
                          key={idx}
                          choice={choice}
                          checked={checked}
                          isSelected={selectedIdx === idx}
                          isAnswer={idx === content.answer_idx}
                          onTap={() => handleChoiceTap(idx)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {currentDrill.format === "truefalse" && (
                  <div className="grid grid-cols-2 gap-3">
                    {[true, false].map((value) => {
                      const isSelected = pickedBool === value;
                      let stateClass = "border-black/10 bg-white text-[#1A1A24]/80 active:bg-black/[0.04]";
                      if (checked) {
                        const isAnswer = value === content.answer;
                        if (isAnswer) stateClass = "border-emerald-500/40 bg-emerald-50 text-[#1A1A24]/90";
                        else if (isSelected) stateClass = "border-red-500/40 bg-red-50 text-[#1A1A24]/90";
                        else stateClass = "border-black/[0.06] bg-transparent text-[#6E6E78]/55";
                      } else if (isSelected) {
                        stateClass = "border-black/25 bg-black/[0.04] text-[#1A1A24]/90";
                      }
                      return (
                        <button
                          key={String(value)}
                          type="button"
                          disabled={checked}
                          onClick={() => handleTrueFalseTap(value)}
                          className={`min-h-[72px] rounded-2xl border text-[16px] font-semibold transition-colors ${stateClass}`}
                        >
                          {value ? "True" : "False"}
                        </button>
                      );
                    })}
                  </div>
                )}

                {currentDrill.format === "blank" && (
                  <input
                    value={blankInput}
                    onChange={(e) => setBlankInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleBlankCheck();
                    }}
                    placeholder={content.placeholder ?? ""}
                    disabled={checked}
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                    inputMode={content.accept_mode === "numeric" ? "numeric" : "text"}
                    className="min-h-[52px] w-full rounded-xl border border-black/15 bg-white px-3 py-3 font-mono text-[16px] text-[#1A1A24] outline-none transition-shadow placeholder:text-[#6E6E78]/60 focus:border-indigo-500/50 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]"
                  />
                )}

                {currentDrill.format === "tiles" && (
                  <TileDrill
                    tiles={content.tiles ?? []}
                    mode={content.mode ?? "build"}
                    answerSequence={content.sequence}
                    selection={tileSelection}
                    onSelectionChange={setTileSelection}
                    checked={checked}
                    disabled={checked}
                  />
                )}
              </div>

              {checked && result !== null && (
                <div
                  className={`mt-3 flex animate-[learn-step-in_.18s_ease-out] items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] ${
                    result ? FEEDBACK.correct : FEEDBACK.wrong
                  }`}
                >
                  <span className="text-[15px]">{result ? "✓" : "✕"}</span>
                  <span>{result ? "Correct" : "Not quite"}</span>
                </div>
              )}
            </div>
          </div>
        </main>
      )}

      {phase === "drill" &&
        currentDrill &&
        content &&
        !teachOpen &&
        (currentDrill.format === "blank" || currentDrill.format === "tiles") && (
        <footer className={DOCK_SHELL}>
          <div className={DOCK_STACK}>
            <button
              type="button"
              onClick={currentDrill.format === "blank" ? handleBlankCheck : handleTilesCheck}
              disabled={checked || (currentDrill.format === "blank" ? blankInput.trim().length === 0 : tileSelection.length === 0)}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985] disabled:opacity-40"
            >
              Check
            </button>
          </div>
        </footer>
      )}

      {phase === "drill" && currentDrill && teachOpen && (
        <div className="absolute inset-x-0 bottom-0 z-10 max-h-[72vh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-black/[0.08] bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-[0_-8px_32px_rgba(0,0,0,0.10)] animate-[learn-step-in_.18s_ease-out] md:px-8">
          <div className={READING_COL}>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-[#6E6E78]/70">Correct answer</p>
            <div className="mb-4 text-[14px] text-[#1A1A24]/90">{correctAnswerNode(currentDrill)}</div>

            <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-[#6E6E78]">How to solve this type</p>
            <Markdown className="mb-4 text-[13px] leading-relaxed text-[#1A1A24]/80">{currentDrill.content.how_md}</Markdown>

            <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-[#6E6E78]">Why</p>
            <Markdown className="mb-4 text-[13px] leading-relaxed text-[#1A1A24]/80">{currentDrill.content.why_md}</Markdown>

            <div className="mb-4 rounded-xl bg-black/[0.03] px-3 py-2.5 ring-1 ring-black/10">
              <Markdown className="text-[13px] text-[#1A1A24]/80">{`💡 ${currentDrill.content.tip_md}`}</Markdown>
            </div>

            <button
              type="button"
              onClick={advanceDrill}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
            >
              Got it →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One `mcq`/`why` choice button — shared by both formats (identical
 * `choices`/`answer_idx` shape). Tap = answer, no separate Check. */
function ChoiceButton({
  choice,
  checked,
  isSelected,
  isAnswer,
  onTap,
}: {
  choice: string;
  checked: boolean;
  isSelected: boolean;
  isAnswer: boolean;
  onTap: () => void;
}) {
  let stateClass = "border-black/10 bg-white text-[#1A1A24]/80 active:bg-black/[0.04]";
  if (checked) {
    if (isAnswer) stateClass = "border-emerald-500/40 bg-emerald-50 text-[#1A1A24]/90";
    else if (isSelected) stateClass = "border-red-500/40 bg-red-50 text-[#1A1A24]/90";
    else stateClass = "border-black/[0.06] bg-transparent text-[#6E6E78]/55";
  } else if (isSelected) {
    stateClass = "border-black/25 bg-black/[0.04] text-[#1A1A24]/90";
  }
  return (
    <button
      type="button"
      disabled={checked}
      onClick={onTap}
      className={`min-h-[56px] w-full rounded-xl border px-4 py-3.5 text-left text-[14px] transition-colors ${stateClass}`}
    >
      <Markdown className="inline">{choice}</Markdown>
    </button>
  );
}
