import { supabase, getUserId } from "./supabase";
import type { CalendarEvent } from "@nexus/core";

// ─── Cross-app read/write: PathFinder's calendar, from inside Vault ──────────
// Every Nexus app shares ONE Supabase project + ONE account (auth.uid()), so
// Vault can read AND write PathFinder's pf_* tables directly with the same
// session — no IPC hub. RLS (user_id = auth.uid()) is the guard. Payloads here
// mirror PathFinder's own api.ts so both apps stay schema-compatible.

/** Local YYYY-MM-DD for a Date (the calendar day as the user sees it). */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** pf_ times may be "HH:MM:SS"; the calendar UI wants "HH:MM". */
const hhmm = (t: string | null): string => (t ?? "").slice(0, 5);

/** A calendar entry for one day, carrying the metadata needed to edit it. */
export interface PfCalEntry {
  key: string; // stable id used as CalendarEvent.id
  kind: "single" | "recurring";
  sourceId: number; // pf_cal_blocks.id OR pf_recurring_cal_blocks.id
  date: string; // day it appears on (YYYY-MM-DD)
  title: string;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  color: string;
  description: string | null;
  location: string | null;
  // recurring-only:
  recurrence?: string; // "daily" | "weekly"
  daysOfWeek?: string | null; // comma-separated getUTCDay() numbers
  startDate?: string;
  endDate?: string | null;
}

export function entryToEvent(e: PfCalEntry): CalendarEvent {
  return {
    id: e.key,
    title: e.title,
    startTime: e.startTime,
    endTime: e.endTime,
    color: e.color,
    recurring: e.kind === "recurring",
  };
}

/**
 * Load PathFinder's blocks for a single day: one-off `pf_cal_blocks` plus
 * recurring `pf_recurring_cal_blocks` expanded onto that day (UTC weekday,
 * daily/weekly — mirrors PathFinder's own expandRecurring). [] if signed out.
 */
export async function loadPathfinderDay(date: Date): Promise<PfCalEntry[]> {
  const dateStr = toIsoDate(date);

  let userId: string;
  try {
    userId = getUserId();
  } catch {
    return [];
  }

  const [{ data: regular }, { data: recurring }] = await Promise.all([
    supabase
      .from("pf_cal_blocks")
      .select("*")
      .eq("user_id", userId)
      .eq("date", dateStr)
      .order("start_time"),
    supabase
      .from("pf_recurring_cal_blocks")
      .select("*")
      .eq("user_id", userId)
      .lte("start_date", dateStr)
      .or(`end_date.is.null,end_date.gte.${dateStr}`),
  ]);

  const entries: PfCalEntry[] = [];

  for (const b of regular ?? []) {
    entries.push({
      key: `pf-${b.id}`,
      kind: "single",
      sourceId: b.id,
      date: b.date,
      title: b.title,
      startTime: hhmm(b.start_time),
      endTime: hhmm(b.end_time),
      color: b.color,
      description: b.description,
      location: b.location,
    });
  }

  const dow = new Date(dateStr + "T00:00:00Z").getUTCDay();
  for (const r of recurring ?? []) {
    const days: number[] = r.days_of_week
      ? String(r.days_of_week).split(",").map(Number)
      : [];
    const matches =
      r.recurrence === "daily" ||
      (r.recurrence === "weekly" && days.includes(dow));
    if (!matches) continue;
    entries.push({
      key: `pf-r-${r.id}-${dateStr}`,
      kind: "recurring",
      sourceId: r.id,
      date: dateStr,
      title: r.title,
      startTime: hhmm(r.start_time),
      endTime: hhmm(r.end_time),
      color: r.color,
      description: r.description,
      location: r.location,
      recurrence: r.recurrence,
      daysOfWeek: r.days_of_week,
      startDate: r.start_date,
      endDate: r.end_date,
    });
  }

  return entries.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** CalendarEvent[] for a day (read-only convenience). */
export async function getPathfinderEvents(date: Date): Promise<CalendarEvent[]> {
  return (await loadPathfinderDay(date)).map(entryToEvent);
}

// ─── Writes (mirror PathFinder's api.ts payloads) ───────────────────────────

export interface BlockInput {
  date: string;
  title: string;
  startTime: string;
  endTime: string;
  color: string;
  description?: string | null;
  location?: string | null;
}

export async function createBlock(input: BlockInput): Promise<void> {
  const { error } = await supabase.from("pf_cal_blocks").insert({
    user_id: getUserId(),
    date: input.date,
    title: input.title,
    start_time: input.startTime,
    end_time: input.endTime,
    color: input.color,
    description: input.description ?? null,
    location: input.location ?? null,
    task_id: null,
  });
  if (error) throw error;
}

export async function updateBlock(
  id: number,
  patch: Omit<BlockInput, "date">
): Promise<void> {
  const { error } = await supabase
    .from("pf_cal_blocks")
    .update({
      title: patch.title,
      start_time: patch.startTime,
      end_time: patch.endTime,
      color: patch.color,
      description: patch.description ?? null,
      location: patch.location ?? null,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteBlock(id: number): Promise<void> {
  const { error } = await supabase.from("pf_cal_blocks").delete().eq("id", id);
  if (error) throw error;
}

export interface SeriesInput {
  title: string;
  startTime: string;
  endTime: string;
  color: string;
  recurrence: string; // "daily" | "weekly"
  daysOfWeek: string | null; // comma-separated getUTCDay numbers (weekly only)
  startDate: string;
  endDate: string | null;
  description?: string | null;
  location?: string | null;
}

export async function createSeries(input: SeriesInput): Promise<void> {
  const { error } = await supabase.from("pf_recurring_cal_blocks").insert({
    user_id: getUserId(),
    title: input.title,
    start_time: input.startTime,
    end_time: input.endTime,
    color: input.color,
    recurrence: input.recurrence,
    days_of_week: input.daysOfWeek,
    start_date: input.startDate,
    end_date: input.endDate,
    description: input.description ?? null,
    location: input.location ?? null,
  });
  if (error) throw error;
}

export async function updateSeries(
  id: number,
  patch: Omit<SeriesInput, "startDate">
): Promise<void> {
  const { error } = await supabase
    .from("pf_recurring_cal_blocks")
    .update({
      title: patch.title,
      start_time: patch.startTime,
      end_time: patch.endTime,
      color: patch.color,
      recurrence: patch.recurrence,
      days_of_week: patch.daysOfWeek,
      end_date: patch.endDate,
      description: patch.description ?? null,
      location: patch.location ?? null,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteSeries(id: number): Promise<void> {
  const { error } = await supabase
    .from("pf_recurring_cal_blocks")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
