// Calendar blocks (one-off and recurring), schedule entries and time blocks.

import {
  err, expandRecurring, expandScheduleEntries, mapScheduleEntry, num, supabase, getUserId,
} from "./_shared";
import type {
  CalBlock, RecurringCalBlock, ScheduleEntry, TimeBlock,
} from "../../types";
import { CATEGORIES } from "@nexus/core/categories";

// ═══════════════════════════════════════════════════════════════════════════
// CALENDAR BLOCKS
// ═══════════════════════════════════════════════════════════════════════════

export const getCalBlocks = async (startDate: string, endDate: string): Promise<CalBlock[]> => {
  const [{ data: regular }, { data: recurring }] = await Promise.all([
    supabase.from("pf_cal_blocks").select("*").eq("user_id", getUserId())
      .gte("date", startDate).lte("date", endDate).order("start_time"),
    supabase.from("pf_recurring_cal_blocks").select("*").eq("user_id", getUserId())
      .lte("start_date", endDate)
      .or(`end_date.is.null,end_date.gte.${startDate}`),
  ]);

  const regularMapped: CalBlock[] = (regular ?? []).map((b) => ({
    id: num(b.id), date: b.date, title: b.title, start_time: b.start_time,
    end_time: b.end_time, color: b.color, description: b.description,
    location: b.location, created_at: b.created_at,
    is_recurring: false, recurring_id: null, recurrence: null,
    days_of_week: null, series_start_date: null, series_end_date: null,
    task_id: b.task_id ? num(b.task_id) : null,
    category: b.category ?? null,
    parent_block_id: b.parent_block_id != null ? num(b.parent_block_id) : null,
  }));

  const virtual = (recurring ?? []).flatMap((r) => expandRecurring(r, startDate, endDate));

  return [...regularMapped, ...virtual].sort(
    (a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time)
  );
};

export type CoverageCategoryOption = { name: string; color: string; emoji: string };

/**
 * The 7 shared categories for the block category picker (Phase E), ordered by
 * `sort`. Falls back to the `CATEGORIES` constant on any fetch failure or an
 * empty table (e.g. the migration hasn't landed on this Supabase project yet
 * from this machine's point of view) so the picker never renders empty.
 */
export const getCoverageCategories = async (): Promise<CoverageCategoryOption[]> => {
  try {
    const { data, error } = await supabase
      .from("coverage_categories")
      .select("name, color, emoji, sort")
      .eq("user_id", getUserId())
      .order("sort", { ascending: true });
    if (error || !data || data.length === 0) throw error ?? new Error("coverage_categories empty");
    return data.map((r: any) => ({ name: String(r.name), color: String(r.color), emoji: r.emoji ?? "" }));
  } catch {
    return CATEGORIES.map((c) => ({ name: c.name, color: c.color, emoji: c.emoji }));
  }
};

/**
 * True when setting `blockId`'s parent to `newParentId` would create a cycle
 * — i.e. `newParentId`'s own parent chain, walked through `dayBlocks` (the
 * day's already-loaded blocks — cheap, no extra round trip), already
 * contains `blockId`. `blockId === null` means "a brand-new block", which
 * can never be its own ancestor, so only the chain-containment check applies.
 *
 * This is a client-side backstop for chains deeper than one hop. The DB's
 * `pf_cal_blocks_no_self_parent` CHECK already refuses the trivial
 * `newParentId === blockId` case on its own.
 */
export function wouldCreateCalBlockCycle(
  dayBlocks: CalBlock[], blockId: number | null, newParentId: number | null,
): boolean {
  if (newParentId == null) return false;
  if (blockId != null && newParentId === blockId) return true;
  const byId = new Map(dayBlocks.map((b) => [b.id, b]));
  const seen = new Set<number>();
  let cur: number | null = newParentId;
  while (cur != null) {
    if (blockId != null && cur === blockId) return true;
    if (seen.has(cur)) return true; // pre-existing cycle in the loaded data — refuse to extend it
    seen.add(cur);
    cur = byId.get(cur)?.parent_block_id ?? null;
  }
  return false;
}

export const createCalBlock = async (
  date: string, title: string, startTime: string, endTime: string,
  color: string, description: string | null, location: string | null,
  taskId?: number | null, category?: string | null,
  parentBlockId?: number | null, dayBlocks?: CalBlock[],
): Promise<CalBlock> => {
  if (parentBlockId != null && dayBlocks && wouldCreateCalBlockCycle(dayBlocks, null, parentBlockId)) {
    throw new Error("Cannot nest a block under itself or one of its own descendants.");
  }
  const { data, error } = await supabase
    .from("pf_cal_blocks")
    .insert({ user_id: getUserId(), date, title, start_time: startTime, end_time: endTime, color, description, location, task_id: taskId ?? null, category: category ?? null, parent_block_id: parentBlockId ?? null })
    .select().single();
  if (error) err(error);
  return { id: num(data!.id), date: data!.date, title: data!.title, start_time: data!.start_time, end_time: data!.end_time, color: data!.color, description: data!.description, location: data!.location, created_at: data!.created_at, is_recurring: false, recurring_id: null, recurrence: null, days_of_week: null, series_start_date: null, series_end_date: null, task_id: data!.task_id ? num(data!.task_id) : null, category: data!.category ?? null, parent_block_id: data!.parent_block_id != null ? num(data!.parent_block_id) : null };
};

export const updateCalBlock = async (
  id: number, title: string, startTime: string, endTime: string,
  color: string, description: string | null, location: string | null,
  taskId?: number | null, category?: string | null,
  parentBlockId?: number | null, dayBlocks?: CalBlock[], date?: string,
): Promise<CalBlock> => {
  // `category` is only written when the caller actually passes it — omitting
  // the argument (older call sites, e.g. Dashboard's block editor) must leave
  // an existing category untouched rather than silently clearing it.
  // `parent_block_id` follows the SAME discipline: only written when
  // `parentBlockId !== undefined`, so a caller that doesn't know about
  // nesting can never wipe an existing block's parent out from under it.
  // `date` follows suit too (added for U2's drag-across-days move) — every
  // pre-existing caller omits it and leaves the block's date untouched.
  if (
    parentBlockId !== undefined && parentBlockId != null && dayBlocks &&
    wouldCreateCalBlockCycle(dayBlocks, id, parentBlockId)
  ) {
    throw new Error("Cannot nest a block under itself or one of its own descendants.");
  }
  const patch: Record<string, unknown> = { title, start_time: startTime, end_time: endTime, color, description, location, task_id: taskId ?? null };
  if (category !== undefined) patch.category = category;
  if (parentBlockId !== undefined) patch.parent_block_id = parentBlockId;
  if (date !== undefined) patch.date = date;
  const { data, error } = await supabase
    .from("pf_cal_blocks")
    .update(patch)
    .eq("id", id).select().single();
  if (error) err(error);
  return { id: num(data!.id), date: data!.date, title: data!.title, start_time: data!.start_time, end_time: data!.end_time, color: data!.color, description: data!.description, location: data!.location, created_at: data!.created_at, is_recurring: false, recurring_id: null, recurrence: null, days_of_week: null, series_start_date: null, series_end_date: null, task_id: data!.task_id ? num(data!.task_id) : null, category: data!.category ?? null, parent_block_id: data!.parent_block_id != null ? num(data!.parent_block_id) : null };
};

export const deleteCalBlock = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_cal_blocks").delete().eq("id", id);
  if (error) err(error);
};

// ─── Recurring calendar blocks ──────────────────────────────────────────────

export const createRecurringCalBlock = async (
  title: string, startTime: string, endTime: string, color: string,
  recurrence: string, daysOfWeek: string | null, startDate: string,
  endDate: string | null, description: string | null, location: string | null,
  taskId?: number | null, category?: string | null,
): Promise<RecurringCalBlock> => {
  const { data, error } = await supabase
    .from("pf_recurring_cal_blocks")
    .insert({ user_id: getUserId(), title, start_time: startTime, end_time: endTime, color, recurrence, days_of_week: daysOfWeek, start_date: startDate, end_date: endDate, description, location, task_id: taskId ?? null, category: category ?? null })
    .select().single();
  if (error) err(error);
  return data! as RecurringCalBlock;
};

export const updateRecurringCalBlock = async (
  id: number, title: string, startTime: string, endTime: string, color: string,
  recurrence: string, daysOfWeek: string | null, endDate: string | null,
  description: string | null, location: string | null, category?: string | null,
): Promise<void> => {
  // Same omit-means-untouched rule as updateCalBlock.
  const patch: Record<string, unknown> = { title, start_time: startTime, end_time: endTime, color, recurrence, days_of_week: daysOfWeek, end_date: endDate, description, location };
  if (category !== undefined) patch.category = category;
  const { error } = await supabase
    .from("pf_recurring_cal_blocks")
    .update(patch)
    .eq("id", id);
  if (error) err(error);
};

export const deleteRecurringCalBlock = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_recurring_cal_blocks").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULE ENTRIES
// ═══════════════════════════════════════════════════════════════════════════

export const getScheduleEntriesByPlan = async (planId: number): Promise<ScheduleEntry[]> => {
  const { data, error } = await supabase
    .from("pf_schedule_entries")
    .select("*, pf_plans(title)")
    .eq("plan_id", planId)
    .order("created_at");
  if (error) err(error);
  return (data ?? []).map((e) => mapScheduleEntry(e));
};

export const getAllScheduleEntries = async (): Promise<ScheduleEntry[]> => {
  const { data, error } = await supabase
    .from("pf_schedule_entries")
    .select("*, pf_plans(title)")
    .eq("user_id", getUserId())
    .order("start_time");
  if (error) err(error);
  return (data ?? []).map((e) => mapScheduleEntry(e));
};

/** Returns all schedule entries (one-off + expanded recurring) for a single date. */
export const getScheduleEntriesForDate = async (date: string): Promise<ScheduleEntry[]> => {
  const [{ data: oneOff }, { data: recurring }] = await Promise.all([
    supabase.from("pf_schedule_entries")
      .select("*, pf_plans(title)")
      .eq("user_id", getUserId()).eq("is_recurring", false).eq("date", date),
    supabase.from("pf_schedule_entries")
      .select("*, pf_plans(title)")
      .eq("user_id", getUserId()).eq("is_recurring", true)
      .lte("series_start_date", date)
      .or(`series_end_date.is.null,series_end_date.gte.${date}`),
  ]);
  return [
    ...(oneOff  ?? []).map((e) => mapScheduleEntry(e)),
    ...(recurring ?? []).flatMap((e) => expandScheduleEntries(e, date, date)),
  ];
};

export const createScheduleEntry = async (payload: {
  plan_id: number;
  title: string;
  description?: string | null;
  location?: string | null;
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  color?: string;
  category?: string;
  is_recurring?: boolean;
  recurrence?: string | null;
  days_of_week?: string | null;
  series_start_date?: string | null;
  series_end_date?: string | null;
}): Promise<ScheduleEntry> => {
  const { data, error } = await supabase
    .from("pf_schedule_entries")
    .insert({ user_id: getUserId(), ...payload })
    .select("*, pf_plans(title)")
    .single();
  if (error) err(error);
  return mapScheduleEntry(data!);
};

export const updateScheduleEntry = async (id: number, payload: {
  title: string;
  description?: string | null;
  location?: string | null;
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  color?: string;
  category?: string;
  is_recurring?: boolean;
  recurrence?: string | null;
  days_of_week?: string | null;
  series_start_date?: string | null;
  series_end_date?: string | null;
}): Promise<ScheduleEntry> => {
  const { data, error } = await supabase
    .from("pf_schedule_entries")
    .update(payload)
    .eq("id", id)
    .select("*, pf_plans(title)")
    .single();
  if (error) err(error);
  return mapScheduleEntry(data!);
};

export const deleteScheduleEntry = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_schedule_entries").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// TIME BLOCKS
// ═══════════════════════════════════════════════════════════════════════════

export const getTimeBlocks = async (date: string): Promise<TimeBlock[]> => {
  const { data, error } = await supabase
    .from("pf_time_blocks").select("*").eq("user_id", getUserId()).eq("date", date);
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), date: r.date, slot: r.slot, label: r.label }));
};

export const saveTimeBlock = async (date: string, slot: string, label: string): Promise<void> => {
  const { error } = await supabase
    .from("pf_time_blocks")
    .upsert({ user_id: getUserId(), date, slot, label }, { onConflict: "user_id,date,slot" });
  if (error) err(error);
};
