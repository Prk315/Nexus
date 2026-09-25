// Learn ecosystem: tracked study materials + the composed daily plan.
//
// These are `lr_` tables — the Learn family, keyed `user_id = 'default'`
// under permissive RLS (the policy's role list is {public}, so the
// authenticated client this app exports reads them fine). They are NOT
// pf_ rows: no team scoping, no getUserId(). The daily plan itself is
// written by the `learn-plan` edge function on pg_cron; this module only
// reads it, logs progress, and manages materials — the generator reads
// those logs to decide tomorrow's blocks.

import { supabase, err } from "./_shared";
import {
  materialPosition, materialFraction, materialPace, lastActivityDate,
  type LearnEventLike, type MaterialLike,
} from "../learnProgress";

const LEARN_USER = "default";
const EVENT_WINDOW_DAYS = 90;

export type MaterialKind = "book" | "document" | "paper" | "assignment" | "course" | "lesson";
export type MaterialStatus = "active" | "paused" | "done";

export interface LearnMaterial extends MaterialLike {
  kind: MaterialKind;
  title: string;
  vaultNodeId: string | null;
  url: string | null;
  unitLabel: string;
  priority: number;
  status: MaterialStatus;
  dueDate: string | null;
  notes: string | null;
  // Derived from the event window:
  position: number;
  fraction: number | null;
  pace: number;
  lastActivity: string | null;
}

export interface LearnPlanBlockReading {
  minutes: number; material_id: string; title: string;
  vault_node_id: string | null; unit_label: string;
  from: number; to: number; pace: number;
}
export interface LearnPlanBlockLesson {
  minutes?: number; material_id?: string; title?: string; url?: string | null;
  retention?: boolean; phase?: string;
}
export interface LearnPlan {
  planDate: string;
  blocks: {
    intro: { minutes: number };
    reading: LearnPlanBlockReading | null;
    lesson: LearnPlanBlockLesson;
    review: { minutes: number; due_concepts: number | null };
  };
  briefMd: string;
  pfTaskIds: number[];
  vaultNoteId: string | null;
  status: "ready" | "done";
  generatedAt: string;
}

/** Today's plan, or null — and null must render as "not generated yet",
 *  never as an empty day. The cron writes it; absence is absence. */
export async function getLearnDay(date: string): Promise<LearnPlan | null> {
  const { data, error } = await supabase
    .from("lr_daily_plan").select("*")
    .eq("user_id", LEARN_USER).eq("plan_date", date).maybeSingle();
  if (error) err(error);
  if (!data) return null;
  return {
    planDate: data.plan_date,
    blocks: data.blocks,
    briefMd: data.brief_md,
    pfTaskIds: Array.isArray(data.pf_task_ids) ? data.pf_task_ids : [],
    vaultNoteId: data.vault_note_id,
    status: data.status,
    generatedAt: data.generated_at,
  };
}

export async function markLearnDayDone(date: string): Promise<void> {
  const { error } = await supabase.from("lr_daily_plan")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("user_id", LEARN_USER).eq("plan_date", date);
  if (error) err(error);
}

interface MaterialRow {
  id: string; kind: MaterialKind; title: string;
  vault_node_id: string | null; url: string | null;
  unit_label: string; total_units: number | null; start_unit: number;
  pace_units_per_min: number; priority: number; status: MaterialStatus;
  due_date: string | null; notes: string | null;
}

export async function getLearnMaterials(): Promise<LearnMaterial[]> {
  const since = new Date(Date.now() - EVENT_WINDOW_DAYS * 86_400_000)
    .toISOString().slice(0, 10);
  const [mats, evs] = await Promise.all([
    supabase.from("lr_materials").select("*").eq("user_id", LEARN_USER)
      .order("priority", { ascending: false }).order("title"),
    supabase.from("lr_progress_events")
      .select("material_id, event_date, kind, units_from, units_to, units_delta, minutes")
      .eq("user_id", LEARN_USER).gte("event_date", since),
  ]);
  if (mats.error) err(mats.error);
  if (evs.error) err(evs.error);
  const events = (evs.data ?? []) as LearnEventLike[];
  return ((mats.data ?? []) as MaterialRow[]).map((r) => {
    const like: MaterialLike = {
      id: r.id, start_unit: r.start_unit,
      total_units: r.total_units, pace_units_per_min: r.pace_units_per_min,
    };
    const position = materialPosition(like, events);
    return {
      ...like,
      kind: r.kind, title: r.title, vaultNodeId: r.vault_node_id, url: r.url,
      unitLabel: r.unit_label, priority: r.priority, status: r.status,
      dueDate: r.due_date, notes: r.notes,
      position,
      fraction: materialFraction(like, position),
      pace: materialPace(like, events),
      lastActivity: lastActivityDate(like, events),
    };
  });
}

export interface LogProgressPayload {
  materialId: string;
  kind?: "reading" | "exercise" | "lesson" | "review" | "other";
  unitsFrom?: number | null;
  unitsTo?: number | null;
  unitsDelta?: number | null;
  minutes?: number | null;
  note?: string | null;
}

export async function logLearnProgress(p: LogProgressPayload): Promise<void> {
  const { error } = await supabase.from("lr_progress_events").insert({
    user_id: LEARN_USER,
    material_id: p.materialId,
    kind: p.kind ?? "reading",
    units_from: p.unitsFrom ?? null,
    units_to: p.unitsTo ?? null,
    units_delta: p.unitsDelta ?? null,
    minutes: p.minutes ?? null,
    note: p.note ?? null,
    source: "pathfinder",
  });
  if (error) err(error);
}

export interface CreateMaterialPayload {
  kind: MaterialKind; title: string;
  totalUnits?: number | null; startUnit?: number;
  vaultNodeId?: string | null; url?: string | null;
  unitLabel?: string; priority?: number; dueDate?: string | null;
}

export async function createLearnMaterial(p: CreateMaterialPayload): Promise<void> {
  const { error } = await supabase.from("lr_materials").insert({
    user_id: LEARN_USER,
    kind: p.kind,
    title: p.title,
    total_units: p.totalUnits ?? null,
    start_unit: p.startUnit ?? 0,
    vault_node_id: p.vaultNodeId ?? null,
    url: p.url ?? null,
    unit_label: p.unitLabel ?? "pages",
    priority: p.priority ?? 1,
    due_date: p.dueDate ?? null,
  });
  if (error) err(error);
}

export async function updateLearnMaterial(
  id: string,
  patch: Partial<{ status: MaterialStatus; priority: number; totalUnits: number | null; dueDate: string | null; title: string }>,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    row.status = patch.status;
    row.completed_at = patch.status === "done" ? new Date().toISOString() : null;
  }
  if (patch.priority !== undefined) row.priority = patch.priority;
  if (patch.totalUnits !== undefined) row.total_units = patch.totalUnits;
  if (patch.dueDate !== undefined) row.due_date = patch.dueDate;
  if (patch.title !== undefined) row.title = patch.title;
  const { error } = await supabase.from("lr_materials").update(row).eq("id", id);
  if (error) err(error);
}
