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
  courseId: number | null;
  chapterPrefix: string | null;
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
  course_id: number | null; chapter_prefix: string | null;
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
      courseId: r.course_id, chapterPrefix: r.chapter_prefix,
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
  courseId?: number | null; chapterPrefix?: string | null;
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
    course_id: p.courseId ?? null,
    chapter_prefix: p.chapterPrefix ?? null,
  });
  if (error) err(error);
}

export async function updateLearnMaterial(
  id: string,
  patch: Partial<{
    status: MaterialStatus; priority: number; totalUnits: number | null;
    dueDate: string | null; title: string; url: string | null;
    unitLabel: string; courseId: number | null; chapterPrefix: string | null;
    startUnit: number;
  }>,
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
  if (patch.url !== undefined) row.url = patch.url;
  if (patch.unitLabel !== undefined) row.unit_label = patch.unitLabel;
  if (patch.courseId !== undefined) row.course_id = patch.courseId;
  if (patch.chapterPrefix !== undefined) row.chapter_prefix = patch.chapterPrefix;
  if (patch.startUnit !== undefined) row.start_unit = patch.startUnit;
  const { error } = await supabase.from("lr_materials").update(row).eq("id", id);
  if (error) err(error);
}

/** Deleting a material CASCADES its progress events — that history is only
 *  about this material, and orphaned events would poison week totals. */
export async function deleteLearnMaterial(id: string): Promise<void> {
  const { error } = await supabase.from("lr_materials").delete().eq("id", id);
  if (error) err(error);
}

// ── Courses (lr_course + this user's enrollment pacing) ────────────────────

export interface LearnCourse {
  cId: number;
  title: string;
  enrolled: boolean;
  label: string | null;
  chapterPrefix: string | null;
  termStart: string | null;
  week1Chapter: number | null;
  chaptersPerWeek: number | null;
  lectureDow: number | null;
  exerciseDow: number | null;
  active: boolean;
}

export async function getLearnCourses(): Promise<LearnCourse[]> {
  const [courses, enrolls] = await Promise.all([
    supabase.from("lr_course").select("c_id, title").order("c_id"),
    supabase.from("lr_course_enrollment").select("*").eq("user_id", LEARN_USER),
  ]);
  if (courses.error) err(courses.error);
  if (enrolls.error) err(enrolls.error);
  const byId = new Map((enrolls.data ?? []).map((e) => [e.c_id, e]));
  return (courses.data ?? []).map((c) => {
    const e = byId.get(c.c_id);
    return {
      cId: c.c_id,
      title: c.title,
      enrolled: !!e,
      label: e?.label ?? null,
      chapterPrefix: e?.chapter_prefix ?? null,
      termStart: e?.term_start ?? null,
      week1Chapter: e?.week1_chapter ?? null,
      chaptersPerWeek: e?.chapters_per_week != null ? Number(e.chapters_per_week) : null,
      lectureDow: e?.lecture_dow ?? null,
      exerciseDow: e?.exercise_dow ?? null,
      active: e?.active ?? false,
    };
  });
}

export interface EnrollPayload {
  label: string;
  chapterPrefix: string;
  termStart: string; // YYYY-MM-DD
  week1Chapter?: number;
  chaptersPerWeek?: number;
  lectureDow?: number | null;   // 0=Sunday — the pf_recurring convention, NOT ISO
  exerciseDow?: number | null;
}

/** Create a course shell + enrollment. ⚠️ A course made here has NO concept
 *  graph until the LearnAndRetain ingest builds one — the UI must say so
 *  rather than showing an empty lesson pool as a bug. */
export async function createLearnCourse(title: string, enroll: EnrollPayload): Promise<void> {
  const { data, error } = await supabase.from("lr_course")
    .insert({ title, active: true }).select("c_id").single();
  if (error) err(error);
  const cId = (data as { c_id: number }).c_id;
  await enrollLearnCourse(cId, enroll);
}

export async function enrollLearnCourse(cId: number, e: EnrollPayload): Promise<void> {
  const { error } = await supabase.from("lr_course_enrollment").upsert({
    user_id: LEARN_USER,
    c_id: cId,
    label: e.label,
    chapter_prefix: e.chapterPrefix,
    term_start: e.termStart,
    week1_chapter: e.week1Chapter ?? 1,
    chapters_per_week: e.chaptersPerWeek ?? 1,
    lecture_dow: e.lectureDow ?? null,
    exercise_dow: e.exerciseDow ?? null,
    weight: 1,
    active: true,
  }, { onConflict: "user_id,c_id" });
  if (error) err(error);
}

export async function setLearnCourseActive(cId: number, active: boolean): Promise<void> {
  const { error } = await supabase.from("lr_course_enrollment")
    .update({ active }).eq("user_id", LEARN_USER).eq("c_id", cId);
  if (error) err(error);
}
