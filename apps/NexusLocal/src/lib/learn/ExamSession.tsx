/**
 * ExamSession — MLA eksamensemulator, tro mod det annoncerede format:
 * multiple choice med NUL, ét eller flere korrekte svar pr. spørgsmål,
 * ingen minuspoint, og et point gives KUN når præcis alle korrekte svar er
 * valgt — alt-eller-intet, mængde-lighed (`setsEqual`), aldrig delvis
 * kredit. Options er checkbokse, aldrig radioknapper — en radiogruppe kan
 * ikke udtrykke "vælg to" eller "vælg ingen".
 *
 * Flowet pr. spørgsmål er REX-gate-strukturen: prøv selv → evt. "Vis hint 1
 * · formlen" (det analytiske udtryk man kan svare med) → evt. "Vis hint 2 ·
 * teorien" → **Tjek svar**. Tjekket giver ØJEBLIKKELIG feedback — verdict,
 * grøn/rød markering af options og forklaringen — mens den SAMLEDE
 * vurdering (score, sektions-breakdown) stadig først kommer når hele sættet
 * er afsluttet. Et tjekket spørgsmål er låst; at bladre tilbage viser dets
 * facit igen.
 *
 * Persistens — råstof til en senere "practice these concepts"-funktion:
 * hvert tjek logger straks til `lr_attempt_log` (grade 3/0, samme stige som
 * resten af Learn), og afslutningen skriver kørslen til `lr_challenge_run`
 * (scope "mla-exam") med pr.-spørgsmål-detaljer {slug, ok, hints} i
 * rounds-jsonb'en.
 *
 * Bekræftelser er two-tap inline, aldrig window.confirm — en silent no-op i
 * iOS WKWebView, hvor afslutning ellers ville være umulig at bekræfte.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { logAttempt, submitExamRun, type ExamQuestion } from "./api";
import { Markdown } from "./Markdown";
import { CARD, FEEDBACK, PLAYER_STYLE, READING_COL } from "./player/tokens";

/** Normalisering til numerisk svar-match: små bogstaver, intet whitespace,
 * decimalkomma → punktum. Accept-listen er normaliseret med samme regel. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").replace(/,(?=\d)/g, ".");
}

function setsEqual(a: Set<number>, b: number[]): boolean {
  return a.size === b.length && b.every((x) => a.has(x));
}

// `touched` lader "ingen af svarene er korrekte" være et bevidst afgivet
// svar: et klik der efterlader mængden tom tæller som besvaret; et urørt
// spørgsmål gør ikke.
interface AnswerState { picked: Set<number>; text: string; touched?: boolean }

function isCorrect(q: ExamQuestion, a: AnswerState | undefined): boolean {
  if (!a) return false;
  if (q.kind === "mc") return a.touched === true && setsEqual(a.picked, q.correct);
  const t = norm(a.text);
  if (t === "") return false;
  return q.accept.some((acc) => norm(acc) === t);
}

function isAnswered(q: ExamQuestion, a: AnswerState | undefined): boolean {
  if (!a) return false;
  return q.kind === "mc" ? a.picked.size > 0 || a.touched === true : a.text.trim() !== "";
}

export function ExamSession({ title, questions, onClose }: {
  title: string;
  questions: ExamQuestion[];
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Record<string, boolean>>({}); // slug → ok
  const [hintsShown, setHintsShown] = useState<Record<string, number>>({}); // slug → 0|1|2
  const [phase, setPhase] = useState<"taking" | "review">("taking");
  // Two-tap i stedet for window.confirm (silent no-op i iOS WKWebView).
  const [armed, setArmed] = useState<"finish" | "close" | null>(null);
  const startedAt = useRef(Date.now());
  const submitted = useRef(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3500);
    return () => clearTimeout(t);
  }, [armed]);

  const q = questions[idx];
  const a = answers[q?.slug ?? ""];
  const qChecked = q ? q.slug in checked : false;

  const checkedCount = useMemo(() => Object.keys(checked).length, [checked]);
  const correctSoFar = useMemo(() => Object.values(checked).filter(Boolean).length, [checked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
      if (phase === "taking") {
        if (e.key === "ArrowRight") setIdx((i) => Math.min(questions.length - 1, i + 1));
        if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, questions.length, armed, checkedCount]);

  function requestClose() {
    if (phase === "taking" && checkedCount > 0 && !submitted.current && armed !== "close") {
      setArmed("close");
      return;
    }
    onClose();
  }

  function toggleOption(slug: string, i: number) {
    if (checked[slug] !== undefined) return; // tjekket = låst
    setAnswers((prev) => {
      const cur = prev[slug] ?? { picked: new Set<number>(), text: "" };
      const picked = new Set(cur.picked);
      if (picked.has(i)) picked.delete(i); else picked.add(i);
      return { ...prev, [slug]: { ...cur, picked, touched: true } };
    });
  }

  function setText(slug: string, text: string) {
    if (checked[slug] !== undefined) return;
    setAnswers((prev) => ({ ...prev, [slug]: { ...(prev[slug] ?? { picked: new Set<number>() }), text } }));
  }

  function toggleFlag(slug: string) {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  }

  function showHint(slug: string, level: number) {
    setHintsShown((prev) => ({ ...prev, [slug]: Math.max(prev[slug] ?? 0, level) }));
  }

  /** Tjek ÉT spørgsmål: lås det, vis verdict + forklaring, og log forsøget
   * med det samme — fire-and-forget, feedbacken venter ikke på netværket. */
  function checkCurrent() {
    if (!q || qChecked || !isAnswered(q, a)) return;
    const ok = isCorrect(q, a);
    setChecked((prev) => ({ ...prev, [q.slug]: ok }));
    void logAttempt({ itemRef: q.slug, lens: null, grade: ok ? 3 : 0 }).catch(() => {});
  }

  const results = useMemo(() => {
    if (phase !== "review") return null;
    const per = questions.map((qq) => ({ q: qq, ok: checked[qq.slug] ?? false }));
    const correct = per.filter((p) => p.ok).length;
    const bySec = new Map<string, { correct: number; total: number }>();
    for (const p of per) {
      const s = bySec.get(p.q.section) ?? { correct: 0, total: 0 };
      s.total += 1;
      if (p.ok) s.correct += 1;
      bySec.set(p.q.section, s);
    }
    return { per, correct, bySec };
  }, [phase, questions, checked]);

  /** Afslut sættet: utjekkede spørgsmål tæller som forkerte (og logges som
   * sådan), kørslen persisteres med pr.-spørgsmål-detaljer. */
  function finish() {
    const unchecked = questions.filter((qq) => !(qq.slug in checked));
    if (unchecked.length > 0 && armed !== "finish") {
      setArmed("finish");
      return;
    }
    setArmed(null);
    submitted.current = true;
    for (const qq of unchecked) {
      void logAttempt({ itemRef: qq.slug, lens: null, grade: 0 }).catch(() => {});
    }
    const finalChecked = { ...checked };
    for (const qq of unchecked) finalChecked[qq.slug] = false;
    setChecked(finalChecked);
    const per = questions.map((qq) => ({
      slug: qq.slug,
      ok: finalChecked[qq.slug] ?? false,
      hints: hintsShown[qq.slug] ?? 0,
    }));
    void submitExamRun({
      correct: per.filter((p) => p.ok).length,
      total: questions.length,
      durationSecs: Math.round((Date.now() - startedAt.current) / 1000),
      label: title,
      wrong: per.filter((p) => !p.ok).map((p) => p.slug),
      results: per,
    }).catch(() => {});
    setPhase("review");
  }

  if (!q) return null;

  const minutes = Math.floor((Date.now() - startedAt.current) / 60000);
  const hintLevel = hintsShown[q.slug] ?? 0;
  const hintBtn = "rounded-lg border border-black/15 px-3 py-1.5 text-xs font-medium text-[#1A1A24]/70 hover:bg-black/[0.03]";

  /** Option-visning efter tjek: grøn = korrekt, rød = valgt-men-forkert. */
  function optionClasses(slug: string, i: number): string {
    const picked = answers[slug]?.picked.has(i) ?? false;
    const corr = q.correct.includes(i);
    if (corr) return "border-emerald-500/40 bg-emerald-50";
    if (picked) return "border-red-500/40 bg-red-50";
    return "border-black/10 bg-white opacity-70";
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col animate-[learn-overlay_.22s_ease-out] overflow-y-auto bg-[#F6F5F1] text-[#1A1A24]">
      <style>{PLAYER_STYLE}</style>

      <header className={`${READING_COL} flex items-center gap-3 px-4 pb-2 pt-4 md:px-0`}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="text-xs text-black/50 tabular-nums">
            {phase === "taking"
              ? `${checkedCount}/${questions.length} tjekket · ${correctSoFar} rigtige · ${minutes} min`
              : `Resultat · ${results!.correct}/${questions.length} point`}
          </div>
        </div>
        {phase === "taking" && (
          <button onClick={finish}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${armed === "finish" ? "bg-amber-500 text-white" : "bg-[#1A1A24] text-white"}`}>
            {armed === "finish" ? `${questions.length - checkedCount} utjekkede — afslut?` : "Afslut sættet"}
          </button>
        )}
        <button onClick={requestClose}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${armed === "close" ? "border-amber-500 text-amber-700" : "border-black/15 text-[#1A1A24]/70"}`}>
          {armed === "close" ? "Gemmes ikke — luk?" : "Luk"}
        </button>
      </header>

      {phase === "taking" ? (
        <main className={`${READING_COL} flex-1 px-4 pb-16 md:px-0`}>
          {/* Navigator: grøn = tjekket rigtig, rød = tjekket forkert,
              grå fyldt = besvaret men utjekket, ring = flaget. */}
          <div className="mb-4 flex flex-wrap gap-1.5">
            {questions.map((qq, i) => {
              const st = checked[qq.slug];
              const isCur = i === idx;
              const base = st === true ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-500/30"
                : st === false ? "bg-red-100 text-red-800 ring-1 ring-red-500/30"
                  : isAnswered(qq, answers[qq.slug]) ? "bg-black/[0.12] text-[#1A1A24]"
                    : "bg-white text-black/45 ring-1 ring-black/10";
              return (
                <button key={qq.slug} onClick={() => setIdx(i)}
                  className={[
                    "h-7 w-7 rounded-md text-[11px] font-semibold tabular-nums transition-colors",
                    isCur ? "bg-[#1A1A24] text-white" : base,
                    flagged.has(qq.slug) ? "ring-2 ring-amber-400" : "",
                  ].join(" ")}>
                  {i + 1}
                </button>
              );
            })}
          </div>

          <div className={`${CARD} p-4 md:p-6`} key={q.slug}>
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-medium text-black/60">{q.section}</span>
              <span className="text-[11px] text-black/40">{q.sourceRef}</span>
              {qChecked && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${checked[q.slug] ? FEEDBACK.correct : FEEDBACK.wrong}`}>
                  {checked[q.slug] ? "Korrekt" : "Forkert"}
                </span>
              )}
              <button onClick={() => toggleFlag(q.slug)}
                className={`ml-auto rounded-md px-2 py-0.5 text-[11px] font-medium ${flagged.has(q.slug) ? FEEDBACK.draft : "text-black/40 hover:text-black/70"}`}>
                {flagged.has(q.slug) ? "⚑ Flaget" : "⚑ Flag"}
              </button>
            </div>
            <Markdown className="text-[15px]">{q.prompt}</Markdown>

            {q.kind === "mc" ? (
              <div className="mt-4 flex flex-col gap-2">
                {q.options.map((opt, i) => {
                  const on = a?.picked.has(i) ?? false;
                  return (
                    <button key={i} onClick={() => toggleOption(q.slug, i)}
                      className={[
                        "flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                        qChecked ? optionClasses(q.slug, i)
                          : on ? "border-[#1A1A24]/60 bg-black/[0.04]" : "border-black/10 bg-white hover:bg-black/[0.02]",
                      ].join(" ")}>
                      <span className={[
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold",
                        on ? "border-[#1A1A24] bg-[#1A1A24] text-white" : "border-black/25 bg-white text-transparent",
                      ].join(" ")}>✓</span>
                      <Markdown className="text-[14px]">{opt}</Markdown>
                    </button>
                  );
                })}
                {!qChecked && (
                  <div className="mt-1 text-[11px] text-black/40">
                    0, 1 eller flere kan være korrekte — point kun ved præcis alle korrekte valgt.
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4">
                <input
                  value={a?.text ?? ""}
                  onChange={(e) => setText(q.slug, e.target.value)}
                  readOnly={qChecked}
                  placeholder="Skriv det endelige svar"
                  spellCheck={false}
                  className={`w-full max-w-sm rounded-xl border px-3 py-2.5 font-mono text-[14px] outline-none ${qChecked ? (checked[q.slug] ? "border-emerald-500/40 bg-emerald-50" : "border-red-500/40 bg-red-50") : "border-black/10 bg-white focus:border-black/30"}`}
                />
                {!qChecked && (
                  <div className="mt-1 text-[11px] text-black/40">Skriv-selv-svar — tal/udtryk, fx <code>8</code> eller <code>(2,3)</code>.</div>
                )}
              </div>
            )}

            {/* Hints (REX-strukturen) — kan foldes ud før tjek, og de
                viste hints bliver stående efter. */}
            {(hintLevel >= 1 || qChecked) && q.hint1 && (
              <div className="mt-3 rounded-lg border-l-2 border-indigo-400/60 bg-black/[0.03] px-3 py-2">
                <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-black/45">Hint 1 · formlen</div>
                <Markdown className="text-[13px]">{q.hint1}</Markdown>
              </div>
            )}
            {(hintLevel >= 2 || qChecked) && q.hint2 && (
              <div className="mt-2 rounded-lg border-l-2 border-fuchsia-400/60 bg-black/[0.03] px-3 py-2">
                <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-black/45">Hint 2 · teorien</div>
                <Markdown className="text-[13px]">{q.hint2}</Markdown>
              </div>
            )}

            {/* Øjeblikkelig feedback efter tjek: facit + forklaring. */}
            {qChecked && (
              <div className="mt-3 rounded-lg bg-black/[0.03] px-3 py-2">
                {q.kind === "numeric" && (
                  <div className="mb-1 text-[13px]">
                    <span className="text-black/50">Facit: </span>
                    {q.solution ? <Markdown className="inline text-[13px]">{q.solution}</Markdown> : null}
                  </div>
                )}
                {q.explanation && <Markdown className="text-[13px] text-black/70">{q.explanation}</Markdown>}
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}
              className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium text-[#1A1A24]/80 disabled:opacity-40">
              ← Forrige
            </button>
            {!qChecked ? (
              <div className="flex gap-2">
                {hintLevel < 1 && q.hint1 && (
                  <button onClick={() => showHint(q.slug, 1)} className={hintBtn}>Vis hint 1 · formlen</button>
                )}
                {hintLevel === 1 && q.hint2 && (
                  <button onClick={() => showHint(q.slug, 2)} className={hintBtn}>Vis hint 2 · teorien</button>
                )}
                <button onClick={checkCurrent} disabled={!isAnswered(q, a)}
                  className="rounded-lg bg-[#1A1A24] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                  Tjek svar
                </button>
              </div>
            ) : (
              <button onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))} disabled={idx === questions.length - 1}
                className="rounded-lg bg-[#1A1A24] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                Næste →
              </button>
            )}
          </div>
        </main>
      ) : (
        <main className={`${READING_COL} flex-1 px-4 pb-16 md:px-0`}>
          <div className={`${CARD} mb-4 p-4 md:p-6`}>
            <div className="text-2xl font-bold tabular-nums">
              {results!.correct}/{questions.length}
              <span className="ml-2 text-base font-medium text-black/50">
                ({Math.round((results!.correct / questions.length) * 100)}%)
              </span>
            </div>
            <div className="mt-3 flex flex-col gap-1">
              {[...results!.bySec.entries()].map(([sec, s]) => (
                <div key={sec} className="flex items-center gap-2 text-[13px]">
                  <span className="w-44 truncate text-black/60">{sec}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.07]">
                    <div className="h-full rounded-full bg-[#1A1A24]" style={{ width: `${(s.correct / s.total) * 100}%` }} />
                  </div>
                  <span className="w-10 text-right tabular-nums text-black/60">{s.correct}/{s.total}</span>
                </div>
              ))}
            </div>
          </div>

          {results!.per.map(({ q: qq, ok }, i) => {
            const aa = answers[qq.slug];
            return (
              <div key={qq.slug} className={`${CARD} mb-3 p-4`}>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-[11px] font-semibold tabular-nums text-black/40">{i + 1}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ok ? FEEDBACK.correct : FEEDBACK.wrong}`}>
                    {ok ? "Korrekt" : "Forkert"}
                  </span>
                  {(hintsShown[qq.slug] ?? 0) > 0 && (
                    <span className="text-[11px] text-black/40">{hintsShown[qq.slug]} hint{(hintsShown[qq.slug] ?? 0) > 1 ? "s" : ""}</span>
                  )}
                  <span className="text-[11px] text-black/40">{qq.sourceRef}</span>
                </div>
                <Markdown className="text-[14px]">{qq.prompt}</Markdown>
                {qq.kind === "mc" ? (
                  <div className="mt-2 flex flex-col gap-1">
                    {qq.options.map((opt, oi) => {
                      const picked = aa?.picked.has(oi) ?? false;
                      const corr = qq.correct.includes(oi);
                      return (
                        <div key={oi} className={[
                          "flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[13px]",
                          corr ? "bg-emerald-50 ring-1 ring-emerald-500/25"
                            : picked ? "bg-red-50 ring-1 ring-red-500/25" : "",
                        ].join(" ")}>
                          <span className="mt-0.5 w-8 shrink-0 text-[11px] font-medium text-black/50">
                            {picked ? "valgt" : ""}{picked && corr ? " ✓" : corr ? "✓" : picked ? " ✗" : ""}
                          </span>
                          <Markdown className="text-[13px]">{opt}</Markdown>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-2 text-[13px]">
                    <span className="text-black/50">Dit svar: </span>
                    <code>{aa?.text.trim() || "—"}</code>
                    <span className="ml-3 text-black/50">Facit: </span>
                    {qq.solution ? <Markdown className="inline text-[13px]">{qq.solution}</Markdown> : null}
                  </div>
                )}
                {qq.explanation && (
                  <div className="mt-2 rounded-lg bg-black/[0.03] px-3 py-2">
                    <Markdown className="text-[13px] text-black/70">{qq.explanation}</Markdown>
                  </div>
                )}
              </div>
            );
          })}
        </main>
      )}
    </div>
  );
}
