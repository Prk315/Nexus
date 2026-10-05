/**
 * Roadmap data — the fetch and the pure build, shared by the full
 * RoadmapPanel and the always-visible OverviewStrip so the two can never
 * disagree about progress or countdowns. Reads via `supabasePublic`
 * (lr_* is anon_all; the authed client returns an empty set, not an error).
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

export interface BookView {
  title: string;
  pct: number;          // 0..1 over the readable span
  position: number;
  total: number;
  unitLabel: string;
  needPerDay: number | null;
  pace7: number | null; // null = unknown, never 0
}
export interface LessonView { title: string; state: "done" | "active" | "planned"; url: string | null }
export interface CourseView {
  label: string;
  daysLeft: number | null;
  examDate: string | null;
  books: BookView[];
  lessons: LessonView[];
  bookPct: number;      // aggregate readable-span progress
  lessonsDone: number;
}

function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function daysBetween(fromYmd: string, toYmd: string): number {
  const [y1, m1, d1] = fromYmd.split("-").map(Number);
  const [y2, m2, d2] = toYmd.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}
const todayYmd = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

export function build(mats: MaterialRow[], events: EventRow[], enrolls: EnrollRow[]): CourseView[] {
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


export function useRoadmap(): { courses: CourseView[] | null; weeks: WeekNode[] | null; error: boolean } {
  const [courses, setCourses] = useState<CourseView[] | null>(null);
  const [weeks, setWeeks] = useState<WeekNode[] | null>(null);
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
            .select("c_id, label, plan_id").eq("user_id", LEARN_USER).eq("active", true),
        ]);
        if (m.error || e.error || en.error) throw m.error ?? e.error ?? en.error;
        // Graded deadlines fra kursernes PathFinder-planer — best effort:
        // træet uden deadlines er stadig et træ, så en fejl her blokerer ikke.
        let tasks: Array<{ title: string; due_date: string; done: boolean }> = [];
        try {
          const planIds = (en.data ?? [])
            .map((r: { plan_id: number | null }) => r.plan_id)
            .filter((p): p is number => p != null);
          if (planIds.length) {
            const t = await supabasePublic.from("pf_tasks")
              .select("title, due_date, done").in("plan_id", planIds)
              .not("due_date", "is", null);
            tasks = (t.data ?? [])
              .filter((r) => r.title && r.due_date &&
                /quiz|afleve|assignm|hand[- ]?in|exam|eksamen|prøve|rapport|projekt/i.test(r.title) &&
                !/^(lecture|forelæsning|excercise|exercise|øvelser|lab)/i.test(r.title))
              .map((r) => ({ title: r.title as string, due_date: (r.due_date as string).slice(0, 10), done: !!r.done }));
          }
        } catch { /* deadlines er pynt på træet, aldrig en blocker */ }
        if (alive) {
          setCourses(build(m.data ?? [], e.data ?? [], en.data ?? []));
          setWeeks(buildWeekTree(m.data ?? [], e.data ?? [], en.data ?? [], tasks));
        }
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => { alive = false; };
  }, []);
  return { courses, weeks, error };
}

// ── Uge-træet: git-graph-roadmappet ─────────────────────────────────────────
// Trunk = terminens uger frem til eksamen; grene = ugens leverancer på tværs
// af ALLE kurser. Fortid viser faktiske hændelser (✓), nutid/fremtid viser
// planen: bøgernes resterende sider fordelt jævnt over de resterende uger,
// lektionskøen fordelt med lessons_per_week ad gangen, og graded deadlines
// placeret i deres uge. Ren funktion — projektionen kan testes.

export interface WeekItem {
  course: string;
  kind: "read" | "lesson" | "deadline";
  text: string;
  done: boolean;
}
export interface WeekNode {
  idx: number;          // teaching week, 1-based
  start: string;        // monday, YYYY-MM-DD
  state: "past" | "current" | "future" | "exam";
  items: WeekItem[];
}

interface TaskLite { title: string; due_date: string; done: boolean }

const TERM_START = "2026-08-31"; // monday of teaching week 1 (every enrollment)
const LESSONS_PER_WEEK = 3;

function shortTitle(t: string): string {
  return t.replace(/^[A-Za-zÆØÅæøå]+ · /, "").replace(/ — Concept Module$/, "")
    .replace(/\s*\(.*\)$/, "").slice(0, 34);
}

export function buildWeekTree(
  mats: MaterialRow[], events: EventRow[], enrolls: EnrollRow[], tasks: TaskLite[],
): WeekNode[] {
  const today = todayYmd();
  const courseOf = new Map(enrolls.map((e) => [e.c_id, e.label]));
  const examDate = mats.filter((m) => m.due_date).map((m) => m.due_date!).sort().at(-1) ?? null;
  const lastWeek = examDate ? Math.floor(daysBetween(TERM_START, examDate) / 7) + 1 : 10;
  const curWeek = Math.min(lastWeek, Math.floor(daysBetween(TERM_START, today) / 7) + 1);
  const weekOf = (ymd: string) => Math.floor(daysBetween(TERM_START, ymd) / 7) + 1;
  const mondayOf = (w: number) => shiftDate(TERM_START, (w - 1) * 7);

  const byId = new Map(mats.map((m) => [m.id, m]));
  const posOf = new Map<string, number>();
  for (const e of events) {
    if (e.units_to != null && e.units_to > (posOf.get(e.material_id) ?? 0)) posOf.set(e.material_id, e.units_to);
  }

  const weeks: WeekNode[] = [];
  for (let w = 1; w <= lastWeek; w++) {
    weeks.push({
      idx: w, start: mondayOf(w),
      state: w < curWeek ? "past" : w === curWeek ? "current" : "future",
      items: [],
    });
  }

  // FORTID + NUTID: faktiske hændelser, aggregeret pr. (uge, kursus, slags)
  const readAgg = new Map<string, number>(); // `${w}|${course}` -> pages
  for (const e of events) {
    const m = byId.get(e.material_id);
    if (!m || m.course_id == null) continue;
    const w = weekOf(e.event_date);
    if (w < 1 || w > lastWeek) continue;
    const course = courseOf.get(m.course_id);
    if (!course) continue; // materiale på et ikke-aktivt kursus hører ikke hjemme i træet
    if (e.kind === "reading" && e.units_delta != null && e.units_delta > 0) {
      const k = `${w}|${course}`;
      readAgg.set(k, (readAgg.get(k) ?? 0) + e.units_delta);
    } else if (e.kind === "lesson") {
      weeks[w - 1].items.push({ course, kind: "lesson", text: shortTitle(m.title), done: true });
    }
  }
  for (const [k, pages] of readAgg) {
    const [w, course] = k.split("|");
    weeks[Number(w) - 1].items.push({ course, kind: "read", text: `Læste ${Math.round(pages)} sider`, done: true });
  }

  // FREMTID (inkl. resten af denne uge): bøgernes resterende sider jævnt fordelt
  const weeksLeft = Math.max(1, lastWeek - curWeek + 1);
  const perCoursePages = new Map<string, number>();
  for (const m of mats) {
    if (m.status !== "active" || !["book", "document", "paper"].includes(m.kind)) continue;
    if (m.course_id == null || m.total_units == null) continue;
    const course = courseOf.get(m.course_id);
    if (!course) continue;
    const remaining = Math.max(0, m.total_units - Math.max(m.start_unit ?? 0, posOf.get(m.id) ?? 0));
    perCoursePages.set(course, (perCoursePages.get(course) ?? 0) + remaining);
  }
  for (let w = curWeek; w <= lastWeek; w++) {
    for (const [course, total] of perCoursePages) {
      const perWeek = Math.ceil(total / weeksLeft);
      if (perWeek > 0) weeks[w - 1].items.push({ course, kind: "read", text: `Læs ~${perWeek} sider`, done: false });
    }
  }

  // Lektionskøen: aktive (uafsluttede) først, så planlagte — LESSONS_PER_WEEK pr. uge
  const doneLessons = new Set(events.filter((e) => e.kind === "lesson").map((e) => e.material_id));
  const queue = mats
    .filter((m) => m.kind === "lesson" && (m.status === "active" || m.status === "planned") && !doneLessons.has(m.id))
    .sort((a, b) => (a.status === b.status ? a.id.localeCompare(b.id) : a.status === "active" ? -1 : 1));
  queue.forEach((m, i) => {
    const w = Math.min(lastWeek, curWeek + Math.floor(i / LESSONS_PER_WEEK));
    const course = m.course_id != null ? courseOf.get(m.course_id) : undefined;
    weeks[w - 1].items.push({ course: course ?? "", kind: "lesson", text: shortTitle(m.title), done: false });
  });

  // Graded deadlines i deres uge
  for (const t of tasks) {
    const w = weekOf(t.due_date);
    if (w < 1 || w > lastWeek) continue;
    weeks[w - 1].items.push({ course: "", kind: "deadline", text: t.title.slice(0, 40), done: t.done });
  }

  if (examDate) weeks.push({ idx: lastWeek + 1, start: examDate, state: "exam", items: [] });
  return weeks;
}
