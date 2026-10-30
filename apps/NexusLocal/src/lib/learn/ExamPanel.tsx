/**
 * ExamPanel — entry-kort for MLA-eksamenstræneren på Overblik-fladen.
 *
 * MLA er et roadmap-kursus (lr_course_enrollment/lr_materials), IKKE et
 * COURSES-kursus med egen path — så kortet bor på Overblik ved siden af
 * TodayPanel/ReviewPanel i stedet for på Kursus-fanen, og læser sin pool
 * direkte på slug-præfiks (`mla-mc-`) uden CourseContext.
 *
 * Fire startmåder, alle over samme pool (61 officielle sample-spørgsmål):
 *  - Prøveeksamen: 20 tilfældige på tværs af alle tre sæt
 *  - Sæt 1/2/3: ét helt sæt i rækkefølge (som PDF'en)
 *  - Svage & usete: 20 prioriteret efter aldrig-forsøgt, derefter senest
 *    forkert (lr_attempt_log-indekset) — genkørslen der faktisk flytter noget
 *
 * Seneste/bedste resultat kommer fra `fetchExamRuns` (lr_challenge_run,
 * scope "mla-exam"). Refetch når sessionen lukker — samme "reload on
 * close"-forhold som InfinitePanel har til ExerciseSession.
 */

import { useEffect, useMemo, useState } from "react";
import { fetchExamAttemptIndex, fetchExamPool, fetchExamRuns, type ExamQuestion, type ExamRun } from "./api";
import { ExamSession } from "./ExamSession";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Hvert grundspørgsmål findes i tre permutationer: originalen
 * (`mla-mc-s1-01`) og varianterne `…b`/`…c` med andre tal og andre
 * udsagnskombinationer — så man træner at FINDE svaret, ikke huske det.
 * Basen er sluggen uden variantbogstavet. */
function baseOf(slug: string): string {
  return slug.replace(/[a-z]$/, "");
}

/** Gruppér poolen pr. grundspørgsmål og træk én tilfældig variant pr. base —
 * ingen session viser to varianter af samme spørgsmål. */
function onePerBase(pool: ExamQuestion[]): ExamQuestion[] {
  const groups = new Map<string, ExamQuestion[]>();
  for (const q of pool) {
    const b = baseOf(q.slug);
    groups.set(b, [...(groups.get(b) ?? []), q]);
  }
  return [...groups.values()].map((g) => g[Math.floor(Math.random() * g.length)]);
}

/** Bland option-rækkefølgen (og remap facit-indekserne) pr. session, så
 * heller ikke PLACERINGEN af et svar kan læres udenad. Numeriske spørgsmål
 * er uberørte. */
function permuteOptions(q: ExamQuestion): ExamQuestion {
  if (q.kind !== "mc" || q.options.length < 2) return q;
  const order = shuffle(q.options.map((_, i) => i));
  return {
    ...q,
    options: order.map((i) => q.options[i]),
    correct: q.correct.map((c) => order.indexOf(c)),
  };
}

export function ExamPanel() {
  // undefined = loading, null = fetch fejlede.
  const [pool, setPool] = useState<ExamQuestion[] | null | undefined>(undefined);
  const [runs, setRuns] = useState<ExamRun[]>([]);
  const [attempts, setAttempts] = useState<Map<string, number>>(new Map());
  const [session, setSession] = useState<{ title: string; questions: ExamQuestion[] } | null>(null);

  useEffect(() => {
    if (session) return;
    let cancelled = false;
    Promise.all([fetchExamPool(), fetchExamRuns(10), fetchExamAttemptIndex()])
      .then(([p, r, a]) => {
        if (cancelled) return;
        setPool(p);
        setRuns(r);
        setAttempts(a as Map<string, number>);
      })
      .catch(() => { if (!cancelled) setPool(null); });
    return () => { cancelled = true; };
  }, [session]);

  const bySet = useMemo(() => {
    const m = new Map<string, ExamQuestion[]>();
    for (const q of pool ?? []) {
      const key = q.slug.slice(0, "mla-mc-sN".length); // "mla-mc-s1"
      m.set(key, [...(m.get(key) ?? []), q]);
    }
    return m;
  }, [pool]);

  const baseCount = useMemo(() => new Set((pool ?? []).map((q) => baseOf(q.slug))).size, [pool]);

  if (pool === undefined) return null;
  if (pool === null || pool.length === 0) {
    return (
      <section className="rounded-2xl border border-[#E3E2DC] bg-white p-5">
        <h2 className="text-sm font-semibold">MLA · Eksamenstræner</h2>
        <p className="mt-1 text-[13px] text-black/50">
          {pool === null ? "Kunne ikke hente spørgsmålsbanken." : "Ingen spørgsmål i banken endnu."}
        </p>
      </section>
    );
  }

  const last = runs[0] ?? null;
  const best = runs.reduce<ExamRun | null>((b, r) => (b === null || r.correct / r.total > b.correct / b.total ? r : b), null);

  function startMixed() {
    setSession({
      title: "MLA · Prøveeksamen (20 blandede)",
      questions: shuffle(onePerBase(pool!)).slice(0, 20).map(permuteOptions),
    });
  }
  function startSet(n: number) {
    // Sættets baser i PDF'ens rækkefølge, men en tilfældig variant pr. base.
    const qs = onePerBase(bySet.get(`mla-mc-s${n}`) ?? []).sort((a, b) => a.slug.localeCompare(b.slug));
    setSession({ title: `MLA · Sample Questions ${n}`, questions: qs.map(permuteOptions) });
  }
  function startWeak() {
    // Aldrig-forsøgte baser først (tilfældig orden), derefter senest-forkerte,
    // derefter resten — 20 i alt. "Svag" dømmes pr. BASE: en forkert variant
    // gør hele grundspørgsmålet svagt, ellers kunne man "nulstille" et svagt
    // spørgsmål ved at få en anden variant rigtig.
    const lastByBase = new Map<string, number>();
    for (const [slug, grade] of attempts) lastByBase.set(baseOf(slug), grade);
    const variants = onePerBase(pool!);
    const never = shuffle(variants.filter((q) => !lastByBase.has(baseOf(q.slug))));
    const wrong = shuffle(variants.filter((q) => lastByBase.get(baseOf(q.slug)) === 0));
    const rest = shuffle(variants.filter((q) => (lastByBase.get(baseOf(q.slug)) ?? 0) > 0));
    setSession({ title: "MLA · Svage & usete", questions: [...never, ...wrong, ...rest].slice(0, 20).map(permuteOptions) });
  }

  const btn = "rounded-lg border border-black/15 px-3 py-1.5 text-xs font-medium text-[#1A1A24]/80 hover:bg-black/[0.03]";

  return (
    <section className="rounded-2xl border border-[#E3E2DC] bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">MLA · Eksamenstræner</h2>
        <span className="text-[11px] text-black/40">{baseCount} spørgsmål × {Math.round(pool.length / Math.max(1, baseCount))} varianter · 0..n korrekte · alt-eller-intet</span>
      </div>
      {(last || best) && (
        <p className="mt-1 text-[13px] text-black/55 tabular-nums">
          {last && <>Seneste: {last.correct}/{last.total}</>}
          {best && best !== last && <> · Bedste: {best.correct}/{best.total}</>}
          {last && last.wrong.length > 0 && <> · {last.wrong.length} at genbesøge</>}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={startMixed} className="rounded-lg bg-[#1A1A24] px-3 py-1.5 text-xs font-semibold text-white">
          Prøveeksamen · 20
        </button>
        <button onClick={startWeak} className={btn}>Svage &amp; usete · 20</button>
        {[1, 2, 3].map((n) => (
          <button key={n} onClick={() => startSet(n)} className={btn}>
            Sæt {n} · {new Set((bySet.get(`mla-mc-s${n}`) ?? []).map((q) => baseOf(q.slug))).size}
          </button>
        ))}
      </div>
      {session && (
        <ExamSession title={session.title} questions={session.questions} onClose={() => setSession(null)} />
      )}
    </section>
  );
}
