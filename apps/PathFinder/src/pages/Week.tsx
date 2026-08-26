// The week page: state, data loading, and the layout that arranges the week and
// month views.
//
// The components live in components/week/. This file was 2,676 lines with all
// of them inline.

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { ChevronLeft, ChevronRight, Target, Flag, GraduationCap, PanelLeft, PanelRight, PanelBottom, PanelTop, CalendarRange } from "lucide-react";
import { getWeekItems, getAllTasks, getGoals, getPlans, getSystems, createTask, updateTask, deleteTask, toggleTask, toTaskWithContext, createGoal, updateGoal, deleteGoal, createPlan, updatePlan, deletePlan, createSystem, updateSystem, deleteSystem, markSystemDone, getCalBlocks, createCalBlock, updateCalBlock, deleteCalBlock, getTaskSessionsInRange, logTaskSession, unlogTaskOccurrence, getTaskScheduling, createRecurringCalBlock, updateRecurringCalBlock, deleteRecurringCalBlock, getDeadlines, toggleDeadline, updateCourseAssignment, getCoverageCategories } from "../lib/api";
import { loadActualWeek, loadSleepWeek } from "../lib/actual";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { blockMinutes, subtreeNode, unscheduledMinutes } from "../lib/taskTree";
import { isTaskRelevantToMe } from "../lib/team";
import { getUserId } from "../lib/supabase";
import type { Goal, Plan, TaskWithContext, SystemEntry, WeekItems, CalBlock, Deadline, CourseAssignment, TaskSession, TaskCoverage } from "../types";
import { BLOCK_COLORS, DAY_NAMES, DEFAULT_SCROLL_HOUR, HOURS, HOUR_PX, HOUR_PX_STORAGE_KEY, HOUR_START, MONTHS, ModalState, addDays, clampChildSpan, clampHourPx, externalDragDurationMin, pxToMinutes, minutesToPx, timeToMinutes, toISO, todayISO, weekStart, zoomHourPx } from "../components/week/_shared";
import { CalBlockModal, TaskModal, GoalModal, PlanModal, SystemModal, TypePickerModal } from "../components/week/modals";
import { TaskPopupChip, TimeColumn } from "../components/week/TimeColumn";
import { SystemsBar, HeaderPanel, LeftPanel, RightPanel } from "../components/week/panels";
import { WeekTimeStrip } from "../components/week/WeekTimeStrip";
import { MonthView } from "../components/week/MonthView";
import { DragGhostLayer, ExternalDragGhostLayer, useWeekInteractions } from "../components/week/useWeekInteractions";
import type { TaskDraft, GoalDraft, PlanDraft, SystemDraft } from "../components/week/modals";
import type { BlockDraft } from "../components/week/_shared";
import type { DragCommitPatch, ExternalDragPayload, ExternalDropDest } from "../components/week/useWeekInteractions";
import type { Span } from "@nexus/core/coverage";
import type { ActualDay } from "../lib/actual";
import type { CoverageCategoryOption } from "../lib/api";

export function Week() {
  const [view,       setView]      = useState<"week" | "month">("week");
  const [sun,        setSun]       = useState<Date>(() => weekStart(new Date()));
  const [monthStart, setMonthStart] = useState<Date>(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });

  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  const [selectedDay, setSelectedDay] = useState(() => todayISO());
  const [items,        setItems]       = useState<WeekItems>({ tasks: [], goals: [], plans: [], deadlines: [], course_assignments: [], schedule_entries: [], training_sessions: [] });
  const [allPlans,     setAllPlans]    = useState<Plan[]>([]);
  const [allGoals,     setAllGoals]    = useState<Goal[]>([]);
  const [systems,      setSystems]     = useState<SystemEntry[]>([]);
  const [calBlocks,    setCalBlocks]   = useState<CalBlock[]>([]);
  const [allDeadlines, setAllDeadlines] = useState<Deadline[]>([]);
  const [allTasks,     setAllTasks]    = useState<TaskWithContext[]>([]);
  // Sessions logged against calendar occurrences in the visible range. Keyed by
  // cal_block_id so a block can tell whether it has already been worked — for a
  // recurring series that id is the occurrence's virtual negative id, so ticking
  // one Wednesday off doesn't mark every Wednesday.
  const [sessionsByBlock, setSessionsByBlock] = useState<Map<number, TaskSession>>(new Map());
  // The raw list as well: sessionsByBlock drops freehand sessions (no
  // cal_block_id), and those are still time actually worked.
  const [sessionsInRange, setSessionsInRange] = useState<TaskSession[]>([]);
  // Committed calendar minutes per task — the SAME source the board's stage gate
  // uses, so "unscheduled" means the same thing in both places. Deliberately not
  // derived from this week's calBlocks: a task due Thursday may be scheduled next
  // month, and calling that unscheduled would be wrong.
  const [taskCoverage, setTaskCoverage] = useState<Map<number, TaskCoverage>>(new Map());
  const [modal,        setModal]       = useState<ModalState | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Vertical zoom (U2 §1) — desktop only; mobile always renders at the fixed
  // HOUR_PX default (see the mobile TimeColumn call below) and never reads
  // this state at all. Read once on mount, written back debounced.
  const [hourPx, setHourPxRaw] = useState<number>(() => {
    const saved = Number(localStorage.getItem(HOUR_PX_STORAGE_KEY));
    return clampHourPx(saved > 0 ? saved : HOUR_PX);
  });
  const setHourPx = useCallback((v: number) => setHourPxRaw((prev) => {
    const next = clampHourPx(v);
    return next === prev ? prev : next;
  }), []);
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(HOUR_PX_STORAGE_KEY, String(hourPx)), 300);
    return () => clearTimeout(t);
  }, [hourPx]);

  // Panel visibility — persisted in localStorage
  const [showLeft,   setShowLeft]   = useState(() => localStorage.getItem("week_panel_left")   === "1");
  const [showRight,  setShowRight]  = useState(() => localStorage.getItem("week_panel_right")  === "1");
  const [showHeader, setShowHeader] = useState(() => localStorage.getItem("week_panel_header") === "1");
  const [showFooter, setShowFooter] = useState(() => (localStorage.getItem("week_panel_footer") ?? "1") === "1");

  const toggleLeft   = () => setShowLeft((v)   => { localStorage.setItem("week_panel_left",   v ? "0" : "1"); return !v; });
  const toggleRight  = () => setShowRight((v)  => { localStorage.setItem("week_panel_right",  v ? "0" : "1"); return !v; });
  const toggleHeader = () => setShowHeader((v) => { localStorage.setItem("week_panel_header", v ? "0" : "1"); return !v; });
  const toggleFooter = () => setShowFooter((v) => { localStorage.setItem("week_panel_footer", v ? "0" : "1"); return !v; });

  // "Actual" overlay — sleep/screen/training behind the planned blocks.
  // Default OFF: when off, loadActualWeek never runs, so the calendar costs
  // exactly what it costs today.
  const [showActual, setShowActual] = useState(() => localStorage.getItem("pf-week-show-actual") === "1");
  const [actualByDate, setActualByDate] = useState<Map<string, ActualDay>>(new Map());
  const toggleActual = () => setShowActual((v) => { localStorage.setItem("pf-week-show-actual", v ? "0" : "1"); return !v; });

  // Sleep band — ALWAYS on (Phase E §7), independent of the "Actual" toggle
  // above (which keeps gating screen + training, the heavier fetch). Loaded
  // once per visible week via loadSleepWeek, the lightweight half of
  // loadActualWeek.
  const [sleepByDate, setSleepByDate] = useState<Map<string, Span[]>>(new Map());

  // Category picker options — fetched once on mount (not per-week; the list
  // rarely changes), falling back to the CATEGORIES constant on failure
  // inside getCoverageCategories itself.
  const [categories, setCategories] = useState<CoverageCategoryOption[]>([]);
  useEffect(() => { getCoverageCategories().then(setCategories); }, []);

  // Weekly focus note — persisted per-week in localStorage
  const [weekNote, setWeekNote] = useState("");

  const days  = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(sun, i)), [sun]);
  const start = toISO(sun);
  const end   = toISO(days[6]);
  const today = todayISO();

  // Month grid range
  const monthGridStart = useMemo(() => {
    const d = new Date(monthStart); d.setDate(d.getDate() - d.getDay()); return d;
  }, [monthStart]);
  const monthGridEnd = useMemo(() => {
    const last = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    last.setDate(last.getDate() + (6 - last.getDay())); return last;
  }, [monthStart]);

  const queryStart = view === "week" ? start : toISO(monthGridStart);
  const queryEnd   = view === "week" ? end   : toISO(monthGridEnd);

  const load = useCallback(async () => {
    const [wi, gp, pl, sy, cb, dl, at, ts, tc] = await Promise.all([
      getWeekItems(queryStart, queryEnd), getGoals(), getPlans(), getSystems(),
      getCalBlocks(queryStart, queryEnd), getDeadlines(), getAllTasks(),
      getTaskSessionsInRange(queryStart, queryEnd), getTaskScheduling(),
    ]);
    const myUid = getUserId();
    setItems({ ...wi, tasks: wi.tasks.filter((x) => isTaskRelevantToMe(x, myUid)) });
    setAllGoals(gp); setAllPlans(pl); setSystems(sy); setCalBlocks(cb);
    setAllDeadlines(dl); setAllTasks(at.filter((x) => isTaskRelevantToMe(x, myUid)));
    setSessionsByBlock(new Map(
      ts.filter((x) => x.cal_block_id != null).map((x) => [x.cal_block_id!, x]),
    ));
    setSessionsInRange(ts);
    setTaskCoverage(tc);
  }, [queryStart, queryEnd]);

  useEffect(() => { load(); }, [load]);

  // Load/save weekly focus note from localStorage
  useEffect(() => { setWeekNote(localStorage.getItem(`week_note_${start}`) ?? ""); }, [start]);
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(`week_note_${start}`, weekNote), 400);
    return () => clearTimeout(t);
  }, [weekNote, start]);

  // Scroll on week change so the former bounded window's start (5am) sits at
  // the top of the now-full-24h grid, instead of dropping the user at
  // midnight (week view only).
  useEffect(() => {
    if (view === "week" && gridRef.current) {
      gridRef.current.scrollTop = (DEFAULT_SCROLL_HOUR - HOUR_START) * hourPx;
    }
    // Intentionally NOT depending on hourPx — this only resets the scroll
    // position on a week/view change, same as before U2; zooming must not
    // yank the view back to the default scroll target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, view]);

  // Actual-day data (screen/training) — loads once per visible week while
  // the toggle is on; re-runs when the week navigates (start changes), not
  // on unrelated re-renders. Off by default, so a plain week view never
  // fires this.
  useEffect(() => {
    if (!showActual || view !== "week") return;
    let cancelled = false;
    loadActualWeek(days.map(toISO))
      .then((map) => { if (!cancelled) setActualByDate(map); })
      .catch(() => { if (!cancelled) setActualByDate(new Map()); });
    return () => { cancelled = true; };
  }, [showActual, view, start]);

  // Sleep band data — ALWAYS loads for the visible week (not gated by
  // showActual); degrades to an empty map silently, same as loadActualWeek,
  // so a bridgeless browser dev run just shows no bands rather than erroring.
  useEffect(() => {
    if (view !== "week") return;
    let cancelled = false;
    loadSleepWeek(days.map(toISO))
      .then((map) => { if (!cancelled) setSleepByDate(map); })
      .catch(() => { if (!cancelled) setSleepByDate(new Map()); });
    return () => { cancelled = true; };
  }, [view, start]);

  // Week navigation
  const prevWeek = () => {
    setSun((d) => {
      const newSun = addDays(d, -7);
      const dow = new Date(selectedDay).getDay();
      setSelectedDay(toISO(addDays(newSun, dow)));
      return newSun;
    });
  };
  const nextWeek = () => {
    setSun((d) => {
      const newSun = addDays(d, 7);
      const dow = new Date(selectedDay).getDay();
      setSelectedDay(toISO(addDays(newSun, dow)));
      return newSun;
    });
  };
  const goToday  = () => {
    setSun(weekStart(new Date()));
    setSelectedDay(todayISO());
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setMonthStart(d);
  };

  // Month navigation
  const prevMonth = () => setMonthStart((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const nextMonth = () => setMonthStart((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));

  const tasksFor             = (iso: string) => items.tasks.filter((t) => t.due_date === iso);
  // A step that carries its own due date belongs in the week — but shown bare it
  // reads as an orphan, so it gets its parent as a breadcrumb.
  const taskTitleById = useMemo(
    () => new Map(allTasks.map((t) => [t.id, t.title])),
    [allTasks],
  );
  // Which tasks have steps under them. `items.tasks` only holds what is due in
  // range, so this comes from the full list — otherwise a parent whose steps are
  // undated would look childless here and stay tickable, disagreeing with the
  // board and the dashboard.
  const stepCountByParent = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of allTasks) {
      if (t.parent_id == null) continue;
      m.set(t.parent_id, (m.get(t.parent_id) ?? 0) + 1);
    }
    return m;
  }, [allTasks]);

  const chipProps = (t: TaskWithContext) => ({
    today,
    parentTitle: t.parent_id != null ? taskTitleById.get(t.parent_id) ?? null : null,
    scheduledMin: taskCoverage.get(t.id)?.scheduledMin ?? 0,
    hasSteps: (stepCountByParent.get(t.id) ?? 0) > 0,
  });

  /**
   * What dragging `task` onto the grid would create (U3 Part A). Runs the
   * exact same rollup the board's scheduling gate reads — `subtreeNode` +
   * `taskTree.unscheduledMinutes` against the live `allTasks` tree and
   * `taskCoverage` map — rather than a hand-rolled duplicate, so the
   * duration this proposes can never quietly disagree with "Xh booked"
   * elsewhere on this same page.
   */
  const computeDragPayload = (task: TaskWithContext): ExternalDragPayload => {
    const node = subtreeNode(allTasks, task.id);
    const unscheduled = node ? unscheduledMinutes(node, taskCoverage) : 0;
    return {
      taskId: task.id,
      title: task.title,
      durationMin: externalDragDurationMin(unscheduled, task.time_estimate),
    };
  };
  const goalsFor             = (iso: string) => items.goals.filter((g) => g.deadline  === iso);
  const deadlinesFor         = (iso: string) => items.deadlines.filter((d) => d.due_date === iso);
  const courseAssignmentsFor = (iso: string) => items.course_assignments.filter((a) => a.due_date === iso);
  const scheduleEntriesFor   = (iso: string) => items.schedule_entries.filter((e) => e.date === iso);
  const trainingSessionsFor  = (iso: string) => items.training_sessions.filter((s) => s.scheduled_date === iso);
  const blocksFor            = (iso: string) => calBlocks.filter((b) => b.date === iso);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleToggleTask = async (id: number) => {
    await toggleTask(id);
    setItems((prev) => ({ ...prev, tasks: prev.tasks.map((t) => t.id === id ? { ...t, done: !t.done } : t) }));
  };

  const handleCreateTask = async (d: TaskDraft) => {
    await createTask({ title: d.title, plan_id: Number(d.plan_id), priority: d.priority, due_date: d.due_date || null });
    setModal(null); load();
  };

  const handleEditTask = async (task: TaskWithContext, d: TaskDraft) => {
    await updateTask(task.id, { title: d.title, priority: d.priority, due_date: d.due_date || null });
    setModal(null); load();
  };

  const handleDeleteTask = async (id: number) => { await deleteTask(id); setModal(null); load(); };

  const handleCreateGoal = async (d: GoalDraft) => {
    await createGoal({ title: d.title, priority: d.priority, deadline: d.deadline || null, description: d.description || null });
    setModal(null); load();
  };

  const handleEditGoal = async (goal: Goal, d: GoalDraft) => {
    await updateGoal(goal.id, { title: d.title, priority: d.priority, deadline: d.deadline || null, status: d.status, description: d.description || null });
    setModal(null); load();
  };

  const handleDeleteGoal = async (id: number) => { await deleteGoal(id); setModal(null); load(); };

  const handleCreatePlan = async (d: PlanDraft) => {
    await createPlan({ title: d.title, goal_id: d.goal_id ? Number(d.goal_id) : null, deadline: d.deadline || null, description: d.description || null });
    setModal(null); load();
  };

  const handleEditPlan = async (plan: Plan, d: PlanDraft) => {
    await updatePlan(plan.id, { title: d.title, goal_id: d.goal_id ? Number(d.goal_id) : null, deadline: d.deadline || null, status: d.status, description: null, is_course: plan.is_course });
    setModal(null); load();
  };

  const handleDeletePlan = async (id: number) => { await deletePlan(id); setModal(null); load(); };

  const handleCreateSystem = async (d: SystemDraft) => {
    await createSystem({ title: d.title, description: d.description || null, frequency: d.frequency, days_of_week: null, start_time: d.start_time || null, end_time: d.end_time || null });
    setModal(null); setSystems(await getSystems());
  };

  const handleEditSystem = async (sys: SystemEntry, d: SystemDraft) => {
    await updateSystem(sys.id, { title: d.title, description: d.description || null, frequency: d.frequency, days_of_week: sys.days_of_week, start_time: d.start_time || null, end_time: d.end_time || null });
    setModal(null); setSystems(await getSystems());
  };

  const handleDeleteSystem = async (id: number) => { await deleteSystem(id); setModal(null); setSystems(await getSystems()); };
  const handleMarkSystemDone = async (id: number) => { await markSystemDone(id); setSystems(await getSystems()); };

  const handleToggleAssignment = async (a: CourseAssignment) => {
    const newStatus = a.status === "done" ? "pending" : "done";
    const updated = await updateCourseAssignment(a.id, {
      plan_id: a.plan_id, title: a.title, assignment_type: a.assignment_type,
      due_date: a.due_date, status: newStatus, priority: a.priority,
      book_title: a.book_title, chapter_start: a.chapter_start, chapter_end: a.chapter_end,
      page_start: a.page_start, page_end: a.page_end, page_current: a.page_current,
      notes: a.notes, start_time: a.start_time, end_time: a.end_time,
    });
    setItems((prev) => ({
      ...prev,
      course_assignments: prev.course_assignments.map((x) => x.id === a.id ? updated : x),
    }));
  };

  const handleToggleDeadline = async (id: number) => {
    const updated = await toggleDeadline(id);
    setAllDeadlines((prev) => prev.map((d) => d.id === id ? updated : d));
  };
  const handleCreateBlock = async (d: BlockDraft) => {
    if (modal?.kind !== "create-block") return;
    const desc = d.description.trim() || null;
    const loc  = d.location.trim()    || null;
    if (d.is_recurring) {
      const dow = d.recurrence === "weekly" ? d.days_of_week.join(",") : null;
      await createRecurringCalBlock(d.title, d.start_time, d.end_time, d.color, d.recurrence, dow, modal.date, d.series_end_date || null, desc, loc, undefined, d.category);
      load();
    } else {
      let taskId = d.task_id;
      if (taskId === null) {
        const durationMin = timeToMinutes(d.end_time) - timeToMinutes(d.start_time);
        const newTask = await createTask({
          plan_id: null,
          title: d.title,
          time_estimate: durationMin > 0 ? durationMin : null,
          due_date: modal.date,
        });
        taskId = newTask.id;
        setAllTasks((prev) => [toTaskWithContext(newTask), ...prev]);
      }
      // A block created inside a parent (the "Add segment" flow) is silently
      // clamped into the parent's own span before it's saved — matching the
      // app's existing forgiving style (never blocking a save over a
      // slightly-out-of-range time).
      const parent = modal.parentBlock;
      const { start: st, end: et } = parent
        ? clampChildSpan(d.start_time, d.end_time, parent)
        : { start: d.start_time, end: d.end_time };
      const b = await createCalBlock(
        modal.date, d.title, st, et, d.color, desc, loc, taskId, d.category,
        parent?.id ?? null, blocksFor(modal.date),
      );
      setCalBlocks((prev) => [...prev, b]);
    }
    setModal(null);
  };

  const handleEditBlock = async (block: CalBlock, d: BlockDraft) => {
    const desc = d.description.trim() || null;
    const loc  = d.location.trim()    || null;
    if (block.is_recurring && block.recurring_id != null) {
      const dow = d.recurrence === "weekly" ? d.days_of_week.join(",") : null;
      await updateRecurringCalBlock(block.recurring_id, d.title, d.start_time, d.end_time, d.color, d.recurrence, dow, d.series_end_date || null, desc, loc, d.category);
      load();
    } else {
      // Editing never changes WHO a block's parent is (moving blocks between
      // parents is phase-2 drag work) — parentBlockId is simply never passed
      // to updateCalBlock here, so the omit-means-untouched rule leaves any
      // existing parent_block_id exactly as it was. If this block IS itself
      // someone's child, its own times still get the same silent clamp a
      // freshly-created segment gets.
      const parent = block.parent_block_id != null
        ? calBlocks.find((x) => x.id === block.parent_block_id) ?? null
        : null;
      const { start: st, end: et } = parent
        ? clampChildSpan(d.start_time, d.end_time, parent)
        : { start: d.start_time, end: d.end_time };
      const b = await updateCalBlock(block.id, d.title, st, et, d.color, desc, loc, d.task_id, d.category);
      setCalBlocks((prev) => prev.map((x) => x.id === block.id ? b : x));
    }
    setModal(null);
  };

  /**
   * Ticks a scheduled block off as worked, or un-ticks it.
   *
   * This is the step that closes the loop: the planner commits calendar time,
   * and this records that the time was actually spent. A session is what moves
   * sessions- and time-mode completion, so without it a recurring step could be
   * scheduled forever and never complete.
   *
   * The session is keyed to `block.id` — for a recurring series that is the
   * occurrence's virtual negative id, so ticking one Wednesday does not mark
   * every Wednesday. Minutes come from the block's own duration.
   */
  const handleToggleWorked = async (block: CalBlock) => {
    if (block.task_id == null) return;
    const existing = sessionsByBlock.get(block.id);

    // Optimistic: the tick must feel instant, and a failure re-syncs via load().
    setSessionsByBlock((prev) => {
      const next = new Map(prev);
      if (existing) next.delete(block.id);
      else next.set(block.id, {
        id: -1, task_id: block.task_id!, date: block.date,
        minutes: blockMinutes(block.start_time, block.end_time),
        cal_block_id: block.id, note: null, created_at: new Date().toISOString(),
      });
      return next;
    });

    try {
      if (existing) {
        await unlogTaskOccurrence(block.task_id, block.id);
      } else {
        await logTaskSession({
          task_id: block.task_id,
          date: block.date,
          minutes: blockMinutes(block.start_time, block.end_time),
          cal_block_id: block.id,
        });
      }
    } finally {
      load();
    }
  };

  const handleDeleteBlock = async (block: CalBlock) => {
    if (block.is_recurring && block.recurring_id != null) {
      await deleteRecurringCalBlock(block.recurring_id);
      load();
    } else {
      await deleteCalBlock(block.id);
      // The DB cascades the delete to every descendant (parent_block_id ON
      // DELETE CASCADE) — mirror that locally so a deleted parent's children
      // don't sit around as stale orphans (rendered top-level, per the
      // never-lose-a-block rule) until the next load().
      setCalBlocks((prev) => {
        const removed = new Set<number>([block.id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const b of prev) {
            if (b.parent_block_id != null && removed.has(b.parent_block_id) && !removed.has(b.id)) {
              removed.add(b.id);
              grew = true;
            }
          }
        }
        return prev.filter((b) => !removed.has(b.id));
      });
    }
    setModal(null);
  };

  /**
   * Commits a drag-resolved patch (move/resize/nest/unnest — U2 §2) exactly
   * the way every other handler above does: optimistic local update first,
   * then the API call, reverting via a full `load()` on failure (same
   * pattern `handleToggleWorked` uses) rather than hand-tracking a snapshot.
   * The interactions hook has already done all the geometry/clamp work by
   * the time this runs — this is purely the data layer.
   */
  const handleDragCommit = useCallback((block: CalBlock, patch: DragCommitPatch) => {
    setCalBlocks((prev) => prev.map((b) => (b.id === block.id ? { ...b, ...patch } : b)));
    updateCalBlock(
      block.id, block.title,
      patch.start_time ?? block.start_time,
      patch.end_time ?? block.end_time,
      block.color, block.description, block.location, block.task_id, block.category,
      patch.parent_block_id !== undefined ? patch.parent_block_id : undefined,
      calBlocks,
      patch.date,
    ).catch((e) => { console.error("drag commit failed, reloading", e); load(); });
  }, [calBlocks, load]);

  const handleDragClickSlot = useCallback(
    (date: string, time: string) => setModal({ kind: "create-block", date, startTime: time }),
    [],
  );

  /**
   * Commits an external drag-to-schedule drop (U3 Part A) — dragging a task
   * from RightPanel or an all-day TaskPopupChip onto the grid. Same
   * optimistic-insert-then-reload-on-error shape as `handleDragCommit`
   * above, with one addition: it reloads on SUCCESS too (not only on
   * failure), because unlike a move/resize this creates a new commitment
   * against a task — `taskCoverage` (the map behind "Xh booked" on every
   * chip/popup, and the board's own scheduling gate) has no local optimistic
   * update path, so it's stale until the next `load()` regardless of outcome.
   *
   * The optimistic block uses a large negative temp id — distinct from both
   * real rows (positive) and virtual recurring occurrences (bounded negative
   * ids derived from `recurring_id × 100000 + dayOffset`) — purely for the
   * brief window before `load()` replaces it with the server's row.
   */
  const handleExternalDrop = (payload: ExternalDragPayload, dest: ExternalDropDest) => {
    const tempId = -Date.now();
    const temp: CalBlock = {
      id: tempId, date: dest.date, title: payload.title, start_time: dest.startTime, end_time: dest.endTime,
      color: "blue", description: null, location: null, created_at: new Date().toISOString(),
      is_recurring: false, recurring_id: null, recurrence: null, days_of_week: null,
      series_start_date: null, series_end_date: null, task_id: payload.taskId, category: null,
      parent_block_id: dest.parentBlockId,
    };
    setCalBlocks((prev) => [...prev, temp]);
    createCalBlock(
      dest.date, payload.title, dest.startTime, dest.endTime, "blue", null, null,
      payload.taskId, null, dest.parentBlockId, blocksFor(dest.date),
    )
      .then(() => load())
      .catch((e) => {
        console.error("external drag drop failed, reloading", e);
        setCalBlocks((prev) => prev.filter((b) => b.id !== tempId));
        load();
      });
  };

  const { interactions } = useWeekInteractions({
    hourPx,
    calBlocks,
    scrollContainerRef: gridRef,
    onClickSlot: handleDragClickSlot,
    onCommitBlock: handleDragCommit,
    onExternalDrop: handleExternalDrop,
  });

  // ── Zoom + horizontal week-nav wheel handling (U2 §1, §3) ──────────────────
  //
  // ctrl/meta-wheel (also how browsers deliver trackpad pinch) zooms,
  // anchoring the minute currently under the cursor so the grid doesn't jump.
  // A dominant horizontal wheel (trackpad two-finger horizontal swipe)
  // navigates prev/next week, debounced so one gesture moves exactly one
  // week — everything else (plain vertical wheel) is left to fall through to
  // native scrolling, untouched.
  const hDeltaAccum = useRef(0);
  const hNavCooldownUntil = useRef(0);
  // A plain `onWheel` JSX prop is a React SYNTHETIC handler, and React 17+
  // registers its delegated wheel listener as PASSIVE by default (matching
  // the browser's own default for wheel/touch) — `e.preventDefault()` inside
  // one is silently a no-op. Verified live: dispatching a ctrl-wheel through
  // the normal event path updated hourPx correctly but left
  // `event.defaultPrevented === false`. Without a real preventDefault, ctrl/
  // meta-wheel would zoom the grid AND the browser's native page zoom at the
  // same time. A native listener registered with `{ passive: false }`
  // (below) is the only way to actually cancel it.
  const handleGridWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const container = gridRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const cursorYInGrid = e.clientY - rect.top + container.scrollTop;
      const minuteUnderCursor = pxToMinutes(cursorYInGrid, hourPx);
      const next = zoomHourPx(hourPx, e.deltaY);
      if (next === hourPx) return;
      const distFromTop = e.clientY - rect.top;
      setHourPx(next);
      requestAnimationFrame(() => {
        if (!gridRef.current) return;
        gridRef.current.scrollTop = minutesToPx(minuteUnderCursor, next) - distFromTop;
      });
      return;
    }
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      hDeltaAccum.current += e.deltaX;
      const now = performance.now();
      if (now < hNavCooldownUntil.current) return;
      if (Math.abs(hDeltaAccum.current) > 120) {
        const dir = hDeltaAccum.current > 0 ? 1 : -1;
        hDeltaAccum.current = 0;
        hNavCooldownUntil.current = now + 400;
        if (dir > 0) nextWeek(); else prevWeek();
      }
    } else {
      hDeltaAccum.current = 0;
    }
  }, [hourPx, setHourPx]);

  useEffect(() => {
    const el = gridRef.current;
    if (!el || view !== "week" || isMobile) return;
    el.addEventListener("wheel", handleGridWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleGridWheel);
  }, [handleGridWheel, view, isMobile]);

  // ── Header label ─────────────────────────────────────────────────────────────

  const headerLabel = view === "month"
    ? `${MONTHS[monthStart.getMonth()]} ${monthStart.getFullYear()}`
    : (() => {
        const s = sun; const e = days[6];
        if (s.getMonth() === e.getMonth())
          return `${MONTHS[s.getMonth()]} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`;
        return `${MONTHS[s.getMonth()]} ${s.getDate()} – ${MONTHS[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
      })();

  const handlePrev = view === "week" ? prevWeek : prevMonth;
  const handleNext = view === "week" ? nextWeek : nextMonth;

  const panelBtn = (active: boolean) =>
    cn("p-1 rounded transition-colors", active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground");

  // Mobile timeline ref — used only in mobile view but must be declared unconditionally (Rules of Hooks)
  const mobileTimelineRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isMobile && mobileTimelineRef.current) {
      mobileTimelineRef.current.scrollTop = (DEFAULT_SCROLL_HOUR - HOUR_START) * HOUR_PX;
    }
  }, [isMobile, selectedDay]);

  // Shared modal JSX used by both mobile and desktop branches
  function renderModals() {
    return (
      <>
        {modal?.kind === "pick" && (
          <TypePickerModal date={modal.date}
            onPick={(type) => setModal({ kind: `create-${type}` as "create-task" | "create-goal" | "create-plan", date: modal.date })}
            onClose={() => setModal(null)} />
        )}
        {modal?.kind === "create-block" && (
          <CalBlockModal date={modal.date} startTime={modal.startTime} tasks={allTasks} categories={categories}
            taskCoverage={taskCoverage} dayBlocks={blocksFor(modal.date)}
            parentBlock={modal.parentBlock} presetTitle={modal.presetTitle} presetTaskId={modal.presetTaskId}
            onSave={handleCreateBlock} onClose={() => setModal(null)} />
        )}
        {modal?.kind === "edit-block" && (
          <CalBlockModal initial={modal.block} date={modal.block.date} startTime={modal.block.start_time} tasks={allTasks} categories={categories}
            taskCoverage={taskCoverage} dayBlocks={blocksFor(modal.block.date)}
            onSave={(d) => handleEditBlock(modal.block, d)}
            onDelete={() => handleDeleteBlock(modal.block)}
            onClose={() => setModal(null)}
            // Nesting is never offered on a recurring block or a virtual
            // (negative-id) occurrence — see the header-zone rule that
            // recurring blocks never nest.
            onAddSegment={!modal.block.is_recurring && modal.block.id > 0
              ? () => setModal({
                  kind: "create-block", date: modal.block.date, startTime: modal.block.start_time,
                  parentBlock: modal.block,
                })
              : undefined}
          />
        )}
        {modal?.kind === "create-task" && (
          <TaskModal date={modal.date} plans={allPlans} onSave={handleCreateTask} onClose={() => setModal(null)} />
        )}
        {modal?.kind === "edit-task" && (
          <TaskModal initial={modal.task} date={modal.task.due_date ?? today} plans={allPlans}
            onSave={(d) => handleEditTask(modal.task, d)}
            onDelete={() => handleDeleteTask(modal.task.id)}
            onClose={() => setModal(null)} />
        )}
        {modal?.kind === "create-goal" && (
          <GoalModal date={modal.date} onSave={handleCreateGoal} onClose={() => setModal(null)} />
        )}
        {modal?.kind === "edit-goal" && (
          <GoalModal initial={modal.goal} date={modal.goal.deadline ?? today}
            onSave={(d) => handleEditGoal(modal.goal, d)}
            onDelete={() => handleDeleteGoal(modal.goal.id)}
            onClose={() => setModal(null)} />
        )}
        {modal?.kind === "create-plan" && (
          <PlanModal date={modal.date} goals={allGoals} onSave={handleCreatePlan} onClose={() => setModal(null)} />
        )}
        {modal?.kind === "edit-plan" && (
          <PlanModal initial={modal.plan} date={modal.plan.deadline ?? today} goals={allGoals}
            onSave={(d) => handleEditPlan(modal.plan, d)}
            onDelete={() => handleDeletePlan(modal.plan.id)}
            onClose={() => setModal(null)} />
        )}
        {modal?.kind === "create-system" && (
          <SystemModal onSave={handleCreateSystem} onClose={() => setModal(null)} />
        )}
        {modal?.kind === "edit-system" && (
          <SystemModal initial={modal.system}
            onSave={(d) => handleEditSystem(modal.system, d)}
            onDelete={() => handleDeleteSystem(modal.system.id)}
            onClose={() => setModal(null)} />
        )}
      </>
    );
  }

  // ── Mobile week view ──────────────────────────────────────────────────────────
  if (isMobile) {
    const selDate   = new Date(selectedDay + "T00:00:00");
    const selGoals  = goalsFor(selectedDay);
    const selTasks  = tasksFor(selectedDay);
    const selDL     = deadlinesFor(selectedDay);
    const selCAAll  = courseAssignmentsFor(selectedDay);
    const selCAAllDay = selCAAll.filter((a) => !a.start_time);
    const selectedLabel = `${DAY_NAMES[selDate.getDay()]}, ${MONTHS[selDate.getMonth()]} ${selDate.getDate()}`;
    const hasAllDay = selGoals.length + selTasks.length + selDL.length + selCAAll.length > 0;

    return (
      <div className="flex flex-col h-[calc(100vh-2.5rem)] overflow-hidden">

        {/* Mobile nav header */}
        <div className="h-11 flex items-center justify-between px-4 border-b border-border shrink-0 bg-background">
          <button onClick={prevWeek} className="p-1 rounded hover:bg-accent">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="text-sm font-medium">{headerLabel}</span>
          <button onClick={nextWeek} className="p-1 rounded hover:bg-accent">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {/* Day strip */}
        <div className="flex border-b border-border shrink-0 bg-card">
          {days.map((day) => {
            const iso = toISO(day);
            const isToday    = iso === today;
            const isSelected = iso === selectedDay;
            const dayAbbr = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][day.getDay()];
            return (
              <button
                key={iso}
                onClick={() => setSelectedDay(iso)}
                className={`flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors ${
                  isSelected ? "text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                <span className="text-[11px] font-medium">{dayAbbr}</span>
                <span className={`w-7 h-7 flex items-center justify-center rounded-full text-sm font-semibold ${
                  isSelected ? "bg-primary text-primary-foreground" : isToday ? "text-primary font-bold" : ""
                }`}>{day.getDate()}</span>
                {isToday && !isSelected && <span className="w-1 h-1 rounded-full bg-primary" />}
              </button>
            );
          })}
        </div>

        {/* Selected day label */}
        <div className="shrink-0 px-4 py-1.5 border-b border-border/40 bg-card/50">
          <span className="text-xs font-medium text-muted-foreground">{selectedLabel}</span>
        </div>

        {/* All-day items for selected day */}
        {hasAllDay && (
          <div className="shrink-0 px-3 py-2 border-b border-border bg-card/30 flex flex-col gap-1 max-h-28 overflow-y-auto">
            {selGoals.map((g) => (
              <button key={`g-${g.id}`} onClick={() => setModal({ kind: "edit-goal", goal: g })}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-left w-full bg-blue-500/10 border border-blue-500/20 transition-colors">
                <Target className="h-3 w-3 text-blue-500 shrink-0" />
                <span className="text-xs text-foreground truncate">{g.title}</span>
              </button>
            ))}
            {selTasks.map((t) => (
              <TaskPopupChip key={`t-${t.id}`} t={t} {...chipProps(t)}
                onToggle={() => handleToggleTask(t.id)}
                onEdit={() => setModal({ kind: "edit-task", task: t })} />
            ))}
            {selDL.map((d) => (
              <div key={`dl-${d.id}`}
                className={cn("flex items-center gap-1.5 px-2 py-1 rounded border",
                  d.done ? "bg-secondary/40 border-border/40" : "bg-red-500/10 border-red-400/40")}>
                <Flag className={cn("h-3 w-3 shrink-0", d.done ? "text-muted-foreground" : "text-red-500")} />
                <span className={cn("text-xs truncate", d.done ? "line-through text-muted-foreground" : "text-foreground")}>{d.title}</span>
              </div>
            ))}
            {selCAAllDay.map((a) => (
              <div key={`ca-${a.id}`}
                className="flex items-center gap-1.5 px-2 py-1 rounded border bg-indigo-500/10 border-indigo-400/40">
                <GraduationCap className="h-3 w-3 shrink-0 text-indigo-500" />
                <span className="text-xs truncate text-foreground">{a.title}</span>
              </div>
            ))}
          </div>
        )}

        {/* Scrollable time grid — reuses TimeColumn for event rendering */}
        <div ref={mobileTimelineRef} className="flex-1 overflow-y-auto">
          <div className="flex" style={{ height: HOURS.length * HOUR_PX + 1 }}>
            <div className="w-12 shrink-0 relative select-none">
              {HOURS.map((h, i) => (
                <div key={h} className="absolute right-2 text-[10px] text-muted-foreground/60 tabular-nums"
                  style={{ top: i * HOUR_PX - 6 }}>
                  {h}:00
                </div>
              ))}
            </div>
            <TimeColumn
              date={selDate}
              isToday={selectedDay === today}
              blocks={blocksFor(selectedDay)}
              systems={systems}
              courseAssignments={selCAAll}
              scheduleEntries={scheduleEntriesFor(selectedDay)}
              sleepSpans={sleepByDate.get(selectedDay)}
              categories={categories}
              sessionsByBlock={sessionsByBlock}
              hourPx={HOUR_PX}
              onClickSlot={(date, time) => setModal({ kind: "create-block", date, startTime: time })}
              onClickBlock={(b) => setModal({ kind: "edit-block", block: b })}
              onToggleWorked={handleToggleWorked}
            />
          </div>
        </div>

        {renderModals()}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-2.5rem)] overflow-hidden">

      {/* ── Nav header ───────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <button onClick={handlePrev} className="p-1 rounded hover:bg-secondary transition-colors">
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          </button>
          <button onClick={handleNext} className="p-1 rounded hover:bg-secondary transition-colors">
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
          <span className="text-sm font-medium text-foreground">{headerLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Panel toggles */}
          <div className="flex items-center gap-0.5 mr-1">
            <button onClick={toggleHeader} title="Toggle header panel" className={panelBtn(showHeader)}>
              <PanelTop className="h-4 w-4" />
            </button>
            <button onClick={toggleLeft} title="Toggle left panel" className={panelBtn(showLeft)}>
              <PanelLeft className="h-4 w-4" />
            </button>
            <button onClick={toggleRight} title="Toggle right panel" className={panelBtn(showRight)}>
              <PanelRight className="h-4 w-4" />
            </button>
            <button onClick={toggleFooter} title="Toggle systems bar" className={panelBtn(showFooter)}>
              <PanelBottom className="h-4 w-4" />
            </button>
          </div>
          <div className="w-px h-4 bg-border" />
          {/* View toggle */}
          <div className="flex rounded-md border border-border overflow-hidden">
            {(["week", "month"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={cn("px-3 py-1 text-xs font-medium transition-colors capitalize",
                  view === v ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                )}>
                {v}
              </button>
            ))}
          </div>
          {/* Zoom reset — only visible once the grid has actually been
              zoomed away from the default scale (U2 §1). */}
          {view === "week" && hourPx !== HOUR_PX && (
            <button
              onClick={() => setHourPx(HOUR_PX)}
              title="Reset zoom to the default scale"
              className="rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              1×
            </button>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={goToday}>Today</Button>
          <div className="w-px h-4 bg-border" />
          {/* Actual-day overlay toggle */}
          <button
            onClick={toggleActual}
            title="Show actual day (sleep, screen, training) behind planned blocks"
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              showActual ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            Actual
          </button>
          {/* Sleep is always-on now, so its legend dot shows regardless of the toggle;
              Screen/Training stay behind it since they're the heavier fetch. */}
          <div className="flex items-center gap-2 pl-0.5">
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />Sleep</span>
            {showActual && (
              <>
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-sky-400" />Screen</span>
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Training</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Header panel ─────────────────────────────────────────────────── */}
      {showHeader && (
        <div className="flex items-center gap-4 pr-4">
          <div className="flex-1 min-w-0">
            <HeaderPanel items={items} today={today} days={days} view={view} />
          </div>
          {view === "week" && (
            <WeekTimeStrip
              days={days.map(toISO)}
              today={today}
              blocks={calBlocks}
              sessions={sessionsInRange}
            />
          )}
        </div>
      )}

      {/* ── Main content row ─────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* Left sidebar */}
        {showLeft && (
          <LeftPanel
            goals={allGoals}
            plans={allPlans}
            weekNote={weekNote}
            onNoteChange={setWeekNote}
            onEditGoal={(g) => setModal({ kind: "edit-goal", goal: g })}
            onEditPlan={(p) => setModal({ kind: "edit-plan", plan: p })}
          />
        )}

        {/* ── Calendar content ───────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {view === "month" ? (
          <MonthView
            monthStart={monthStart}
            calBlocks={calBlocks}
            items={items}
            today={today}
            onClickDay={(iso) => setModal({ kind: "create-block", date: iso, startTime: "09:00" })}
            onClickBlock={(b) => setModal({ kind: "edit-block", block: b })}
            onToggleTask={handleToggleTask}
            onEditGoal={(g) => setModal({ kind: "edit-goal", goal: g })}
          />
        ) : (
          <>
            {/* Day name headers */}
            <div className="shrink-0 flex border-b border-border bg-card">
              <div className="w-12 shrink-0" />
              {days.map((day) => {
                const iso = toISO(day);
                const isToday = iso === today;
                return (
                  <div key={iso} className={cn("flex-1 text-center py-2 border-r border-border", isToday && "bg-primary/5")}>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {DAY_NAMES[day.getDay()]}
                    </p>
                    <p className={cn("text-lg font-semibold leading-none mt-0.5", isToday ? "text-primary" : "text-foreground")}>
                      {day.getDate()}
                    </p>
                    <p className="text-xs text-muted-foreground">{MONTHS[day.getMonth()]}</p>
                  </div>
                );
              })}
            </div>

            {/* Shared all-day row */}
            <div className="shrink-0 flex border-b border-border bg-card/50 overflow-y-auto" style={{ maxHeight: 96 }}>
              <div className="w-12 shrink-0 flex items-start justify-end pr-1.5 pt-1">
                <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wide">all-day</span>
              </div>
              {days.map((day) => {
                const iso = toISO(day);
                const isToday = iso === today;
                const dayGoals    = goalsFor(iso);
                const dayTasks    = tasksFor(iso);
                const dayDL       = deadlinesFor(iso);
                const dayCA       = courseAssignmentsFor(iso);
                const daySE       = scheduleEntriesFor(iso).filter((e) => !e.start_time);
                const dayTS       = trainingSessionsFor(iso);
                const hasItems = dayGoals.length + dayTasks.length + dayDL.length + dayCA.length + daySE.length + dayTS.length > 0;
                return (
                  <div key={iso}
                    className={cn("flex-1 min-w-0 border-r border-border p-0.5 flex flex-col gap-0.5",
                      isToday && "bg-primary/[0.03]",
                      !hasItems && "min-h-[1.75rem]"
                    )}>
                    {dayGoals.map((g) => (
                      <button key={`g-${g.id}`} onClick={() => setModal({ kind: "edit-goal", goal: g })}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-left w-full bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 transition-colors">
                        <Target className="h-2.5 w-2.5 text-blue-500 shrink-0" />
                        <span className="text-[11px] text-foreground truncate">{g.title}</span>
                      </button>
                    ))}
                    {dayTasks.map((t) => (
                      <TaskPopupChip
                        key={`t-${t.id}`}
                        t={t}
                        {...chipProps(t)}
                        interactions={interactions}
                        dragPayload={computeDragPayload(t)}
                        onToggle={() => handleToggleTask(t.id)}
                        onEdit={() => setModal({ kind: "edit-task", task: t })}
                      />
                    ))}
                    {dayDL.map((d) => (
                      <div key={`dl-${d.id}`}
                        className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded border",
                          d.done ? "bg-secondary/40 border-border/40" : "bg-red-500/10 border-red-400/40")}>
                        <Flag className={cn("h-2.5 w-2.5 shrink-0", d.done ? "text-muted-foreground" : "text-red-500")} />
                        <span className={cn("text-[11px] truncate", d.done ? "line-through text-muted-foreground" : "text-foreground")}>{d.title}</span>
                      </div>
                    ))}
                    {dayCA.map((a) => (
                      <div key={`ca-${a.id}`}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded border bg-indigo-500/10 border-indigo-400/40">
                        <GraduationCap className="h-2.5 w-2.5 shrink-0 text-indigo-500" />
                        <span className="text-[11px] truncate text-foreground">{a.title}</span>
                      </div>
                    ))}
                    {daySE.map((e) => {
                      const clr = BLOCK_COLORS[e.color] ?? BLOCK_COLORS.teal;
                      return (
                        <div key={`se-${e.id}`}
                          className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded border", clr.bg, clr.border)}>
                          <CalendarRange className={cn("h-2.5 w-2.5 shrink-0", clr.text)} />
                          <span className={cn("text-[11px] truncate", clr.text)}>{e.title}</span>
                        </div>
                      );
                    })}
                    {dayTS.map((s) => {
                      const typeColors: Record<string, string> = {
                        running:  "bg-emerald-500/10 border-emerald-400/40 text-emerald-700",
                        strength: "bg-orange-500/10 border-orange-400/40 text-orange-700",
                        yoga:     "bg-violet-500/10 border-violet-400/40 text-violet-700",
                        other:    "bg-slate-500/10 border-slate-400/40 text-slate-600",
                      };
                      const typeIcons: Record<string, string> = { running: "🏃", strength: "🏋️", yoga: "🧘", other: "⚡" };
                      const cls = typeColors[s.plan_type ?? "other"] ?? typeColors.other;
                      return (
                        <div key={`ts-${s.id}`}
                          className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded border", cls)}>
                          <span className="text-xs leading-none shrink-0">{typeIcons[s.plan_type ?? "other"] ?? "⚡"}</span>
                          <span className={cn("text-[11px] truncate", s.completed && "line-through opacity-60")}>{s.title}</span>
                          {s.start_time && <span className="text-[9px] opacity-60 shrink-0 ml-auto">{s.start_time.slice(0,5)}</span>}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Scrollable time area */}
            <div ref={gridRef} className="flex-1 overflow-y-auto">
              <div className="flex" style={{ height: HOURS.length * hourPx + 1 }}>

                {/* Time labels */}
                <div className="w-12 shrink-0 relative select-none">
                  {HOURS.map((h, i) => (
                    <div key={h} className="absolute right-2 text-[10px] text-muted-foreground/60 tabular-nums"
                      style={{ top: i * hourPx - 6 }}>
                      {h}:00
                    </div>
                  ))}
                </div>

                {/* Day columns */}
                {days.map((day) => {
                  const iso = toISO(day);
                  return (
                    <TimeColumn
                      key={iso}
                      date={day}
                      isToday={iso === today}
                      blocks={blocksFor(iso)}
                      systems={systems}
                      courseAssignments={items.course_assignments.filter((a) => a.due_date === iso)}
                      scheduleEntries={scheduleEntriesFor(iso)}
                      actual={showActual ? actualByDate.get(iso) : undefined}
                      sleepSpans={sleepByDate.get(iso)}
                      categories={categories}
                      sessionsByBlock={sessionsByBlock}
                      hourPx={hourPx}
                      interactions={interactions}
                      onClickSlot={(date, time) => setModal({ kind: "create-block", date, startTime: time })}
                      onClickBlock={(b) => setModal({ kind: "edit-block", block: b })}
                      onToggleWorked={handleToggleWorked}
                    />
                  );
                })}
              </div>
            </div>
          </>
        )}
        </div>{/* end calendar content */}

        {/* Right sidebar */}
        {showRight && (
          <RightPanel
            tasks={items.tasks}
            deadlines={allDeadlines}
            courseAssignments={items.course_assignments}
            today={today}
            interactions={interactions}
            getDragPayload={computeDragPayload}
            onToggleTask={handleToggleTask}
            onToggleDeadline={handleToggleDeadline}
            onToggleAssignment={handleToggleAssignment}
          />
        )}

      </div>{/* end main content row */}

      {/* ── Systems bar (toggleable footer) ─────────────────────────────── */}
      {showFooter && (
        <SystemsBar
          systems={systems}
          onMarkDone={handleMarkSystemDone}
          onAdd={() => setModal({ kind: "create-system" })}
          onEdit={(s) => setModal({ kind: "edit-system", system: s })}
        />
      )}

      {view === "week" && (
        <>
          <DragGhostLayer subscribe={interactions.subscribeGhost} getSnapshot={interactions.getGhostSnapshot} />
          <ExternalDragGhostLayer subscribe={interactions.subscribeExternalGhost} getSnapshot={interactions.getExternalGhostSnapshot} />
        </>
      )}

      {renderModals()}
    </div>
  );
}
