import { useEffect, useMemo, useState, useCallback } from "react";
import { GraduationCap, ChevronRight, ChevronDown } from "lucide-react";
import { getCourseAssignments, updateCourseAssignment } from "../../lib/api";
import { Badge } from "../ui/badge";
import { cn, daysUntil, deadlineLabel, deadlineVariant, PRIORITY_BADGE_CLASSES } from "../../lib/utils";
import type { CourseAssignment } from "../../types";

function AssignmentRow({ a, onMarkDone }: { a: CourseAssignment; onMarkDone: () => void }) {
  const days = a.due_date ? daysUntil(a.due_date) : null;
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 group hover:bg-secondary/50 transition-colors">
      <span className={cn("text-xs px-1.5 py-0.5 rounded border font-medium shrink-0", PRIORITY_BADGE_CLASSES[a.priority] ?? PRIORITY_BADGE_CLASSES.low)}>
        {a.assignment_type}
      </span>
      <span className="text-sm flex-1 truncate">{a.title}</span>
      {days !== null && <Badge variant={deadlineVariant(days)} className="shrink-0 text-xs">{deadlineLabel(days)}</Badge>}
      <button
        onClick={onMarkDone}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-0.5 rounded border border-indigo-400/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10"
      >
        Mark done
      </button>
    </div>
  );
}

// Open course assignments (overdue + unscheduled + upcoming) grouped by course.
// Absorbs the Study sections of the old Backlog + Planner pages (interactive).
export function StudySection() {
  const [assignments, setAssignments] = useState<CourseAssignment[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(() => getCourseAssignments().then(setAssignments), []);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const open = assignments
      .filter((a) => a.status !== "done")
      .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
    const map = new Map<string, CourseAssignment[]>();
    for (const a of open) {
      if (!map.has(a.plan_title)) map.set(a.plan_title, []);
      map.get(a.plan_title)!.push(a);
    }
    return Array.from(map.entries()).map(([course, items]) => ({ course, items }));
  }, [assignments]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (total === 0) return null;

  const markDone = async (a: CourseAssignment) => {
    await updateCourseAssignment(a.id, { ...a, status: "done" });
    load();
  };

  return (
    <section className="rounded-xl border border-indigo-400/30 bg-indigo-500/5 p-3">
      <button onClick={() => setCollapsed((v) => !v)} className="flex items-center gap-2 w-full">
        {collapsed ? <ChevronRight className="h-4 w-4 text-indigo-500" /> : <ChevronDown className="h-4 w-4 text-indigo-500" />}
        <GraduationCap className="h-4 w-4 text-indigo-500 shrink-0" />
        <h2 className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Study</h2>
        <span className="text-xs text-indigo-500/70">({total})</span>
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-3 mt-2">
          {groups.map((g) => (
            <div key={g.course}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-foreground/80">{g.course}</span>
                <span className="text-xs text-muted-foreground">({g.items.length})</span>
              </div>
              <div className="flex flex-col gap-0.5 pl-3 border-l-2 border-indigo-400/30">
                {g.items.map((a) => <AssignmentRow key={a.id} a={a} onMarkDone={() => markDone(a)} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
