/**
 * Pensum-roadmap — one card per course: countdown, every book as a progress
 * bar with the pace the deadline demands, and the lesson curriculum as a
 * done → active → planned timeline. Pure view over `useRoadmap()`; the
 * honesty rules (absent ≠ zero, no cold-start "bagud") live in roadmapData.
 */
import { useRoadmap } from "./roadmapData";
import { WeekTree } from "./WeekTree";

function Bar({ pct, tone }: { pct: number; tone: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#EBEAE5]">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.round(pct * 100)}%` }} />
    </div>
  );
}

export function RoadmapPanel() {
  const { courses, weeks, error } = useRoadmap();

  if (error) {
    return <section className="rounded-2xl bg-white p-5 text-sm text-[#6E6E78] shadow-sm">
      Roadmappet kunne ikke hentes.
    </section>;
  }
  if (courses === null) return null;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9A9AA8]">
        Pensum-roadmap
      </h2>
      {weeks && weeks.length > 0 && <WeekTree weeks={weeks} />}
      <h2 className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9A9AA8]">
        Per kursus
      </h2>
      {courses.map((c) => (
        <div key={c.label} className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-baseline justify-between">
            <div className="text-base font-semibold">{c.label}</div>
            {c.daysLeft != null ? (
              <div className="text-right">
                <span className={`text-xl font-bold tabular-nums ${c.daysLeft <= 14 ? "text-[#BE123C]" : "text-[#1A1A24]"}`}>
                  {c.daysLeft}
                </span>
                <span className="ml-1 text-xs text-[#6E6E78]">dage til eksamen · {c.examDate}</span>
              </div>
            ) : <span className="text-xs text-[#9A9AA8]">ingen eksamensdato</span>}
          </div>

          {/* samlet fremdrift */}
          <div className="mb-4 grid grid-cols-2 gap-3 text-xs text-[#6E6E78]">
            <div>
              <div className="mb-1 flex justify-between">
                <span>Læsning</span><span className="tabular-nums">{Math.round(c.bookPct * 100)}%</span>
              </div>
              <Bar pct={c.bookPct} tone="bg-gradient-to-r from-indigo-500 to-fuchsia-500" />
            </div>
            <div>
              <div className="mb-1 flex justify-between">
                <span>Lektioner</span>
                <span className="tabular-nums">{c.lessonsDone}/{c.lessons.length}</span>
              </div>
              <Bar pct={c.lessons.length ? c.lessonsDone / c.lessons.length : 0} tone="bg-emerald-500" />
            </div>
          </div>

          {/* bøger */}
          {c.books.map((b) => {
            const onTrack = b.pace7 != null && b.needPerDay != null
              ? b.pace7 >= b.needPerDay : null;
            return (
              <div key={b.title} className="mb-2.5">
                <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="truncate">{b.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-[#6E6E78]">
                    {b.position}/{b.total}
                    {b.needPerDay != null && <> · kræver <b>{b.needPerDay.toFixed(1)}/dag</b></>}
                    {onTrack != null && (
                      <span className={onTrack ? "ml-1 text-emerald-600" : "ml-1 text-[#BE123C]"}>
                        {onTrack ? "on track" : "bagud"}
                      </span>
                    )}
                  </span>
                </div>
                <Bar pct={b.pct} tone="bg-indigo-400" />
              </div>
            );
          })}

          {/* lektions-tidslinje */}
          {c.lessons.length > 0 && (
            <div className="mt-4 flex flex-col gap-1.5">
              {c.lessons.map((l) => (
                <div key={l.title} className="flex items-center gap-2 text-[13px]">
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    l.state === "done" ? "bg-emerald-500 text-white"
                    : l.state === "active" ? "bg-fuchsia-500 text-white"
                    : "border border-[#C6C6D2] text-transparent"
                  }`}>
                    {l.state === "done" ? "✓" : l.state === "active" ? "→" : "·"}
                  </span>
                  {l.state === "active" && l.url ? (
                    <a href={l.url} target="_blank" rel="noreferrer"
                       className="font-medium text-[#1A1A24] underline decoration-[#C6C6D2] underline-offset-2">
                      {l.title}
                    </a>
                  ) : (
                    <span className={l.state === "planned" ? "text-[#9A9AA8]" : ""}>{l.title}</span>
                  )}
                  {l.state === "planned" && <span className="text-[10px] uppercase tracking-wide text-[#C6C6D2]">planlagt</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
