/**
 * The always-visible strip above the Learn tabs. Used to carry one roadmap
 * chip per course (countdown · læsning · lektioner); those were retired
 * 2026-11-07 with the rest of the roadmap surface (exam term over,
 * `PathStatsPanel` now owns per-path progress), so only the nearest graded
 * deadline remains — the "hvad brænder?" half of the old strip.
 */
import { useEffect, useState } from "react";
import { supabasePublic } from "../supabase";

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
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen" }).format(new Date());
        const graded = (t.data ?? []).filter((r) => (r.due_date ?? "") >= today).find((r) =>
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
  const deadline = useNextDeadline();
  if (!deadline || deadline.inDays > 7) return null;

  return (
    <div className="mx-auto rounded-full bg-[#FDECEF] px-3.5 py-1 text-xs font-medium text-[#BE123C]">
      ⚠︎ {deadline.title} — om {deadline.inDays} dag{deadline.inDays === 1 ? "" : "e"}
    </div>
  );
}
