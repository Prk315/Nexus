// Timed reminders on the calendar — the read side and every write.
//
// A reminder is a pf_tasks row (category 'reminder') plus its pf_task_reminders
// subtype row. Ticking completes the TASK; the time lives on the subtype. Both
// go through PathFinder's api layer, never raw writes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createQuickTask, deleteTask, getRemindersInRange, saveTaskSubtype, toggleTask } from "../../lib/api";
import type { CalReminder } from "../../lib/reminders";

export interface ReminderAttrs {
  remind_at: string | null;
  lead_minutes: number | null;
}

export interface CalRemindersState {
  reminders: CalReminder[];
  /** A failed read, said out loud — not rendered as "no reminders". */
  error: string | null;
  actionError: string | null;
  clearActionError: () => void;
  reload: () => Promise<void>;
  toggle: (r: CalReminder) => Promise<void>;
  save: (taskId: number, attrs: ReminderAttrs) => Promise<boolean>;
  create: (title: string, attrs: ReminderAttrs) => Promise<boolean>;
  remove: (taskId: number) => Promise<boolean>;
}

export function useCalReminders(start: string, end: string, onChanged?: () => void): CalRemindersState {
  const [reminders, setReminders] = useState<CalReminder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const generation = useRef(0);
  // Held in a ref so a parent passing an inline callback doesn't re-create
  // every action (and re-run every effect) on each render.
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const reload = useCallback(async () => {
    const gen = ++generation.current;
    try {
      const rows = await getRemindersInRange(start, end);
      if (gen !== generation.current) return;
      setReminders(rows);
      setError(null);
    } catch (e) {
      if (gen !== generation.current) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [start, end]);

  useEffect(() => { void reload(); }, [reload]);

  // Added or ticked from the sidebar panel, the phone or another tab.
  useEffect(() => {
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setActionError(null);
      changed.current?.();
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      await reload();
    }
  }, [reload]);

  const toggle = useCallback(async (r: CalReminder) => {
    setReminders((prev) => prev.map((x) => (x.task_id === r.task_id ? { ...x, done: !x.done } : x)));
    await run(() => toggleTask(r.task_id));
  }, [run]);

  const save = useCallback(
    (taskId: number, attrs: ReminderAttrs) => run(() => saveTaskSubtype(taskId, "reminder", attrs)),
    [run],
  );

  const create = useCallback(
    (title: string, attrs: ReminderAttrs) => run(() => createQuickTask("reminder", title.trim(), { ...attrs })),
    [run],
  );

  const remove = useCallback((taskId: number) => run(() => deleteTask(taskId)), [run]);

  return useMemo(() => ({
    reminders, error, actionError,
    clearActionError: () => setActionError(null),
    reload, toggle, save, create, remove,
  }), [reminders, error, actionError, reload, toggle, save, create, remove]);
}
