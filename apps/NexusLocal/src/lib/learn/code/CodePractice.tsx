/**
 * Deliberate code practice — Codecademy-shaped, deliberately OPTIONAL: there
 * is no streak, no due-ness, no place in the daily plan. Exercises live in
 * `lr_code_exercises` (seeded content, course-aligned katas), attempts in
 * `lr_code_attempts`; grading is hidden tests run client-side (see
 * `runners.ts` for where each language executes).
 *
 * Pass rules: Python = user code + authored tests in one run, pass when the
 * run completes and prints OK (the tests end in print('OK') — an assert that
 * fails never reaches it). C = compile + run the whole file, pass when stdout
 * equals the exercise's expected_stdout byte for byte (the main() is
 * authored, so the comparison is fair).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { supabasePublic } from "../../supabase";
import { nodeUserId } from "../../nodeUser";
import { Markdown } from "../Markdown";
import { canRunC, runC, runPython, type RunResult } from "./runners";

type Lang = "python" | "c";

interface ExerciseSpec {
  statement_md: string;
  starter_code: string;
  hints: string[];
  solution_md: string;
  tests?: string;
  expected_stdout?: string;
}

interface Exercise {
  slug: string;
  language: Lang;
  course_key: string | null;
  title: string;
  difficulty: number;
  spec: ExerciseSpec;
}

const COURSE_LABEL: Record<string, string> = {
  mla: "ML", dm: "DM", rex: "REX", prob: "Sandsynlighed", pgm: "PGM", modernc: "Modern C",
};

async function fetchExercises(): Promise<Exercise[]> {
  const { data, error } = await supabasePublic
    .from("lr_code_exercises")
    .select("slug, language, course_key, title, difficulty, spec")
    .eq("status", "live")
    .order("difficulty")
    .order("slug");
  if (error) throw error;
  return (data ?? []) as Exercise[];
}

async function fetchPassed(): Promise<Set<string>> {
  const { data, error } = await supabasePublic
    .from("lr_code_attempts")
    .select("exercise_slug")
    .eq("user_id", await nodeUserId())
    .eq("passed", true);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.exercise_slug as string));
}

async function logAttempt(slug: string, passed: boolean, code: string): Promise<void> {
  await supabasePublic.from("lr_code_attempts").insert({
    user_id: await nodeUserId(),
    exercise_slug: slug,
    passed,
    code: code.slice(0, 20_000),
  });
}

/** Panel på Learn-overblikket: ÉN start-knap. Deliberate practice er en
 * SESSION med stigende sværhedsgrad, ikke en menu — listen findes stadig,
 * men gemt bag "gennemse", til at kigge løsninger efter. */
export function CodePanel() {
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [passed, setPassed] = useState<Set<string>>(new Set());
  const [lang, setLang] = useState<Lang>(() => {
    try { return (localStorage.getItem("nl-code-lang") as Lang) || "python"; } catch { return "python"; }
  });
  const [mode, setMode] = useState<"idle" | "activity" | "browse">("idle");
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    fetchExercises().then(setExercises).catch((e) => setError(String(e?.message ?? e)));
    fetchPassed().then(setPassed).catch(() => {/* fluebenene er pynt, ikke data */});
  };
  useEffect(reload, []);

  const list = useMemo(
    () => (exercises ?? []).filter((e) => e.language === lang),
    [exercises, lang],
  );

  if (mode === "activity" && list.length) {
    return <CodeActivity exercises={list} passed={passed} onClose={() => { setMode("idle"); reload(); }} />;
  }
  const open = list.find((e) => e.slug === openSlug) ?? null;
  if (open) {
    return <CodeSession exercise={open} onClose={() => { setOpenSlug(null); reload(); }} />;
  }

  return (
    <section className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_8px_rgba(0,0,0,0.05)] md:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Kodetræning</h2>
          <p className="mt-0.5 text-[12px] text-[#6E6E78]">
            ~45 min · starter let, niveauet stiger med dig. Valgfri — ingen streak, intet pres.
          </p>
        </div>
        <div className="flex gap-1 rounded-full bg-[#EBEAE5] p-1">
          {(["python", "c"] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => { setLang(l); try { localStorage.setItem("nl-code-lang", l); } catch { /* convenience */ } }}
              className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                lang === l ? "bg-white text-[#1A1A24] shadow-sm" : "text-[#6E6E78]"
              }`}
            >
              {l === "python" ? "Python" : "C"}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-3 text-[12px] text-rose-600">Kunne ikke hente øvelser: {error}</p>}
      {!exercises && !error && <p className="mt-3 text-[12px] text-[#6E6E78]/70">Henter…</p>}

      {lang === "c" && !canRunC() && (
        <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700">
          C kompileres kun på Mac'en — her på web kan du læse, skrive og se løsningen, men ikke køre.
        </p>
      )}

      {exercises && list.length > 0 && (
        <>
          <button
            onClick={() => setMode("activity")}
            className="mt-4 w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
          >
            ▶ Start kodetræning
          </button>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-[#6E6E78]/70">
              {Array.from(passed).filter((sl) => list.some((e) => e.slug === sl)).length}/{list.length} løst
            </span>
            <button onClick={() => setMode(mode === "browse" ? "idle" : "browse")} className="text-[11px] text-indigo-600 hover:underline">
              {mode === "browse" ? "Skjul øvelser" : "Gennemse øvelser"}
            </button>
          </div>
        </>
      )}

      {mode === "browse" && (
        <div className="mt-2 flex flex-col gap-1.5">
          {list.map((e) => (
            <button
              key={e.slug}
              onClick={() => setOpenSlug(e.slug)}
              className="flex min-h-[44px] items-center gap-3 rounded-xl bg-black/[0.02] px-3 py-2 text-left ring-1 ring-black/[0.05] transition-colors hover:bg-black/[0.04]"
            >
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${
                passed.has(e.slug)
                  ? "bg-emerald-500/15 text-emerald-600"
                  : "bg-black/[0.05] text-[#6E6E78]/60"
              }`}>
                {passed.has(e.slug) ? "✓" : ""}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-[#1A1A24]/90">{e.title}</span>
              {e.course_key && (
                <span className="shrink-0 rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                  {COURSE_LABEL[e.course_key] ?? e.course_key}
                </span>
              )}
              <span className="shrink-0 text-[10px] text-[#6E6E78]/60">{"●".repeat(e.difficulty)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

const ACTIVITY_MINUTES = 45;

interface Outcome { passed: boolean; usedHints: boolean; usedSolution: boolean; skipped: boolean }

/** 45-minutters aktivitet med adaptivt niveau: bestået uden hjælp → op,
 * bestået med hints → samme, sprunget over / løsning afsløret → ned. Uløste
 * øvelser serveres før allerede-løste på samme niveau, og en øvelse ses
 * højst én gang pr. session. */
function CodeActivity({ exercises, passed, onClose }: {
  exercises: Exercise[];
  passed: Set<string>;
  onClose: () => void;
}) {
  const [startedAt] = useState(() => Date.now());
  const [level, setLevel] = useState(1);
  const [served, setServed] = useState<Set<string>>(new Set());
  const [solved, setSolved] = useState(0);
  const [done, setDone] = useState(false);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const pick = (lvl: number, taken: Set<string>): Exercise | null => {
    const fresh = exercises.filter((e) => !taken.has(e.slug));
    if (!fresh.length) return null;
    // nærmeste niveau vinder; uløst slår løst; derefter stabil slug-orden
    const scored = fresh
      .map((e) => ({ e, d: Math.abs(e.difficulty - lvl), old: passed.has(e.slug) ? 1 : 0 }))
      .sort((a, b) => a.d - b.d || a.old - b.old || a.e.slug.localeCompare(b.e.slug));
    return scored[0].e;
  };

  const [current, setCurrent] = useState<Exercise | null>(() => pick(1, new Set()));

  const minutesGone = Math.floor((Date.now() - startedAt) / 60_000);
  const overTime = minutesGone >= ACTIVITY_MINUTES;

  function advance(outcome: Outcome) {
    const taken = new Set(served);
    if (current) taken.add(current.slug);
    setServed(taken);
    if (outcome.passed) setSolved((n) => n + 1);

    const next = outcome.passed && !outcome.usedSolution && !outcome.usedHints
      ? Math.min(3, level + 1)
      : outcome.passed
        ? level
        : Math.max(1, level - 1);
    setLevel(next);

    if (overTime) { setDone(true); return; }
    const nx = pick(next, taken);
    if (!nx) { setDone(true); return; }
    setCurrent(nx);
  }

  if (done || !current) {
    return (
      <section className="rounded-2xl border border-black/[0.06] bg-white p-5 text-center shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
        <div className="text-3xl">🏁</div>
        <h2 className="mt-2 text-[15px] font-semibold">Kodetræning færdig</h2>
        <p className="mt-1 text-[13px] text-[#6E6E78]">
          {solved} løst på {Math.max(1, minutesGone)} min · sluttede på niveau {level}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {!!pick(level, served) && (
            <button
              onClick={() => { setDone(false); const nx = pick(level, served); if (nx) setCurrent(nx); }}
              className="rounded-xl bg-black/[0.05] px-4 py-2 text-[13px] font-medium text-[#1A1A24]/80"
            >
              Bliv ved lidt endnu
            </button>
          )}
          <button onClick={onClose} className="rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-2 text-[13px] font-semibold text-white">
            Luk
          </button>
        </div>
      </section>
    );
  }

  return (
    <CodeSession
      key={current.slug}
      exercise={current}
      onClose={onClose}
      activity={{
        minutesGone,
        minutesTotal: ACTIVITY_MINUTES,
        level,
        index: served.size + 1,
        onNext: advance,
      }}
    />
  );
}

interface ActivityCtx {
  minutesGone: number;
  minutesTotal: number;
  level: number;
  index: number;
  onNext: (o: Outcome) => void;
}

function CodeSession({ exercise, onClose, activity }: {
  exercise: Exercise;
  onClose: () => void;
  activity?: ActivityCtx;
}) {
  const spec = exercise.spec;
  const draftKey = `nl-code-draft-${exercise.slug}`;
  const [code, setCode] = useState<string>(() => {
    try { return localStorage.getItem(draftKey) || spec.starter_code; } catch { return spec.starter_code; }
  });
  const [result, setResult] = useState<RunResult | null>(null);
  const [verdict, setVerdict] = useState<"pass" | "fail" | null>(null);
  const [running, setRunning] = useState(false);
  const [hintsShown, setHintsShown] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const loggedPass = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(draftKey, code); } catch { /* draft er en convenience */ }
  }, [code, draftKey]);

  const runnable = exercise.language === "python" || canRunC();

  async function run() {
    if (running || !runnable) return;
    setRunning(true);
    setResult(null);
    setVerdict(null);
    let res: RunResult;
    let pass: boolean;
    if (exercise.language === "python") {
      const full = `${code}\n\n${spec.tests ?? "print('OK')"}`;
      res = await runPython(full);
      pass = res.ok && res.stdout.trim().split("\n").slice(-1)[0] === "OK";
    } else {
      res = await runC(code);
      pass = res.ok && spec.expected_stdout != null && res.stdout === spec.expected_stdout;
    }
    setResult(res);
    setVerdict(pass ? "pass" : "fail");
    setRunning(false);
    if (pass && !loggedPass.current) {
      loggedPass.current = true;
      logAttempt(exercise.slug, true, code).catch(() => {/* fremskridt er best-effort */});
    } else if (!pass) {
      logAttempt(exercise.slug, false, code).catch(() => {/* dito */});
    }
  }

  return (
    <section className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_8px_rgba(0,0,0,0.05)] md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[#6E6E78]">
            {exercise.language === "python" ? "Python" : "C"}
            {exercise.course_key ? ` · ${COURSE_LABEL[exercise.course_key] ?? exercise.course_key}` : ""}
          </div>
          <h2 className="text-[15px] font-semibold">{exercise.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          {activity && (
            <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-medium tabular-nums text-[#6E6E78]">
              #{activity.index} · niv. {activity.level} · {activity.minutesGone}/{activity.minutesTotal} min
            </span>
          )}
          <button onClick={onClose} className="rounded-lg bg-black/[0.04] px-2.5 py-1 text-[12px] text-[#6E6E78] hover:bg-black/[0.07]">
            {activity ? "Afslut" : "← Tilbage"}
          </button>
        </div>
      </div>

      <Markdown className="mt-3 text-[13.5px] leading-relaxed text-[#1A1A24]/85">{spec.statement_md}</Markdown>

      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          // Tab indrykker — i en kode-editor er fokus-flytning det forkerte default.
          if (e.key === "Tab") {
            e.preventDefault();
            const el = e.currentTarget;
            const a = el.selectionStart, b = el.selectionEnd;
            setCode(code.slice(0, a) + "    " + code.slice(b));
            requestAnimationFrame(() => el.setSelectionRange(a + 4, a + 4));
          }
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        rows={Math.max(10, code.split("\n").length + 2)}
        className="mt-3 w-full resize-y rounded-xl border border-black/15 bg-[#1A1A24] p-3 font-mono text-[13px] leading-relaxed text-[#ECECF2] outline-none focus:border-indigo-500/60"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={run}
          disabled={running || !runnable}
          className="rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-2 text-[13px] font-semibold text-white transition-transform active:scale-[0.985] disabled:opacity-40"
        >
          {running ? "Kører…" : "▶ Kør og test"}
        </button>
        {hintsShown < spec.hints.length && (
          <button onClick={() => setHintsShown((h) => h + 1)} className="rounded-xl bg-black/[0.04] px-3 py-2 text-[12px] text-[#1A1A24]/70 hover:bg-black/[0.07]">
            Hint {hintsShown + 1}/{spec.hints.length}
          </button>
        )}
        <button onClick={() => setShowSolution((s) => !s)} className="rounded-xl bg-black/[0.04] px-3 py-2 text-[12px] text-[#1A1A24]/70 hover:bg-black/[0.07]">
          {showSolution ? "Skjul løsning" : "Vis løsning"}
        </button>
        <button
          onClick={() => { setCode(spec.starter_code); setResult(null); setVerdict(null); }}
          className="rounded-xl bg-black/[0.04] px-3 py-2 text-[12px] text-[#6E6E78] hover:bg-black/[0.07]"
        >
          Nulstil
        </button>
        {!runnable && <span className="text-[11px] text-amber-700">Kør på Mac'en — C har ingen compiler på web.</span>}
        {activity && verdict !== "pass" && (
          <button
            onClick={() => activity.onNext({ passed: false, usedHints: hintsShown > 0, usedSolution: showSolution, skipped: true })}
            className="ml-auto rounded-xl bg-black/[0.04] px-3 py-2 text-[12px] text-[#6E6E78] hover:bg-black/[0.07]"
          >
            Spring over →
          </button>
        )}
        {activity && verdict === "pass" && (
          <button
            onClick={() => activity.onNext({ passed: true, usedHints: hintsShown > 0, usedSolution: showSolution, skipped: false })}
            className="ml-auto rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-2 text-[13px] font-semibold text-white"
          >
            Næste →
          </button>
        )}
      </div>

      {spec.hints.slice(0, hintsShown).map((h, i) => (
        <div key={i} className="mt-2 rounded-lg bg-indigo-500/[0.07] px-3 py-2 text-[12.5px] text-[#1A1A24]/80">
          💡 <Markdown className="inline">{h}</Markdown>
        </div>
      ))}

      {verdict && (
        <div className={`mt-3 rounded-xl px-3 py-2 text-[13px] font-medium ${
          verdict === "pass" ? "bg-emerald-500/10 text-emerald-700" : "bg-rose-500/10 text-rose-700"
        }`}>
          {verdict === "pass" ? "✓ Alle tests bestået" :
            exercise.language === "c" && result?.ok
              ? "✗ Output matcher ikke det forventede"
              : "✗ Ikke bestået endnu"}
        </div>
      )}

      {result && (result.stdout || result.stderr) && (
        <pre className="mt-2 max-h-56 overflow-auto rounded-xl bg-[#1A1A24] p-3 text-[12px] leading-relaxed text-[#ECECF2]">
          {result.stdout}
          {result.stderr && <span className="text-rose-300">{"\n"}{result.stderr}</span>}
          {exercise.language === "c" && verdict === "fail" && result.ok && spec.expected_stdout != null && (
            <span className="text-amber-300">{"\nForventet:\n"}{spec.expected_stdout}</span>
          )}
        </pre>
      )}

      {showSolution && (
        <div className="mt-3 rounded-xl bg-black/[0.03] p-3 ring-1 ring-black/[0.06]">
          <div className="text-[10px] uppercase tracking-wide text-[#6E6E78]">Løsning</div>
          <Markdown className="mt-1 text-[13px] leading-relaxed text-[#1A1A24]/85">{spec.solution_md}</Markdown>
        </div>
      )}
    </section>
  );
}
