// The dashboard page: state, data loading, and the layout that arranges the
// day's surfaces.
//
// The components themselves live in components/dashboard/. This file was 2,471
// lines with all five of them inline, which meant every change to the task list
// and every change to the day calendar edited the same file.

import { useEffect, useState, useCallback, useMemo } from "react";
import { PanelRight, PanelRightClose } from "lucide-react";
import { getGoals, getPlans, getAllTasks, getSystems, toggleTask, createTask, updateTask, deleteTask, toTaskWithContext, getTaskSessionsInRange, logTaskSession, unlogTaskOccurrence, getCalBlocks, createCalBlock, updateCalBlock, deleteCalBlock, getDailyGoals, setDailyPrimaryGoal, clearDailyPrimaryGoal, addDailySecondaryGoal, updateDailySecondaryGoal, deleteDailySecondaryGoal, getCourseAssignments, updateCourseAssignment, getScheduleEntriesForDate, getHabitsForDate, toggleHabitCompletion, getHabitStacks, getTrainingSessionsForDate } from "../lib/api";
import { blockMinutes } from "../lib/taskTree";
import type { Goal, Plan, TaskWithContext, SystemEntry, CalBlock, DailyGoals, DailyPrimaryGoal, CourseAssignment, ScheduleEntry, HabitWithCompletion, HabitStack, TrainingSession, TaskSession } from "../types";
import { DCBlockDraft, timeToMin, todayDate } from "../components/dashboard/_shared";
import { DayCalendar } from "../components/dashboard/DayCalendar";
import { HabitsStrip } from "../components/dashboard/HabitsStrip";
import { WelcomeBox } from "../components/dashboard/WelcomeBox";
import { TodoList } from "../components/dashboard/TodoList";
import { NowPanel } from "../components/dashboard/NowPanel";
import { TaskPlanner } from "../components/workspace/TaskPlanner";
import { nextUp, needsScheduling } from "../lib/nextUp";

export function Dashboard() {
  const [goals,      setGoals]      = useState<Goal[]>([]);
  const [plans,      setPlans]      = useState<Plan[]>([]);
  const [tasks,      setTasks]      = useState<TaskWithContext[]>([]);
  const [systems,    setSystems]    = useState<SystemEntry[]>([]);
  const [calBlocks,  setCalBlocks]  = useState<CalBlock[]>([]);
  // Sessions logged against today's calendar occurrences, keyed by cal_block_id.
  const [sessionsByBlock, setSessionsByBlock] = useState<Map<number, TaskSession>>(new Map());
  const [dailyGoals, setDailyGoals] = useState<DailyGoals>({ primary: null, secondary: [] });
  const [courseAssignments, setCourseAssignments] = useState<CourseAssignment[]>([]);
  const [scheduleEntries,  setScheduleEntries]  = useState<ScheduleEntry[]>([]);
  const [habits,           setHabits]           = useState<HabitWithCompletion[]>([]);
  const [habitStacks,      setHabitStacks]      = useState<HabitStack[]>([]);
  const [todaySessions,    setTodaySessions]    = useState<TrainingSession[]>([]);

  const date = todayDate();

  // Goal done-state — lifted here so WelcomeBox pie chart stays in sync
  const lsKey = `daily_goals_done_${date}`;
  const [goalPrimaryDone, setGoalPrimaryDone] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem(`daily_goals_done_${todayDate()}`) ?? "{}").primary === true; }
    catch { return false; }
  });
  const [goalSecDone, setGoalSecDone] = useState<Set<number>>(() => {
    try { return new Set<number>(JSON.parse(localStorage.getItem(`daily_goals_done_${todayDate()}`) ?? "{}").secondary ?? []); }
    catch { return new Set(); }
  });

  function persistGoalDone(primary: boolean, sec: Set<number>) {
    localStorage.setItem(lsKey, JSON.stringify({ primary, secondary: [...sec] }));
  }
  function handleTogglePrimaryDone() {
    const next = !goalPrimaryDone;
    setGoalPrimaryDone(next);
    persistGoalDone(next, goalSecDone);
  }
  function handleToggleSecDone(id: number) {
    const next = new Set(goalSecDone);
    next.has(id) ? next.delete(id) : next.add(id);
    setGoalSecDone(next);
    persistGoalDone(goalPrimaryDone, next);
  }

  const load = useCallback(async () => {
    // The six side-tools (reminders, notes, brain dump, events, deadlines,
    // agreements) are no longer loaded here — they live in the sidebar and fetch
    // their own data on first open. See components/QuickPanels.tsx.
    const [g, p, t, s, cb, dg, cas, ses, hb, hs, ts, wk] = await Promise.all([
      getGoals(), getPlans(), getAllTasks(), getSystems(), getCalBlocks(date, date),
      getDailyGoals(date),
      getCourseAssignments(), getScheduleEntriesForDate(date), getHabitsForDate(date), getHabitStacks(),
      getTrainingSessionsForDate(date), getTaskSessionsInRange(date, date),
    ]);
    setGoals(g); setPlans(p); setTasks(t); setSystems(s); setCalBlocks(cb);
    setDailyGoals(dg);
    setCourseAssignments(cas.filter((ca) => ca.due_date === date));
    setScheduleEntries(ses);
    setHabits(hb);
    setHabitStacks(hs);
    setTodaySessions(ts);
    setSessionsByBlock(new Map(
      wk.filter((x) => x.cal_block_id != null).map((x) => [x.cal_block_id!, x]),
    ));
  }, [date]);

  useEffect(() => { load(); }, [load]);

  // ── Day-calendar rail: collapsible + drag-resizable ───────────────────────
  const RAIL_MIN = 220, RAIL_MAX = 620, RAIL_DEFAULT = 288;
  const [railOpen, setRailOpen] = useState(
    () => localStorage.getItem("pf-dash-rail-open") !== "0",
  );
  const [railWidth, setRailWidth] = useState(() => {
    const v = Number(localStorage.getItem("pf-dash-rail-w"));
    return Number.isFinite(v) && v >= RAIL_MIN && v <= RAIL_MAX ? v : RAIL_DEFAULT;
  });

  useEffect(() => { localStorage.setItem("pf-dash-rail-open", railOpen ? "1" : "0"); }, [railOpen]);
  useEffect(() => { localStorage.setItem("pf-dash-rail-w", String(railWidth)); }, [railWidth]);

  /**
   * Drag the divider to resize.
   *
   * Width is read from the pointer's distance to the window's right edge rather
   * than accumulated deltas — accumulating drifts whenever a move event is
   * coalesced or the clamp bites, so the handle slowly desyncs from the cursor.
   * Pointer capture keeps the drag alive when the cursor outruns the 4px handle.
   */
  const startResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();

    // Listeners go on `window`, not on the handle with setPointerCapture.
    // Capture retargets events to the element in theory, but in practice moves
    // went missing and the rail barely tracked the cursor. Window listeners are
    // the conventional shape here and also keep the drag alive when the pointer
    // outruns the handle or leaves the viewport entirely.
    const onMove = (ev: PointerEvent) => {
      setRailWidth(Math.min(RAIL_MAX, Math.max(RAIL_MIN, window.innerWidth - ev.clientX)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    // Without these, dragging selects the text it sweeps over and the cursor
    // flickers back to a caret whenever it crosses the content.
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);

  // Today's calendar commitments, grouped by the task they belong to. Dashboard
  // already loads exactly one day of blocks, so "scheduled today" is free — no
  // extra query for the unfolded task overview.
  const blocksByTask = useMemo(() => {
    const m = new Map<number, CalBlock[]>();
    for (const b of calBlocks) {
      if (b.task_id == null) continue;
      const bucket = m.get(b.task_id);
      if (bucket) bucket.push(b); else m.set(b.task_id, [b]);
    }
    for (const list of m.values()) list.sort((a, b) => a.start_time.localeCompare(b.start_time));
    return m;
  }, [calBlocks]);

  const workedBlockIds = useMemo(() => new Set(sessionsByBlock.keys()), [sessionsByBlock]);

  // "What should I work on right now" — ranking lives in lib/nextUp.ts.
  // nowMinutes is state rather than a Date read at render, so the panel
  // re-ranks as the day moves instead of freezing at first paint.
  const [nowMinutes, setNowMinutes] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNowMinutes(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const nowItems = useMemo(
    () => nextUp({ tasks, blocksByTask, workedBlockIds, today: date, nowMinutes }),
    [tasks, blocksByTask, workedBlockIds, date, nowMinutes],
  );
  const blocked = useMemo(
    () => needsScheduling({ tasks, blocksByTask, workedBlockIds, today: date }),
    [tasks, blocksByTask, workedBlockIds, date],
  );

  // The planner is mounted here, not just on the Workspace board. Breaking a
  // task down, setting its axes, committing time and choosing what "done" means
  // all lived one page away from where the day is actually spent, which is why
  // none of it was getting used.
  const [plannerId, setPlannerId] = useState<number | null>(null);

  // Quick tasks (reminders / chores / shopping) are standing lists — they show
  // regardless of due date, unlike project tasks which only surface on their day.
  const todayTasks   = useMemo(
    () => tasks.filter((t) => t.due_date === date || t.category != null),
    [tasks, date],
  );

  const handleToggleTask = async (id: number) => {
    await toggleTask(id);
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, done: !t.done } : t));
  };

  const handleCreateTask = async (payload: { plan_id?: number | null; title: string; priority?: string; due_date?: string | null; category?: string | null }) => {
    await createTask(payload);
    const t = await getAllTasks();
    setTasks(t);
  };

  const handleDeleteTask = async (id: number) => {
    await deleteTask(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const handleUpdateTask = async (id: number, payload: { title: string; priority: string; due_date?: string | null; category?: string | null }) => {
    await updateTask(id, payload);
    const t = await getAllTasks();
    setTasks(t);
  };

  const handleSetPrimary = async (payload: DailyPrimaryGoal) => {
    await setDailyPrimaryGoal(date, payload);
    setDailyGoals((prev) => ({ ...prev, primary: payload }));
  };
  const handleClearPrimary = async () => {
    await clearDailyPrimaryGoal(date);
    setDailyGoals((prev) => ({ ...prev, primary: null }));
  };
  const handleAddSecondary = async (text: string) => {
    const g = await addDailySecondaryGoal(date, text);
    setDailyGoals((prev) => ({ ...prev, secondary: [...prev.secondary, g] }));
  };
  const handleUpdateSecondaryEstimate = async (id: number, min: number | null) => {
    await updateDailySecondaryGoal(id, { time_estimate_min: min });
    setDailyGoals((prev) => ({
      ...prev,
      secondary: prev.secondary.map((s) => s.id === id ? { ...s, time_estimate_min: min } : s),
    }));
  };
  const handleDeleteSecondary = async (id: number) => {
    await deleteDailySecondaryGoal(id);
    setDailyGoals((prev) => ({ ...prev, secondary: prev.secondary.filter((s) => s.id !== id) }));
  };


  const handleToggleAssignment = async (ca: CourseAssignment) => {
    const newStatus = ca.status === "done" ? "pending" : "done";
    const updated = await updateCourseAssignment(ca.id, {
      plan_id: ca.plan_id, title: ca.title, assignment_type: ca.assignment_type,
      due_date: ca.due_date, status: newStatus, priority: ca.priority,
      book_title: ca.book_title, chapter_start: ca.chapter_start, chapter_end: ca.chapter_end,
      page_start: ca.page_start, page_end: ca.page_end, page_current: ca.page_current,
      notes: ca.notes, start_time: ca.start_time, end_time: ca.end_time,
    });
    setCourseAssignments((prev) => prev.map((x) => x.id === ca.id ? updated : x));
  };

  const handleToggleHabit = async (id: number) => {
    const nowDone = await toggleHabitCompletion(id, date);
    setHabits((prev) => prev.map((h) => h.id === id ? { ...h, done: nowDone } : h));
  };

  /**
   * Ticks a scheduled block off as worked, or un-ticks it.
   *
   * Mirrors Week's handler: the session is keyed to `block.id`, which for a
   * recurring occurrence is its virtual negative id, so one day's tick doesn't
   * mark the whole series. This is what advances sessions- and time-mode
   * completion — without it a recurring step never finishes.
   */
  const handleToggleWorked = async (block: CalBlock) => {
    if (block.task_id == null) return;
    const existing = sessionsByBlock.get(block.id);

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

  const handleCreateCalBlock = async (d: DCBlockDraft) => {
    let taskId = d.task_id;
    if (taskId === null) {
      const durationMin = timeToMin(d.end_time) - timeToMin(d.start_time);
      const newTask = await createTask({
        plan_id: null, title: d.title,
        time_estimate: durationMin > 0 ? durationMin : null,
        due_date: date,
      });
      taskId = newTask.id;
      setTasks((prev) => [toTaskWithContext(newTask), ...prev]);
    }
    const b = await createCalBlock(date, d.title, d.start_time, d.end_time, d.color, d.description || null, d.location || null, taskId);
    setCalBlocks((prev) => [...prev, b].sort((a, x) => a.start_time.localeCompare(x.start_time)));
  };
  const handleUpdateCalBlock = async (id: number, d: DCBlockDraft) => {
    const b = await updateCalBlock(id, d.title, d.start_time, d.end_time, d.color, d.description || null, d.location || null, d.task_id);
    setCalBlocks((prev) => prev.map((x) => x.id === id ? b : x));
  };
  const handleDeleteCalBlock = async (b: CalBlock) => {
    await deleteCalBlock(b.id);
    setCalBlocks((prev) => prev.filter((x) => x.id !== b.id));
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-2.75rem-5.5rem)] md:h-[calc(100vh-2.5rem)] overflow-hidden">

      <WelcomeBox goals={goals} plans={plans} tasks={tasks} systems={systems}
        dailyGoals={dailyGoals} courseAssignments={courseAssignments} date={date}
        goalPrimaryDone={goalPrimaryDone} goalSecDone={goalSecDone} todaySessions={todaySessions}
        onTogglePrimaryDone={handleTogglePrimaryDone} onToggleSecDone={handleToggleSecDone}
        onSetPrimary={handleSetPrimary} onClearPrimary={handleClearPrimary}
        onAddSecondary={handleAddSecondary} onUpdateSecondaryEstimate={handleUpdateSecondaryEstimate}
        onDeleteSecondary={handleDeleteSecondary} />

      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden relative">

        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-y-auto border-r border-border px-3 py-2 md:px-4 md:py-3 flex flex-col gap-3 md:gap-4">

          {/* To-Do List */}
          <NowPanel
            items={nowItems}
            blockedCount={blocked.length}
            onOpen={(t) => setPlannerId(t.id)}
            onLogSession={(item) => { if (item.block) handleToggleWorked(item.block); }}
            // Turns the count into an action: open the planner on the first
            // thing the gate is holding back, where it can be scheduled.
            onScheduleHint={() => { if (blocked[0]) setPlannerId(blocked[0].id); }}
          />

          <TodoList
            tasks={todayTasks}
            allTasks={tasks}
            plans={plans}
            courseAssignments={courseAssignments}
            blocksByTask={blocksByTask}
            workedBlockIds={workedBlockIds}
            onToggleTask={handleToggleTask}
            onCreateTask={handleCreateTask}
            onDeleteTask={handleDeleteTask}
            onUpdateTask={handleUpdateTask}
            onToggleAssignment={handleToggleAssignment}
          />

        </div>

        {/* ── Right column: Habits + Day Calendar ─────────────────────────── */}
        {/*
          Collapsible and resizable. The day calendar is the densest thing on the
          page and how much room it deserves depends entirely on what the day
          looks like — a wall of blocks wants width, an empty Sunday wants none.
          Both the width and the open/closed state persist, because a layout you
          have to re-adjust on every visit is worse than a fixed one.
        */}
        {!railOpen && (
          <button
            onClick={() => setRailOpen(true)}
            title="Show day calendar"
            className="hidden md:flex absolute bottom-3 right-3 z-10 h-8 w-8 items-center justify-center rounded-md border border-border bg-card shadow-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <PanelRight className="h-4 w-4" />
          </button>
        )}

        {/* 12px hit area around a 1px line. A hairline divider is the right
            *look* but a terrible target; separating the two means the handle is
            easy to grab without drawing a thick bar down the page.
            touch-none stops the browser claiming the gesture for scrolling. */}
        {railOpen && (
        <div
          onPointerDown={startResize}
          title="Drag to resize"
          className="hidden md:flex w-3 shrink-0 cursor-col-resize items-stretch justify-center touch-none group/resize"
        >
          <div className="w-px bg-border transition-colors group-hover/resize:bg-primary group-active/resize:bg-primary" />
        </div>
        )}

        {railOpen && (
        <div
          style={{ width: railWidth }}
          className="hidden md:flex shrink-0 flex-col overflow-hidden px-3 py-3 gap-3 relative">
          <button
            onClick={() => setRailOpen(false)}
            title="Hide day calendar"
            className="absolute top-1 right-1 z-10 p-1 rounded text-muted-foreground/50 hover:text-foreground hover:bg-secondary transition-colors"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
          <HabitsStrip habits={habits} stacks={habitStacks} onToggle={handleToggleHabit} today={date} />
          <DayCalendar
            date={date}
            calBlocks={calBlocks}
            systems={systems}
            courseAssignments={courseAssignments}
            scheduleEntries={scheduleEntries}
            tasks={tasks}
            sessionsByBlock={sessionsByBlock}
            onToggleWorked={handleToggleWorked}
            onCreateBlock={handleCreateCalBlock}
            onUpdateBlock={handleUpdateCalBlock}
            onDeleteBlock={handleDeleteCalBlock}
          />
        </div>
        )}

      </div>

    
      {plannerId != null && (
        <TaskPlanner rootId={plannerId} onClose={() => { setPlannerId(null); load(); }} />
      )}
</div>
  );
}
