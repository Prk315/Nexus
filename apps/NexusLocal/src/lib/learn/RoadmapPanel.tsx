/**
 * Pensum-roadmap — the whole exam runway on one card per course: a concrete
 * countdown, every tracked book as a progress bar with the daily pace the
 * deadline demands, and the lesson curriculum as a done → next → planned
 * timeline.
 *
 * Data posture matches the rest of the Learn surface: `lr_*` rows are
 * user_id 'default' under anon_all, so everything reads via `supabasePublic`
 * (the authenticated client would return an EMPTY SET, not an error — the
 * CLAUDE.md trap). Three queries, no derived state stored anywhere: the
 * roadmap is a VIEW over the tracker, so it can never disagree with it.
 *
 * Honesty rules carried over from the edge functions:
 * - position = max(start_unit, furthest units_to) — absent events ≠ page 0.
 * - 7-day pace NULL (vist som "—") until there are reading events; an
 *   on-track verdict is only rendered when a real pace exists. Absent is
 *   not zero, and "bagud" must never be a cold-start artifact.
 * - A lesson counts as afsluttet when a lesson-kind progress event exists
 *   for its material — the same signal learn-plan's weekly quota counts.
 */
import { useEffect, useState } from "react";
import { supabasePublic } from "../supabase";

const LEARN_USER = "default";

interface MaterialRow {
  id: string;
  kind: string;
  title: string;
  unit_label: string;
  total_units: number | null;
  start_unit: number;
  status: string;
  due_date: string | null;
  course_id: number | null;
  priority: number;
  url: string | null;
}
interface EventRow {
  material_id: string;
  event_date: string;
  kind: string;
  units_to: number | null;
  units_delta: number | null;
}
interface EnrollRow { c_id: number; label: string }

interface BookView {
  title: string;
  pct: number;          // 0..1 over the readable span
  position: number;
  total: number;
  unitLabel: string;
  needPerDay: number | null;
  pace7: number | null; // null = unknown, never 0
}
interface LessonView { title: string; state: "done" | "active" | "planned"; url: string | null }
interface CourseView {
  label: string;
  daysLeft: number | null;
  examDate: string | null;
  books: BookView[];
  lessons: LessonView[];
  bookPct: number;      // aggregate readable-span progress
  lessonsDone: number;
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const [y1, m1, d1] = fromYmd.split("-").map(Number);
  const [y2, m2, d2] = toYmd.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}
const todayYmd = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

function build(mats: MaterialRow[], events: EventRow[], enrolls: EnrollRow[]): CourseView[] {
  const today = todayYmd();
  const posOf = new Map<string, number>();
  const lessonDone = new Set<string>();
  const pace7 = new Map<string, number>();
  for (const e of events) {
    if (e.units_to != null && e.units_to > (posOf.get(e.material_id) ?? 0)) {
      posOf.set(e.material_id, e.units_to);
    }
    if (e.kind === "lesson") lessonDone.add(e.material_id);
    if (e.kind === "reading" && e.units_delta != null && e.units_delta > 0 &&
        daysBetween(e.event_date, today) < 7) {
      pace7.set(e.material_id, (pace7.get(e.material_id) ?? 0) + e.units_delta);
    }
  }

  return enrolls.map((en) => {
    const books = mats
      .filter((m) => m.course_id === en.c_id && m.status === "active" &&
        ["book", "document", "paper"].includes(m.kind) && m.total_units != null)
      .map((m): BookView => {
        const position = Math.max(m.start_unit ?? 0, posOf.get(m.id) ?? 0);
        const span = Math.max(1, (m.total_units ?? 0) - (m.start_unit ?? 0));
        const read = Math.max(0, position - (m.start_unit ?? 0));
        const remaining = Math.max(0, (m.total_units ?? 0) - position);
        const days = m.due_date ? Math.max(1, daysBetween(today, m.due_date)) : null;
        const paced = pace7.get(m.id);
        return {
          title: m.title,
          pct: Math.min(1, read / span),
          position,
          total: m.total_units ?? 0,
          unitLabel: m.unit_label,
          needPerDay: days != null ? remaining / days : null,
          pace7: paced != null ? paced / 7 : null,
        };
      });

    const lessons = mats
      .filter((m) => m.course_id === en.c_id && m.kind === "lesson" && m.status !== "paused")
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m): LessonView => ({
        title: m.title.replace(/^[A-Za-zÆØÅæøå]+ · /, "").replace(/ — Concept Module$/, ""),
        state: lessonDone.has(m.id) ? "done" : m.status === "active" ? "active" : "planned",
        url: m.url,
      }));

    const due = books.map((b) => b).length > 0
      ? mats.find((m) => m.course_id === en.c_id && m.due_date != null)?.due_date ?? null
      : null;
    const spanSum = books.reduce((s, b) => s + Math.max(1, b.total - 0), 0);
    const bookPct = spanSum === 0 ? 0 :
      books.reduce((s, b) => s + b.pct * Math.max(1, b.total), 0) / spanSum;

    return {
      label: en.label,
      examDate: due,
      daysLeft: due ? daysBetween(today, due) : null,
      books,
      lessons,
      bookPct,
      lessonsDone: lessons.filter((l) => l.state === "done").length,
    };
  }).filter((c) => c.books.length > 0 || c.lessons.length > 0);
}

function Bar({ pct, tone }: { pct: number; tone: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#EBEAE5]">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.round(pct * 100)}%` }} />
    </div>
  );
}

export function RoadmapPanel() {
  const [courses, setCourses] = useState<CourseView[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [m, e, en] = await Promise.all([
          supabasePublic.from("lr_materials")
            .select("id, kind, title, unit_label, total_units, start_unit, status, due_date, course_id, priority, url")
            .eq("user_id", LEARN_USER),
          supabasePublic.from("lr_progress_events")
            .select("material_id, event_date, kind, units_to, units_delta")
            .eq("user_id", LEARN_USER),
          supabasePublic.from("lr_course_enrollment")
            .select("c_id, label").eq("user_id", LEARN_USER).eq("active", true),
        ]);
        if (m.error || e.error || en.error) throw m.error ?? e.error ?? en.error;
        if (alive) setCourses(build(m.data ?? [], e.data ?? [], en.data ?? []));
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => { alive = false; };
  }, []);

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
