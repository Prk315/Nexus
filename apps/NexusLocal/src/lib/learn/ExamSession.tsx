/**
 * ExamSession — MLA eksamensemulator, tro mod det annoncerede format:
 * multiple choice med NUL, ét eller flere korrekte svar pr. spørgsmål
 * (det kan ske at ingen eller alle er korrekte), ingen minuspoint, og et
 * point gives KUN når præcis alle korrekte svar er valgt — alt-eller-intet,
 * ingen delvis kredit. Grading er derfor mængde-lighed (`setsEqual`), og
 * option-UI'et er checkbokse, aldrig radioknapper — en radiogruppe ville
 * gøre "vælg to" og "vælg ingen" umulige at afgive.
 *
 * De fire "skriv selv svaret"-spørgsmål fra sample-sættene beholder deres
 * form (tekstfelt, normaliseret match mod accept-listen) — de træner samme
 * stof, selv om selve eksamen er ren MC.
 *
 * Samme skal som ChallengeSession/SprintSession: fuldskærmsoverlay,
 * `player/tokens.tsx`-litteraler, PLAYER_STYLE injiceret øverst. Dansk
 * chrome som Generalprøven — fladen ER kursusordforråd (Aflevér, facit,
 * sektion), jf. DESIGN.md §Language rule's undtagelse.
 *
 * Persistens: ved aflevering logges hvert spørgsmål fire-and-forget til
 * `lr_attempt_log` (grade 3 rigtig / 0 forkert — samme stige som resten af
 * Learn) og kørslen til `lr_challenge_run` under scope "mla-exam"
 * (`api.submitExamRun`). Undervejs persisteres INTET — at lukke overlayet
 * koster kun den igangværende kørsel, og det bekræftes først.
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
// svar: at åbne et spørgsmål og gå videre uden klik markerer det IKKE som
// besvaret, men et klik der efterlader mængden tom gør.
interface AnswerState { picked: Set<number>; text: string; touched?: boolean }

function isCorrect(q: ExamQuestion, a: AnswerState | undefined): boolean {
  if (!a) return false;
  // Et urørt spørgsmål er aldrig korrekt — heller ikke når facit er den
  // tomme mængde; "ingen af svarene" skal AFGIVES (touched) for at tælle.
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
  const [phase, setPhase] = useState<"taking" | "review">("taking");
  // To-trins bekræftelse i stedet for window.confirm: confirm() er en silent
  // no-op i iOS WKWebView (returnerer false), så Aflevér/Luk ville aldrig
  // kunne bekræftes på telefonen — samme regel som Vaults ConfirmDialog.
  // Første tryk armerer knappen (teksten skifter), andet tryk udfører;
  // armering falder tilbage efter 3,5 s.
  const [armed, setArmed] = useState<"submit" | "close" | null>(null);
  const startedAt = useRef(Date.now());
  const submitted = useRef(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3500);
    return () => clearTimeout(t);
  }, [armed]);

  const q = questions[idx];
  const a = answers[q?.slug ?? ""];

  const answeredCount = useMemo(
    () => questions.filter((qq) => isAnswered(qq, answers[qq.slug])).length,
    [questions, answers],
  );

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
  }, [phase, questions.length]);

  function requestClose() {
    if (phase === "taking" && answeredCount > 0 && !submitted.current && armed !== "close") {
      setArmed("close");
      return;
    }
    onClose();
  }

  function toggleOption(slug: string, i: number) {
    setAnswers((prev) => {
      const cur = prev[slug] ?? { picked: new Set<number>(), text: "" };
      const picked = new Set(cur.picked);
      if (picked.has(i)) picked.delete(i); else picked.add(i);
      return { ...prev, [slug]: { ...cur, picked, touched: true } };
    });
  }

  function setText(slug: string, text: string) {
    setAnswers((prev) => ({ ...prev, [slug]: { ...(prev[slug] ?? { picked: new Set<number>() }), text } }));
  }

  function toggleFlag(slug: string) {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  }

  const results = useMemo(() => {
    if (phase !== "review") return null;
    const per = questions.map((qq) => ({ q: qq, ok: isCorrect(qq, answers[qq.slug]) }));
    const correct = per.filter((p) => p.ok).length;
    const bySec = new Map<string, { correct: number; total: number }>();
    for (const p of per) {
      const s = bySec.get(p.q.section) ?? { correct: 0, total: 0 };
      s.total += 1;
      if (p.ok) s.correct += 1;
      bySec.set(p.q.section, s);
    }
    return { per, correct, bySec };
  }, [phase, questions, answers]);

  function submit() {
    const unanswered = questions.length - answeredCount;
    if (unanswered > 0 && armed !== "submit") {
      setArmed("submit");
      return;
    }
    setArmed(null);
    submitted.current = true;
    const per = questions.map((qq) => ({ slug: qq.slug, ok: isCorrect(qq, answers[qq.slug]) }));
    // Fire-and-forget — resultatskærmen skal ikke vente på netværket, og en
    // fejlet log koster kun statistik, aldrig besvarelsen på skærmen.
    for (const p of per) {
      void logAttempt({ itemRef: p.slug, lens: null, grade: p.ok ? 3 : 0 }).catch(() => {});
    }
    void submitExamRun({
      correct: per.filter((p) => p.ok).length,
      total: questions.length,
      durationSecs: Math.round((Date.now() - startedAt.current) / 1000),
      label: title,
      wrong: per.filter((p) => !p.ok).map((p) => p.slug),
    }).catch(() => {});
    setPhase("review");
  }

  if (!q) return null;

  const minutes = Math.floor((Date.now() - startedAt.current) / 60000);

  return (
    <div className="fixed inset-0 z-50 flex flex-col animate-[learn-overlay_.22s_ease-out] overflow-y-auto bg-[#F6F5F1] text-[#1A1A24]">
      <style>{PLAYER_STYLE}</style>

      <header className={`${READING_COL} flex items-center gap-3 px-4 pb-2 pt-4 md:px-0`}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="text-xs text-black/50">
            {phase === "taking"
              ? `${answeredCount}/${questions.length} besvaret · ${minutes} min`
              : `Resultat · ${results!.correct}/${questions.length} point`}
          </div>
        </div>
        {phase === "taking" && (
          <button onClick={submit}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${armed === "submit" ? "bg-amber-500 text-white" : "bg-[#1A1A24] text-white"}`}>
            {armed === "submit" ? `${questions.length - answeredCount} ubesvarede — aflevér?` : "Aflevér"}
          </button>
        )}
        <button onClick={requestClose}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${armed === "close" ? "border-amber-500 text-amber-700" : "border-black/15 text-[#1A1A24]/70"}`}>
          {armed === "close" ? "Gemmes ikke — luk?" : "Luk"}
        </button>
      </header>

      {phase === "taking" ? (
        <main className={`${READING_COL} flex-1 px-4 pb-16 md:px-0`}>
          {/* Navigator: ét tal pr. spørgsmål — fyldt = besvaret, ring = flaget. */}
          <div className="mb-4 flex flex-wrap gap-1.5">
            {questions.map((qq, i) => {
              const done = isAnswered(qq, answers[qq.slug]);
              const isCur = i === idx;
              return (
                <button key={qq.slug} onClick={() => setIdx(i)}
                  className={[
                    "h-7 w-7 rounded-md text-[11px] font-semibold tabular-nums transition-colors",
                    isCur ? "bg-[#1A1A24] text-white"
                      : done ? "bg-black/[0.12] text-[#1A1A24]"
                        : "bg-white text-black/45 ring-1 ring-black/10",
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
                        on ? "border-[#1A1A24]/60 bg-black/[0.04]" : "border-black/10 bg-white hover:bg-black/[0.02]",
                      ].join(" ")}>
                      <span className={[
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold",
                        on ? "border-[#1A1A24] bg-[#1A1A24] text-white" : "border-black/25 bg-white text-transparent",
                      ].join(" ")}>✓</span>
                      <Markdown className="text-[14px]">{opt}</Markdown>
                    </button>
                  );
                })}
                <div className="mt-1 text-[11px] text-black/40">
                  0, 1 eller flere kan være korrekte — point kun ved præcis alle korrekte valgt.
                </div>
              </div>
            ) : (
              <div className="mt-4">
                <input
                  value={a?.text ?? ""}
                  onChange={(e) => setText(q.slug, e.target.value)}
                  placeholder="Skriv det endelige svar"
                  spellCheck={false}
                  className="w-full max-w-sm rounded-xl border border-black/10 bg-white px-3 py-2.5 font-mono text-[14px] outline-none focus:border-black/30"
                />
                <div className="mt-1 text-[11px] text-black/40">Skriv-selv-svar — tal/udtryk, fx <code>8</code> eller <code>(2,3)</code>.</div>
              </div>
            )}
          </div>

          <div className="mt-4 flex justify-between">
            <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}
              className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium text-[#1A1A24]/80 disabled:opacity-40">
              ← Forrige
            </button>
            <button onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))} disabled={idx === questions.length - 1}
              className="rounded-lg bg-[#1A1A24] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              Næste →
            </button>
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
