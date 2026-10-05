/**
 * The always-visible overblik above the Learn tabs: one compact chip per
 * course (countdown · læsning · lektioner) plus the nearest graded deadline.
 * Deliberately TINY — it answers "hvor er jeg, og hvad brænder?" at a
 * glance; everything deeper lives in the Roadmap tab. Reads the same
 * `useRoadmap()` as the full panel, so the two can never disagree.
 */
import { useEffect, useState } from "react";
import { supabasePublic } from "../supabase";
import { useRoadmap } from "./roadmapData";

interface Deadline { title: string; due: string; inDays: number }

function daysTo(ymd: string): number {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen" }).format(new Date());
  const [y1, m1, d1] = t.split("-").map(Number);
  const [y2, m2, d2] = ymd.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Nearest undone graded task across the enrolled courses' plans. */
function useNextDeadline(): Deadline | null {
  const [dl, setDl] = useState<Deadline | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const en = await supabasePublic.from("lr_course_enrollment")
          .select("plan_id").eq("user_id", "default").eq("active", true);
        const planIds = (en.data ?? []).map((r) => r.plan_id).filter((p): p is number => p != null);
        if (!planIds.length) return;
        const t = await supabasePublic.from("pf_tasks")
          .select("title, due_date").in("plan_id", planIds).eq("done", false)
          .not("due_date", "is", null)
          .order("due_date", { ascending: true }).limit(20);
        const graded = (t.data ?? []).find((r) =>
          /quiz|afleve|assignm|hand[- ]?in|exam|eksamen|prøve|deadline|rapport|projekt/i.test(r.title ?? "") &&
          !/^(lecture|forelæsning|excercise|exercise|øvelser|lab)/i.test(r.title ?? ""));
        if (alive && graded?.due_date) {
          const due = graded.due_date.slice(0, 10);
          setDl({ title: graded.title ?? "", due, inDays: daysTo(due) });
        }
      } catch { /* striben er et overblik, aldrig en blocker */ }
    })();
    return () => { alive = false; };
  }, []);
  return dl;
}

export function OverviewStrip() {
  const { courses } = useRoadmap();
  const deadline = useNextDeadline();
  if (!courses?.length && !deadline) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap justify-center gap-2">
        {(courses ?? []).map((c) => (
          <div key={c.label}
            className="flex items-baseline gap-2 rounded-full bg-white px-3.5 py-1.5 text-xs shadow-sm">
            <span className="font-semibold">{c.label}</span>
            {c.daysLeft != null && (
              <span className={`font-bold tabular-nums ${c.daysLeft <= 14 ? "text-[#BE123C]" : "text-[#1A1A24]"}`}>
                {c.daysLeft}d
              </span>
            )}
            <span className="tabular-nums text-[#6E6E78]">{Math.round(c.bookPct * 100)}%</span>
            <span className="tabular-nums text-[#6E6E78]">{c.lessonsDone}/{c.lessons.length} lekt.</span>
          </div>
        ))}
      </div>
      {deadline && deadline.inDays <= 7 && (
        <div className="mx-auto rounded-full bg-[#FDECEF] px-3.5 py-1 text-xs font-medium text-[#BE123C]">
          ⚠︎ {deadline.title} — om {deadline.inDays} dag{deadline.inDays === 1 ? "" : "e"}
        </div>
      )}
    </div>
  );
}
