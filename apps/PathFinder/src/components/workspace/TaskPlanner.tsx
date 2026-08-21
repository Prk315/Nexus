import { useEffect, useMemo, useState } from "react";
import {
  Lock, Target, CalendarClock, Gauge, AlertTriangle, Check, Repeat, Trash2,
} from "lucide-react";
import { Dialog, DialogContent } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  cn, STAGE_LABEL, STAGE_HINT, STAGE_CLASSES, STAGE_ORDER, formatDateShort,
} from "../../lib/utils";
import {
  subtreeNode, flatten, rollupEstimate, rollupCoverage, rollupProgress,
  ownProgress, formatMinutes, gateReason, isWorkable, planningOf, type TaskNode,
} from "../../lib/taskTree";
import {
  useAddSubtask, usePatchTask, useSetTaskParent, useSetTaskStage, useSetTaskMatrix,
  useTaskBlocks, useTaskSessions, useTaskScheduling,
  useScheduleTask, useScheduleTaskSeries, useUnscheduleTask,
  useLogSession, useDeleteSession,
} from "../../hooks/useTaskPlanning";
import { useTasks, useToggleTask, useDeleteTask } from "../../hooks/useTasks";
import { PriorityPad } from "./PriorityPad";
import { BreakdownTree } from "./BreakdownTree";
import { SchedulePanel } from "./SchedulePanel";
import type { CompletionMode, TaskSession, TaskStage } from "../../types";

/**
 * The three-step task planner.
 *
 *   Refine    — say what the work is: importance x urgency, notes, and a recursive
 *               breakdown whose steps carry their own state, estimate and date.
 *   Schedule  — commit calendar time, in pieces. Not all-or-nothing.
 *   Measure   — decide what "done" means, and log the work that gets you there.
 *
 * The steps are ordered because they depend on each other, and the lifecycle rail
 * at the top enforces the one rule that gives the whole thing teeth: **a task
 * cannot become Active until it has calendar time behind it.** Planning that never
 * turns into a commitment is the failure mode this is built to prevent.
 */

type Step = "refine" | "schedule" | "measure";

const STEPS: { id: Step; label: string; icon: typeof Target }[] = [
  { id: "refine", label: "Refine", icon: Target },
  { id: "schedule", label: "Schedule", icon: CalendarClock },
  { id: "measure", label: "Measure", icon: Gauge },
];

export function TaskPlanner({ rootId, onClose }: { rootId: number; onClose: () => void }) {
  const { data: tasks = [] } = useTasks();
  const { data: coverage = new Map() } = useTaskScheduling();

  const root = useMemo(() => subtreeNode(tasks, rootId), [tasks, rootId]);
  const subtreeIds = useMemo(() => (root ? flatten(root).map((n) => n.task.id) : []), [root]);

  const { data: blocks = [] } = useTaskBlocks(rootId, subtreeIds);
  const { data: sessions = [] } = useTaskSessions(rootId, subtreeIds);

  const sessionsByTask = useMemo(() => {
    const m = new Map<number, TaskSession[]>();
    for (const s of sessions) {
      const b = m.get(s.task_id);
      if (b) b.push(s); else m.set(s.task_id, [s]);
    }
    return m;
  }, [sessions]);

  const [step, setStep] = useState<Step>("refine");
  const [scheduleTargetId, setScheduleTargetId] = useState<number>(rootId);
  const [gateError, setGateError] = useState<string | null>(null);

  // Mutations
  const addSubtask = useAddSubtask(rootId);
  const patch = usePatchTask(rootId);
  const reparent = useSetTaskParent(rootId);
  const setStage = useSetTaskStage(rootId);
  const setMatrix = useSetTaskMatrix(rootId);
  const schedule = useScheduleTask(rootId);
  const scheduleSeries = useScheduleTaskSeries(rootId);
  const unschedule = useUnscheduleTask(rootId);
  const logSession = useLogSession(rootId);
  const deleteSession = useDeleteSession(rootId);
  const toggle = useToggleTask();
  const del = useDeleteTask();

  // The scheduling target must stay inside the subtree — a step can be deleted
  // while the Schedule tab is pointing at it.
  useEffect(() => {
    if (!subtreeIds.includes(scheduleTargetId)) setScheduleTargetId(rootId);
  }, [subtreeIds, scheduleTargetId, rootId]);

  if (!root) return null;

  const t = root.task;
  const estimate = rollupEstimate(root);
  const cov = rollupCoverage(root, coverage);
  const progress = rollupProgress(root, sessionsByTask);
  const workable = isWorkable(root, coverage);
  const blocked = gateReason(root, coverage);
  const stage = planningOf(t).stage;

  const targetNode =
    flatten(root).find((n) => n.task.id === scheduleTargetId) ?? root;

  const goToStage = async (stage: TaskStage) => {
    setGateError(null);
    try {
      await setStage.mutateAsync({ id: t.id, stage });
    } catch (e) {
      setGateError(typeof e === "string" ? e : "Could not change stage.");
      setStep("schedule");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        title={t.title}
        description={[t.plan_title, t.goal_title].filter(Boolean).join(" · ") || undefined}
        className="max-w-3xl"
      >
        <div className="flex flex-col gap-4 max-h-[74vh] overflow-y-auto pr-1 -mr-1">
          {/* ── Lifecycle rail ── */}
          <div className="flex flex-wrap items-center gap-1.5">
            {STAGE_ORDER.map((s) => {
              const active = stage === s;
              const locked = s === "active" && !workable;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={locked}
                  onClick={() => goToStage(s)}
                  title={locked ? (blocked ?? undefined) : STAGE_HINT[s]}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    active ? STAGE_CLASSES[s] : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60",
                    locked && "opacity-45 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground",
                  )}
                >
                  {locked && <Lock className="h-3 w-3" />}
                  {STAGE_LABEL[s]}
                </button>
              );
            })}

            <div className="flex-1" />

            <div className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
              <span title="Total effort, rolled up from the steps">{formatMinutes(estimate)}</span>
              <span
                title={`${formatMinutes(cov.scheduledMin)} committed to the calendar`}
                className={cn(
                  cov.scheduledMin === 0 ? "text-muted-foreground/50"
                    : cov.scheduledMin >= estimate ? "text-emerald-500" : "text-amber-500",
                )}
              >
                {formatMinutes(cov.scheduledMin)} scheduled
              </span>
              <span>{Math.round(progress.fraction * 100)}%</span>
            </div>
          </div>

          {blocked && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{blocked}</span>
            </div>
          )}
          {gateError && !blocked && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {gateError}
            </div>
          )}

          {/* ── Step tabs ── */}
          <div className="inline-flex self-start rounded-lg border border-border p-0.5">
            {STEPS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setStep(id)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  step === id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {step === "refine" && (
            <RefineStep
              root={root}
              coverage={coverage}
              sessionsByTask={sessionsByTask}
              onMatrix={(importance, urgency) => setMatrix.mutate({ id: t.id, importance, urgency })}
              onPatchRoot={(p) => patch.mutate({ id: t.id, patch: p as any })}
              handlers={{
                onAddChild: (parentId, title) => addSubtask.mutate({ parentId, title }),
                onPatch: (id, p) => patch.mutate({ id, patch: p as any }),
                onToggle: (id) => toggle.mutate(id),
                onDelete: (id) => del.mutate(id),
                onReparent: (id, parentId) => reparent.mutate({ id, parentId }),
                onSchedule: (id) => { setScheduleTargetId(id); setStep("schedule"); },
              }}
            />
          )}

          {step === "schedule" && (
            <SchedulePanel
              root={root}
              target={targetNode}
              blocks={blocks}
              coverage={coverage}
              onTargetChange={setScheduleTargetId}
              onSchedule={(v) => schedule.mutate(v)}
              onScheduleSeries={(v) => scheduleSeries.mutate(v)}
              onUnschedule={(v) => unschedule.mutate(v)}
            />
          )}

          {step === "measure" && (
            <MeasureStep
              root={root}
              sessionsByTask={sessionsByTask}
              onPatch={(id, p) => patch.mutate({ id, patch: p as any })}
              onLog={(v) => logSession.mutate(v)}
              onDeleteSession={(id) => deleteSession.mutate(id)}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-border">
          <span className="text-[11px] text-muted-foreground">
            {workable
              ? "Scheduled — this task can be worked on."
              : "Not yet workable. Commit calendar time to unlock Active."}
          </span>
          <div className="flex gap-2">
            {stage !== "active" && workable && stage !== "done" && (
              <Button size="sm" onClick={() => goToStage("active")}>Start work</Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Step 1: refine ───────────────────────────────────────────────────────────

function RefineStep({ root, coverage, sessionsByTask, onMatrix, onPatchRoot, handlers }: {
  root: TaskNode;
  coverage: Parameters<typeof rollupCoverage>[1];
  sessionsByTask: Map<number, TaskSession[]>;
  onMatrix: (importance: any, urgency: any) => void;
  onPatchRoot: (patch: Record<string, unknown>) => void;
  handlers: React.ComponentProps<typeof BreakdownTree>["handlers"];
}) {
  const t = root.task;
  const plan = planningOf(t);
  const [notes, setNotes] = useState(plan.notes ?? "");
  useEffect(() => setNotes(plan.notes ?? ""), [plan.notes]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground">Importance &amp; urgency</span>
          <PriorityPad
            importance={t.priority}
            urgency={plan.urgency}
            onChange={onMatrix}
          />
        </div>

        <div className="flex-1 min-w-[220px] flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground">Detail</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => { if (notes !== (plan.notes ?? "")) onPatchRoot({ notes: notes || null }); }}
            placeholder="What does done look like? What's the approach, what's in the way?"
            className="flex-1 min-h-[132px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground/50"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium text-foreground">Breakdown</span>
          <span className="text-[11px] text-muted-foreground">
            Each step carries its own state, estimate and date.
          </span>
        </div>
        <BreakdownTree
          root={root}
          coverage={coverage as any}
          sessionsByTask={sessionsByTask}
          handlers={handlers}
        />
      </div>
    </div>
  );
}

// ── Step 3: measure ──────────────────────────────────────────────────────────

const MODE_COPY: Record<CompletionMode, { label: string; hint: string }> = {
  binary: { label: "Checkbox", hint: "Done when you say it's done." },
  sessions: { label: "Sessions", hint: "Done after a number of work sessions — for steps you repeat." },
  time: { label: "Time logged", hint: "Done once the estimated minutes have been logged." },
};

function MeasureStep({ root, sessionsByTask, onPatch, onLog, onDeleteSession }: {
  root: TaskNode;
  sessionsByTask: Map<number, TaskSession[]>;
  onPatch: (id: number, patch: Record<string, unknown>) => void;
  onLog: (v: { task_id: number; date: string; minutes: number; note?: string | null }) => void;
  onDeleteSession: (id: number) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const steps = useMemo(() => flatten(root).filter((n) => n.children.length === 0), [root]);
  const [logTarget, setLogTarget] = useState<number>(steps[0]?.task.id ?? root.task.id);
  const [logMinutes, setLogMinutes] = useState("30");

  useEffect(() => {
    if (!steps.some((s) => s.task.id === logTarget)) {
      setLogTarget(steps[0]?.task.id ?? root.task.id);
    }
  }, [steps, logTarget, root.task.id]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-muted-foreground leading-snug">
        A step that repeats is never finished in one sitting — give it{" "}
        <strong className="font-medium text-foreground">Sessions</strong> and it completes by
        count instead of by checkbox. Each step chooses its own measure.
      </p>

      <div className="flex flex-col gap-1.5">
        {steps.map((n) => {
          const task = n.task;
          const sessions = sessionsByTask.get(task.id) ?? [];
          const tp = planningOf(task);
          const p = ownProgress(task, sessions);
          return (
            <div key={task.id} className="rounded-lg border border-border/60 p-2.5 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className={cn("text-sm truncate flex-1 min-w-0", p.done && "line-through text-muted-foreground")}>
                  {task.title}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{p.label}</span>
                {p.done && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
              </div>

              <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn("h-full rounded-full transition-all", p.done ? "bg-emerald-500" : "bg-primary")}
                  style={{ width: `${Math.round(p.fraction * 100)}%` }}
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(Object.keys(MODE_COPY) as CompletionMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    title={MODE_COPY[m].hint}
                    onClick={() => onPatch(task.id, {
                      completion_mode: m,
                      // A sessions target has to exist or progress divides by zero;
                      // 3 is a sane weekly-habit default the user can edit.
                      target_count: m === "sessions" ? (tp.target_count ?? 3) : null,
                    })}
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
                      tp.completion_mode === m
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60",
                    )}
                  >
                    {m === "sessions" && <Repeat className="inline h-2.5 w-2.5 mr-0.5 -mt-0.5" />}
                    {MODE_COPY[m].label}
                  </button>
                ))}

                {tp.completion_mode === "sessions" && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    target
                    <Input
                      type="number"
                      min={1}
                      value={tp.target_count ?? 3}
                      onChange={(e) => onPatch(task.id, { target_count: Math.max(1, Number(e.target.value) || 1) })}
                      className="h-6 w-14 text-[11px] px-1.5"
                    />
                  </span>
                )}
              </div>

              {sessions.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {sessions.slice(0, 8).map((s) => (
                    <span
                      key={s.id}
                      className="group inline-flex items-center gap-1 rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground"
                      title={`${s.date} · ${formatMinutes(s.minutes)}`}
                    >
                      {formatDateShort(s.date)}
                      <button
                        type="button"
                        onClick={() => onDeleteSession(s.id)}
                        className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                        title="Remove this session"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                  {sessions.length > 8 && (
                    <span className="text-[10px] text-muted-foreground/60 self-center">
                      +{sessions.length - 8} more
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Manual log — for work done away from a scheduled block. */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
        <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
          <label className="text-[11px] text-muted-foreground">Log work on</label>
          <select
            value={logTarget}
            onChange={(e) => setLogTarget(Number(e.target.value))}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {steps.map((n) => (
              <option key={n.task.id} value={n.task.id}>{n.task.title}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">Minutes</label>
          <Input
            type="number" min={1} value={logMinutes}
            onChange={(e) => setLogMinutes(e.target.value)}
            className="h-8 w-20 text-xs"
          />
        </div>
        <Button
          size="sm"
          onClick={() => onLog({
            task_id: logTarget,
            date: today,
            minutes: Math.max(1, Number(logMinutes) || 0),
          })}
        >
          Log session
        </Button>
      </div>
    </div>
  );
}
