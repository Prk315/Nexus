// The dashboard header: greeting, daily goals, active goals, the day ring and stat pills.

import { useState } from "react";
import { Check, X, Clock, Star, Pencil } from "lucide-react";
import { cn } from "../../lib/utils";
import { isDue } from "../workspace/systemForms";
import type { Goal, Plan, TaskWithContext, SystemEntry, DailyGoals, DailyPrimaryGoal, DailySecGoal, CourseAssignment, TrainingSession } from "../../types";
import { PieItem, formatMinutes } from "./_shared";
import { TodayPie } from "./TodayPie";
import { TimeEstimateBadge, TimeEstimateInput } from "./TodoList";

// ── Welcome Box ───────────────────────────────────────────────────────────────

/**
 * Active goals, compacted into the header.
 *
 * They used to be a full-width block above the task list, which spent a whole
 * row and ~1000px of width on two short titles and two progress bars. Goals are
 * *context* for the day rather than something you act on hourly, so they belong
 * beside the other at-a-glance header readouts — next to the pie, not above the
 * work.
 *
 * Same ordering as the old block (priority, then nearest deadline) so the goal
 * that mattered most still reads first. Scrolls past three rather than growing
 * the header.
 */
function HeaderGoals({ goals }: { goals: Goal[] }) {
  const active = [...goals]
    .filter((g) => g.status === "active")
    .sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 } as Record<string, number>;
      const pd = (p[a.priority] ?? 1) - (p[b.priority] ?? 1);
      if (pd !== 0) return pd;
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      return a.deadline ? -1 : b.deadline ? 1 : 0;
    });

  if (active.length === 0) return null;

  return (
    <div className="hidden lg:flex shrink-0 w-56 max-h-16 flex-col justify-center gap-2 overflow-y-auto">
      {active.map((g) => {
        const pct = g.task_count === 0 ? 0 : Math.round((g.done_count / g.task_count) * 100);
        return (
          <div key={g.id} className="flex flex-col gap-1">
            <span className="truncate text-[11px] font-medium text-foreground" title={g.title}>
              {g.title}
            </span>
            <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function WelcomeBox({
  goals, plans, tasks, systems, dailyGoals, courseAssignments, date,
  goalPrimaryDone, goalSecDone, todaySessions,
  onTogglePrimaryDone, onToggleSecDone, onSetPrimary, onClearPrimary,
  onAddSecondary, onUpdateSecondaryEstimate, onDeleteSecondary,
}: {
  goals: Goal[]; plans: Plan[]; tasks: TaskWithContext[]; systems: SystemEntry[];
  dailyGoals: DailyGoals; courseAssignments: CourseAssignment[]; date: string;
  goalPrimaryDone: boolean; goalSecDone: Set<number>; todaySessions: TrainingSession[];
  onTogglePrimaryDone: () => void;
  onToggleSecDone: (id: number) => void;
  onSetPrimary: (payload: DailyPrimaryGoal) => void;
  onClearPrimary: () => void;
  onAddSecondary: (text: string) => void;
  onUpdateSecondaryEstimate: (id: number, min: number | null) => void;
  onDeleteSecondary: (id: number) => void;
}) {
  const hour     = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Inline goal editing state (primary + secondary edited directly in the header)
  const [editingPrimary, setEditingPrimary] = useState(false);
  const [primaryDraft, setPrimaryDraft] = useState(dailyGoals.primary?.text ?? "");
  const [primaryEstDraft, setPrimaryEstDraft] = useState(dailyGoals.primary?.time_estimate_min ? formatMinutes(dailyGoals.primary.time_estimate_min) : "");
  const [secDraft, setSecDraft] = useState("");
  const [editingEstId, setEditingEstId] = useState<number | null>(null);
  const [estDraft, setEstDraft] = useState("");

  function commitPrimary() {
    const text = primaryDraft.trim();
    if (text) onSetPrimary({ text, time_estimate_min: parseMinutes(primaryEstDraft) });
    else onClearPrimary();
    setEditingPrimary(false);
  }
  function startEditPrimary() {
    setPrimaryDraft(dailyGoals.primary?.text ?? "");
    setPrimaryEstDraft(dailyGoals.primary?.time_estimate_min ? formatMinutes(dailyGoals.primary.time_estimate_min) : "");
    setEditingPrimary(true);
  }
  function handleSecKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && secDraft.trim()) {
      onAddSecondary(secDraft.trim());
      setSecDraft("");
    }
  }
  function commitSecEst(g: DailySecGoal) {
    onUpdateSecondaryEstimate(g.id, parseMinutes(estDraft));
    setEditingEstId(null);
  }

  // Stat pills.
  //
  // Every count here is over *top-level* tasks only. A subtask is a step inside
  // a task, not a task of its own — counting both would report a task broken
  // into five steps as six things to do, and the number would grow the more
  // carefully you planned.
  const rootTasks   = tasks.filter((t) => t.parent_id == null);
  const activeGoals = goals.filter((g) => g.status === "active").length;
  const openTasks   = rootTasks.filter((t) => !t.done).length;
  const activePlans = plans.filter((p) => p.status === "active").length;
  const systemsDue  = systems.filter(isDue).length;

  // Today's task progress (tasks due today + assignments + training sessions)
  const todayTasks = rootTasks.filter((t) => t.due_date === date);
  const totalToday = todayTasks.length + courseAssignments.length + todaySessions.length;
  const doneToday  = todayTasks.filter((t) => t.done).length
                   + courseAssignments.filter((ca) => ca.status === "done").length
                   + todaySessions.filter((s) => s.completed).length;
  const progressPct = totalToday === 0 ? 0 : Math.round((doneToday / totalToday) * 100);

  // Pie chart: 16-hour day = 960 minutes
  // Normal task → 10 min; timed assignment → duration (minutes)
  const TOTAL_MIN = 16 * 60;
  const TASK_MIN  = 10;
  let doneMin = 0, pendingMin = 0;

  for (const t of todayTasks) {
    // `aggregate_estimate` is the trigger-maintained roll-up of the whole
    // breakdown, so a task split into steps contributes its real total exactly
    // once. Falling back to its own estimate covers leaves and any row read
    // before the aggregate was computed.
    const min = t.aggregate_estimate || t.time_estimate || TASK_MIN;
    (t.done ? (doneMin += min) : (pendingMin += min));
  }
  for (const ca of courseAssignments) {
    let min: number;
    if (ca.time_estimate != null) {
      min = ca.time_estimate;
    } else if (ca.start_time && ca.end_time) {
      const [sh, sm] = ca.start_time.split(":").map(Number);
      const [eh, em] = ca.end_time.split(":").map(Number);
      const dur = (eh * 60 + em) - (sh * 60 + sm);
      min = dur > 0 ? dur : TASK_MIN;
    } else {
      min = TASK_MIN;
    }
    ca.status === "done" ? (doneMin += min) : (pendingMin += min);
  }

  const SESSION_DEFAULT_MIN = 60;
  for (const s of todaySessions) {
    let min = SESSION_DEFAULT_MIN;
    if (s.start_time && s.end_time) {
      const [sh, sm] = s.start_time.split(":").map(Number);
      const [eh, em] = s.end_time.split(":").map(Number);
      const dur = (eh * 60 + em) - (sh * 60 + sm);
      if (dur > 0) min = dur;
    }
    s.completed ? (doneMin += min) : (pendingMin += min);
  }

  const goalPieItems: PieItem[] = [];
  if (dailyGoals.primary?.time_estimate_min) {
    const min = dailyGoals.primary.time_estimate_min;
    goalPrimaryDone ? (doneMin += min) : (pendingMin += min);
    goalPieItems.push({ id: 0, label: dailyGoals.primary.text, subtitle: "Primary goal", minutes: min, done: goalPrimaryDone, kind: "goal" });
  }
  for (const g of dailyGoals.secondary) {
    if (!g.time_estimate_min) continue;
    const isDone = goalSecDone.has(g.id);
    isDone ? (doneMin += g.time_estimate_min) : (pendingMin += g.time_estimate_min);
    goalPieItems.push({ id: g.id, label: g.text, subtitle: "Secondary goal", minutes: g.time_estimate_min, done: isDone, kind: "goal" });
  }

  const workMin  = doneMin + pendingMin;
  const capTotal = Math.max(TOTAL_MIN, workMin);
  const freeMin  = capTotal - workMin;

  const pieItems: PieItem[] = [
    ...todayTasks.map((t) => ({
      id: t.id, label: t.title, subtitle: t.plan_title ?? undefined,
      // Same roll-up the totals above use, so the slices sum to the ring.
      minutes: t.aggregate_estimate || t.time_estimate || TASK_MIN,
      done: t.done, kind: "task" as const,
    })),
    ...courseAssignments.map((ca) => {
      let min: number;
      if (ca.time_estimate != null) {
        min = ca.time_estimate;
      } else if (ca.start_time && ca.end_time) {
        const [sh, sm] = ca.start_time.split(":").map(Number);
        const [eh, em] = ca.end_time.split(":").map(Number);
        const dur = (eh * 60 + em) - (sh * 60 + sm);
        min = dur > 0 ? dur : TASK_MIN;
      } else {
        min = TASK_MIN;
      }
      return { id: ca.id, label: ca.title, subtitle: ca.plan_title, minutes: min, done: ca.status === "done", kind: "assignment" as const };
    }),
    ...todaySessions.map((s) => {
      let min = SESSION_DEFAULT_MIN;
      if (s.start_time && s.end_time) {
        const [sh, sm] = s.start_time.split(":").map(Number);
        const [eh, em] = s.end_time.split(":").map(Number);
        const dur = (eh * 60 + em) - (sh * 60 + sm);
        if (dur > 0) min = dur;
      }
      const typeIcons: Record<string, string> = { running: "🏃", strength: "🏋️", yoga: "🧘", other: "⚡" };
      const icon = typeIcons[s.plan_type ?? "other"] ?? "⚡";
      return { id: s.id, label: `${icon} ${s.title}`, subtitle: s.plan_title ?? "Training", minutes: min, done: s.completed, kind: "assignment" as const };
    }),
    ...goalPieItems,
  ];

  return (
    <div className="shrink-0 flex flex-col md:flex-row items-stretch md:items-center gap-4 px-5 py-2.5 border-b border-border bg-card">

      {/* Greeting */}
      <div className="shrink-0 w-full md:w-auto">
        <h1 className="text-xl font-semibold text-foreground">{greeting}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </p>
      </div>

      <div className="hidden md:block h-10 w-px bg-border shrink-0" />

      {/* Goals editor + today's progress */}
      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        {/* Primary goal */}
        {editingPrimary ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <input
              autoFocus
              className="flex-1 h-7 rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring min-w-0"
              placeholder="What's your main focus today?"
              value={primaryDraft}
              onChange={(e) => setPrimaryDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitPrimary();
                if (e.key === "Escape") setEditingPrimary(false);
              }}
            />
            <TimeEstimateInput value={primaryEstDraft} onChange={setPrimaryEstDraft} onBlur={commitPrimary} className="w-16" />
            {dailyGoals.primary && (
              <button onClick={() => { onClearPrimary(); setEditingPrimary(false); }}
                className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : dailyGoals.primary ? (
          <div className="group flex items-center gap-1.5 min-w-0">
            <button
              onClick={onTogglePrimaryDone}
              className={cn(
                "h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition-colors",
                goalPrimaryDone ? "bg-emerald-500 border-emerald-500 text-white" : "border-yellow-500/50 hover:border-yellow-500"
              )}
            >
              {goalPrimaryDone && <Check className="h-2.5 w-2.5" />}
            </button>
            <Star className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
            <button onClick={startEditPrimary} className="flex items-center gap-1.5 text-left min-w-0 flex-1">
              <span className={cn("text-sm font-medium truncate", goalPrimaryDone ? "line-through text-muted-foreground" : "text-foreground")}>
                {dailyGoals.primary.text}
              </span>
              <TimeEstimateBadge min={dailyGoals.primary.time_estimate_min} />
              <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </button>
          </div>
        ) : (
          <button
            onClick={startEditPrimary}
            className="flex items-center gap-1.5 text-left text-muted-foreground/50 hover:text-muted-foreground transition-colors w-fit"
          >
            <Star className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs italic">Set your primary goal for today…</span>
          </button>
        )}

        {/* Secondary goals — compact chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {dailyGoals.secondary.map((g) => {
            const done = goalSecDone.has(g.id);
            return (
              <div key={g.id} className="group flex items-center gap-1 rounded-full border border-border bg-background pl-1.5 pr-1 py-0.5">
                <button
                  onClick={() => onToggleSecDone(g.id)}
                  className={cn(
                    "h-3 w-3 shrink-0 rounded-full border flex items-center justify-center transition-colors",
                    done ? "bg-emerald-500 border-emerald-500 text-white" : "border-muted-foreground/30 hover:border-muted-foreground"
                  )}
                >
                  {done && <Check className="h-2 w-2" />}
                </button>
                <span className={cn("text-xs max-w-[120px] truncate", done ? "line-through text-muted-foreground" : "text-foreground")}>
                  {g.text}
                </span>
                {editingEstId === g.id ? (
                  <TimeEstimateInput value={estDraft} onChange={setEstDraft} onBlur={() => commitSecEst(g)} className="w-14 h-6" />
                ) : (
                  <button
                    onClick={() => { setEditingEstId(g.id); setEstDraft(g.time_estimate_min ? formatMinutes(g.time_estimate_min) : ""); }}
                    className={cn(
                      "flex items-center transition-colors shrink-0",
                      g.time_estimate_min
                        ? "text-muted-foreground hover:text-foreground"
                        : "opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-muted-foreground"
                    )}
                    title="Set time estimate"
                  >
                    {g.time_estimate_min ? <TimeEstimateBadge min={g.time_estimate_min} /> : <Clock className="h-3 w-3" />}
                  </button>
                )}
                <button onClick={() => onDeleteSecondary(g.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0">
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          <input
            className="h-6 w-36 rounded-full border border-input bg-transparent px-2.5 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="+ secondary goal"
            value={secDraft}
            onChange={(e) => setSecDraft(e.target.value)}
            onKeyDown={handleSecKey}
          />
        </div>

        {totalToday > 0 ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {doneToday}/{totalToday} today
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/40 italic">Nothing scheduled for today</p>
        )}
      </div>

      <div className="hidden lg:block h-10 w-px bg-border shrink-0" />

      {/* Active goals — context for the day, beside the other header readouts */}
      <HeaderGoals goals={goals} />

      <div className="hidden md:block h-10 w-px bg-border shrink-0" />

      {/* Pie chart */}
      <TodayPie doneMin={doneMin} pendingMin={pendingMin} freeMin={freeMin} capTotal={capTotal} items={pieItems} />

      <div className="hidden md:block h-10 w-px bg-border shrink-0" />

      {/* Stat pills */}
      <div className="flex items-center gap-2 shrink-0 w-full md:w-auto flex-wrap">
        {[
          { label: "Goals",   value: activeGoals },
          { label: "Plans",   value: activePlans },
          { label: "Tasks",   value: openTasks },
          { label: "Systems", value: systemsDue, sub: systemsDue === 0 ? "clear" : "due" },
        ].map(({ label, value, sub }) => (
          <div key={label} className="rounded-lg border border-border px-3 py-1.5 bg-background text-center min-w-[56px]">
            <p className="text-sm font-semibold text-foreground leading-none">{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{sub ?? label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Goal time-estimate helpers ────────────────────────────────────────────────


function parseMinutes(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  // "1h 30m", "1h30m", "1h", "90m", "90", "1.5h"
  const hm = s.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*m?)?$/);
  if (hm) {
    const h = parseFloat(hm[1]);
    const m = hm[2] ? parseInt(hm[2]) : 0;
    return Math.round(h * 60) + m;
  }
  const m = s.match(/^(\d+)\s*m?$/);
  if (m) return parseInt(m[1]);
  return null;
}
