/**
 * The composed learning day — the compass at the top of the Learn page.
 *
 * Renders `lr_daily_plan` (written by the `learn-plan` edge function on
 * pg_cron): intro brief, the day's reading range, the authored lesson (or an
 * honest "retention day" — DESIGN.md pins lessons at 3–4×/week aligned to
 * lectures, and flattening that into a daily lesson is the exact mistake the
 * rejected v1 made), and the repetition block the panels below serve.
 *
 * A missing row renders "not generated yet" — the `blocking_state` doctrine:
 * lr_daily_plan is never seeded, so absence means "no plan computed", never
 * "rest day". Paper theme, English chrome, near-monochrome ink; the one
 * gradient is the day-done state, because DESIGN.md §0 rule 1 says gradient
 * means progress you earned.
 */

import { useCallback, useEffect, useState } from "react";
import { fetchDailyPlan, markDailyPlanDone, type DailyPlan } from "./api";
import { Markdown } from "./Markdown";

function todayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export function TodayPanel() {
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [state, setState] = useState<"loading" | "missing" | "error" | "ready">("loading");
  const [briefOpen, setBriefOpen] = useState(false);
  const date = todayYmd();

  const load = useCallback(async () => {
    try {
      const p = await fetchDailyPlan(date);
      setPlan(p);
      setState(p ? "ready" : "missing");
    } catch {
      setState("error");
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  if (state === "loading") return null;

  if (state === "missing" || state === "error") {
    return (
      <section className="rounded-2xl border border-dashed border-[#1A1A24]/15 p-4 text-sm text-[#1A1A24]/60">
        {state === "missing"
          ? "Today's plan hasn't been generated yet — the generator passes every 30 minutes."
          : "Couldn't read today's plan."}
        <button onClick={load} className="ml-2 font-medium text-[#1A1A24]/80 underline-offset-2 hover:underline">
          check again
        </button>
      </section>
    );
  }

  const b = plan!.blocks;
  const done = plan!.status === "done";

  const rows: Array<{ n: number; label: string; minutes?: number; body: React.ReactNode }> = [
    { n: 1, label: "Intro", minutes: b.intro?.minutes, body: <>the brief — say the say-backs out loud first</> },
    {
      n: 2, label: "Reading", minutes: b.reading?.minutes,
      body: b.reading
        ? <>{b.reading.title}, {b.reading.unit_label === "pages" ? "pp." : b.reading.unit_label} <strong>{b.reading.from}–{b.reading.to}</strong></>
        : <span className="text-[#1A1A24]/45">no active reading material</span>,
    },
    {
      n: 3, label: "Lesson", minutes: b.lesson?.minutes,
      body: b.lesson?.retention
        ? <span className="text-[#1A1A24]/60">retention day — the review below <em>is</em> the work</span>
        : (
          <>
            {b.lesson?.title}
            {b.lesson?.url && (
              <a href={b.lesson.url} target="_blank" rel="noreferrer"
                className="ml-1.5 font-medium text-indigo-600 underline-offset-2 hover:underline">
                open ↗
              </a>
            )}
          </>
        ),
    },
    {
      n: 4, label: "Repetition", minutes: b.review?.minutes,
      body: b.review?.due_concepts != null
        ? <>{b.review.due_concepts} concepts due — start below</>
        : <>start in the review section below</>,
    },
  ];

  return (
    <section className="rounded-2xl border border-[#1A1A24]/10 bg-white/60 p-4 md:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-[#1A1A24]">
          Today <span className="ml-1 font-normal text-[#1A1A24]/45">{plan!.plan_date}</span>
        </h2>
        {done ? (
          <span className="rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-2.5 py-0.5 text-xs font-semibold text-white">
            day complete
          </span>
        ) : (
          <button
            onClick={async () => { await markDailyPlanDone(date); load(); }}
            className="rounded-full border border-[#1A1A24]/15 px-2.5 py-0.5 text-xs font-medium text-[#1A1A24]/70 hover:border-[#1A1A24]/30 hover:text-[#1A1A24]"
          >
            mark day done
          </button>
        )}
      </div>

      <ol className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={r.n} className="flex items-baseline gap-2.5 text-sm text-[#1A1A24]/85">
            <span className="flex h-4.5 w-4.5 flex-none translate-y-0.5 items-center justify-center rounded-full bg-[#1A1A24]/8 text-[10px] font-bold text-[#1A1A24]/60">
              {r.n}
            </span>
            <span>
              <span className="font-medium text-[#1A1A24]">{r.label}</span>
              {r.minutes ? <span className="ml-1 text-xs text-[#1A1A24]/45">{r.minutes} min</span> : null}
              <span className="mx-1.5 text-[#1A1A24]/30">·</span>
              {r.body}
            </span>
          </li>
        ))}
      </ol>

      <button
        onClick={() => setBriefOpen((v) => !v)}
        className="mt-3 text-xs font-medium text-[#1A1A24]/55 underline-offset-2 hover:underline"
      >
        {briefOpen ? "hide the brief" : "read the brief"}
      </button>
      {briefOpen && (
        <div className="mt-2 rounded-xl bg-[#1A1A24]/[0.04] p-3">
          <Markdown className="text-sm leading-relaxed">{plan!.brief_md}</Markdown>
        </div>
      )}
    </section>
  );
}
