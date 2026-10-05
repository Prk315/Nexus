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


export function useRoadmap(): { courses: CourseView[] | null; error: boolean } {
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
  return { courses, error };
}
