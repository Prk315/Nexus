import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import {
  getPlans, createPlan, updatePlan, deletePlan, getAllScheduleEntries,
  createScheduleEntry, updateScheduleEntry, deleteScheduleEntry,
} from "../lib/api";
import type { Plan, ScheduleEntry } from "../types";

// ── Entry draft shape (shared by forms) ───────────────────────────────────────

export type Category = "transport" | "medical" | "fitness" | "work" | "social" | "other";

export interface EntryDraft {
  category: Category;
  title: string;
  location: string;
  description: string;
  color: string;
  start_time: string;
  end_time: string;
  is_recurring: boolean;
  date: string;
  recurrence: "weekly" | "daily";
  days_of_week: number[];
  series_start_date: string;
  series_end_date: string;
}

export interface PlanDraft {
  title: string;
  description: string;
}

// ── Context value ──────────────────────────────────────────────────────────────

export interface SchedulesContextValue {
  plans: Plan[];
  allEntries: ScheduleEntry[];
  /** Reload schedules from Supabase (plans list) */
  loadPlans: () => Promise<void>;
  /** Reload all entries from Supabase */
  loadAllEntries: () => Promise<void>;
  /** Optimistically merge a plan's entries into allEntries after a local edit */
  mergeEntries: (planId: number, entries: ScheduleEntry[]) => void;
  /** Create a new schedule (is_schedule plan) */
  createSchedule: (d: PlanDraft) => Promise<void>;
  /** Update an existing schedule */
  updateSchedule: (plan: Plan, d: PlanDraft) => Promise<void>;
  /** Delete a schedule and all its entries */
  deleteSchedule: (plan: Plan) => Promise<void>;
  /** Add an entry to a plan */
  addEntry: (planId: number, d: EntryDraft) => Promise<void>;
  /** Update an existing entry */
  editEntry: (entry: ScheduleEntry, d: EntryDraft) => Promise<void>;
  /** Delete an entry */
  removeEntry: (id: number) => Promise<void>;
}

// ── Context ────────────────────────────────────────────────────────────────────

const SchedulesContext = createContext<SchedulesContextValue | null>(null);

export function SchedulesProvider({ children }: { children: ReactNode }) {
  const [plans,      setPlans]      = useState<Plan[]>([]);
  const [allEntries, setAllEntries] = useState<ScheduleEntry[]>([]);

  const loadPlans = useCallback(async () => {
    const all = await getPlans();
    setPlans(all.filter((p) => p.is_schedule));
  }, []);

  const loadAllEntries = useCallback(async () => {
    setAllEntries(await getAllScheduleEntries());
  }, []);

  useEffect(() => {
    loadPlans();
    loadAllEntries();
  }, [loadPlans, loadAllEntries]);

  const mergeEntries = useCallback((planId: number, entries: ScheduleEntry[]) => {
    setAllEntries((prev) => [
      ...prev.filter((e) => e.plan_id !== planId),
      ...entries,
    ]);
  }, []);

  const createSchedule = useCallback(async (d: PlanDraft) => {
    await createPlan({ title: d.title, description: d.description.trim() || null, is_schedule: true });
    await loadPlans();
  }, [loadPlans]);

  const updateSchedule = useCallback(async (plan: Plan, d: PlanDraft) => {
    await updatePlan(plan.id, {
      title: d.title, description: d.description.trim() || null,
      status: plan.status, is_schedule: true,
    });
    await loadPlans();
  }, [loadPlans]);

  const deleteSchedule = useCallback(async (plan: Plan) => {
    await deletePlan(plan.id);
    await Promise.all([loadPlans(), loadAllEntries()]);
  }, [loadPlans, loadAllEntries]);

  function draftToPayload(planId: number, d: EntryDraft) {
    return {
      plan_id:           planId,
      title:             d.title,
      category:          d.category,
      description:       d.description.trim()  || null,
      location:          d.location.trim()      || null,
      color:             d.color,
      start_time:        d.start_time           || null,
      end_time:          d.end_time             || null,
      is_recurring:      d.is_recurring,
      recurrence:        d.is_recurring ? d.recurrence : null,
      days_of_week:      d.is_recurring && d.recurrence === "weekly" ? d.days_of_week.join(",") : null,
      date:              d.is_recurring ? null : (d.date || null),
      series_start_date: d.is_recurring ? (d.series_start_date || null) : null,
      series_end_date:   d.is_recurring ? (d.series_end_date   || null) : null,
    };
  }

  const addEntry = useCallback(async (planId: number, d: EntryDraft) => {
    await createScheduleEntry(draftToPayload(planId, d));
    await loadAllEntries();
  }, [loadAllEntries]);

  const editEntry = useCallback(async (entry: ScheduleEntry, d: EntryDraft) => {
    const { plan_id, ...rest } = draftToPayload(entry.plan_id, d);
    await updateScheduleEntry(entry.id, rest);
    await loadAllEntries();
  }, [loadAllEntries]);

  const removeEntry = useCallback(async (id: number) => {
    await deleteScheduleEntry(id);
    await loadAllEntries();
  }, [loadAllEntries]);

  return (
    <SchedulesContext.Provider value={{
      plans, allEntries,
      loadPlans, loadAllEntries, mergeEntries,
      createSchedule, updateSchedule, deleteSchedule,
      addEntry, editEntry, removeEntry,
    }}>
      {children}
    </SchedulesContext.Provider>
  );
}

export function useSchedules(): SchedulesContextValue {
  const ctx = useContext(SchedulesContext);
  if (!ctx) throw new Error("useSchedules() must be inside <SchedulesProvider>");
  return ctx;
}
